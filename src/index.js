const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization"
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

async function hashCode(code, pepper) {
  const bytes = new TextEncoder().encode(`${pepper}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}


const ADMIN_FALLBACK_SHA256 = "9bf84a9825fcf66c467a2a73d1369ab3ba5f4d5a86c146046dfe46881eed0e49";

async function sha256Text(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function adminAuthorized(request, env) {
  const auth = request.headers.get("authorization") || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!supplied || !env.DB) return false;
  await ensureAdminAuthTables(env);
  const tokenHash = await sha256Text(supplied);
  const now = Date.now();
  const row = await env.DB.prepare("SELECT token_hash,expires_at FROM admin_sessions WHERE token_hash=? AND expires_at>? LIMIT 1").bind(tokenHash, now).first();
  if (!row) return false;
  try { await env.DB.prepare("UPDATE admin_sessions SET last_seen_at=? WHERE token_hash=?").bind(now, tokenHash).run(); } catch(_) {}
  return true;
}

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

function b64urlBytes(bytes) {
  let s=""; for (const b of bytes) s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function b64urlText(value) { return b64urlBytes(new TextEncoder().encode(value)); }
function b64urlDecode(value) {
  const s=String(value||"").replace(/-/g,"+").replace(/_/g,"/");
  const bin=atob(s+"=".repeat((4-s.length%4)%4)), out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out;
}
async function recoveryCryptoKey(env) {
  const seed = new TextEncoder().encode("carplay-subscription-recovery:" + String(env.CODE_PEPPER || "carplay-recovery"));
  const digest = await crypto.subtle.digest("SHA-256", seed);
  return crypto.subtle.importKey("raw", digest, {name:"AES-GCM"}, false, ["encrypt","decrypt"]);
}
async function sealRecoveryCode(code, env) {
  const clean = normalizeCode(code);
  if (!validCode(clean)) throw new Error("CODE_INVALIDE");
  const key = await recoveryCryptoKey(env), iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, new TextEncoder().encode(clean));
  return b64urlBytes(iv) + "." + b64urlBytes(new Uint8Array(encrypted));
}
async function openRecoveryCode(box, env) {
  const parts = String(box || "").split(".");
  if (parts.length !== 2) throw new Error("CODE_RECUPERATION_NON_INITIALISE");
  const key = await recoveryCryptoKey(env), iv = b64urlDecode(parts[0]), encrypted = b64urlDecode(parts[1]);
  const plain = await crypto.subtle.decrypt({name:"AES-GCM", iv}, key, encrypted);
  const code = normalizeCode(new TextDecoder().decode(plain));
  if (!validCode(code)) throw new Error("CODE_RECUPERATION_NON_INITIALISE");
  return code;
}
async function ensureGpsUnlockTables(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS gps_unlock_requests (
    id TEXT PRIMARY KEY, market_key TEXT NOT NULL, market_name TEXT NOT NULL DEFAULT '', requester_name TEXT NOT NULL DEFAULT '', requester_email TEXT NOT NULL DEFAULT '', current_value TEXT NOT NULL DEFAULT '', proposed_value TEXT NOT NULL DEFAULT '', device_id TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'gps',
    token_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', requested_at INTEGER NOT NULL,
    request_expires_at INTEGER NOT NULL, grant_expires_at INTEGER, consumed INTEGER NOT NULL DEFAULT 0,
    decided_at INTEGER, updated_at INTEGER NOT NULL
  )`).run();
  try { await env.DB.prepare("ALTER TABLE gps_unlock_requests ADD COLUMN scope TEXT NOT NULL DEFAULT 'gps'").run(); } catch(_) {}
  try { await env.DB.prepare("ALTER TABLE gps_unlock_requests ADD COLUMN requester_name TEXT NOT NULL DEFAULT ''").run(); } catch(_) {}
  try { await env.DB.prepare("ALTER TABLE gps_unlock_requests ADD COLUMN requester_email TEXT NOT NULL DEFAULT ''").run(); } catch(_) {}
  try { await env.DB.prepare("ALTER TABLE gps_unlock_requests ADD COLUMN current_value TEXT NOT NULL DEFAULT ''").run(); } catch(_) {}
  try { await env.DB.prepare("ALTER TABLE gps_unlock_requests ADD COLUMN proposed_value TEXT NOT NULL DEFAULT ''").run(); } catch(_) {}
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS gps_unlock_pending ON gps_unlock_requests(status,request_expires_at)").run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_push_config (
    id INTEGER PRIMARY KEY CHECK(id=1), public_jwk TEXT NOT NULL, private_jwk TEXT NOT NULL, public_key TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
    endpoint TEXT PRIMARY KEY, subscription_json TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`).run();
}
async function ensureVapidConfig(env) {
  await ensureGpsUnlockTables(env);
  let row=await env.DB.prepare("SELECT public_jwk,private_jwk,public_key FROM admin_push_config WHERE id=1").first();
  if(row) return row;
  const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  const pub=await crypto.subtle.exportKey("jwk",pair.publicKey),priv=await crypto.subtle.exportKey("jwk",pair.privateKey);
  const publicKey=b64urlBytes(new Uint8Array([4,...b64urlDecode(pub.x),...b64urlDecode(pub.y)]));
  await env.DB.prepare(`INSERT OR IGNORE INTO admin_push_config(id,public_jwk,private_jwk,public_key,updated_at) VALUES(1,?,?,?,?)`)
    .bind(JSON.stringify(pub),JSON.stringify(priv),publicKey,Date.now()).run();
  return await env.DB.prepare("SELECT public_jwk,private_jwk,public_key FROM admin_push_config WHERE id=1").first();
}
async function vapidAuthorization(endpoint, config) {
  const audience=new URL(endpoint).origin, now=Math.floor(Date.now()/1000);
  const unsigned=b64urlText(JSON.stringify({typ:"JWT",alg:"ES256"}))+"."+b64urlText(JSON.stringify({aud:audience,exp:now+43200,sub:"mailto:administrateur@carplay.local"}));
  const key=await crypto.subtle.importKey("jwk",JSON.parse(config.private_jwk),{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const signature=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${b64urlBytes(new Uint8Array(signature))}, k=${config.public_key}`;
}
async function notifyAdminGpsRequest(env) {
  const config=await ensureVapidConfig(env), rows=await env.DB.prepare("SELECT endpoint FROM admin_push_subscriptions").all();
  for(const row of rows.results||[]) try {
    const response=await fetch(row.endpoint,{method:"POST",headers:{TTL:"120",Urgency:"high",Authorization:await vapidAuthorization(row.endpoint,config)}});
    if(response.status===404||response.status===410) await env.DB.prepare("DELETE FROM admin_push_subscriptions WHERE endpoint=?").bind(row.endpoint).run();
  } catch(_) {}
}
async function adminGpsPush(request, env) {
  if (!(await adminAuthorized(request,env))) return json({ok:false,error:"SECRET_INCORRECT"},401);
  const config=await ensureVapidConfig(env);
  if(request.method==="GET") return json({ok:true,publicKey:config.public_key});
  const data=await body(request),sub=data.subscription;
  if(!sub||!/^https:\/\//.test(String(sub.endpoint||""))) return json({ok:false,error:"ABONNEMENT_NOTIFICATION_INVALIDE"},400);
  await env.DB.prepare(`INSERT INTO admin_push_subscriptions(endpoint,subscription_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET subscription_json=excluded.subscription_json,updated_at=excluded.updated_at`)
    .bind(String(sub.endpoint).slice(0,1000),JSON.stringify(sub),Date.now()).run();
  return json({ok:true});
}
async function requestGpsUnlock(request, env) {
  await ensureGpsUnlockTables(env); await ensureSubscriptionEmailColumns(env); await ensureMarketVerificationTables(env); await ensureInstallationsTable(env);
  const data=await body(request),marketKey=cleanMarketKey(data.marketKey),deviceId=String(data.deviceId||"").trim(),requesterEmail=normalizeEmail(data.requesterEmail),subscriptionCode=normalizeCode(data.subscriptionCode);
  if(!marketKey||!validDevice(deviceId)) return json({ok:false,error:"DONNEES_INVALIDES"},400);
  // La demande enregistre elle-même le téléphone : aucun ancien appareil ne doit
  // échouer simplement parce que l'appel /api/installations n'a pas été fait avant.
  const seen=Math.floor(Date.now()/1000);
  await env.DB.prepare(`INSERT INTO app_installations(device_id,platform,first_seen,last_seen) VALUES(?,?,?,?)
    ON CONFLICT(device_id) DO UPDATE SET last_seen=excluded.last_seen`).bind(deviceId,"market-change",seen,seen).run();
  const requesterName=String(data.requesterName||"").trim().replace(/\s+/g," ").slice(0,100);
  if(requesterName.split(" ").filter(Boolean).length<2)return json({ok:false,error:"NOM_ET_PRENOM_OBLIGATOIRES"},400);
  if(!validEmail(requesterEmail))return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);
  const emailHash=await sha256Text(requesterEmail);
  let sub=await env.DB.prepare("SELECT id,code_hash,phone_device,autoradio_device,recovery_email_hash,recovery_email_mask,expires_at,lifetime,active FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) LIMIT 1").bind(deviceId,deviceId).first();
  // Secours pour les anciens téléphones : si le lien appareil n'est pas retrouvé,
  // on utilise le code d'abonnement déjà présent dans l'application. Le code + l'e-mail
  // doivent correspondre au même abonnement; on ne remplace jamais un autre téléphone actif.
  if(!sub && validCode(subscriptionCode)){
    const codeHash=await hashCode(subscriptionCode,env.CODE_PEPPER);
    const byCode=await env.DB.prepare("SELECT id,code_hash,phone_device,autoradio_device,recovery_email_hash,recovery_email_mask,expires_at,lifetime,active FROM subscriptions WHERE code_hash=? AND active=1 LIMIT 1").bind(codeHash).first();
    if(byCode){
      if(!byCode.lifetime&&(!byCode.expires_at||Date.parse(byCode.expires_at)<=Date.now()))return json({ok:false,error:"ABONNEMENT_EXPIRE"},403);
      const stored=String(byCode.recovery_email_hash||"");
      const legacy=String(byCode.recovery_email_mask||"").trim().toLowerCase();
      if(stored && stored!==emailHash && !(legacy && !legacy.includes("***") && legacy===requesterEmail))return json({ok:false,error:"EMAIL_NE_CORRESPOND_PAS"},403);
      if(byCode.phone_device && byCode.phone_device!==deviceId && byCode.autoradio_device!==deviceId)return json({ok:false,error:"APPAREIL_REMPLACE"},409);
      if(!byCode.phone_device)await env.DB.prepare("UPDATE subscriptions SET phone_device=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(deviceId,byCode.id).run();
      sub=byCode;
    }
  }
  if(!sub)return json({ok:false,error:"COMPTE_ABONNEMENT_INTROUVABLE"},403);
  if(!sub.lifetime&&(!sub.expires_at||Date.parse(sub.expires_at)<=Date.now()))return json({ok:false,error:"ABONNEMENT_EXPIRE"},403);
  if(!sub.recovery_email_hash){
    const owner=await activeEmailOwner(env,emailHash,sub.id);
    if(owner)return json({ok:false,error:"EMAIL_DEJA_UTILISEE_AUTRE_TELEPHONE"},409);
    await env.DB.prepare("UPDATE subscriptions SET recovery_email_hash=?,recovery_email_mask=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(emailHash,requesterEmail,sub.id).run();
  }else if(String(sub.recovery_email_hash)!==emailHash){
    const legacyEmail=String(sub.recovery_email_mask||"").trim().toLowerCase();
    if(legacyEmail && !legacyEmail.includes("***") && legacyEmail===requesterEmail){
      await env.DB.prepare("UPDATE subscriptions SET recovery_email_hash=?,recovery_email_mask=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(emailHash,requesterEmail,sub.id).run();
    }else return json({ok:false,error:"EMAIL_NE_CORRESPOND_PAS"},403);
  }
  const editableScopes=["gps","photo","time","count","draw","clientModel","welcome","placer","exists"],scope=editableScopes.includes(data.scope)?data.scope:"gps",now=Date.now(),id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID(),tokenHash=await sha256Text(token);
  await env.DB.prepare("UPDATE gps_unlock_requests SET status='expired',updated_at=? WHERE device_id=? AND market_key=? AND scope=? AND status='pending'").bind(now,deviceId,marketKey,scope).run();
  const informationScope=["time","count","draw","clientModel","welcome","placer","exists"].includes(scope),proposedValue=informationScope?String(data.proposedValue||'').slice(0,100):(scope==='gps'?'Correction du point GPS':scope==='photo'?'Remplacement de la photo':'');
  if(informationScope&&!normalizedVerification(scope,proposedValue))return json({ok:false,error:'VALEUR_INVALIDE'},400);
  let currentValue='';
  if(informationScope){const current=await env.DB.prepare("SELECT value_display FROM market_verification_consensus WHERE market_key=? AND field=? LIMIT 1").bind(marketKey,scope).first();currentValue=String(current&&current.value_display||data.currentValue||'').slice(0,100);}
  else if(scope==='gps') currentValue='Point GPS actuel enregistré';
  else if(scope==='photo') currentValue='Photo actuelle enregistrée';
  await env.DB.prepare(`INSERT INTO gps_unlock_requests(id,market_key,market_name,requester_name,requester_email,current_value,proposed_value,device_id,scope,token_hash,status,requested_at,request_expires_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`).bind(id,marketKey,String(data.marketName||"Marché").slice(0,150),requesterName,requesterEmail,currentValue,proposedValue,deviceId,scope,tokenHash,now,now+180000,now).run();
  await notifyAdminGpsRequest(env);
  return json({ok:true,id,token,expiresAt:now+180000});
}
async function gpsUnlockStatus(url, env) {
  await ensureGpsUnlockTables(env); const id=String(url.searchParams.get("id")||""),deviceId=String(url.searchParams.get("deviceId")||"");
  const row=await env.DB.prepare("SELECT status,request_expires_at,grant_expires_at,consumed FROM gps_unlock_requests WHERE id=? AND device_id=?").bind(id,deviceId).first();
  if(!row) return json({ok:false,error:"DEMANDE_INTROUVABLE"},404); const now=Date.now();
  let status=row.status; if(status==="pending"&&now>Number(row.request_expires_at))status="expired";if(status==="approved"&&(row.consumed||now>Number(row.grant_expires_at||0)))status=row.consumed?"consumed":"expired";
  return json({ok:true,status,expiresAt:status==="approved"?Number(row.grant_expires_at):Number(row.request_expires_at)});
}
async function adminGpsUnlockRequests(request, env) {
  if (!(await adminAuthorized(request,env))) return json({ok:false,error:"SECRET_INCORRECT"},401);
  await ensureGpsUnlockTables(env); await ensureMarketVerificationTables(env); const now=Date.now();
  if(request.method==="GET") {await env.DB.prepare("UPDATE gps_unlock_requests SET status='expired',updated_at=? WHERE status='pending' AND request_expires_at<?").bind(now,now).run();const rows=await env.DB.prepare("SELECT id,market_key,market_name,requester_name,requester_email,current_value,proposed_value,device_id,scope,status,requested_at,request_expires_at FROM gps_unlock_requests WHERE status='pending' ORDER BY requested_at DESC LIMIT 30").all();return json({ok:true,requests:rows.results||[]});}
  const data=await body(request),id=String(data.id||""),approve=data.approve===true,row=await env.DB.prepare("SELECT status,request_expires_at,scope,market_key,proposed_value FROM gps_unlock_requests WHERE id=?").bind(id).first();
  if(!row||row.status!=="pending"||now>Number(row.request_expires_at)) return json({ok:false,error:"DEMANDE_EXPIREE"},409);
  if(approve&&row.scope==='exists'){const value=normalizedVerification('exists',row.proposed_value);if(!value)return json({ok:false,error:'VALEUR_INVALIDE'},400);await env.DB.prepare(`INSERT INTO market_verification_consensus(market_key,field,value_norm,value_display,confirmations,updated_at) VALUES(?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(market_key,field) DO UPDATE SET value_norm=excluded.value_norm,value_display=excluded.value_display,confirmations=1,updated_at=CURRENT_TIMESTAMP`).bind(row.market_key,'exists',value.norm,value.display).run();await env.DB.prepare("UPDATE gps_unlock_requests SET status='completed',consumed=1,decided_at=?,updated_at=? WHERE id=?").bind(now,now,id).run();return json({ok:true,status:'completed',marketExists:value.display==='Oui'});}
  if(approve&&["time","count","draw","clientModel","welcome","placer"].includes(row.scope)){const value=normalizedVerification(row.scope,row.proposed_value);if(!value)return json({ok:false,error:'VALEUR_INVALIDE'},400);await env.DB.prepare(`INSERT INTO market_verification_consensus(market_key,field,value_norm,value_display,confirmations,updated_at) VALUES(?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(market_key,field) DO UPDATE SET value_norm=excluded.value_norm,value_display=excluded.value_display,confirmations=1,updated_at=CURRENT_TIMESTAMP`).bind(row.market_key,row.scope,value.norm,value.display).run();await env.DB.prepare(`INSERT INTO market_verification_consensus(market_key,field,value_norm,value_display,confirmations,updated_at) VALUES(?,'exists','oui','Oui',1,CURRENT_TIMESTAMP) ON CONFLICT(market_key,field) DO UPDATE SET value_norm='oui',value_display='Oui',confirmations=1,updated_at=CURRENT_TIMESTAMP`).bind(row.market_key).run();await env.DB.prepare("UPDATE gps_unlock_requests SET status='completed',consumed=1,decided_at=?,updated_at=? WHERE id=?").bind(now,now,id).run();return json({ok:true,status:'completed'});}
  if(approve){await env.DB.prepare(`INSERT INTO market_verification_consensus(market_key,field,value_norm,value_display,confirmations,updated_at) VALUES(?,'exists','oui','Oui',1,CURRENT_TIMESTAMP) ON CONFLICT(market_key,field) DO UPDATE SET value_norm='oui',value_display='Oui',confirmations=1,updated_at=CURRENT_TIMESTAMP`).bind(row.market_key).run();}
  await env.DB.prepare("UPDATE gps_unlock_requests SET status=?,grant_expires_at=?,decided_at=?,updated_at=? WHERE id=?").bind(approve?"approved":"denied",approve?now+180000:null,now,now,id).run();
  return json({ok:true,status:approve?"approved":"denied",expiresAt:approve?now+180000:null});
}

function normalizeCode(value) {
  return String(value || "").toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[OI]/g, c => ({ O:"Q", I:"L" }[c]))
    .slice(0, 6);
}
function validCode(value) { return /^[A-HJ-NP-Z0-9]{6}$/.test(normalizeCode(value)); }
function randomSubscriptionCode(){
  const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789", bytes=new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out=""; for(const b of bytes) out+=alphabet[b%alphabet.length];
  return out;
}
function validDevice(value) { return /^[a-zA-Z0-9._:-]{8,128}$/.test(String(value || "").trim()); }
function normalizeEmail(value){return String(value||"").trim().toLowerCase().slice(0,254)}
async function activeEmailOwner(env,emailHash,exceptId){
  const rows=await env.DB.prepare("SELECT id,lifetime,expires_at,active FROM subscriptions WHERE recovery_email_hash=? AND id<>? AND active=1").bind(emailHash,exceptId||-1).all();
  const now=Date.now();
  return (rows.results||[]).find(r=>!!r.lifetime||(r.expires_at&&Date.parse(r.expires_at)>now))||null;
}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)}
async function ensureSubscriptionEmailColumns(env){
  try{await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN recovery_email_hash TEXT").run()}catch(_){}
  try{await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN recovery_email_mask TEXT").run()}catch(_){}
  try{await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN recovery_code_box TEXT").run()}catch(_){}
  try{await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN last_recovery_sent_at INTEGER").run()}catch(_){}
  try{await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN account_first_name TEXT").run()}catch(_){}
  try{await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN account_last_name TEXT").run()}catch(_){}
  try{await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN account_updated_at INTEGER").run()}catch(_){}
  try{await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN duration_days INTEGER").run()}catch(_){}
  try{await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN redeemed_at INTEGER").run()}catch(_){}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS subscription_email_challenges(id TEXT PRIMARY KEY,subscription_id INTEGER NOT NULL,email TEXT NOT NULL,email_hash TEXT NOT NULL,device_id TEXT NOT NULL,device_type TEXT NOT NULL,code_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_email_challenge_device ON subscription_email_challenges(device_id,created_at)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS brevo_daily_usage(day TEXT PRIMARY KEY, sent_count INTEGER NOT NULL DEFAULT 0)").run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS email_identity_challenges(id TEXT PRIMARY KEY,email TEXT NOT NULL,email_hash TEXT NOT NULL,device_id TEXT NOT NULL,code_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,verified INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL)`).run();
}
function emailMask(email){return email.replace(/^(.{2}).*(@.*)$/,'$1***$2')}
function parisDay(){return new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function randomEmailCode(){const a=new Uint32Array(1);crypto.getRandomValues(a);return String(a[0]%1000000).padStart(6,"0")}
async function emailCodeHash(id,code,env){return sha256Text(id+":"+code+":"+(env.CODE_PEPPER||"carplay-email"))}

const ONLY_ADMIN_EMAIL = "appli.suzon@gmail.com";
const ONLY_ADMIN_NAME = "Steve Suzon";
async function ensureAdminAuthTables(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_email_challenges(
    id TEXT PRIMARY KEY,email TEXT NOT NULL,device_id TEXT NOT NULL DEFAULT '',code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,consumed INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_sessions(
    token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,device_id TEXT NOT NULL DEFAULT '',expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL
  )`).run();
  try{await env.DB.prepare("CREATE INDEX IF NOT EXISTS admin_challenges_email_created ON admin_email_challenges(email,created_at)").run()}catch(_){}
  try{await env.DB.prepare("CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at)").run()}catch(_){}
}
async function adminLoginCodeHash(id,code,env){return sha256Text("admin:"+id+":"+code+":"+(env.CODE_PEPPER||"couteau-suisse-admin"))}
function randomAdminToken(){const b=new Uint8Array(32);crypto.getRandomValues(b);return b64urlBytes(b)}
async function sendBrevoAdminCode(env,email,code){
  if(!env.BREVO_API_KEY||!env.BREVO_SENDER_EMAIL)throw new Error("EMAIL_CONFIG");
  const response=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{accept:"application/json","content-type":"application/json","api-key":env.BREVO_API_KEY},body:JSON.stringify({sender:{name:"Couteau Suisse",email:String(env.BREVO_SENDER_EMAIL)},to:[{email}],subject:"Confirmation administrateur Couteau Suisse",textContent:"Steve, votre code de confirmation administrateur est : "+code+". Il est valable 10 minutes.",htmlContent:'<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:2px solid #f39b19;border-radius:18px"><h2 style="color:#c86b00">Couteau Suisse — Administration</h2><p>Bonjour Steve Suzon,</p><p>Voici votre code de confirmation administrateur :</p><p style="font-size:34px;font-weight:900;letter-spacing:8px">'+code+'</p><p>Ce code est valable 10 minutes.</p><p style="font-size:12px;color:#666">Seule l’adresse '+ONLY_ADMIN_EMAIL+' peut recevoir cette confirmation.</p></div>'})});
  if(!response.ok)throw new Error("EMAIL_SEND");
}
async function requestAdminEmailLogin(request,env){
  if(!env.DB)return json({ok:false,error:"DB_NON_CONFIGUREE"},500);
  await ensureAdminAuthTables(env);
  const d=await body(request),email=normalizeEmail(d.email),deviceId=String(d.deviceId||"").slice(0,160),now=Date.now();
  if(email!==ONLY_ADMIN_EMAIL)return json({ok:false,error:"ADMIN_NON_AUTORISE"},403);
  const recent=await env.DB.prepare("SELECT created_at FROM admin_email_challenges WHERE email=? ORDER BY created_at DESC LIMIT 1").bind(email).first();
  if(recent&&now-Number(recent.created_at||0)<45000)return json({ok:false,error:"ATTENDEZ_QUELQUES_SECONDES"},429);
  const id=crypto.randomUUID(),code=randomEmailCode(),hash=await adminLoginCodeHash(id,code,env),expires=now+10*60*1000;
  await env.DB.prepare("INSERT INTO admin_email_challenges(id,email,device_id,code_hash,expires_at,attempts,consumed,created_at) VALUES(?,?,?,?,?,0,0,?)").bind(id,email,deviceId,hash,expires,now).run();
  try{await sendBrevoAdminCode(env,email,code)}catch(e){return json({ok:false,error:String(e&&e.message||"EMAIL_SEND")},500)}
  return json({ok:true,challengeId:id,email:emailMask(email),expiresAt:expires,adminName:ONLY_ADMIN_NAME});
}
async function verifyAdminEmailLogin(request,env){
  if(!env.DB)return json({ok:false,error:"DB_NON_CONFIGUREE"},500);
  await ensureAdminAuthTables(env);
  const d=await body(request),id=String(d.challengeId||""),code=String(d.code||"").replace(/\D/g,"").slice(0,6),deviceId=String(d.deviceId||"").slice(0,160),now=Date.now();
  const row=await env.DB.prepare("SELECT * FROM admin_email_challenges WHERE id=? LIMIT 1").bind(id).first();
  if(!row||row.email!==ONLY_ADMIN_EMAIL)return json({ok:false,error:"CONFIRMATION_INTROUVABLE"},404);
  if(Number(row.consumed))return json({ok:false,error:"CODE_DEJA_UTILISE"},409);
  if(Number(row.expires_at)<now)return json({ok:false,error:"CODE_EXPIRE"},410);
  if(Number(row.attempts||0)>=6)return json({ok:false,error:"TROP_DE_TENTATIVES"},429);
  const h=await adminLoginCodeHash(id,code,env);
  if(h!==String(row.code_hash||"")){
    await env.DB.prepare("UPDATE admin_email_challenges SET attempts=attempts+1 WHERE id=?").bind(id).run();
    return json({ok:false,error:"CODE_INCORRECT"},403);
  }
  await env.DB.prepare("UPDATE admin_email_challenges SET consumed=1 WHERE id=?").bind(id).run();
  const token=randomAdminToken(),tokenHash=await sha256Text(token),expires=now+180*24*60*60*1000;
  await env.DB.prepare("INSERT OR REPLACE INTO admin_sessions(token_hash,email,device_id,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)").bind(tokenHash,ONLY_ADMIN_EMAIL,deviceId,expires,now,now).run();
  try{await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at<?").bind(now).run()}catch(_){}
  return json({ok:true,token,expiresAt:expires,adminName:ONLY_ADMIN_NAME,email:ONLY_ADMIN_EMAIL});
}
async function adminSessionStatus(request,env){
  const ok=await adminAuthorized(request,env);
  return ok?json({ok:true,admin:true,name:ONLY_ADMIN_NAME,email:ONLY_ADMIN_EMAIL}):json({ok:false,admin:false},401);
}
async function adminLogout(request,env){
  const auth=request.headers.get("authorization")||"",token=auth.startsWith("Bearer ")?auth.slice(7).trim():"";
  if(token&&env.DB){await ensureAdminAuthTables(env);try{await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha256Text(token)).run()}catch(_){}}
  return json({ok:true});
}
async function sendBrevoCode(env,email,code){
  if(!env.BREVO_API_KEY||!env.BREVO_SENDER_EMAIL)throw new Error("EMAIL_CONFIG");
  const response=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{accept:"application/json","content-type":"application/json","api-key":env.BREVO_API_KEY},body:JSON.stringify({sender:{name:"Couteau Suisse",email:String(env.BREVO_SENDER_EMAIL)},to:[{email}],subject:"Votre code de confirmation Couteau Suisse",textContent:"Votre code de confirmation Couteau Suisse est : "+code+". Il est valable 10 minutes.",htmlContent:'<div style="font-family:Arial,sans-serif"><h2>Couteau Suisse</h2><p>Votre code de confirmation est :</p><p style="font-size:32px;font-weight:bold;letter-spacing:7px">'+code+'</p><p>Ce code est valable 10 minutes.</p></div>'})});
  if(!response.ok)throw new Error("EMAIL_SEND");
}
function subscriptionRemainingInfo(row,now=Date.now()){
  if(row&&Number(row.lifetime))return {lifetime:true,remainingDays:null,expiresAt:null,endDate:"",label:"Abonnement à vie"};
  const expiresAt=String(row&&row.expires_at||"");
  const expiresMs=Date.parse(expiresAt);
  const remainingDays=Number.isFinite(expiresMs)?Math.max(0,Math.ceil((expiresMs-now)/86400000)):0;
  const endDate=Number.isFinite(expiresMs)?new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(expiresMs)):"";
  return {lifetime:false,remainingDays,expiresAt:expiresAt||null,endDate,label:remainingDays+" jour"+(remainingDays>1?"s":"")+" restant"+(remainingDays>1?"s":"")};
}
async function sendBrevoSubscriptionCode(env,email,code,row,now=Date.now()){
  if(!env.BREVO_API_KEY||!env.BREVO_SENDER_EMAIL)throw new Error("EMAIL_CONFIG");
  const info=subscriptionRemainingInfo(row,now);
  const remainingText=info.lifetime?"Abonnement à vie":"Jours restants : "+info.remainingDays+(info.endDate?"\nDate de fin : "+info.endDate:"");
  const remainingHtml=info.lifetime?'<p style="font-size:20px;font-weight:bold;color:#16803a">Abonnement à vie</p>':'<p style="font-size:20px;font-weight:bold">Jours restants : '+info.remainingDays+'</p>'+(info.endDate?'<p>Date de fin : <strong>'+info.endDate+'</strong></p>':'');
  const response=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{accept:"application/json","content-type":"application/json","api-key":env.BREVO_API_KEY},body:JSON.stringify({sender:{name:"Couteau Suisse",email:String(env.BREVO_SENDER_EMAIL)},to:[{email}],subject:"Votre code d’abonnement Couteau Suisse et vos jours restants",textContent:"Votre code d’abonnement Couteau Suisse est : "+code+".\n\n"+remainingText+".\n\nEntrez ce même code sur votre nouveau téléphone pour récupérer votre abonnement. L’ancien téléphone sera automatiquement remplacé pour cet abonnement.",htmlContent:'<div style="font-family:Arial,sans-serif;line-height:1.45"><h2>Couteau Suisse</h2><p>Voici le code rattaché à votre abonnement :</p><p style="font-size:32px;font-weight:bold;letter-spacing:7px">'+code+'</p>'+remainingHtml+'<p>Entrez ce même code sur votre nouveau téléphone pour récupérer votre abonnement. L’ancien téléphone sera automatiquement remplacé pour cet abonnement.</p></div>'})});
  if(!response.ok)throw new Error("EMAIL_SEND");
  return info;
}
async function recoverSubscriptionCode(request,env){
  await ensureSubscriptionEmailColumns(env);
  const data=await body(request),email=normalizeEmail(data.email),deviceId=String(data.deviceId||''),now=Date.now(),day=parisDay();
  const firstName=String(data.firstName||'').trim().replace(/\s+/g,' ').slice(0,60),lastName=String(data.lastName||'').trim().replace(/\s+/g,' ').slice(0,60);
  if(!validEmail(email))return json({ok:false,error:'EMAIL_OBLIGATOIRE'},400);
  if(!validDevice(deviceId))return json({ok:false,error:'DONNEES_INVALIDES'},400);
  const emailHash=await sha256Text(email);
  const row=await env.DB.prepare("SELECT * FROM subscriptions WHERE recovery_email_hash=? AND active=1 ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC,id DESC LIMIT 1").bind(emailHash).first();
  if(!row)return json({ok:false,error:'EMAIL_INTROUVABLE'},404);
  const storedFirst=String(row.account_first_name||'').trim(),storedLast=String(row.account_last_name||'').trim();
  if(storedFirst&&storedLast){
    if(firstName.length<2||lastName.length<2)return json({ok:false,error:'NOM_ET_PRENOM_OBLIGATOIRES'},400);
    if(subscriptionIdentityKey(storedFirst)!==subscriptionIdentityKey(firstName)||subscriptionIdentityKey(storedLast)!==subscriptionIdentityKey(lastName))return json({ok:false,error:'IDENTITE_NE_CORRESPOND_PAS'},403);
  }
  if(!row.lifetime&&(!row.expires_at||Date.parse(row.expires_at)<=now))return json({ok:false,error:'ABONNEMENT_EXPIRE'},403);
  if(Number(row.last_recovery_sent_at||0)&&now-Number(row.last_recovery_sent_at)<60000)return json({ok:false,error:'CODE_EMAIL_TROP_RAPIDE'},429);
  const usage=await env.DB.prepare("SELECT sent_count FROM brevo_daily_usage WHERE day=?").bind(day).first();
  if(Number(usage?.sent_count||0)>=200)return json({ok:false,error:'QUOTA_EMAIL_JOURNALIER'},429);
  let code='';
  try{
    code=await openRecoveryCode(row.recovery_code_box,env);
  }catch(_){
    // Anciens abonnements : le code original n'était pas encore stocké de façon réversible.
    // On crée donc un NOUVEAU code de récupération pour le MÊME abonnement, sans toucher
    // à la date de fin, au statut à vie, aux points ni aux autres données du compte.
    for(let attempt=0;attempt<20;attempt++){
      const candidate=randomSubscriptionCode(),candidateHash=await hashCode(candidate,env.CODE_PEPPER);
      const exists=await env.DB.prepare("SELECT id FROM subscriptions WHERE code_hash=? AND id<>? LIMIT 1").bind(candidateHash,row.id).first();
      if(exists)continue;
      code=candidate;
      const box=await sealRecoveryCode(code,env);
      await env.DB.prepare("UPDATE subscriptions SET code_hash=?,recovery_code_box=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(candidateHash,box,row.id).run();
      row.code_hash=candidateHash; row.recovery_code_box=box;
      break;
    }
    if(!code)return json({ok:false,error:'CODE_RECUPERATION_NON_INITIALISE'},409);
  }
  let remainingInfo;
  try{remainingInfo=await sendBrevoSubscriptionCode(env,email,code,row,now)}catch(_){return json({ok:false,error:'EMAIL_ENVOI_INDISPONIBLE'},503)}
  await env.DB.batch([
    env.DB.prepare("UPDATE subscriptions SET last_recovery_sent_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(now,row.id),
    env.DB.prepare("INSERT INTO brevo_daily_usage(day,sent_count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET sent_count=sent_count+1").bind(day)
  ]);
  return json({ok:true,email,lifetime:remainingInfo.lifetime,remainingDays:remainingInfo.remainingDays,expiresAt:remainingInfo.expiresAt});
}

async function startEmailIdentity(request,env){
  await ensureSubscriptionEmailColumns(env);const data=await body(request),email=normalizeEmail(data.email),deviceId=String(data.deviceId||""),now=Date.now(),day=parisDay();
  if(!validEmail(email))return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);if(!validDevice(deviceId))return json({ok:false,error:"DONNEES_INVALIDES"},400);
  const usage=await env.DB.prepare("SELECT sent_count FROM brevo_daily_usage WHERE day=?").bind(day).first();if(Number(usage?.sent_count||0)>=200)return json({ok:false,error:"QUOTA_EMAIL_JOURNALIER"},429);
  const emailHash=await sha256Text(email),recent=await env.DB.prepare("SELECT created_at FROM email_identity_challenges WHERE device_id=? AND email_hash=? ORDER BY created_at DESC LIMIT 1").bind(deviceId,emailHash).first();if(recent&&now-Number(recent.created_at)<60000)return json({ok:false,error:"CODE_EMAIL_TROP_RAPIDE"},429);
  const id=crypto.randomUUID(),code=randomEmailCode(),codeHash=await emailCodeHash(id,code,env);await env.DB.prepare("DELETE FROM email_identity_challenges WHERE expires_at<?").bind(now).run();await env.DB.prepare("INSERT INTO email_identity_challenges(id,email,email_hash,device_id,code_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?)").bind(id,email,emailHash,deviceId,codeHash,now+600000,now).run();
  try{await sendBrevoCode(env,email,code)}catch(_){await env.DB.prepare("DELETE FROM email_identity_challenges WHERE id=?").bind(id).run();return json({ok:false,error:"EMAIL_ENVOI_INDISPONIBLE"},503)}
  await env.DB.prepare("INSERT INTO brevo_daily_usage(day,sent_count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET sent_count=sent_count+1").bind(day).run();return json({ok:true,challengeId:id,email,expiresAt:now+600000});
}
async function confirmEmailIdentity(request,env){
  await ensureSubscriptionEmailColumns(env);const data=await body(request),id=String(data.challengeId||""),code=String(data.verificationCode||"").replace(/\D/g,""),deviceId=String(data.deviceId||""),row=await env.DB.prepare("SELECT * FROM email_identity_challenges WHERE id=? AND device_id=?").bind(id,deviceId).first(),now=Date.now();
  if(!row||!/^\d{6}$/.test(code))return json({ok:false,error:"CODE_EMAIL_INCORRECT"},403);if(now>Number(row.expires_at))return json({ok:false,error:"CODE_EMAIL_EXPIRE"},403);if(Number(row.attempts)>=5)return json({ok:false,error:"CODE_EMAIL_TROP_ESSAIS"},429);
  if(await emailCodeHash(id,code,env)!==row.code_hash){await env.DB.prepare("UPDATE email_identity_challenges SET attempts=attempts+1 WHERE id=?").bind(id).run();return json({ok:false,error:"CODE_EMAIL_INCORRECT"},403)}
  await env.DB.prepare("UPDATE email_identity_challenges SET verified=1 WHERE id=?").bind(id).run();return json({ok:true,email:row.email,emailProof:id});
}

function subscriptionIdentityKey(value){
  return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
}

async function activate(request, env) {
  await ensureSubscriptionEmailColumns(env);
  const data = await body(request);
  const code = normalizeCode(data.code);
  const email = normalizeEmail(data.email);
  const deviceId = String(data.deviceId || "");
  const type = data.deviceType === "autoradio" ? "autoradio" : "phone";
  const firstName = String(data.firstName || "").trim().replace(/\s+/g," ").slice(0,60);
  const lastName = String(data.lastName || "").trim().replace(/\s+/g," ").slice(0,60);
  if (!validEmail(email)) return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);
  if (firstName.length < 2 || lastName.length < 2) return json({ok:false,error:"NOM_ET_PRENOM_OBLIGATOIRES"},400);
  if (!validCode(code) || !validDevice(deviceId)) return json({ok:false,error:"DONNEES_INVALIDES"},400);

  const now = Date.now();
  const codeHash = await hashCode(code, env.CODE_PEPPER);
  const row = await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash=? AND active=1").bind(codeHash).first();
  if (!row) return json({ok:false,error:"CODE_INCORRECT"},403);

  const emailHash = await sha256Text(email);
  const column = type === "autoradio" ? "autoradio_device" : "phone_device";
  const freshCode = !row.recovery_email_hash && !row.phone_device && !row.autoradio_device && !row.account_first_name && !row.account_last_name;
  const durationDays = Math.max(1, Math.min(3650, Number(row.duration_days) || 365));

  // Un code neuf sert aussi de recharge. Si ce nom/e-mail ou ce téléphone possède déjà
  // un abonnement, on conserve le même compte et on ajoute la durée du nouveau code.
  if (freshCode) {
    const candidates = await env.DB.prepare(
      `SELECT * FROM subscriptions
       WHERE id<>? AND (recovery_email_hash=? OR phone_device=? OR autoradio_device=?)
       ORDER BY CASE WHEN recovery_email_hash=? THEN 0 ELSE 1 END,
                CASE WHEN active=1 THEN 0 ELSE 1 END,
                COALESCE(account_updated_at,0) DESC, id DESC
       LIMIT 1`
    ).bind(row.id,emailHash,deviceId,deviceId,emailHash).first();

    if (candidates) {
      const account = candidates;
      const storedEmail = String(account.recovery_email_hash || "");
      const storedFirst = String(account.account_first_name || "");
      const storedLast = String(account.account_last_name || "");
      if (storedEmail && storedEmail !== emailHash) return json({ok:false,error:"EMAIL_NE_CORRESPOND_PAS"},403);
      if (storedFirst && storedLast && (subscriptionIdentityKey(storedFirst)!==subscriptionIdentityKey(firstName) || subscriptionIdentityKey(storedLast)!==subscriptionIdentityKey(lastName))) {
        return json({ok:false,error:"IDENTITE_NE_CORRESPOND_PAS"},403);
      }
      if (Number(account.lifetime)) return json({ok:false,error:"ABONNEMENT_DEJA_A_VIE"},409);

      const recoveryCodeBox = await sealRecoveryCode(code,env);
      const oldEnd = account.expires_at ? Date.parse(account.expires_at) : 0;
      const base = Number.isFinite(oldEnd) && oldEnd > now ? oldEnd : now;
      const becomesLifetime = Number(row.lifetime) === 1;
      const newExpires = becomesLifetime ? null : new Date(base + durationDays * 86400000).toISOString();

      // D1 batch est transactionnel : on libère d'abord le nouveau code, puis on le
      // rattache à l'ancien compte afin de garder le même subscription_id et ses données.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM subscriptions WHERE id=?").bind(row.id),
        env.DB.prepare(`UPDATE subscriptions SET code_hash=?,recovery_code_box=?,expires_at=?,lifetime=?,active=1,
          recovery_email_hash=?,recovery_email_mask=?,account_first_name=?,account_last_name=?,account_updated_at=?,
          duration_days=?,redeemed_at=?,${column}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(codeHash,recoveryCodeBox,newExpires,becomesLifetime?1:0,emailHash,email,firstName,lastName,now,durationDays,now,deviceId,account.id)
      ]);

      const info = subscriptionRemainingInfo({lifetime:becomesLifetime?1:0,expires_at:newExpires},now);
      return json({ok:true,lifetime:becomesLifetime,expiresAt:newExpires,deviceType:type,email,firstName,lastName,renewed:true,addedDays:becomesLifetime?null:durationDays,remainingDays:info.remainingDays});
    }

    // Première activation d'un code neuf : la durée commence le jour de l'activation,
    // et non le jour où l'administrateur a créé le code.
    const owner = await activeEmailOwner(env,emailHash,row.id);
    if (owner) return json({ok:false,error:"EMAIL_DEJA_UTILISEE"},409);
    const recoveryCodeBox = await sealRecoveryCode(code,env);
    const becomesLifetime = Number(row.lifetime) === 1;
    const expiresAt = becomesLifetime ? null : new Date(now + durationDays * 86400000).toISOString();
    await env.DB.prepare(`UPDATE subscriptions SET expires_at=?,recovery_email_hash=?,recovery_email_mask=?,recovery_code_box=?,
      account_first_name=?,account_last_name=?,account_updated_at=?,duration_days=?,redeemed_at=?,${column}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(expiresAt,emailHash,email,recoveryCodeBox,firstName,lastName,now,durationDays,now,deviceId,row.id).run();
    const info = subscriptionRemainingInfo({lifetime:becomesLifetime?1:0,expires_at:expiresAt},now);
    return json({ok:true,lifetime:becomesLifetime,expiresAt,deviceType:type,email,firstName,lastName,renewed:false,addedDays:becomesLifetime?null:durationDays,remainingDays:info.remainingDays});
  }

  // Code déjà rattaché à un compte : connexion/récupération normale, sans ajouter
  // une seconde fois les 365 jours.
  if (!row.lifetime && (!row.expires_at || Date.parse(row.expires_at) <= now)) return json({ok:false,error:"ABONNEMENT_EXPIRE"},403);
  const storedEmail = String(row.recovery_email_hash || "");
  const storedFirst = String(row.account_first_name || "");
  const storedLast = String(row.account_last_name || "");
  if (storedEmail && storedEmail !== emailHash) return json({ok:false,error:"EMAIL_NE_CORRESPOND_PAS"},403);
  if (storedFirst && storedLast && (subscriptionIdentityKey(storedFirst)!==subscriptionIdentityKey(firstName) || subscriptionIdentityKey(storedLast)!==subscriptionIdentityKey(lastName))) {
    return json({ok:false,error:"IDENTITE_NE_CORRESPOND_PAS"},403);
  }
  const emailOwner = await activeEmailOwner(env,emailHash,row.id);
  if (emailOwner) return json({ok:false,error:"EMAIL_DEJA_UTILISEE"},409);
  const recoveryCodeBox = await sealRecoveryCode(code,env);
  await env.DB.prepare(`UPDATE subscriptions SET recovery_email_hash=?,recovery_email_mask=?,recovery_code_box=?,account_first_name=?,account_last_name=?,account_updated_at=?,redeemed_at=COALESCE(redeemed_at,?),${column}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(emailHash,email,recoveryCodeBox,firstName,lastName,now,now,deviceId,row.id).run();
  const info = subscriptionRemainingInfo(row,now);
  return json({ok:true,lifetime:!!row.lifetime,expiresAt:row.expires_at||null,deviceType:type,email,firstName,lastName,renewed:false,remainingDays:info.remainingDays});
}

async function updateSubscriptionEmail(request, env) {
  await ensureSubscriptionEmailColumns(env);
  const data = await body(request);
  const email = normalizeEmail(data.email);
  const firstName = String(data.firstName || "").trim().replace(/\s+/g," ").slice(0,60);
  const lastName = String(data.lastName || "").trim().replace(/\s+/g," ").slice(0,60);
  const deviceId = String(data.deviceId || "");
  if (firstName.length < 2 || lastName.length < 2) return json({ok:false,error:"NOM_PRENOM_OBLIGATOIRES"},400);
  if (!validEmail(email)) return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);
  if (!validDevice(deviceId)) return json({ok:false,error:"DONNEES_INVALIDES"},400);
  const row = await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) LIMIT 1").bind(deviceId,deviceId).first();
  if (!row) return json({ok:false,error:"COMPTE_ABONNEMENT_INTROUVABLE"},403);
  if (!row.lifetime && (!row.expires_at || Date.parse(row.expires_at) <= Date.now())) return json({ok:false,error:"ABONNEMENT_EXPIRE"},403);
  const emailHash = await sha256Text(email);
  const owner = await activeEmailOwner(env,emailHash,row.id);
  if (owner) return json({ok:false,error:"EMAIL_DEJA_UTILISEE"},409);
  await env.DB.prepare("UPDATE subscriptions SET recovery_email_hash=?,recovery_email_mask=?,account_first_name=?,account_last_name=?,account_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(emailHash,email,firstName,lastName,Date.now(),row.id).run();
  return json({ok:true,email,firstName,lastName});
}

async function confirmSubscriptionEmail(request,env){
  await ensureSubscriptionEmailColumns(env);const data=await body(request),challengeId=String(data.challengeId||""),verificationCode=String(data.verificationCode||"").replace(/\D/g,""),deviceId=String(data.deviceId||"");
  if(!challengeId||!/^\d{6}$/.test(verificationCode)||!validDevice(deviceId))return json({ok:false,error:"DONNEES_INVALIDES"},400);
  const challenge=await env.DB.prepare("SELECT * FROM subscription_email_challenges WHERE id=? AND device_id=?").bind(challengeId,deviceId).first(),now=Date.now();
  if(!challenge||challenge.consumed)return json({ok:false,error:"CODE_EMAIL_INCORRECT"},403);
  if(now>Number(challenge.expires_at))return json({ok:false,error:"CODE_EMAIL_EXPIRE"},403);
  if(Number(challenge.attempts)>=5)return json({ok:false,error:"CODE_EMAIL_TROP_ESSAIS"},429);
  const supplied=await emailCodeHash(challengeId,verificationCode,env);
  if(supplied!==challenge.code_hash){await env.DB.prepare("UPDATE subscription_email_challenges SET attempts=attempts+1 WHERE id=?").bind(challengeId).run();return json({ok:false,error:"CODE_EMAIL_INCORRECT"},403)}
  const row=await env.DB.prepare("SELECT * FROM subscriptions WHERE id=? AND active=1").bind(challenge.subscription_id).first();
  if(!row||(!row.lifetime&&(!row.expires_at||Date.parse(row.expires_at)<=now)))return json({ok:false,error:"ABONNEMENT_EXPIRE"},403);
  const owner=await activeEmailOwner(env,challenge.email_hash,row.id);if(owner)return json({ok:false,error:"EMAIL_DEJA_UTILISEE"},409);
  const column=challenge.device_type==="autoradio"?"autoradio_device":"phone_device";
  await env.DB.batch([env.DB.prepare(`UPDATE subscriptions SET recovery_email_hash=?,recovery_email_mask=?,${column}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(challenge.email_hash,emailMask(challenge.email),deviceId,row.id),env.DB.prepare("UPDATE subscription_email_challenges SET consumed=1 WHERE id=?").bind(challengeId)]);
  return json({ok:true,lifetime:!!row.lifetime,expiresAt:row.expires_at||null,deviceType:challenge.device_type,email:challenge.email});
}

async function subscriptionStatus(request, env) {
  const data = await body(request);
  const code = normalizeCode(data.code);
  const deviceId = String(data.deviceId || "");
  const type = data.deviceType === "autoradio" ? "autoradio" : "phone";
  if (!validCode(code) || !validDevice(deviceId)) return json({ ok: false, error: "DONNEES_INVALIDES" }, 400);
  const codeHash = await hashCode(code, env.CODE_PEPPER);
  const row = await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash = ? AND active = 1").bind(codeHash).first();
  if (!row) return json({ ok: false, error: "CODE_INCORRECT" }, 403);
  if (!row.lifetime && (!row.expires_at || Date.parse(row.expires_at) <= Date.now())) return json({ ok: false, error: "ABONNEMENT_EXPIRE" }, 403);
  const registered = type === "autoradio" ? row.autoradio_device : row.phone_device;
  if (registered !== deviceId) return json({ ok: false, error: "APPAREIL_REMPLACE" }, 409);
  return json({ ok: true, lifetime: !!row.lifetime, expiresAt: row.expires_at || null, deviceType: type, email: String(row.recovery_email_mask || ""), firstName: String(row.account_first_name || ""), lastName: String(row.account_last_name || "") });
}

async function createSubscription(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ok:false,error:"SECRET_INCORRECT"},401);
  await ensureSubscriptionEmailColumns(env);
  const data = await body(request);
  const code = normalizeCode(data.code);
  if (!validCode(code)) return json({ok:false,error:"CODE_6_CARACTERES_REQUIS"},400);
  const lifetime = data.lifetime === true;
  const days = Math.max(1, Math.min(3650, Number(data.days) || 365));
  // expires_at sert d'affichage provisoire dans l'administration. Lors de la première
  // activation, le compteur repart bien pour la durée complète (365 jours par défaut).
  const expires = lifetime ? null : new Date(Date.now() + days * 86400000).toISOString();
  const codeHash = await hashCode(code,env.CODE_PEPPER);
  const recoveryCodeBox = await sealRecoveryCode(code,env);
  const existing = await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash=?").bind(codeHash).first();

  if (existing) {
    const stillReserved = !!existing.lifetime || (!!(existing.redeemed_at || existing.recovery_email_hash || existing.phone_device || existing.autoradio_device || existing.account_first_name || existing.account_last_name) && !!existing.expires_at && Date.parse(existing.expires_at) > Date.now());
    if (stillReserved) return json({ok:false,error:"CODE_DEJA_UTILISE"},409);
    await env.DB.prepare(`UPDATE subscriptions SET expires_at=?,lifetime=?,active=1,recovery_code_box=?,duration_days=?,redeemed_at=NULL,
      phone_device=NULL,autoradio_device=NULL,recovery_email_hash=NULL,recovery_email_mask=NULL,account_first_name=NULL,account_last_name=NULL,account_updated_at=NULL,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(expires,lifetime?1:0,recoveryCodeBox,days,existing.id).run();
    return json({ok:true,code,lifetime,expiresAt:expires,durationDays:days,renewed:true});
  }

  await env.DB.prepare("INSERT INTO subscriptions(code_hash,expires_at,lifetime,active,recovery_code_box,duration_days,redeemed_at) VALUES(?,?,?,1,?,?,NULL)")
    .bind(codeHash,expires,lifetime?1:0,recoveryCodeBox,days).run();
  return json({ok:true,code,lifetime,expiresAt:expires,durationDays:days,renewed:false});
}

async function subscriptionAction(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "SECRET_INCORRECT" }, 401);
  const data = await body(request);
  const code = normalizeCode(data.code);
  if (!validCode(code)) return json({ ok: false, error: "CODE_6_CARACTERES_REQUIS" }, 400);
  const codeHash = await hashCode(code, env.CODE_PEPPER);
  const row = await env.DB.prepare("SELECT id FROM subscriptions WHERE code_hash = ?").bind(codeHash).first();
  if (!row) return json({ ok: false, error: "CODE_INTROUVABLE" }, 404);
  if (data.action === "reset_devices") {
    await env.DB.prepare("UPDATE subscriptions SET autoradio_device = NULL, phone_device = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run();
    return json({ ok: true, action: "reset_devices" });
  }
  return json({ ok: false, error: "ACTION_INCONNUE" }, 400);
}





async function ensureMailCounterTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mail_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS mail_events_category ON mail_events(category)").run();
}

function normalizeMailCategory(value) {
  const key = String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  const allowed = new Set(["papiers_travail", "mypos_go2", "mypos_ultra", "mypos_flex", "autre"]);
  return allowed.has(key) ? key : "autre";
}

async function recordMailEvent(request, env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE" }, 503);
  await ensureMailCounterTable(env);
  const data = await body(request);
  const category = normalizeMailCategory(data.category);
  await env.DB.prepare("INSERT INTO mail_events(category) VALUES (?)").bind(category).run();
  return json({ ok: true, category });
}

async function adminMailCounters(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "SECRET_INCORRECT" }, 401);
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE" }, 503);
  await ensureMailCounterTable(env);
  const rows = await env.DB.prepare("SELECT category, COUNT(*) AS count FROM mail_events GROUP BY category").all();
  const counts = { papiers_travail: 0, mypos_go2: 0, mypos_ultra: 0, mypos_flex: 0, autre: 0 };
  let total = 0;
  for (const row of rows.results || []) {
    const n = Number(row.count || 0);
    counts[row.category] = n;
    total += n;
  }
  return json({ ok: true, total, counts });
}


async function ensureAdminPresenceTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_presence (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    active INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

async function adminPresenceStatus(env) {
  if (!env.DB) return json({ ok: true, active: false });
  await ensureAdminPresenceTable(env);
  const row = await env.DB.prepare("SELECT active FROM admin_presence WHERE id = 1").first();
  return json({ ok: true, active: !!(row && Number(row.active) === 1) });
}

async function adminPresenceAction(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "SECRET_INCORRECT" }, 401);
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE" }, 503);
  await ensureAdminPresenceTable(env);
  const data = await body(request);
  const active = data.active === true ? 1 : 0;
  await env.DB.prepare(`INSERT INTO admin_presence(id, active, updated_at) VALUES(1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET active=excluded.active, updated_at=CURRENT_TIMESTAMP`).bind(active).run();
  return json({ ok: true, active: !!active });
}

async function presence(request, env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE", count: 0 }, 503);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_presence (
    device_id TEXT PRIMARY KEY,
    last_seen INTEGER NOT NULL
  )`).run();
  const now = Math.floor(Date.now() / 1000);
  if (request.method === "POST") {
    const data = await body(request);
    const deviceId = String(data.deviceId || "").slice(0, 100);
    if (!deviceId) return json({ ok: false, error: "APPAREIL_INVALIDE" }, 400);
    await env.DB.prepare("INSERT INTO app_presence(device_id,last_seen) VALUES(?,?) ON CONFLICT(device_id) DO UPDATE SET last_seen=excluded.last_seen")
      .bind(deviceId, now).run();
    await env.DB.prepare("DELETE FROM app_presence WHERE last_seen < ?").bind(now - 600).run();
  }
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM app_presence WHERE last_seen >= ?").bind(now - 120).first();
  return json({ ok: true, count: Number(row && row.count || 0) });
}


async function ensureInstallationsTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_installations (
    device_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL DEFAULT 'unknown',
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )`).run();
}

async function installations(request, env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE", count: 0 }, 503);
  await ensureInstallationsTable(env);
  if (request.method === "POST") {
    const data = await body(request);
    const deviceId = String(data.deviceId || "").slice(0, 100);
    const platform = String(data.platform || "unknown").slice(0, 32);
    if (!deviceId) return json({ ok: false, error: "APPAREIL_INVALIDE" }, 400);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(`INSERT INTO app_installations(device_id,platform,first_seen,last_seen)
      VALUES(?,?,?,?)
      ON CONFLICT(device_id) DO UPDATE SET platform=excluded.platform,last_seen=excluded.last_seen`)
      .bind(deviceId, platform, now, now).run();
    return json({ ok: true });
  }
  return json({ ok: false, error: "METHODE_INVALIDE" }, 405);
}

async function adminInstallations(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "SECRET_INCORRECT" }, 401);
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE", count: 0 }, 503);
  await ensureInstallationsTable(env);
  const now = Math.floor(Date.now() / 1000);
  const twoMonths = 60 * 24 * 60 * 60;
  await env.DB.prepare("DELETE FROM app_installations WHERE last_seen < ?").bind(now - twoMonths).run();
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM app_installations WHERE last_seen >= ?").bind(now - twoMonths).first();
  return json({ ok: true, count: Number(row && row.count || 0) });
}

async function downloadAutoradioApk() {
  const source = "https://raw.githubusercontent.com/stevesuzon/Carlplay-apk/main/LATEST-APK.apk";
  try {
    const upstream = await fetch(source, { headers: { "accept": "application/vnd.android.package-archive,application/octet-stream" } });
    if (!upstream.ok) return new Response("APK indisponible", { status: 502 });
    const headers = new Headers();
    headers.set("content-type", "application/vnd.android.package-archive");
    headers.set("content-disposition", 'attachment; filename="Couteau-Suisse-V5-Autoradio.apk"');
    headers.set("cache-control", "no-store");
    headers.set("access-control-allow-origin", "*");
    return new Response(upstream.body, { status: 200, headers });
  } catch (e) {
    return new Response("Téléchargement APK indisponible", { status: 502 });
  }
}

async function downloadRne(url) {
  const siren = String(url.searchParams.get("siren") || "").replace(/\D/g, "");
  if (!/^\d{9}$/.test(siren)) return json({ ok: false, error: "SIREN_INVALIDE" }, 400);
  const source = `https://data.inpi.fr/export/companies?format=pdf&ids=${encodeURIComponent(JSON.stringify([siren]))}`;
  try {
    const upstream = await fetch(source, { headers: { "accept": "application/pdf" } });
    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !type.toLowerCase().includes("pdf")) return json({ ok: false, error: "DOCUMENT_INDISPONIBLE" }, 502);
    return new Response(upstream.body, { status: 200, headers: { ...cors, "content-type": "application/pdf", "content-disposition": `attachment; filename="extrait-rne-${siren}.pdf"`, "cache-control": "no-store" } });
  } catch {
    return json({ ok: false, error: "SERVICE_INPI_INDISPONIBLE" }, 502);
  }
}

async function ensureMarketTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS imported_markets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL UNIQUE,
    country TEXT NOT NULL,
    area TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'marche',
    name TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    day TEXT NOT NULL,
    hours TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    merchants TEXT NOT NULL DEFAULT '',
    draw TEXT NOT NULL DEFAULT '',
    registration TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    latitude REAL,
    longitude REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  try { await env.DB.prepare("ALTER TABLE imported_markets ADD COLUMN latitude REAL").run(); } catch (_) {}
  try { await env.DB.prepare("ALTER TABLE imported_markets ADD COLUMN longitude REAL").run(); } catch (_) {}
  try { await env.DB.prepare("ALTER TABLE imported_markets ADD COLUMN registration TEXT NOT NULL DEFAULT ''").run(); } catch (_) {}
}

function cleanMarket(value, max = 240) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeMarket(input) {
  const country = cleanMarket(input.country || input.pays, 2).toUpperCase() === "BE" ? "BE" : "FR";
  const area = cleanMarket(input.area || input.department || input.departement || input.province, 80).toUpperCase();
  const kind = /brocante/i.test(cleanMarket(input.kind || input.type)) ? "brocante" : "marche";
  const name = cleanMarket(input.name || input.nom);
  const city = cleanMarket(input.city || input.ville || input.commune, 120);
  const day = cleanMarket(input.day || input.jour, 30).toLowerCase();
  const hours = cleanMarket(input.hours || input.horaires, 80);
  const address = cleanMarket(input.address || input.adresse, 240);
  const merchants = cleanMarket(input.merchants || input.commercants || input.nombre_commercants, 40);
  const draw = cleanMarket(input.draw || input.tirage || input.tirage_au_sort, 30);
  const registration = cleanMarket(input.registration || input.inscription, 120);
  const note = cleanMarket(input.note || input.remarques, 500);
  const latitude = Number(input.latitude != null ? input.latitude : input.lat);
  const longitude = Number(input.longitude != null ? input.longitude : (input.lng != null ? input.lng : input.lon));
  if (!area || !name || !day) return null;
  const fingerprint = [country, area, kind, name, city, day].join("|").toLowerCase();
  return { fingerprint, country, area, kind, name, city, day, hours, address, merchants, draw, registration, note,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null };
}

async function listMarkets(env) {
  await ensureMarketTable(env);
  await ensureMarketVerificationTables(env);
  const result = await env.DB.prepare("SELECT country,area,kind,name,city,day,hours,address,merchants,draw,registration,note,latitude,longitude FROM imported_markets ORDER BY country,area,day,city,name").all();
  const removed = await env.DB.prepare("SELECT market_key FROM market_verification_consensus WHERE field='exists' AND lower(value_norm)='non'").all();
  const disabled = new Set((removed.results || []).map(r => String(r.market_key || '')));
  const markets = (result.results || []).filter(m => {
    const key = [String(m.country || '').toLowerCase(),m.area,m.name,m.city,m.day,m.address || ''].join('|');
    return !disabled.has(key);
  });
  return json({ ok: true, markets });
}

async function importMarkets(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "SECRET_INCORRECT" }, 401);
  await ensureMarketTable(env);
  const payload = await body(request);
  const source = Array.isArray(payload) ? payload : payload.markets;
  if (!Array.isArray(source) || !source.length) return json({ ok: false, error: "AUCUN_MARCHE" }, 400);
  let added = 0, updated = 0, duplicates = 0, invalid = 0;
  for (const raw of source.slice(0, 5000)) {
    const m = normalizeMarket(raw);
    if (!m) { invalid++; continue; }
    const existing = await env.DB.prepare("SELECT fingerprint FROM imported_markets WHERE fingerprint=?").bind(m.fingerprint).first();
    await env.DB.prepare(`INSERT INTO imported_markets
      (fingerprint,country,area,kind,name,city,day,hours,address,merchants,draw,registration,note,latitude,longitude)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(fingerprint) DO UPDATE SET country=excluded.country,area=excluded.area,kind=excluded.kind,name=excluded.name,city=excluded.city,day=excluded.day,hours=excluded.hours,address=excluded.address,merchants=excluded.merchants,draw=excluded.draw,registration=excluded.registration,note=excluded.note,latitude=excluded.latitude,longitude=excluded.longitude`).bind(m.fingerprint,m.country,m.area,m.kind,m.name,m.city,m.day,m.hours,m.address,m.merchants,m.draw,m.registration,m.note,m.latitude,m.longitude).run();
    if (existing) updated++; else added++;
  }
  return json({ ok: true, added, updated, duplicates, invalid, total: source.length });
}

const MARKET_CONSENSUS_REQUIRED = 1;
const MARKET_LOCATION_REQUIRED = 1;
const MARKET_LOCATION_CLUSTER_METERS = 100;
const MARKET_PHOTO_MAX_BYTES = 260000;
const MARKET_PHOTO_MAX_DISTANCE_METERS = 130;
const MARKET_PHOTO_MIN_STALLS = 0; // V109 : aucun minimum de stands
const MARKET_PHOTO_MIN_QUALITY = 45; // V109 : ne pas refuser une vraie vue générale pour des critères esthétiques

async function ensureMarketVerificationTables(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_verification_votes (
    market_key TEXT NOT NULL, field TEXT NOT NULL, value_norm TEXT NOT NULL, value_display TEXT NOT NULL,
    device_id TEXT NOT NULL, ip_hash TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (market_key, field, device_id)
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS market_votes_value ON market_verification_votes(market_key,field,value_norm)").run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_verification_consensus (
    market_key TEXT NOT NULL, field TEXT NOT NULL, value_norm TEXT NOT NULL, value_display TEXT NOT NULL,
    confirmations INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (market_key, field)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_photo_metadata (
    market_key TEXT PRIMARY KEY, object_key TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
    device_id TEXT NOT NULL, user_latitude REAL NOT NULL, user_longitude REAL NOT NULL,
    market_latitude REAL NOT NULL, market_longitude REAL NOT NULL, distance_meters REAL NOT NULL,
    quality_score INTEGER NOT NULL DEFAULT 0, stall_count INTEGER NOT NULL DEFAULT 0,
    ai_reason TEXT NOT NULL DEFAULT '', replacement_count INTEGER NOT NULL DEFAULT 0, captured_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  for (const sql of [
    "ALTER TABLE market_photo_metadata ADD COLUMN quality_score INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE market_photo_metadata ADD COLUMN stall_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE market_photo_metadata ADD COLUMN ai_reason TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE market_photo_metadata ADD COLUMN replacement_count INTEGER NOT NULL DEFAULT 0"
  ]) { try { await env.DB.prepare(sql).run(); } catch (_) {} }
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_photo_uploads (
    market_key TEXT NOT NULL, device_id TEXT NOT NULL, uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (market_key, device_id)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_photo_blobs (
    market_key TEXT PRIMARY KEY, data_base64 TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_location_votes (
    market_key TEXT NOT NULL, device_id TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, accuracy REAL NOT NULL DEFAULT 0,
    address TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (market_key, device_id)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_location_consensus (
    market_key TEXT PRIMARY KEY, latitude REAL NOT NULL, longitude REAL NOT NULL, address TEXT NOT NULL DEFAULT '',
    confirmations INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

function cleanMarketKey(value) { return String(value || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 500); }

function normalizedVerification(field, raw) {
  const value = String(raw == null ? "" : raw).trim();
  if (!value) return null;
  if (field === "time") {
    const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) return null;
    return { norm: `${match[1]}:${match[2]}`, display: `${match[1]}h${match[2] === "00" ? "" : match[2]}` };
  }
  if (field === "count") {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 0 || count > 10000) return null;
    return { norm: String(count), display: String(count) };
  }
  if (field === "draw" || field === "exists") {
    const norm = value.toLowerCase();
    if (norm !== "oui" && norm !== "non") return null;
    return { norm, display: norm === "oui" ? "Oui" : "Non" };
  }
  if (field === "clientModel") {
    const allowed = {"français":"Français","francais":"Français","belge":"Belge","noir":"Noir","mélangé":"Mélangé","melange":"Mélangé"};
    const key = value.toLowerCase();
    if (!allowed[key]) return null;
    return { norm: key.normalize('NFD').replace(/[\u0300-\u036f]/g,''), display: allowed[key] };
  }
  if (field === "welcome") {
    const allowed={gentil:"Gentil",diable:"Diable","ça dépend de qui place":"Ça dépend de qui place","ca depend de qui place":"Ça dépend de qui place"},key=value.toLowerCase();
    if(!allowed[key]) return null;
    return {norm:key.normalize('NFD').replace(/[\u0300-\u036f]/g,''),display:allowed[key]};
  }
  if (field === "placer") {
    const allowed=["Femme","Homme","Municipal"],parts=value.split(",").map(x=>x.trim()).filter(x=>allowed.includes(x));
    const unique=[...new Set(parts)]; return unique.length?{norm:unique.join("|").toLowerCase(),display:unique.join(", ")}:null;
  }
  return null;
}

async function registeredVerificationDevice(env, deviceId) {
  await ensureInstallationsTable(env);
  return !!(await env.DB.prepare("SELECT device_id FROM app_installations WHERE device_id=?").bind(deviceId).first());
}

async function refreshMarketConsensus(env, marketKey, field) {
  const existing = await env.DB.prepare("SELECT field,value_norm,value_display,confirmations,updated_at FROM market_verification_consensus WHERE market_key=? AND field=?")
    .bind(marketKey, field).first();
  if (existing) return { field, leadingValue: existing.value_display, confirmations: Number(existing.confirmations || 1), confirmed: existing, locked: true };
  const first = await env.DB.prepare(`SELECT value_norm,value_display,device_id FROM market_verification_votes
    WHERE market_key=? AND field=? ORDER BY updated_at DESC LIMIT 1`).bind(marketKey, field).first();
  if (!first) return { field, leadingValue: "", confirmations: 0, confirmed: null, locked: false };
  await env.DB.prepare(`INSERT INTO market_verification_consensus(market_key,field,value_norm,value_display,confirmations,updated_at)
    VALUES(?,?,?,?,1,CURRENT_TIMESTAMP)
    ON CONFLICT(market_key,field) DO NOTHING`).bind(marketKey, field, first.value_norm, first.value_display).run();
  const confirmed = await env.DB.prepare("SELECT field,value_norm,value_display,confirmations,updated_at FROM market_verification_consensus WHERE market_key=? AND field=?")
    .bind(marketKey, field).first();
  return { field, leadingValue: confirmed ? confirmed.value_display : first.value_display, confirmations: confirmed ? Number(confirmed.confirmations || 1) : 1, confirmed: confirmed || null, locked: !!confirmed };
}

async function reverseMarketAddress(lat, lon) {
  try {
    const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`;
    const r = await fetch(u, { headers: { 'User-Agent': 'CouteauSuisse-Marches/1.0', 'Accept-Language': 'fr' } });
    if (!r.ok) return '';
    const j = await r.json();
    return String(j.display_name || '').trim().slice(0, 300);
  } catch (_) { return ''; }
}

async function refreshMarketLocationConsensus(env, marketKey) {
  const existing = await env.DB.prepare("SELECT latitude,longitude,address,confirmations,updated_at FROM market_location_consensus WHERE market_key=?").bind(marketKey).first();
  if (existing) return { latitude:Number(existing.latitude), longitude:Number(existing.longitude), address:existing.address || '', confirmations:Number(existing.confirmations || 1), required:1, locked:true, updatedAt:existing.updated_at };
  const point = await env.DB.prepare("SELECT latitude,longitude,address,accuracy FROM market_location_votes WHERE market_key=? ORDER BY updated_at DESC LIMIT 1").bind(marketKey).first();
  if (!point) return null;
  const lat=Number(point.latitude), lon=Number(point.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let address=String(point.address||'').trim();
  if (!address) address=await reverseMarketAddress(lat,lon);
  if (!address) address=`${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  await env.DB.prepare(`INSERT INTO market_location_consensus(market_key,latitude,longitude,address,confirmations,updated_at)
    VALUES(?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(market_key) DO NOTHING`).bind(marketKey,lat,lon,address).run();
  const locked=await env.DB.prepare("SELECT latitude,longitude,address,confirmations,updated_at FROM market_location_consensus WHERE market_key=?").bind(marketKey).first();
  return locked ? {latitude:Number(locked.latitude),longitude:Number(locked.longitude),address:locked.address||'',confirmations:Number(locked.confirmations||1),required:1,locked:true,updatedAt:locked.updated_at} : null;
}

async function marketVerificationState(env, marketKey, includePhoto = true) {
  await ensureMarketVerificationTables(env);
  const consensus = await env.DB.prepare("SELECT field,value_display,confirmations,updated_at FROM market_verification_consensus WHERE market_key=?").bind(marketKey).all();
  const pending = await env.DB.prepare(`SELECT field,value_display,COUNT(DISTINCT device_id) AS confirmations
    FROM market_verification_votes WHERE market_key=? GROUP BY field,value_norm,value_display ORDER BY field,confirmations DESC`).bind(marketKey).all();
  const values = {}, leaders = {};
  for (const row of consensus.results || []) values[row.field] = { value: row.value_display, confirmations: Number(row.confirmations || 1), updatedAt: row.updated_at, locked:true };
  for (const row of pending.results || []) if (!leaders[row.field] && !values[row.field]) leaders[row.field] = { value: row.value_display, confirmations: Number(row.confirmations), required: 1 };
  let photo = null;
  if (includePhoto) {
    const row = await env.DB.prepare("SELECT distance_meters,quality_score,stall_count,replacement_count,captured_at,updated_at FROM market_photo_metadata WHERE market_key=?").bind(marketKey).first();
    if (row) {
      const replacementsUsed=Math.max(0,Number(row.replacement_count||0));
      photo = { url: `/api/market-photo?marketKey=${encodeURIComponent(marketKey)}&v=${encodeURIComponent(row.updated_at)}`, distanceMeters: Math.round(Number(row.distance_meters)), qualityScore: Number(row.quality_score || 0), stallCount: Number(row.stall_count || 0), replacementsUsed, replacementsRemaining:Math.max(0,2-replacementsUsed), locked:replacementsUsed>=2, capturedAt: row.captured_at };
    }
  }
  const loc = await env.DB.prepare("SELECT latitude,longitude,address,confirmations,updated_at FROM market_location_consensus WHERE market_key=?").bind(marketKey).first();
  const location = loc ? { latitude:Number(loc.latitude), longitude:Number(loc.longitude), address:loc.address, confirmations:Number(loc.confirmations || 1), required:1, locked:true, updatedAt:loc.updated_at } : null;
  const locVotes = await env.DB.prepare("SELECT COUNT(*) AS n FROM market_location_votes WHERE market_key=?").bind(marketKey).first();
  return { marketKey, required: 1, fieldsLocked:true, locationRequired: 1, locationVotes:Number(locVotes&&locVotes.n||0), values, leaders, photo, location };
}

function haversineMeters(a, b, c, d) {
  const p = Math.PI / 180, da = (c - a) * p, db = (d - b) * p;
  const x = Math.sin(da / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(db / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(x));
}

function decodePhoto(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/(jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const binary = atob(match[2]);
  if (!binary.length || binary.length > MARKET_PHOTO_MAX_BYTES) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseVisionJson(value) {
  const text = String(value && (value.response || value.result || value.choices?.[0]?.message?.content) || value || "")
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (_) { return null; }
}

async function inspectMarketPhoto(env, dataUrl) {
  if (!env.AI) return { ok: true, validationMode: "fallback", stallCount: 0, qualityScore: 55, reason: "Contrôle automatique indisponible : photo acceptée avec confirmation utilisateur et GPS." };
  try {
    const response = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
      messages: [
        { role: "system", content: "You are a strict image validator. Return only valid JSON, with no markdown." },
        { role: "user", content: "Validate whether this photo genuinely documents a market in progress. IMPORTANT: be permissive about composition and do NOT require a fixed number of stalls. ACCEPT a normal aisle photo when stalls, merchandise and/or merchants are clearly visible as part of the market, including an aisle with stalls on one or both sides. A photo like a person standing in the central aisle, with food/produce stalls and market activity visible along the sides and farther down the aisle, MUST be accepted even if pedestrians, a dog, poles, vehicles belonging to traders, sky, or empty pavement are also visible. generalView means the image gives useful context of the market area; it does NOT mean every stall must be visible. Reject only when the photo does not provide credible visual evidence of a market: e.g. only a wall/building/empty road/parked vehicle, an extreme close-up of one person or object with no market context, the market is substantially hidden, or the image is unusably blurred/dark. Do not reject merely because the framing is imperfect or because one side has fewer stalls. Return exactly: {\"accepted\":boolean,\"isMarket\":boolean,\"generalView\":boolean,\"stallCount\":integer,\"qualityScore\":integer,\"reason\":\"short French reason\"}. qualityScore is 0-100. Give a higher qualityScore when the market is more clearly visible as a whole, lively, well framed, and shows more useful market context/stalls. This score is used to decide whether a new photo is genuinely better than the currently published one." }
      ],
      image: dataUrl,
      max_tokens: 180,
      temperature: 0
    });
    const result = parseVisionJson(response);
    if (!result) return { ok: true, validationMode: "fallback", stallCount: 0, qualityScore: 55, reason: "Contrôle automatique momentanément indisponible : photo acceptée avec confirmation utilisateur et GPS." };
    const stalls = Math.max(0, Math.min(1000, Math.round(Number(result.stallCount) || 0)));
    const quality = Math.max(0, Math.min(100, Math.round(Number(result.qualityScore) || 0)));
    const accepted = result.accepted === true && result.isMarket === true && result.generalView === true && quality >= MARKET_PHOTO_MIN_QUALITY;
    if (!accepted) return { ok: false, error: "PHOTO_SANS_VUE_GENERALE_DU_MARCHE", stallCount: stalls, qualityScore: quality, reason: String(result.reason || "Photo refusée").slice(0, 180) };
    return { ok: true, stallCount: stalls, qualityScore: quality, reason: String(result.reason || "Vue générale du marché").slice(0, 180) };
  } catch (_) { return { ok: true, validationMode: "fallback", stallCount: 0, qualityScore: 55, reason: "Contrôle automatique momentanément indisponible : photo acceptée avec confirmation utilisateur et GPS." }; }
}

async function saveMarketPhoto(env, marketKey, deviceId, photo, locationOverride = false, photoOverride = false) {
  if (photo.generalView !== true) return { ok: false, error: "VUE_GENERALE_NON_CONFIRMEE" };
  const userLat = Number(photo.userLatitude), userLon = Number(photo.userLongitude), accuracy = Number(photo.accuracy);
  if (![userLat, userLon, accuracy].every(Number.isFinite) || accuracy < 0 || accuracy > 150) return { ok: false, error: "GPS_PHOTO_IMPRECIS" };

  const official = await env.DB.prepare("SELECT latitude,longitude,address FROM market_location_consensus WHERE market_key=?").bind(marketKey).first();
  let marketLat, marketLon;
  if (official && !locationOverride) {
    marketLat = Number(official.latitude); marketLon = Number(official.longitude);
  } else {
    marketLat = Number(photo.proposedMarketLatitude); marketLon = Number(photo.proposedMarketLongitude);
    if (![marketLat, marketLon].every(Number.isFinite)) return { ok:false, error:"GPS_MARCHE_INVALIDE" };
  }
  const distance = haversineMeters(userLat, userLon, marketLat, marketLon);
  if (official && !locationOverride) {
    if (distance > MARKET_PHOTO_MAX_DISTANCE_METERS) return { ok:false, error:"TROP_LOIN_DU_GPS_OFFICIEL", distanceMeters:Math.round(distance) };
  } else if (distance > Math.max(accuracy, 30)) return { ok:false, error:"GPS_ET_PHOTO_NON_COHERENTS" };

  const bytes = decodePhoto(photo.dataUrl);
  if (!bytes) return { ok: false, error: "PHOTO_INVALIDE_OU_TROP_LOURDE" };
  const inspection = await inspectMarketPhoto(env, photo.dataUrl);
  if (!inspection.ok) return inspection;

  const current = await env.DB.prepare("SELECT quality_score,replacement_count,device_id FROM market_photo_metadata WHERE market_key=?").bind(marketKey).first();
  const replacementsUsed = current ? Math.max(0,Number(current.replacement_count||0)) : 0;
  if (current && replacementsUsed >= 2 && !photoOverride) return { ok:false, error:"PHOTO_VERROUILLEE_APRES_2_REMPLACEMENTS", replacementsUsed:2, replacementsRemaining:0 };
  if (current && !photoOverride) {
    if ((inspection.validationMode||'ai') === 'fallback') return { ok:true, keptExisting:true, message:"CONTROLE_AUTO_INDISPONIBLE_PHOTO_EXISTANTE_CONSERVEE", qualityScore:inspection.qualityScore, stallCount:inspection.stallCount, distanceMeters:Math.round(distance), replacementsUsed, replacementsRemaining:Math.max(0,2-replacementsUsed), validationMode:'fallback' };
    if (Number(inspection.qualityScore||0) <= Number(current.quality_score||0)) return { ok:true, keptExisting:true, message:"LA_PHOTO_EXISTANTE_EST_MEILLEURE_OU_EQUIVALENTE", qualityScore:inspection.qualityScore, stallCount:inspection.stallCount, distanceMeters:Math.round(distance), replacementsUsed, replacementsRemaining:Math.max(0,2-replacementsUsed), validationMode:inspection.validationMode||'ai' };
  }

  const objectKey = env.MARKET_PHOTOS ? `market-photos/${await sha256Text(marketKey)}.jpg` : `d1:${await sha256Text(marketKey)}`;
  if (env.MARKET_PHOTOS) {
    await env.MARKET_PHOTOS.put(objectKey, bytes, { httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=3600" } });
    try { await env.DB.prepare("DELETE FROM market_photo_blobs WHERE market_key=?").bind(marketKey).run(); } catch (_) {}
  } else {
    const encoded = String(photo.dataUrl || "").replace(/^data:image\/(?:jpeg|jpg);base64,/i, "");
    await env.DB.prepare(`INSERT INTO market_photo_blobs(market_key,data_base64,mime_type,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(market_key) DO UPDATE SET data_base64=excluded.data_base64,mime_type=excluded.mime_type,updated_at=CURRENT_TIMESTAMP`)
      .bind(marketKey, encoded, "image/jpeg").run();
  }
  const capturedAt = new Date().toISOString(), newReplacementCount=current?replacementsUsed+1:0;
  await env.DB.prepare(`INSERT INTO market_photo_metadata(market_key,object_key,mime_type,device_id,user_latitude,user_longitude,market_latitude,market_longitude,distance_meters,quality_score,stall_count,ai_reason,replacement_count,captured_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(market_key) DO UPDATE SET object_key=excluded.object_key,mime_type=excluded.mime_type,device_id=excluded.device_id,user_latitude=excluded.user_latitude,user_longitude=excluded.user_longitude,market_latitude=excluded.market_latitude,market_longitude=excluded.market_longitude,distance_meters=excluded.distance_meters,quality_score=excluded.quality_score,stall_count=excluded.stall_count,ai_reason=excluded.ai_reason,replacement_count=excluded.replacement_count,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(marketKey, objectKey, "image/jpeg", deviceId, userLat, userLon, marketLat, marketLon, distance, inspection.qualityScore, inspection.stallCount, inspection.reason, newReplacementCount, capturedAt).run();
  await env.DB.prepare(`INSERT INTO market_photo_uploads(market_key,device_id,uploaded_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(market_key,device_id) DO UPDATE SET uploaded_at=CURRENT_TIMESTAMP`).bind(marketKey, deviceId).run();
  return { ok:true, replaced:!!current, distanceMeters:Math.round(distance), stallCount:inspection.stallCount, qualityScore:inspection.qualityScore, capturedAt, replacementsUsed:newReplacementCount, replacementsRemaining:Math.max(0,2-newReplacementCount), locked:newReplacementCount>=2, validationMode:inspection.validationMode||"ai" };
}

async function submitMarketVerification(request, env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE" }, 503);
  await ensureMarketVerificationTables(env);
  const data = await body(request), marketKey = cleanMarketKey(data.marketKey), deviceId = String(data.deviceId || "").slice(0, 100);
  if (!marketKey || !validDevice(deviceId)) return json({ ok: false, error: "DONNEES_INVALIDES" }, 400);
  if (!(await registeredVerificationDevice(env, deviceId))) return json({ ok: false, error: "APPAREIL_NON_ENREGISTRE" }, 403);
  await ensureGpsUnlockTables(env);
  const ipHash = await sha256Text(`${env.CODE_PEPPER || "market"}:${request.headers.get("CF-Connecting-IP") || ""}`), results = {};
  const isAdminRequest = await adminAuthorized(request,env), requestedScope = ["gps","time","photo"].includes(String(data.unlockScope||"")) ? String(data.unlockScope) : "";
  let grantRow=null;
  if(!isAdminRequest&&requestedScope&&data.gpsUnlockId&&data.gpsUnlockToken){
    grantRow=await env.DB.prepare("SELECT id,scope,token_hash,status,grant_expires_at,consumed,market_key,device_id FROM gps_unlock_requests WHERE id=?").bind(String(data.gpsUnlockId)).first();
    const valid=!!(grantRow&&grantRow.scope===requestedScope&&grantRow.status==='approved'&&!grantRow.consumed&&Date.now()<=Number(grantRow.grant_expires_at||0)&&grantRow.market_key===marketKey&&grantRow.device_id===deviceId&&(await sha256Text(String(data.gpsUnlockToken)))===grantRow.token_hash);
    if(!valid)grantRow=null;
  }
  let grantUsed=false;

  const existingPresence = await env.DB.prepare("SELECT value_norm,value_display FROM market_verification_consensus WHERE market_key=? AND field='exists' LIMIT 1").bind(marketKey).first();
  if(existingPresence && String(existingPresence.value_norm||'').toLowerCase()==='non' && !isAdminRequest) return json({ok:false,error:'MARCHE_SUPPRIME'},409);
  let confirmsPresence=false;
  for (const field of ["time", "count", "draw", "clientModel", "welcome", "placer", "exists"]) {
    const locked = await env.DB.prepare("SELECT field,value_display,confirmations,updated_at FROM market_verification_consensus WHERE market_key=? AND field=?").bind(marketKey,field).first();
    const mayReplaceTime=locked&&isAdminRequest;
    if (locked&&!mayReplaceTime) { results[field]={field,leadingValue:locked.value_display,confirmations:Number(locked.confirmations||1),confirmed:locked,locked:true}; continue; }
    const value = normalizedVerification(field, data.values && data.values[field]);
    if (!value) continue;
    if(field==='exists' && value.norm!=='oui' && !isAdminRequest) continue;
    if(field!=='exists'||value.norm==='oui') confirmsPresence=true;
    if(mayReplaceTime){await env.DB.prepare(`INSERT INTO market_verification_consensus(market_key,field,value_norm,value_display,confirmations,updated_at) VALUES(?,?,?,?,1,CURRENT_TIMESTAMP)
      ON CONFLICT(market_key,field) DO UPDATE SET value_norm=excluded.value_norm,value_display=excluded.value_display,confirmations=1,updated_at=CURRENT_TIMESTAMP`).bind(marketKey,field,value.norm,value.display).run();results[field]={field,leadingValue:value.display,confirmations:1,confirmed:{field,value_display:value.display,confirmations:1},locked:true};if(grantRow&&grantRow.scope==='time')grantUsed=true;continue;}
    await env.DB.prepare(`INSERT INTO market_verification_votes(market_key,field,value_norm,value_display,device_id,ip_hash,created_at,updated_at)
      VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(market_key,field,device_id) DO UPDATE SET value_norm=excluded.value_norm,value_display=excluded.value_display,ip_hash=excluded.ip_hash,updated_at=CURRENT_TIMESTAMP`)
      .bind(marketKey, field, value.norm, value.display, deviceId, ipHash).run();
    results[field] = await refreshMarketConsensus(env, marketKey, field);
  }

  let photo = null, locationResult = await refreshMarketLocationConsensus(env,marketKey), locationVote=null;
  if (data.photo && data.photo.dataUrl) confirmsPresence=true;
  if (data.photo && data.photo.dataUrl) {
    const locationOverride=(isAdminRequest&&requestedScope!=='photo')||!!(grantRow&&grantRow.scope==='gps'),photoOverride=isAdminRequest||locationOverride||!!(grantRow&&grantRow.scope==='photo');
    photo = await saveMarketPhoto(env, marketKey, deviceId, data.photo, locationOverride, photoOverride);
    if(photo&&photo.ok&&grantRow&&(grantRow.scope==='gps'||grantRow.scope==='photo'))grantUsed=true;
    if(photo&&photo.ok&&locationOverride){const la=Number(data.photo.proposedMarketLatitude),lo=Number(data.photo.proposedMarketLongitude),ac=Number(data.photo.accuracy);if(Number.isFinite(la)&&Number.isFinite(lo)){const addr=await reverseMarketAddress(la,lo);await env.DB.prepare(`INSERT INTO market_location_consensus(market_key,latitude,longitude,address,confirmations,updated_at) VALUES(?,?,?,?,1,CURRENT_TIMESTAMP)
        ON CONFLICT(market_key) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,address=excluded.address,confirmations=1,updated_at=CURRENT_TIMESTAMP`).bind(marketKey,la,lo,addr).run();locationResult=await refreshMarketLocationConsensus(env,marketKey);locationVote={latitude:la,longitude:lo,accuracy:Number.isFinite(ac)?ac:0,address:addr,locked:true};}}
    if (photo && photo.ok && !locationResult) {
      const la=Number(data.photo.proposedMarketLatitude), lo=Number(data.photo.proposedMarketLongitude), ac=Number(data.photo.accuracy);
      if (Number.isFinite(la)&&Number.isFinite(lo)) {
        let addr=await reverseMarketAddress(la,lo);
        await env.DB.prepare(`INSERT INTO market_location_votes(market_key,device_id,latitude,longitude,accuracy,address,created_at,updated_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT(market_key,device_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,address=excluded.address,updated_at=CURRENT_TIMESTAMP`)
          .bind(marketKey,deviceId,la,lo,Number.isFinite(ac)?ac:0,addr).run();
        locationResult=await refreshMarketLocationConsensus(env,marketKey);
        locationVote=locationResult?{latitude:locationResult.latitude,longitude:locationResult.longitude,accuracy:Number.isFinite(ac)?ac:0,address:locationResult.address,locked:true}:null;
      }
    } else if (photo && photo.ok && locationResult) {
      locationVote={latitude:locationResult.latitude,longitude:locationResult.longitude,accuracy:Number(data.photo.accuracy||0),address:locationResult.address,locked:true};
    }
  }
  if(grantUsed&&grantRow)await env.DB.prepare("UPDATE gps_unlock_requests SET consumed=1,status='consumed',updated_at=? WHERE id=? AND consumed=0").bind(Date.now(),grantRow.id).run();
  if(confirmsPresence){await env.DB.prepare(`INSERT INTO market_verification_consensus(market_key,field,value_norm,value_display,confirmations,updated_at) VALUES(?,'exists','oui','Oui',1,CURRENT_TIMESTAMP) ON CONFLICT(market_key,field) DO UPDATE SET value_norm='oui',value_display='Oui',confirmations=1,updated_at=CURRENT_TIMESTAMP`).bind(marketKey).run();}
  if(photo&&photo.ok&&!isAdminRequest) await queueContestMarketReview(env,deviceId,marketKey,String(data.marketName||'Marché'),photo);
  return json({ ok: true, required: 1, locationRequired:1, results, photo, locationResult, locationVote, state: await marketVerificationState(env, marketKey) });
}

async function getMarketVerification(url, env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE" }, 503);
  const marketKey = cleanMarketKey(url.searchParams.get("marketKey"));
  if (!marketKey) return json({ ok: false, error: "MARCHE_INVALIDE" }, 400);
  return json({ ok: true, ...(await marketVerificationState(env, marketKey)) });
}

async function batchMarketVerifications(request, env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE" }, 503);
  await ensureMarketVerificationTables(env);
  const data = await body(request);
  const keys = [...new Set((Array.isArray(data.keys) ? data.keys : []).map(cleanMarketKey).filter(Boolean))].slice(0, 200), states = {};
  for (const key of keys) states[key] = await marketVerificationState(env, key, true);
  return json({ ok: true, required: MARKET_CONSENSUS_REQUIRED, states });
}

async function disabledMarketPresence(env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE" }, 503);
  await ensureMarketVerificationTables(env);
  const result = await env.DB.prepare("SELECT market_key,updated_at FROM market_verification_consensus WHERE field='exists' AND lower(value_norm)='non' ORDER BY updated_at DESC").all();
  return json({ ok: true, keys: (result.results || []).map(r => String(r.market_key || '')).filter(Boolean), updatedAt: Date.now() });
}

async function marketPhoto(url, env) {
  if (!env.DB) return new Response("Photo indisponible", { status: 404, headers: cors });
  await ensureMarketVerificationTables(env);
  const marketKey = cleanMarketKey(url.searchParams.get("marketKey"));
  const row = marketKey && await env.DB.prepare("SELECT object_key,mime_type FROM market_photo_metadata WHERE market_key=?").bind(marketKey).first();
  if (!row) return new Response("Photo indisponible", { status: 404, headers: cors });
  if (env.MARKET_PHOTOS && !String(row.object_key || "").startsWith("d1:")) {
    const object = await env.MARKET_PHOTOS.get(row.object_key);
    if (object) return new Response(object.body, { headers: { ...cors, "content-type": row.mime_type || "image/jpeg", "cache-control": "public, max-age=3600" } });
  }
  const blob = await env.DB.prepare("SELECT data_base64,mime_type FROM market_photo_blobs WHERE market_key=?").bind(marketKey).first();
  if (!blob || !blob.data_base64) return new Response("Photo indisponible", { status: 404, headers: cors });
  try {
    const binary = atob(String(blob.data_base64));
    const bytes = new Uint8Array(binary.length);
    for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
    return new Response(bytes, { headers: { ...cors, "content-type": blob.mime_type || row.mime_type || "image/jpeg", "cache-control": "public, max-age=3600" } });
  } catch (_) { return new Response("Photo indisponible", { status: 404, headers: cors }); }
}

async function vigilanceForPlace(url) {
  const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ ok: false, error: "POSITION_INVALIDE" }, 400);
  try {
    const geo = await fetch(`https://geo.api.gouv.fr/communes?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&fields=codeDepartement,departement&format=json`, { headers: { accept: "application/json", "user-agent": "CouteauSuisse-Weather/1.0" } });
    const communes = geo.ok ? await geo.json() : [];
    const commune = Array.isArray(communes) && communes[0];
    const department = commune && commune.departement && commune.departement.nom || "";
    const code = commune && commune.codeDepartement || "";
    if (!department) return json({ ok: true, department: "", code: "", orangeThunderstorm: false });
    const feed = await fetch("https://feeds.meteoalarm.org/api/v1/warnings/feeds-france", { headers: { accept: "application/json", "user-agent": "CouteauSuisse-Weather/1.0" }, cf: { cacheTtl: 300, cacheEverything: true } });
    if (!feed.ok) throw new Error("feed");
    const warnings = await feed.json();
    const fold = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const dep = fold(department);
    let yellowThunderstorm = false, orangeThunderstorm = false, redThunderstorm = false, floodRisk = false, floodLevel = "";
    for (const warning of warnings.warnings || []) for (const info of warning.alert && warning.alert.info || []) {
      if (!(info.area || []).some(area => fold(area.areaDesc) === dep)) continue;
      if (info.expires && Date.parse(info.expires) <= Date.now()) continue;
      const title = fold([info.event, info.headline, ...(info.parameter || []).map(p => p.value)].join(" "));
      if ((title.includes("orage") || title.includes("thunderstorm")) && title.includes("orange")) orangeThunderstorm = true;
      if ((title.includes("orage") || title.includes("thunderstorm")) && title.includes("red")) redThunderstorm = true;
      if ((title.includes("orage") || title.includes("thunderstorm")) && title.includes("yellow")) yellowThunderstorm = true;
      if (title.includes("inondation") || title.includes("crue") || title.includes("flood")) {
        floodRisk = true;
        if (title.includes("red") || title.includes("rouge")) floodLevel = "rouge";
        else if (!floodLevel || floodLevel === "jaune") floodLevel = title.includes("orange") ? "orange" : "jaune";
      }
    }
    return json({ ok: true, department, code, yellowThunderstorm, orangeThunderstorm: orangeThunderstorm || redThunderstorm, redThunderstorm, floodRisk, floodLevel }, 200);
  } catch (error) {
    return json({ ok: false, error: "VIGILANCE_INDISPONIBLE", detail: String(error && error.message || error).slice(0, 160) }, 502);
  }
}


// ===== JEU CONCOURS V189 =====
function contestCleanName(v){return String(v||"").trim().replace(/\s+/g," ").slice(0,80)}
function contestId(){return crypto.randomUUID()}
function contestKm(a,b,c,d){return haversineMeters(Number(a),Number(b),Number(c),Number(d))/1000}
function contestFiveMonthEnd(start){const d=new Date(Number(start)||Date.now());d.setMonth(d.getMonth()+5);return d.getTime()}
const CONTEST_BONUS_MS=3*86400000;
const CONTEST_LONG_TRIP_BONUS_MS=2*86400000;
const CONTEST_RESULTS_MS=3*86400000;
const CONTEST_APP_FREE_EXTRA_MS=5*86400000;
const CONTEST_DIESEL_PRICE=2.23;
// Valeur technique volontairement cachée dans l'interface : elle sert seulement au calcul carburant.
const CONTEST_REFERENCE_L_PER_100KM=7;
function contestDistanceFuel(km){
  const hundredths=Math.max(0,Math.floor((Number(km)||0)*100+1e-9));
  const usedKm=hundredths/100;
  // 2,23 €/L × 7 L/100 km = 0,1561 point par km. Le résultat garde ses décimales, sans arrondi à l'entier.
  const points=(hundredths*1561)/1000000;
  return {usedKm,points};
}
function contestNumberText(v){
  const n=Number(v)||0;
  return n.toFixed(6).replace(/0+$/,'').replace(/\.$/,'');
}
function contestDurationText(ms){const h=Math.max(1,Math.round(Number(ms||0)/3600000));return h%24===0?(h/24)+" jour"+((h/24)>1?"s":""):h+" heures"}

async function ensureContestTables(env){
  await ensureSubscriptionEmailColumns(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_config(id INTEGER PRIMARY KEY CHECK(id=1),start_at INTEGER NOT NULL,end_at INTEGER NOT NULL,finalized_at INTEGER,results_until INTEGER,rules_version INTEGER NOT NULL DEFAULT 189)`).run();
  try{await env.DB.prepare("ALTER TABLE contest_config ADD COLUMN rules_version INTEGER NOT NULL DEFAULT 186").run()}catch(_){}
  try{await env.DB.prepare("ALTER TABLE contest_config ADD COLUMN results_until INTEGER").run()}catch(_){}
  let cfg=await env.DB.prepare("SELECT * FROM contest_config WHERE id=1").first();
  if(!cfg){const start=Date.now(),end=contestFiveMonthEnd(start);await env.DB.prepare("INSERT INTO contest_config(id,start_at,end_at,rules_version) VALUES(1,?,?,189)").bind(start,end).run();cfg={id:1,start_at:start,end_at:end,finalized_at:null,results_until:null,rules_version:189}}
  else{
    const prior=Number(cfg.rules_version||186);
    if(prior<188&&!cfg.finalized_at){const end=prior<187?contestFiveMonthEnd(cfg.start_at):Number(cfg.end_at);await env.DB.prepare("UPDATE contest_config SET end_at=? WHERE id=1").bind(end).run()}
    if(cfg.finalized_at&&!cfg.results_until)await env.DB.prepare("UPDATE contest_config SET results_until=? WHERE id=1").bind(Number(cfg.finalized_at)+CONTEST_RESULTS_MS).run();
    if(prior<189)await env.DB.prepare("UPDATE contest_config SET rules_version=189 WHERE id=1").run();
    cfg=await env.DB.prepare("SELECT * FROM contest_config WHERE id=1").first();
  }

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_participants(subscription_id INTEGER PRIMARY KEY,device_id TEXT NOT NULL,first_name TEXT NOT NULL,last_name TEXT NOT NULL,email_hash TEXT NOT NULL DEFAULT '',home_country TEXT NOT NULL DEFAULT 'FR',home_area TEXT NOT NULL,home_commune TEXT NOT NULL,home_lat REAL NOT NULL,home_lon REAL NOT NULL,return_place_lat REAL,return_place_lon REAL,return_place_label TEXT NOT NULL DEFAULT '',points REAL NOT NULL DEFAULT 0,banned INTEGER NOT NULL DEFAULT 0,alert_count INTEGER NOT NULL DEFAULT 0,change_allowed INTEGER NOT NULL DEFAULT 0,joined_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`).run();
  for(const sql of ["ALTER TABLE contest_participants ADD COLUMN return_place_lat REAL","ALTER TABLE contest_participants ADD COLUMN return_place_lon REAL","ALTER TABLE contest_participants ADD COLUMN return_place_label TEXT NOT NULL DEFAULT ''","ALTER TABLE contest_participants ADD COLUMN camping_active INTEGER NOT NULL DEFAULT 0","ALTER TABLE contest_participants ADD COLUMN camping_lat REAL","ALTER TABLE contest_participants ADD COLUMN camping_lon REAL","ALTER TABLE contest_participants ADD COLUMN camping_label TEXT NOT NULL DEFAULT ''","ALTER TABLE contest_participants ADD COLUMN camping_updated_at INTEGER"])try{await env.DB.prepare(sql).run()}catch(_){}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_market_points(id INTEGER PRIMARY KEY AUTOINCREMENT,subscription_id INTEGER NOT NULL,market_key TEXT NOT NULL,market_name TEXT NOT NULL,distance_km REAL NOT NULL,points REAL NOT NULL,base_points REAL NOT NULL DEFAULT 0,multiplier INTEGER NOT NULL DEFAULT 1,breakdown_json TEXT NOT NULL DEFAULT '{}',market_lat REAL,market_lon REAL,place_label TEXT NOT NULL DEFAULT '',awarded_at INTEGER NOT NULL,UNIQUE(subscription_id,market_key))`).run();
  for(const sql of ["ALTER TABLE contest_market_points ADD COLUMN base_points INTEGER NOT NULL DEFAULT 0","ALTER TABLE contest_market_points ADD COLUMN multiplier INTEGER NOT NULL DEFAULT 1","ALTER TABLE contest_market_points ADD COLUMN breakdown_json TEXT NOT NULL DEFAULT '{}'"])try{await env.DB.prepare(sql).run()}catch(_){}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_market_reviews(id TEXT PRIMARY KEY,subscription_id INTEGER NOT NULL,market_key TEXT NOT NULL,market_name TEXT NOT NULL,device_id TEXT NOT NULL,market_lat REAL NOT NULL,market_lon REAL NOT NULL,place_label TEXT NOT NULL DEFAULT '',photo_captured_at TEXT NOT NULL DEFAULT '',distance_km REAL NOT NULL,base_points INTEGER NOT NULL DEFAULT 0,multiplier INTEGER NOT NULL DEFAULT 1,points INTEGER NOT NULL,breakdown_json TEXT NOT NULL DEFAULT '{}',unusual INTEGER NOT NULL DEFAULT 0,previous_place TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,decided_at INTEGER,UNIQUE(subscription_id,market_key))`).run();
  for(const sql of ["ALTER TABLE contest_market_reviews ADD COLUMN base_points INTEGER NOT NULL DEFAULT 0","ALTER TABLE contest_market_reviews ADD COLUMN multiplier INTEGER NOT NULL DEFAULT 1","ALTER TABLE contest_market_reviews ADD COLUMN breakdown_json TEXT NOT NULL DEFAULT '{}'"])try{await env.DB.prepare(sql).run()}catch(_){}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_reports(id TEXT PRIMARY KEY,subscription_id INTEGER NOT NULL,kind TEXT NOT NULL,description TEXT NOT NULL,fingerprint TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',points REAL NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,decided_at INTEGER)`).run();
  try{await env.DB.prepare("ALTER TABLE contest_reports ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ''").run()}catch(_){}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_commune_requests(id TEXT PRIMARY KEY,subscription_id INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,decided_at INTEGER)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_travel_alerts(id TEXT PRIMARY KEY,subscription_id INTEGER NOT NULL,review_id TEXT NOT NULL,new_place TEXT NOT NULL,previous_place TEXT NOT NULL,message TEXT NOT NULL,user_answer TEXT NOT NULL DEFAULT '',answer_place TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,answered_at INTEGER)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_messages(id TEXT PRIMARY KEY,subscription_id INTEGER NOT NULL,kind TEXT NOT NULL DEFAULT 'info',message TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_results(rank INTEGER PRIMARY KEY,subscription_id INTEGER NOT NULL,first_name TEXT NOT NULL,last_name TEXT NOT NULL,points INTEGER NOT NULL,reward TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_score_events(id TEXT PRIMARY KEY,subscription_id INTEGER NOT NULL,source_type TEXT NOT NULL,source_id TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',base_points INTEGER NOT NULL DEFAULT 0,multiplier INTEGER NOT NULL DEFAULT 1,awarded_points REAL NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,UNIQUE(subscription_id,source_type,source_id))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_bonus_periods(id TEXT PRIMARY KEY,subscription_id INTEGER NOT NULL,multiplier INTEGER NOT NULL,reason TEXT NOT NULL,source_key TEXT NOT NULL,duration_ms INTEGER NOT NULL DEFAULT 259200000,status TEXT NOT NULL DEFAULT 'queued',created_at INTEGER NOT NULL,start_at INTEGER,end_at INTEGER,finished_at INTEGER,UNIQUE(subscription_id,source_key))`).run();
  try{await env.DB.prepare("ALTER TABLE contest_bonus_periods ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 259200000").run()}catch(_){}
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS contest_bonus_status_idx ON contest_bonus_periods(subscription_id,status,created_at)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS contest_score_events_idx ON contest_score_events(subscription_id,created_at)").run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_referral_invites(
    id TEXT PRIMARY KEY,sponsor_subscription_id INTEGER NOT NULL,token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,claimed_subscription_id INTEGER,claimed_at INTEGER
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_referrals(
    id TEXT PRIMARY KEY,invite_id TEXT NOT NULL UNIQUE,sponsor_subscription_id INTEGER NOT NULL,
    referee_subscription_id INTEGER NOT NULL UNIQUE,referee_device_id TEXT NOT NULL UNIQUE,
    email_hash TEXT NOT NULL UNIQUE,phone_hash TEXT NOT NULL UNIQUE,ip_hash TEXT NOT NULL DEFAULT '',phone_mask TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'email_pending',sms_code_hash TEXT NOT NULL DEFAULT '',sms_expires_at INTEGER,
    sms_attempts INTEGER NOT NULL DEFAULT 0,sms_sent_at INTEGER,verified_at INTEGER,
    sponsor_rewarded INTEGER NOT NULL DEFAULT 0,referee_rewarded INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS contest_referrals_sponsor_idx ON contest_referrals(sponsor_subscription_id,status,created_at)").run();
  return cfg;
}

async function contestSubscription(env,data){
  await ensureSubscriptionEmailColumns(env);const deviceId=String(data.deviceId||""),code=normalizeCode(data.subscriptionCode||data.code||"");let row=null;
  if(validDevice(deviceId)){const identityEmail=normalizeEmail(data.email);row=validEmail(identityEmail)?await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) ORDER BY CASE WHEN lower(COALESCE(recovery_email_mask,''))=? THEN 0 ELSE 1 END,lifetime DESC,COALESCE(expires_at,'') DESC LIMIT 1").bind(deviceId,deviceId,identityEmail).first():await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC LIMIT 1").bind(deviceId,deviceId).first()}
  if(!row&&validCode(code)){const h=await hashCode(code,env.CODE_PEPPER);row=await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash=? AND active=1 LIMIT 1").bind(h).first()}
  if(!row)return null;if(!row.lifetime&&(!row.expires_at||Date.parse(row.expires_at)<=Date.now()))return null;return row;
}
async function contestTrialIdentity(request,env){
  const cfg=await ensureContestTables(env),now=Date.now(),freeUntil=Number(cfg.end_at)+CONTEST_APP_FREE_EXTRA_MS;
  if(now>freeUntil)return json({ok:false,error:"PERIODE_ESSAI_TERMINEE"},403);
  const data=await body(request),deviceId=String(data.deviceId||""),email=normalizeEmail(data.email),firstName=contestCleanName(data.firstName),lastName=contestCleanName(data.lastName);
  if(!validDevice(deviceId))return json({ok:false,error:"DONNEES_INVALIDES"},400);
  if(firstName.length<2||lastName.length<2)return json({ok:false,error:"NOM_PRENOM_OBLIGATOIRES"},400);
  if(!validEmail(email))return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);
  const emailHash=await sha256Text(email),trialHash=await sha256Text("contest-trial:"+deviceId),trialEmailHash=await sha256Text("contest-trial-email:"+deviceId+":"+email);
  let row=await env.DB.prepare("SELECT * FROM subscriptions WHERE (phone_device=? OR autoradio_device=?) AND (code_hash=? OR lower(COALESCE(recovery_email_mask,''))=?) ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC LIMIT 1").bind(deviceId,deviceId,trialHash,email).first();
  if(row){
    const stillPaid=!!row.lifetime||(row.code_hash!==trialHash&&row.expires_at&&Date.parse(row.expires_at)>now);
    const expiry=stillPaid?row.expires_at:new Date(freeUntil).toISOString(),storedHash=stillPaid?emailHash:trialEmailHash;
    await env.DB.prepare("UPDATE subscriptions SET expires_at=?,active=1,phone_device=?,recovery_email_hash=?,recovery_email_mask=?,account_first_name=?,account_last_name=?,account_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(expiry,deviceId,storedHash,email,firstName,lastName,now,row.id).run();
  }else{
    await env.DB.prepare("INSERT INTO subscriptions(code_hash,expires_at,lifetime,active,phone_device,recovery_email_hash,recovery_email_mask,account_first_name,account_last_name,account_updated_at) VALUES(?,?,0,1,?,?,?,?,?,?)").bind(trialHash,new Date(freeUntil).toISOString(),deviceId,trialEmailHash,email,firstName,lastName,now).run();
  }
  return json({ok:true,trial:true,email,firstName,lastName,expiresAt:new Date(freeUntil).toISOString()});
}

async function contestPlaceLabel(lat,lon){
  try{const r=await fetch(`https://geo.api.gouv.fr/communes?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&fields=nom,codeDepartement,departement&format=json`,{headers:{accept:"application/json"}});if(r.ok){const a=await r.json(),c=Array.isArray(a)&&a[0];if(c)return `${c.nom}${c.codeDepartement?` (${c.codeDepartement})`:''}`}}catch(_){}
  try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=12`,{headers:{"user-agent":"CouteauSuisse-Contest/1.0"}});if(r.ok){const j=await r.json(),a=j.address||{};return String(a.city||a.town||a.village||a.municipality||j.display_name||"Lieu inconnu").slice(0,120)}}catch(_){}
  return "Lieu non identifié";
}

function formatReturnPlaceNominatim(j){
  const a=j&&j.address||{},city=a.city||a.town||a.village||a.municipality||a.hamlet||'',pc=a.postcode||'';
  const generic=new Set([String(city).toLowerCase(),String(a.road||'').toLowerCase(),String(a.pedestrian||'').toLowerCase(),String(a.square||'').toLowerCase(),String(a.place||'').toLowerCase()]);
  const candidates=[j&&j.name,a.amenity,a.tourism,a.leisure,a.shop,a.office,a.building,a.cemetery,a.historic,a.place].map(x=>String(x||'').trim()).filter(Boolean);
  let named='';
  for(const c of candidates){const lc=c.toLowerCase();if(c.length>2&&!generic.has(lc)&&!/^(yes|no|residential|commercial|industrial)$/i.test(c)){named=c;break}}
  if(named)return named;
  const road=String(a.road||a.pedestrian||a.square||a.place||'').trim();
  const line2=[pc,city].filter(Boolean).join(' ');
  if(road&&line2)return `${road}, ${line2}`;
  if(road)return road;
  if(line2)return line2;
  return String(j&&j.display_name||'').split(',').slice(0,3).join(', ').trim();
}

function formatReturnPlacePostalAddress(j){
  const a=j&&j.address||{},city=String(a.city||a.town||a.village||a.municipality||a.hamlet||'').trim(),pc=String(a.postcode||'').trim();
  const road=String(a.road||a.pedestrian||a.residential||a.path||a.square||a.place||'').trim(),number=String(a.house_number||'').trim();
  const line1=[number,road].filter(Boolean).join(' ').trim(),line2=[pc,city].filter(Boolean).join(' ').trim();
  return [line1,line2].filter(Boolean).join(', ');
}
function cleanReturnPlaceDisplayName(v){return String(v||'').replace(/\s+/g,' ').trim().replace(/\s*(?:[-–—]|\/)\s*(?:Gros\s+)?Malhon\s*$/i,'').trim()}
function preferredReturnPlaceName(name,fullAddress){
  let n=cleanReturnPlaceDisplayName(name),a=String(fullAddress||'').replace(/\s+/g,' ').trim();
  // Si le point GPS est sur une aire d'accueil, ne pas prendre un cimetière/parking voisin comme titre.
  if(/aire d[’']?accueil des gens du voyage/i.test(a)){
    if(/rennes/i.test(a))return 'Aire d’accueil des gens du voyage de Rennes';
    const m=a.match(/(aire d[’']?accueil des gens du voyage[^,;]*)/i);
    if(m&&m[1])return cleanReturnPlaceDisplayName(m[1]);
  }
  return n;
}
function officialReturnPlaceAddress(name,address){
  const n=String(name||''),a=String(address||'').replace(/\s+/g,' ').trim();
  if(/aire d[’']?accueil des gens du voyage/i.test(n)&&/rennes/i.test(n)&&(/\b(?:gros[ -]?)?malhon\b/i.test(a)||/aire d[’']?accueil des gens du voyage/i.test(a)||!a))return '68 avenue Gros Malhon, 35000 Rennes';
  return a;
}

function exactNamedNominatim(j){
  const a=j&&j.address||{},city=String(a.city||a.town||a.village||a.municipality||a.hamlet||'').trim(),road=String(a.road||a.pedestrian||a.square||a.place||'').trim();
  const generic=new Set([city.toLowerCase(),road.toLowerCase(),String(a.postcode||'').toLowerCase()]);
  const candidates=[j&&j.name,a.amenity,a.tourism,a.leisure,a.cemetery,a.historic,a.building,a.shop,a.office].map(x=>String(x||'').trim()).filter(Boolean);
  for(const c of candidates){const lc=c.toLowerCase();if(c.length>2&&!/^\d+$/.test(c)&&!generic.has(lc)&&!/^(yes|no|residential|commercial|industrial|house|apartments)$/i.test(c))return c}
  return '';
}

async function nominatimExactReturnPlace(lat,lon){
  try{
    const r=await fetchDiningWithTimeout(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&namedetails=1&zoom=18&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,{headers:{'user-agent':'CouteauSuisse-ReturnPlace/1.0','accept-language':'fr'}},3200);
    if(r.ok){const j=await r.json(),a=j&&j.address||{};return {name:exactNamedNominatim(j),address:formatReturnPlaceNominatim(j),fullAddress:formatReturnPlacePostalAddress(j),countryCode:String(a.country_code||'').toLowerCase()}}
  }catch(_){ }
  return {name:'',address:'',fullAddress:'',countryCode:''};
}

function returnPlacePoiPriority(tags){
  tags=tags||{};
  const tourism=String(tags.tourism||''),amenity=String(tags.amenity||''),leisure=String(tags.leisure||''),landuse=String(tags.landuse||''),historic=String(tags.historic||''),place=String(tags.place||''),shop=String(tags.shop||''),office=String(tags.office||''),building=String(tags.building||'');
  if(/camp_site|caravan_site|camp_pitch/i.test(tourism))return -140;
  if(/grave_yard|parking|hospital|clinic|school|college|university|townhall|community_centre|place_of_worship/i.test(amenity))return -100;
  if(/cemetery/i.test(landuse)||/cemetery|memorial|monument/i.test(historic))return -110;
  if(/park|stadium|sports_centre|nature_reserve/i.test(leisure))return -85;
  if(/attraction|museum|hotel|hostel|motel|guest_house/i.test(tourism))return -75;
  if(place)return -65;
  if(shop||office)return 35;
  if(/restaurant|fast_food|cafe|bar|pub/i.test(amenity))return 55;
  if(building&&building!=='yes')return 5;
  return 20;
}

async function nearestNamedOsmPlace(lat,lon){
  try{
    const q=`[out:json][timeout:7];nwr(around:250,${lat},${lon})["name"];out center tags 100;`;
    const r=await fetchDiningWithTimeout('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(q),{headers:{'user-agent':'CouteauSuisse-ReturnPlace/1.0'}},3500);
    if(!r.ok)return '';
    const j=await r.json();
    const rows=(j.elements||[]).map(e=>{
      const la=Number(e.lat??e.center?.lat),lo=Number(e.lon??e.center?.lon),tags=e.tags||{},name=String(tags.name||'').trim();
      if(!name||!Number.isFinite(la)||!Number.isFinite(lo))return null;
      const useful=tags.amenity||tags.tourism||tags.leisure||tags.landuse||tags.historic||tags.place||tags.shop||tags.office||tags.building||tags.man_made;
      if(!useful)return null;
      const distance=Math.round(haversineMeters(lat,lon,la,lo));
      return {name,distance,score:distance+returnPlacePoiPriority(tags)};
    }).filter(Boolean).filter(x=>x.distance<=250).sort((a,b)=>a.score-b.score||a.distance-b.distance);
    const best=rows[0];
    return best&&best.distance<=220?best.name:'';
  }catch(_){return ''}
}

function osmCuisineLabel(tags,fast){
  const raw=String(tags&&tags.cuisine||'').trim();
  if(!raw)return fast?'Restauration rapide':'Spécialité non indiquée';
  const labels={french:'Cuisine française',italian:'Italien',pizza:'Pizzeria',burger:'Burgers',japanese:'Japonais',sushi:'Sushis',chinese:'Chinois',indian:'Indien',thai:'Thaï',vietnamese:'Vietnamien',lebanese:'Libanais',mediterranean:'Méditerranéen',seafood:'Fruits de mer',kebab:'Kebab',regional:'Cuisine régionale',vegetarian:'Végétarien'};
  const parts=raw.split(/[;,]/).map(x=>x.trim()).filter(Boolean).slice(0,2).map(x=>labels[x.toLowerCase()]||x.replace(/_/g,' '));
  return parts.join(' / ');
}

function commonsFileUrl(file){
  file=String(file||'').trim().replace(/^File:/i,'').trim();
  if(!file)return '';
  return 'https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(file)+'?width=640';
}
function directFreePhoto(tags){
  tags=tags||{};
  const image=String(tags.image||'').trim();
  if(/^https?:\/\//i.test(image))return {url:image,credit:'OpenStreetMap'};
  if(/^File:/i.test(image))return {url:commonsFileUrl(image),credit:'Wikimedia Commons'};
  const commons=String(tags.wikimedia_commons||'').trim();
  if(/^https?:\/\//i.test(commons))return {url:commons,credit:'Wikimedia Commons'};
  if(/^File:/i.test(commons))return {url:commonsFileUrl(commons),credit:'Wikimedia Commons'};
  return {url:'',credit:''};
}
async function wikidataFreePhoto(qid){
  qid=String(qid||'').trim();
  if(!/^Q\d+$/i.test(qid))return {url:'',credit:''};
  try{
    const r=await fetchDiningWithTimeout('https://www.wikidata.org/wiki/Special:EntityData/'+encodeURIComponent(qid.toUpperCase())+'.json',{headers:{'user-agent':'CouteauSuisse-ReturnPlace/1.0'}},1800);
    if(!r.ok)return {url:'',credit:''};
    const j=await r.json(),e=j&&j.entities&&j.entities[qid.toUpperCase()],claims=e&&e.claims||{};
    const claim=(claims.P18&&claims.P18[0])||(claims.P154&&claims.P154[0]);
    const file=String(claim&&claim.mainsnak&&claim.mainsnak.datavalue&&claim.mainsnak.datavalue.value||'').trim();
    return file?{url:commonsFileUrl(file),credit:'Wikimedia Commons'}:{url:'',credit:''};
  }catch(_){return {url:'',credit:''}}
}
async function wikidataOfficialWebsite(qid){
  qid=String(qid||'').trim();
  if(!/^Q\d+$/i.test(qid))return '';
  try{
    const r=await fetchDiningWithTimeout('https://www.wikidata.org/wiki/Special:EntityData/'+encodeURIComponent(qid.toUpperCase())+'.json',{headers:{'user-agent':'CouteauSuisse-ReturnPlace/1.0'}},1800);
    if(!r.ok)return '';
    const j=await r.json(),e=j&&j.entities&&j.entities[qid.toUpperCase()],claims=e&&e.claims||{},claim=claims.P856&&claims.P856[0];
    const u=String(claim&&claim.mainsnak&&claim.mainsnak.datavalue&&claim.mainsnak.datavalue.value||'').trim();
    return /^https?:\/\//i.test(u)?u:'';
  }catch(_){return ''}
}
async function wikipediaFreePhoto(tag){
  tag=String(tag||'').trim();
  const m=tag.match(/^([a-z-]{2,12}):(.+)$/i);if(!m)return {url:'',credit:''};
  const lang=m[1].toLowerCase(),title=m[2].trim();if(!title)return {url:'',credit:''};
  try{
    const r=await fetchDiningWithTimeout('https://'+lang+'.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(title.replace(/ /g,'_')),{headers:{'user-agent':'CouteauSuisse-ReturnPlace/1.0'}},1800);
    if(!r.ok)return {url:'',credit:''};
    const j=await r.json(),u=String(j&&((j.thumbnail&&j.thumbnail.source)||(j.originalimage&&j.originalimage.source))||'').trim();
    return /^https?:\/\//i.test(u)?{url:u,credit:'Wikipédia / Wikimedia'}:{url:'',credit:''};
  }catch(_){return {url:'',credit:''}}
}
async function freeDiningPhoto(tags){
  const direct=directFreePhoto(tags);if(direct.url)return direct;
  const ids=[tags&&tags.wikidata,tags&&tags['brand:wikidata']].map(x=>String(x||'').trim()).filter(Boolean);
  for(const id of ids){const p=await wikidataFreePhoto(id);if(p.url)return p}
  if(tags&&tags.wikipedia){const p=await wikipediaFreePhoto(tags.wikipedia);if(p.url)return p}
  return {url:'',credit:''};
}
function osmDiningNotability(tags){
  tags=tags||{};let score=0;
  if(tags.wikipedia)score+=8;if(tags.wikidata)score+=7;if(tags.wikimedia_commons||tags.image)score+=6;
  if(tags.website||tags['contact:website'])score+=3;if(tags.phone||tags['contact:phone'])score+=1;
  if(tags.brand||tags['brand:wikidata'])score+=2;if(tags.opening_hours)score+=1;
  return score;
}

async function fetchDiningWithTimeout(url,options={},timeoutMs=4000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(url,{...options,signal:controller.signal})}
  finally{clearTimeout(timer)}
}

async function fetchOverpassJson(q){
  const endpoints=[
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
  ];
  return await new Promise(resolve=>{
    let done=false,pending=endpoints.length;
    const finish=j=>{if(done)return;if(j&&Array.isArray(j.elements)){done=true;resolve(j);return}pending--;if(pending<=0){done=true;resolve(null)}};
    for(const endpoint of endpoints){
      fetchDiningWithTimeout(endpoint,{method:'POST',headers:{'user-agent':'CouteauSuisse-ReturnPlace/1.0','content-type':'application/x-www-form-urlencoded;charset=UTF-8','accept':'application/json'},body:'data='+encodeURIComponent(q)},4200)
        .then(async r=>{if(!r.ok)return null;try{return await r.json()}catch(_){return null}})
        .then(finish).catch(()=>finish(null));
    }
  });
}
function diningAddressFromNominatim(x){
  const a=x&&x.address||{};
  const street=[a.house_number,a.road||a.pedestrian||a.square||a.place].filter(Boolean).join(' ').trim();
  const city=a.city||a.town||a.village||a.municipality||a.suburb||'';
  const locality=[a.postcode,city].filter(Boolean).join(' ').trim();
  return [street,locality].filter(Boolean).join(', ');
}
function diningPhone(tags){
  tags=tags||{};
  return String(tags['contact:phone']||tags.phone||tags['contact:mobile']||tags.mobile||'').trim();
}
function diningWebsite(tags){
  tags=tags||{};
  return String(tags['contact:website']||tags.website||tags['contact:menu']||tags.menu||'').trim();
}
function stripHtmlToText(v){
  return String(v||'')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'\"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&euro;|&#8364;/gi,'€')
    .replace(/&agrave;/gi,'à').replace(/&aacute;/gi,'á').replace(/&acirc;/gi,'â').replace(/&auml;/gi,'ä')
    .replace(/&ccedil;/gi,'ç').replace(/&egrave;/gi,'è').replace(/&eacute;/gi,'é').replace(/&ecirc;/gi,'ê').replace(/&euml;/gi,'ë')
    .replace(/&icirc;/gi,'î').replace(/&iuml;/gi,'ï').replace(/&ocirc;/gi,'ô').replace(/&ouml;/gi,'ö').replace(/&ugrave;/gi,'ù').replace(/&ucirc;/gi,'û').replace(/&uuml;/gi,'ü')
    .replace(/&oelig;/gi,'œ')
    .replace(/\s+/g,' ')
    .trim();
}
function menuSpecialtiesFromText(text){
  // On n'affiche que des plats réellement repérés dans une source publique : jamais de plat inventé à partir du type de cuisine.
  const src=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(!src)return [];
  const dishes=[
    ['Andouillette',/\bandouillette(?:s)?\b/],
    ['Galette-saucisse',/\bgalette[ -]saucisse(?:s)?\b/],
    ['Galettes',/\bgalette(?:s)?\b/],
    ['Crêpes',/\bcrepe(?:s)?\b/],
    ['Moules-frites',/\bmoules?[ -](?:frites?|frite)\b|\bmoules?\b[^.]{0,35}\bfrites?\b/],
    ['Moules',/\bmoules?\b/],
    ['Fruits de mer',/\bfruits? de mer\b/],
    ['Huîtres',/\bhuitre(?:s)?\b/],
    ['Homard',/\bhomard(?:s)?\b/],
    ['Poissons',/\bpoisson(?:s)?\b/],
    ['Choucroute',/\bchoucroute(?:s)?\b/],
    ['Cassoulet',/\bcassoulet(?:s)?\b/],
    ['Bœuf bourguignon',/\bboeuf bourguignon\b/],
    ['Blanquette de veau',/\bblanquette de veau\b/],
    ['Pot-au-feu',/\bpot[ -]au[ -]feu\b/],
    ['Coq au vin',/\bcoq au vin\b/],
    ['Confit de canard',/\bconfit de canard\b/],
    ['Magret de canard',/\bmagret de canard\b/],
    ['Foie gras',/\bfoie gras\b/],
    ['Escargots',/\bescargot(?:s)?\b/],
    ['Steak tartare',/\bsteak tartare\b|\btartare de boeuf\b/],
    ['Entrecôte',/\bentrecote(?:s)?\b/],
    ['Côte de bœuf',/\bcote de boeuf\b/],
    ['Burger',/\bburger(?:s)?\b/],
    ['Pizza',/\bpizza(?:s)?\b/],
    ['Pâtes',/\bpates?\b|\bpasta\b/],
    ['Lasagnes',/\blasagne(?:s)?\b/],
    ['Risotto',/\brisotto(?:s)?\b/],
    ['Couscous',/\bcouscous\b/],
    ['Tajine',/\btajine(?:s)?\b/],
    ['Kebab',/\bkebab(?:s)?\b/],
    ['Sushi',/\bsushi(?:s)?\b/],
    ['Sashimi',/\bsashimi(?:s)?\b/],
    ['Ramen',/\bramen\b/],
    ['Pad thaï',/\bpad thai\b/],
    ['Curry',/\bcurry\b/],
    ['Nems',/\bnem(?:s)?\b/],
    ['Pho',/\bpho\b/],
    ['Paella',/\bpaella(?:s)?\b/],
    ['Tapas',/\btapas\b/],
    ['Grillades',/\bgrillade(?:s)?\b/],
    ['Poulet rôti',/\bpoulet roti\b/],
    ['Tacos',/\btacos?\b/],
    ['Fish and chips',/\bfish (?:and|&) chips\b/]
  ];
  const out=[];
  for(const [label,re] of dishes){if(re.test(src)&&!out.includes(label))out.push(label);if(out.length>=8)break}
  if(out.includes('Galette-saucisse')){const i=out.indexOf('Galettes');if(i>=0)out.splice(i,1)}
  if(out.includes('Moules-frites')){const i=out.indexOf('Moules');if(i>=0)out.splice(i,1)}
  return out.slice(0,8);
}
function menuSpecialtiesFromTags(tags){
  tags=tags||{};
  const raw=[tags.description,tags.note,tags['description:fr'],tags['menu:description'],tags.menu,tags['contact:menu']]
    .map(x=>String(x||'')).filter(x=>x&&!/^https?:\/\//i.test(x)).join(' | ');
  return menuSpecialtiesFromText(raw);
}
function decodeDiningHtml(v){
  return String(v||'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&euro;|&#8364;/gi,'€').replace(/&oelig;/gi,'œ').replace(/&agrave;/gi,'à').replace(/&aacute;/gi,'á').replace(/&acirc;/gi,'â').replace(/&auml;/gi,'ä').replace(/&ccedil;/gi,'ç').replace(/&egrave;/gi,'è').replace(/&eacute;/gi,'é').replace(/&ecirc;/gi,'ê').replace(/&euml;/gi,'ë').replace(/&icirc;/gi,'î').replace(/&iuml;/gi,'ï').replace(/&ocirc;/gi,'ô').replace(/&ouml;/gi,'ö').replace(/&ugrave;/gi,'ù').replace(/&ucirc;/gi,'û').replace(/&uuml;/gi,'ü');
}
function cleanDiningMenuItem(v){
  let x=decodeDiningHtml(String(v||'')).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  x=x.replace(/^[\s•·|–—-]+|[\s•·|–—-]+$/g,'').replace(/\s+(?:\d{1,3}(?:[,.]\d{1,2})?\s*(?:€|eur(?:os?)?))\s*$/i,'').trim();
  if(x.length<3||x.length>90)return '';
  if(/^https?:|www\.|@|\+?\d[\d\s().-]{7,}$/i.test(x))return '';
  if(/^(accueil|home|menu|menus|la carte|notre carte|carte|restaurant|réserver|reservation|contact|horaires|mentions légales|politique|cookies?|entrée?s?|plats?|desserts?|boissons?|formules?|nos produits|nos menus)$/i.test(x))return '';
  if(/(?:télécharger|download|commander|livraison|click\s*&?\s*collect|instagram|facebook|tripadvisor|copyright)/i.test(x))return '';
  if((x.match(/[A-Za-zÀ-ÿ]/g)||[]).length<3)return '';
  return x;
}
function uniqueDiningMenuItems(items,limit=8){
  const out=[],seen=new Set();
  for(const item of items||[]){const x=cleanDiningMenuItem(item);if(!x)continue;const k=x.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ');if(!k||seen.has(k))continue;seen.add(k);out.push(x);if(out.length>=limit)break}
  return out;
}
function jsonLdDiningMenuItems(html){
  const out=[];let m;
  const re=/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const walk=(v,depth)=>{if(depth>18||v==null)return;if(Array.isArray(v)){for(const x of v)walk(x,depth+1);return}if(typeof v!=='object')return;const t=Array.isArray(v['@type'])?v['@type'].join(' '):String(v['@type']||'');if(/MenuItem/i.test(t)&&v.name)out.push(String(v.name));for(const [k,val] of Object.entries(v)){if(k==='name'&&/MenuItem/i.test(t))continue;if(/^(itemListElement|hasMenu|hasMenuSection|hasMenuItem|mainEntity|subjectOf|@graph)$/i.test(k)||typeof val==='object')walk(val,depth+1)}};
  while((m=re.exec(String(html||'')))&&out.length<24){try{walk(JSON.parse(decodeDiningHtml(m[1]).replace(/^\s*<!--|-->\s*$/g,'')),0)}catch(_){}}
  return uniqueDiningMenuItems(out,12);
}
function pricedDiningMenuItems(html){
  let t=String(html||'')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'\n')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'\n')
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi,'\n')
    .replace(/<[^>]+>/g,' ');
  t=decodeDiningHtml(t).replace(/\r/g,'\n');
  const lines=t.split(/\n+/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean),out=[];
  const price=/\b\d{1,3}(?:[,.]\d{1,2})?\s*(?:€|EUR|euros?)\b/i;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(price.test(line)){
      let before=line.split(price)[0].replace(/[.:·•|–—-]+$/g,'').trim();
      if(before&&before.length<=90)out.push(before);
      else if(i>0)out.push(lines[i-1]);
    }else if(i+1<lines.length&&price.test(lines[i+1])&&line.length<=90)out.push(line);
    if(out.length>=18)break;
  }
  return uniqueDiningMenuItems(out,10);
}
function menuPageLinks(html,baseUrl){
  const scored=[];let m;const seen=new Set();
  const re=/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while((m=re.exec(String(html||'')))){
    const href=decodeDiningHtml(m[1]).trim(),text=stripHtmlToText(m[2]).slice(0,120),hay=(href+' '+text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if(!/(?:\bmenu\b|\bcarte\b|specialit|nos[-_ ]?plats|a[-_ ]?la[-_ ]?carte|food[-_ ]?menu)/i.test(hay))continue;
    try{const u=new URL(href,baseUrl),b=new URL(baseUrl);if(!safePublicDiningUrl(u.href)||u.hostname!==b.hostname)continue;u.hash='';const k=u.href;if(seen.has(k))continue;seen.add(k);let score=0;if(/(?:^|[\/_-])(menu|carte|menus)(?:[\/_-]|$)/i.test(u.pathname))score+=5;if(/notre|la[-_ ]?carte|specialit|nos[-_ ]?plats/i.test(hay))score+=3;if(/pdf/i.test(u.pathname))score-=4;scored.push({url:k,score})}catch(_){ }
  }
  return scored.sort((a,b)=>b.score-a.score).slice(0,2).map(x=>x.url);
}
function safePublicDiningUrl(url){
  try{
    const u=new URL(url);if(!/^https?:$/.test(u.protocol))return false;
    const h=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
    if(!h||h==='localhost'||h.endsWith('.local')||h==='::1'||h==='0.0.0.0'||h==='169.254.169.254')return false;
    if(/^127\.|^10\.|^192\.168\.|^169\.254\./.test(h))return false;
    const m=h.match(/^172\.(\d{1,3})\./);if(m&&Number(m[1])>=16&&Number(m[1])<=31)return false;
    return true;
  }catch(_){return false}
}
function likelyOfficialDiningWebsite(url){
  if(!safePublicDiningUrl(url))return false;
  try{const h=new URL(url).hostname.toLowerCase().replace(/^www\./,'');return !/(^|\.)(facebook\.com|instagram\.com|tripadvisor\.[a-z.]+|thefork\.[a-z.]+|lafourchette\.[a-z.]+|ubereats\.com|deliveroo\.[a-z.]+|justeat\.[a-z.]+|pagesjaunes\.fr|google\.[a-z.]+|maps\.[a-z.]+|linktr\.ee|tiktok\.com|youtube\.com)$/i.test(h)}catch(_){return false}
}
async function fetchDiningSitePage(url,timeoutMs=1400){
  try{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (compatible; CouteauSuisseRestaurantMenu/1.0)','accept':'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2','accept-language':'fr-FR,fr;q=0.9'},redirect:'follow',signal:controller.signal});
    clearTimeout(timer);
    if(!r.ok)return null;
    const type=String(r.headers.get('content-type')||'').toLowerCase();if(type&&!/text\/html|application\/xhtml\+xml|text\/plain/.test(type))return null;
    const html=(await r.text()).slice(0,500000);return {html,url:r.url||url};
  }catch(_){return null}
}
function menuItemsFromPublicPage(html){
  const exact=menuSpecialtiesFromText(stripHtmlToText(html));
  const structured=jsonLdDiningMenuItems(html);
  const priced=pricedDiningMenuItems(html);
  return uniqueDiningMenuItems([...(exact||[]),...(structured||[]),...(priced||[])],12);
}
async function fetchPublicMenuSpecialties(row){
  const already=Array.isArray(row&&row.menuSpecialties)?row.menuSpecialties.filter(Boolean):[];
  if(already.length)return {items:already.slice(0,6),source:'Données publiques'};
  const website=String(row&&row.website||'').trim(),menuRaw=String(row&&row.menuUrl||'').trim();
  let homeUrl='';
  if(/^https?:\/\//i.test(website)&&likelyOfficialDiningWebsite(website))homeUrl=website;
  let directMenu='';
  try{if(menuRaw){directMenu=new URL(menuRaw,homeUrl||undefined).href;if(!likelyOfficialDiningWebsite(directMenu))directMenu=''}}catch(_){directMenu=''}
  const urls=[];if(directMenu)urls.push(directMenu);if(homeUrl&&!urls.includes(homeUrl))urls.push(homeUrl);
  if(!urls.length)return {items:[],source:''};
  const found=[];let source='';
  for(const firstUrl of urls.slice(0,2)){
    const page=await fetchDiningSitePage(firstUrl);if(!page)continue;
    found.push(...menuItemsFromPublicPage(page.html));source='Site officiel';
    if(found.length<6&&homeUrl&&firstUrl===homeUrl){
      const links=menuPageLinks(page.html,page.url||homeUrl);
      for(const link of links){const p=await fetchDiningSitePage(link,1200);if(!p)continue;found.push(...menuItemsFromPublicPage(p.html));if(found.length>=8)break}
    }
    if(found.length>=8)break;
  }
  return {items:uniqueDiningMenuItems(found,6),source:found.length?source:''};
}
async function nominatimDining(lat,lon,kind,limit){
  const fast=kind==='fastfood';
  const latDelta=0.10,lonDelta=0.10/Math.max(0.25,Math.cos(Number(lat)*Math.PI/180));
  const viewbox=[Number(lon)-lonDelta,Number(lat)+latDelta,Number(lon)+lonDelta,Number(lat)-latDelta].join(',');
  const terms=fast?['[fast food]','[fast_food]']:['[restaurant]'];
  let all=[];
  for(const term of terms){
    try{
      const u='https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&extratags=1&namedetails=1&dedupe=1&bounded=1&limit=40&viewbox='+encodeURIComponent(viewbox)+'&q='+encodeURIComponent(term);
      const r=await fetchDiningWithTimeout(u,{headers:{'user-agent':'CouteauSuisse-ReturnPlace/1.0','accept-language':'fr','accept':'application/json'}},3200);
      if(!r.ok)continue;
      const j=await r.json();if(Array.isArray(j))all=all.concat(j);
      if(all.length>=limit)break;
    }catch(_){ }
  }
  const seen=new Set(),rows=[];
  for(const x of all){
    const la=Number(x.lat),lo=Number(x.lon);if(!Number.isFinite(la)||!Number.isFinite(lo))continue;
    const d=Math.round(haversineMeters(lat,lon,la,lo));if(d>10000)continue;
    const display=String(x.name||(x.namedetails&&x.namedetails.name)||x.display_name||'').trim();
    const name=String(display.split(',')[0]||'').trim();if(!name)continue;
    const key=name.toLowerCase()+'|'+Math.round(la*10000)+'|'+Math.round(lo*10000);if(seen.has(key))continue;seen.add(key);
    const tags={...(x.extratags||{})};
    if(x.namedetails&&x.namedetails.brand&&!tags.brand)tags.brand=x.namedetails.brand;
    const osmType=String(tags.amenity||x.type||'').toLowerCase().replace(/\s+/g,'_');
    // Ne mélange jamais les deux catégories : restaurant assis d'un côté, restauration rapide de l'autre.
    if(!fast&&(osmType==='fast_food'||obviousFastFoodName(name)))continue;
    if(fast&&osmType&&osmType!=='fast_food'&&osmType!=='restaurant'&&!obviousFastFoodName(name))continue;
    const row={name,distanceMeters:d,rating:null,ratingCount:0,lat:la,lon:lo,address:diningAddressFromNominatim(x),specialty:fast?'Restauration rapide':osmCuisineLabel(tags,false),menuSpecialties:menuSpecialtiesFromTags(tags),website:diningWebsite(tags),menuUrl:String(tags['contact:menu']||tags.menu||'').trim(),phone:diningPhone(tags),wikidataId:String(tags.wikidata||tags['brand:wikidata']||'').trim(),photoName:'',photoUrl:'',photoCredit:'',source:'osm-nominatim-free',diningKind:fast?'fastfood':'restaurant',_tags:tags,_rank:(Number(x.importance)||0)*100+osmDiningNotability(tags)};
    rows.push(row);
  }
  rows.sort((a,b)=>fast?(a.distanceMeters-b.distanceMeters):((b._rank-a._rank)||a.distanceMeters-b.distanceMeters));
  return rows.slice(0,Math.max(limit,8));
}
function normalizeDiningName(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function obviousFastFoodName(v){
  const n=normalizeDiningName(v);
  return /(?:^| )(?:mcdonalds?|burger king|quick|kfc|subway|five guys|o tacos|otacos|dominos?|pizza hut|popeyes|kebab|snack|fast food|tacos)(?: |$)/i.test(n);
}
function sireneDiningName(company,e){
  const enseignes=Array.isArray(e&&e.liste_enseignes)?e.liste_enseignes.filter(Boolean):[];
  return String((enseignes&&enseignes[0])||(e&&e.nom_commercial)||(company&&company.nom_complet)||(company&&company.nom_raison_sociale)||'').trim();
}
function sireneDiningAddress(e){
  if(e&&e.adresse)return String(e.adresse).trim();
  const street=[e&&e.numero_voie,e&&e.type_voie,e&&e.libelle_voie].filter(Boolean).join(' ').trim();
  const locality=[e&&e.code_postal,e&&e.libelle_commune].filter(Boolean).join(' ').trim();
  return [street,locality].filter(Boolean).join(', ');
}
function isSireneDiningActivity(e,company,kind){
  const oldCode=String((e&&e.activite_principale)||(company&&company.activite_principale)||'').toUpperCase();
  const newCode=String((e&&e.activite_principale_naf25)||(company&&company.activite_principale_naf25)||'').toUpperCase();
  if(kind==='fastfood')return oldCode==='56.10C'||newCode==='56.11J';
  return oldCode==='56.10A'||oldCode==='56.10B'||newCode==='56.11G'||newCode==='56.11H';
}
async function sireneDining(lat,lon,kind){
  // Source officielle française, ouverte et sans clé. Elle complète OSM avec les établissements SIRENE/RNE.
  const oldCodes=kind==='fastfood'?'56.10C':'56.10A,56.10B';
  try{
    const u='https://recherche-entreprises.api.gouv.fr/near_point?lat='+encodeURIComponent(lat)+'&long='+encodeURIComponent(lon)+'&radius=10&per_page=25&page=1&limite_matching_etablissements=100&activite_principale='+encodeURIComponent(oldCodes);
    const r=await fetchDiningWithTimeout(u,{headers:{'user-agent':'CouteauSuisse-ReturnPlace/1.0','accept':'application/json'}},3500);
    if(!r.ok)return [];
    const j=await r.json(),rows=[];
    for(const company of (j&&j.results||[])){
      for(const e of (company&&company.matching_etablissements||[])){
        if(String(e&&e.etat_administratif||'A').toUpperCase()!=='A')continue;
        if(!isSireneDiningActivity(e,company,kind))continue;
        const la=Number(e&&e.latitude),lo=Number(e&&e.longitude);if(!Number.isFinite(la)||!Number.isFinite(lo))continue;
        const d=Math.round(haversineMeters(lat,lon,la,lo));if(d>10000)continue;
        const name=sireneDiningName(company,e);if(!name)continue;
        rows.push({name,distanceMeters:d,rating:null,ratingCount:0,lat:la,lon:lo,address:sireneDiningAddress(e),specialty:kind==='fastfood'?'Restauration rapide':'Restaurant',menuSpecialties:[],diningKind:kind==='fastfood'?'fastfood':'restaurant',website:'',menuUrl:'',phone:'',photoName:'',photoUrl:'',photoCredit:'',source:'sirene-gouv-free',_rank:0});
      }
    }
    const seen=new Set();
    return rows.filter(x=>{const k=normalizeDiningName(x.name)+'|'+Math.round(x.lat*10000)+'|'+Math.round(x.lon*10000);if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,30);
  }catch(_){return []}
}
function mergeDiningRows(primary,extra){
  const out=[];
  for(const row of [...(primary||[]),...(extra||[])]){
    if(!row||!Number.isFinite(Number(row.lat))||!Number.isFinite(Number(row.lon)))continue;
    const n=normalizeDiningName(row.name),la=Number(row.lat),lo=Number(row.lon);
    let dup=null;
    for(const x of out){
      const close=haversineMeters(la,lo,Number(x.lat),Number(x.lon))<=120;
      const sameName=n&&normalizeDiningName(x.name)===n;
      if(close&&sameName){dup=x;break}
    }
    if(!dup){out.push({...row});continue}
    if(!dup.address&&row.address)dup.address=row.address;
    if(!dup.specialty&&row.specialty)dup.specialty=row.specialty;
    if((!dup.menuSpecialties||!dup.menuSpecialties.length)&&row.menuSpecialties&&row.menuSpecialties.length)dup.menuSpecialties=row.menuSpecialties;
    if(!dup.website&&row.website)dup.website=row.website;
    if(!dup.menuUrl&&row.menuUrl)dup.menuUrl=row.menuUrl;
    if(!dup.phone&&row.phone)dup.phone=row.phone;
    if(!dup.wikidataId&&row.wikidataId)dup.wikidataId=row.wikidataId;
    if(!dup.photoUrl&&row.photoUrl){dup.photoUrl=row.photoUrl;dup.photoCredit=row.photoCredit||dup.photoCredit}
    const sources=new Set(String(dup.source||'').split('+').filter(Boolean).concat(String(row.source||'').split('+').filter(Boolean)));
    dup.source=[...sources].join('+');
    dup.distanceMeters=Math.min(Number(dup.distanceMeters)||Infinity,Number(row.distanceMeters)||Infinity);
  }
  return out;
}

async function overpassDining(lat,lon,kind){
  const amenity=kind==='fastfood'?'fast_food':'restaurant',fast=kind==='fastfood',limit=10;
  let rows=[];
  try{
    const q=fast
      ? `[out:json][timeout:12];(nwr(around:10000,${lat},${lon})["amenity"="fast_food"];nwr(around:10000,${lat},${lon})["brand"~"McDonald.?s|KFC|Burger King|Quick|Subway|Five Guys|O.?Tacos|Domino.?s|Pizza Hut|Popeyes",i];nwr(around:10000,${lat},${lon})["name"~"McDonald.?s|KFC|Burger King|Quick|Subway|Five Guys|O.?Tacos|Domino.?s|Pizza Hut|Popeyes",i];);out center tags 500;`
      : `[out:json][timeout:12];nwr(around:10000,${lat},${lon})["amenity"="restaurant"];out center tags 350;`;
    const j=await fetchOverpassJson(q),seen=new Set();
    if(j){
      rows=(j.elements||[]).map(e=>{
        const la=Number(e.lat??e.center?.lat),lo=Number(e.lon??e.center?.lon),tags=e.tags||{},name=String(tags.name||tags.brand||tags.operator||'').trim();
        if(!name||!Number.isFinite(la)||!Number.isFinite(lo))return null;
        const street=[tags['addr:housenumber'],tags['addr:street']].filter(Boolean).join(' ').trim();
        const locality=[tags['addr:postcode'],tags['addr:city']||tags['addr:town']||tags['addr:village']].filter(Boolean).join(' ').trim();
        const address=[street,locality].filter(Boolean).join(', ');
        return {name,distanceMeters:Math.round(haversineMeters(lat,lon,la,lo)),rating:null,ratingCount:0,lat:la,lon:lo,address,specialty:fast?'Restauration rapide':osmCuisineLabel(tags,false),menuSpecialties:menuSpecialtiesFromTags(tags),website:diningWebsite(tags),menuUrl:String(tags['contact:menu']||tags.menu||'').trim(),phone:diningPhone(tags),wikidataId:String(tags.wikidata||tags['brand:wikidata']||'').trim(),photoName:'',photoUrl:'',photoCredit:'',source:'osm-overpass-free',diningKind:fast?'fastfood':'restaurant',_tags:tags,_rank:osmDiningNotability(tags)};
      }).filter(Boolean).filter(x=>x.distanceMeters<=10000).filter(x=>{const k=x.name.toLowerCase()+'|'+Math.round(x.lat*10000)+'|'+Math.round(x.lon*10000);if(seen.has(k))return false;seen.add(k);return true});
    }
  }catch(_){rows=[]}
  // Si Overpass est chargé ou indisponible, Nominatim prend automatiquement le relais.
  if(rows.length<limit){
    const fallback=await nominatimDining(lat,lon,kind,limit);
    const keys=new Set(rows.map(x=>x.name.toLowerCase()+'|'+Math.round(x.lat*1000)+'|'+Math.round(x.lon*1000)));
    for(const x of fallback){const k=x.name.toLowerCase()+'|'+Math.round(x.lat*1000)+'|'+Math.round(x.lon*1000);if(!keys.has(k)){keys.add(k);rows.push(x)}}
  }
  rows.sort((a,b)=>a.distanceMeters-b.distanceMeters);
  rows=rows.slice(0,Math.max(limit,12));
  await Promise.all(rows.map(async x=>{const p=await freeDiningPhoto(x._tags||{});x.photoUrl=p.url;x.photoCredit=p.credit;delete x._tags;delete x._rank;}));
  return rows;
}

async function combinedDining(lat,lon,kind,countryCode){
  const limit=10;
  const osmPromise=overpassDining(lat,lon,kind);
  const officialPromise=countryCode==='fr'?sireneDining(lat,lon,kind):Promise.resolve([]);
  const [osm,official]=await Promise.all([osmPromise,officialPromise]);
  const candidates=mergeDiningRows(osm,official)
    .filter(x=>Number(x.distanceMeters)<=10000)
    .filter(x=>kind==='fastfood'?x.diningKind==='fastfood':(x.diningKind!=='fastfood'&&!obviousFastFoodName(x.name)))
    .sort((a,b)=>a.distanceMeters-b.distanceMeters);
  let selected;
  if(kind==='fastfood'){
    // Les chaînes connues demandées apparaissent en premier. À l'intérieur de ce groupe,
    // elles restent classées strictement du plus proche au plus loin.
    const knownChain=/(?:^| )(?:mcdonalds?|kfc|burger king|quick|subway|five guys|o tacos|otacos|dominos?|pizza hut|popeyes)(?: |$)/i;
    const known=candidates.filter(x=>knownChain.test(normalizeDiningName(x.name))).sort((a,b)=>a.distanceMeters-b.distanceMeters);
    const other=candidates.filter(x=>!knownChain.test(normalizeDiningName(x.name))).sort((a,b)=>a.distanceMeters-b.distanceMeters);
    selected=[...known,...other]
      .filter((x,i,a)=>a.findIndex(y=>normalizeDiningName(y.name)===normalizeDiningName(x.name)&&haversineMeters(Number(y.lat),Number(y.lon),Number(x.lat),Number(x.lon))<=120)===i)
      .slice(0,limit);
  }else{
    selected=candidates.slice(0,limit);
  }
  await Promise.all(selected.map(async row=>{
    if(!Array.isArray(row.menuSpecialties))row.menuSpecialties=[];
    if(row.menuSpecialties.length){
      row.menuSpecialties=row.menuSpecialties.slice(0,6);
      row.menuSpecialtiesSource=row.menuSpecialtiesSource||'Données publiques';
      return;
    }
    if(!row.website&&row.wikidataId){
      const wdSite=await wikidataOfficialWebsite(row.wikidataId);
      if(wdSite)row.website=wdSite;
    }
    const info=await fetchPublicMenuSpecialties(row);
    row.menuSpecialties=(info&&info.items||[]).slice(0,6);
    row.menuSpecialtiesSource=String(info&&info.source||'');
  }));
  return selected;
}

async function resolveReturnPlaceDetails(lat,lon,env){
  const exact=await nominatimExactReturnPlace(lat,lon);
  let name=preferredReturnPlaceName(exact.name,exact.fullAddress||'');
  if(!name)name=await nearestNamedOsmPlace(lat,lon);
  if(!name)name=exact.address||await contestPlaceLabel(lat,lon);
  name=preferredReturnPlaceName(name,exact.fullAddress||'');
  const fullAddress=officialReturnPlaceAddress(name,exact.fullAddress||'');
  return {name,address:name,fullAddress,countryCode:exact.countryCode||''};
}
async function resolveReturnPlaceAddress(lat,lon,env){return (await resolveReturnPlaceDetails(lat,lon,env)).name}

async function reversePlaceAddress(url,env){
  const lat=Number(url.searchParams.get('lat')),lon=Number(url.searchParams.get('lon'));if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return json({ok:false,error:'POSITION_INVALIDE'},400);
  return json({ok:true,...await resolveReturnPlaceDetails(lat,lon,env)});
}

async function reversePlaceContext(url,env){
  const lat=Number(url.searchParams.get('lat')),lon=Number(url.searchParams.get('lon'));
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return json({ok:false,error:'POSITION_INVALIDE'},400);
  const place=await resolveReturnPlaceDetails(lat,lon,env),address=place.name;
  let nearby=[];
  try{
    const q=`[out:json][timeout:9];(nwr(around:800,${lat},${lon})["name"]["amenity"~"restaurant|fuel|hospital|police|townhall|cinema|bus_station"];nwr(around:800,${lat},${lon})["name"]["shop"~"supermarket|mall|department_store|car|car_repair"];nwr(around:800,${lat},${lon})["name"]["tourism"~"attraction|hotel|museum"];nwr(around:800,${lat},${lon})["name"]["leisure"~"stadium|sports_centre"];nwr(around:800,${lat},${lon})["name"]["railway"="station"];);out center tags 110;`;
    const r=await fetchDiningWithTimeout('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(q),{headers:{'user-agent':'CouteauSuisse-ReturnPlace/1.0'}},3500);
    if(r.ok){const j=await r.json(),known=/mcdonald|burger king|leclerc|e\.leclerc|carrefour|auchan|intermarch|lidl|aldi|super u|hyper u|casino|monoprix|total|esso|shell|bp|avia|renault|peugeot|citro[eë]n|ford|toyota|volkswagen|mercedes|bmw|audi/i,seen=new Set();nearby=(j.elements||[]).map(e=>{const la=Number(e.lat??e.center?.lat),lo=Number(e.lon??e.center?.lon),tags=e.tags||{},name=String(tags.name||tags.brand||'').trim();if(!name||!Number.isFinite(la)||!Number.isFinite(lo))return null;const d=Math.round(haversineMeters(lat,lon,la,lo)),type=String(tags.amenity||tags.shop||tags.tourism||tags.leisure||tags.railway||''),major=/supermarket|mall|department_store|car|car_repair|fuel|hospital|cinema|bus_station|hotel|stadium|sports_centre|station|restaurant/.test(type);return {name,distanceMeters:d,known:known.test(name),major,type};}).filter(Boolean).filter(x=>{const k=x.name.toLowerCase();if(seen.has(k))return false;seen.add(k);return x.distanceMeters<=800&&x.major}).sort((a,b)=>(Number(b.known)-Number(a.known))||a.distanceMeters-b.distanceMeters).slice(0,1).map(({name,distanceMeters,type})=>({name,distanceMeters,type}));}
  }catch(_){ }
  const diningTimeout=new Promise(resolve=>setTimeout(()=>resolve([[],[]]),14000));
  let [restaurants,fastFood]=await Promise.race([Promise.all([combinedDining(lat,lon,'restaurant',place.countryCode),combinedDining(lat,lon,'fastfood',place.countryCode)]),diningTimeout]);
  // Séparation stricte : un même établissement ne peut jamais apparaître dans Restaurant et Fast-food.
  restaurants=restaurants.filter(r=>!obviousFastFoodName(r.name)&&!fastFood.some(f=>normalizeDiningName(f.name)===normalizeDiningName(r.name)&&haversineMeters(Number(f.lat),Number(f.lon),Number(r.lat),Number(r.lon))<=180));
  return json({ok:true,address,name:place.name,fullAddress:place.fullAddress,nearby,restaurants,fastFood,nearbyRadiusMeters:800,diningRadiusMeters:10000,ratingsProvider:'free-multi-source',ratingsAvailable:false,photoProvider:'wikimedia-free',diningProviders:place.countryCode==='fr'?['OpenStreetMap','API Recherche d’Entreprises (DINUM/Sirene-RNE)','Wikidata/Wikimedia','Sites officiels publics (carte/menu)']:['OpenStreetMap','Wikidata/Wikimedia','Sites officiels publics (carte/menu)']});
}

async function contestHomePlace(request,env){
  await ensureContestTables(env);const data=await body(request),sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:'ABONNEMENT_REQUIS'},403);const p=await env.DB.prepare("SELECT * FROM contest_participants WHERE subscription_id=? AND banned=0").bind(sub.id).first();if(!p)return json({ok:true,participant:false});
  const lat=Number(data.lat),lon=Number(data.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))return json({ok:false,error:'POSITION_INVALIDE'},400);let label=String(data.address||'').trim().slice(0,240);if(!label)label=await contestPlaceLabel(lat,lon);
  const already=Number.isFinite(Number(p.return_place_lat))&&Number.isFinite(Number(p.return_place_lon))&&String(p.return_place_label||'').trim();
  if(!already){await env.DB.prepare("UPDATE contest_participants SET return_place_lat=?,return_place_lon=?,return_place_label=?,updated_at=? WHERE subscription_id=?").bind(lat,lon,label,Date.now(),sub.id).run()}
  const installed=await registeredVerificationDevice(env,String(data.deviceId||'')),identity=!!(String(sub.account_first_name||'').trim()&&String(sub.account_last_name||'').trim()&&String(sub.recovery_email_hash||'').trim());
  if(installed&&identity){await contestEnqueueBonus(env,sub.id,2,"application ajoutée à l’écran d’accueil + identité renseignée + emplacement « Retourner sur la place » enregistré","onboarding-home-place",CONTEST_BONUS_MS)}
  return json({ok:true,participant:true,address:already?String(p.return_place_label):label,bonusEligible:installed&&identity});
}

async function contestCampingPlace(request,env){
  const cfg=await ensureContestTables(env);if(Date.now()>=Number(cfg.end_at))return json({ok:false,error:"CONCOURS_TERMINE"},409);
  const data=await body(request),sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);
  const p=await env.DB.prepare("SELECT * FROM contest_participants WHERE subscription_id=? AND banned=0").bind(sub.id).first();if(!p)return json({ok:false,error:"INSCRIPTION_CONCOURS_REQUISE"},403);
  const lat=Number(data.lat),lon=Number(data.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return json({ok:false,error:"POSITION_INVALIDE"},400);
  const label=await contestPlaceLabel(lat,lon),now=Date.now();
  await env.DB.prepare("UPDATE contest_participants SET camping_active=1,camping_lat=?,camping_lon=?,camping_label=?,camping_updated_at=?,updated_at=? WHERE subscription_id=?").bind(lat,lon,label,now,now,sub.id).run();
  const msg=`📍 EMPLACEMENT DE CAMPING ENREGISTRÉ
Votre nouveau point de départ est : ${label}.

⚠️ IMPORTANT
N'oubliez pas d'appuyer sur « Nouveau lieu de camping » chaque fois que vous changez d'emplacement. Un ancien emplacement ou de mauvaises coordonnées peuvent déclencher des alertes et vous faire exclure du classement.`;
  await contestPushMessage(env,sub.id,msg,"camping");
  return json({ok:true,label,updatedAt:now});
}
async function contestCampingStop(request,env){
  await ensureContestTables(env);const data=await body(request),sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);
  const p=await env.DB.prepare("SELECT * FROM contest_participants WHERE subscription_id=? AND banned=0").bind(sub.id).first();if(!p)return json({ok:false,error:"INSCRIPTION_CONCOURS_REQUISE"},403);
  await env.DB.prepare("UPDATE contest_participants SET camping_active=0,updated_at=? WHERE subscription_id=?").bind(Date.now(),sub.id).run();
  await contestPushMessage(env,sub.id,"🏠 Mode camping terminé. Votre lieu de départ habituel est de nouveau utilisé pour les déplacements du concours.","camping-ended");
  return json({ok:true});
}

async function contestPushMessage(env,subscriptionId,message,kind="info"){await env.DB.prepare("INSERT INTO contest_messages(id,subscription_id,kind,message,created_at) VALUES(?,?,?,?,?)").bind(contestId(),subscriptionId,kind,String(message).slice(0,800),Date.now()).run()}
async function sendContestMail(env,email,subject,text){if(!validEmail(email)||!env.BREVO_API_KEY||!env.BREVO_SENDER_EMAIL)return false;try{const r=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{accept:"application/json","content-type":"application/json","api-key":env.BREVO_API_KEY},body:JSON.stringify({sender:{name:"Couteau Suisse",email:String(env.BREVO_SENDER_EMAIL)},to:[{email}],subject,textContent:text,htmlContent:`<div style="font-family:Arial,sans-serif"><h2>🏆 Jeu concours Couteau Suisse</h2><p>${String(text).replace(/\n/g,"<br>")}</p></div>`})});return r.ok}catch(_){return false}}

async function contestRefreshBonusState(env,subscriptionId){
  const now=Date.now();let active=await env.DB.prepare("SELECT * FROM contest_bonus_periods WHERE subscription_id=? AND status='active' ORDER BY start_at LIMIT 1").bind(subscriptionId).first();
  if(active&&Number(active.end_at||0)<=now){await env.DB.prepare("UPDATE contest_bonus_periods SET status='finished',finished_at=? WHERE id=? AND status='active'").bind(now,active.id).run();await contestPushMessage(env,subscriptionId,`⏱️ BONUS ×${active.multiplier} TERMINÉ — vos nouveaux points reviennent à la valeur normale.`,`bonus-ended`);active=null}
  if(!active){const next=await env.DB.prepare("SELECT * FROM contest_bonus_periods WHERE subscription_id=? AND status='queued' ORDER BY created_at LIMIT 1").bind(subscriptionId).first();if(next){const duration=Math.max(3600000,Number(next.duration_ms||CONTEST_BONUS_MS)),end=now+duration;await env.DB.prepare("UPDATE contest_bonus_periods SET status='active',start_at=?,end_at=? WHERE id=? AND status='queued'").bind(now,end,next.id).run();active={...next,status:'active',start_at:now,end_at:end};await contestPushMessage(env,subscriptionId,`🎁 BONUS ×${next.multiplier} ACTIVÉ — pendant ${contestDurationText(duration)}, seuls vos nouveaux points gagnés sont multipliés par ${next.multiplier}.`,`bonus-started`)}}
  const queued=(await env.DB.prepare("SELECT multiplier,reason,duration_ms,created_at FROM contest_bonus_periods WHERE subscription_id=? AND status='queued' ORDER BY created_at").bind(subscriptionId).all()).results||[];
  return {active,queued};
}
async function contestEnqueueBonus(env,subscriptionId,multiplier,reason,sourceKey,durationMs=CONTEST_BONUS_MS,extendSame=false,notificationMessage=''){
  durationMs=Math.max(3600000,Number(durationMs||CONTEST_BONUS_MS));
  if(extendSame){const active=await env.DB.prepare("SELECT * FROM contest_bonus_periods WHERE subscription_id=? AND status='active' ORDER BY start_at LIMIT 1").bind(subscriptionId).first();if(active&&Number(active.multiplier)===Number(multiplier)){const end=Math.max(Number(active.end_at||0),Date.now()+durationMs);await env.DB.prepare("UPDATE contest_bonus_periods SET end_at=? WHERE id=?").bind(end,active.id).run();await contestPushMessage(env,subscriptionId,`🔥 BONUS ×${multiplier} PROLONGÉ — il reste au moins ${contestDurationText(durationMs)} à partir de maintenant.`,`bonus-extended`);return contestRefreshBonusState(env,subscriptionId)}}
  const r=await env.DB.prepare("INSERT OR IGNORE INTO contest_bonus_periods(id,subscription_id,multiplier,reason,source_key,duration_ms,status,created_at) VALUES(?,?,?,?,?,?,'queued',?)").bind(contestId(),subscriptionId,multiplier,String(reason).slice(0,160),sourceKey,durationMs,Date.now()).run();
  if(r.meta&&Number(r.meta.changes)>0){await contestPushMessage(env,subscriptionId,notificationMessage||`🎁 Vous avez gagné un BONUS ×${multiplier} pendant ${contestDurationText(durationMs)} : ${reason}.`,`bonus-won`)}
  return contestRefreshBonusState(env,subscriptionId);
}
async function contestApplyMarketMilestones(env,subscriptionId){
  const row=await env.DB.prepare("SELECT COUNT(*) AS n FROM contest_market_points WHERE subscription_id=?").bind(subscriptionId).first(),n=Number(row&&row.n||0);
  if(n>=5)await contestEnqueueBonus(env,subscriptionId,2,"5 fiches validées","market-milestone-5");
  if(n>=15)await contestEnqueueBonus(env,subscriptionId,3,"10 nouvelles fiches validées après le premier bonus","market-milestone-15");
  if(n>=40)await contestEnqueueBonus(env,subscriptionId,5,"25 nouvelles fiches validées après le bonus ×3","market-milestone-40");
  return n;
}
function contestBonusProgress(n){n=Number(n||0);if(n<5)return {done:false,label:"Bonus ×2",current:n,target:5,remaining:5-n};if(n<15)return {done:false,label:"Bonus ×3",current:n-5,target:10,remaining:15-n};if(n<40)return {done:false,label:"Bonus ×5",current:n-15,target:25,remaining:40-n};return {done:true,label:"Tous les bonus fiches ont été gagnés",current:25,target:25,remaining:0}}

async function contestAddScoreEvent(env,subscriptionId,sourceType,sourceId,description,basePoints,multiplier,awardedPoints){
  const r=await env.DB.prepare("INSERT OR IGNORE INTO contest_score_events(id,subscription_id,source_type,source_id,description,base_points,multiplier,awarded_points,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(contestId(),subscriptionId,sourceType,sourceId,String(description||"").slice(0,200),Number(basePoints||0),Number(multiplier||1),Number(awardedPoints||0),Date.now()).run();
  if(r.meta&&Number(r.meta.changes)>0){await env.DB.prepare("UPDATE contest_participants SET points=points+?,updated_at=? WHERE subscription_id=?").bind(Number(awardedPoints||0),Date.now(),subscriptionId).run();return true}return false;
}

const REFERRAL_SPONSOR_POINTS=320,REFERRAL_FRIEND_POINTS=96,REFERRAL_INVITE_MS=30*86400000,REFERRAL_EMAIL_MS=24*60*60000;
function referralToken(){const b=new Uint8Array(24);crypto.getRandomValues(b);let x="";for(const n of b)x+=String.fromCharCode(n);return btoa(x).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
async function referralMagicHash(id,token,env){return sha256Text("referral-magic:"+id+":"+token+":"+(env.CODE_PEPPER||"carplay-referral"))}
async function brevoSendHtml(env,to,subject,text,html){
  if(!validEmail(to)||!env.BREVO_API_KEY||!env.BREVO_SENDER_EMAIL)return false;
  try{
    const r=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{accept:"application/json","content-type":"application/json","api-key":String(env.BREVO_API_KEY)},body:JSON.stringify({sender:{name:"Couteau Suisse",email:String(env.BREVO_SENDER_EMAIL)},to:[{email:to}],subject,textContent:text,htmlContent:html})});
    return r.ok;
  }catch(_){return false}
}
async function sendReferralEmail(env,email,confirmUrl,firstName){
  const safeFirst=String(firstName||"").replace(/[<>&"']/g,"");
  const subject="🎁 Bravo ! Vos 96 points Couteau Suisse vous attendent";
  const text=`Bravo${safeFirst?" "+safeFirst:""} ! Vous venez d’installer Couteau Suisse grâce à un parrainage. Vous bénéficiez de 96 points. Appuyez sur ce lien pour en profiter : ${confirmUrl}`;
  const html=`<div style="margin:0;background:#07182d;padding:24px;font-family:Arial,sans-serif;color:#fff"><div style="max-width:620px;margin:auto;background:linear-gradient(180deg,#0d2f5a,#06172d);border:3px solid #f7c94b;border-radius:24px;padding:28px;text-align:center;box-shadow:0 12px 36px rgba(0,0,0,.35)"><div style="font-size:48px">🎁</div><h1 style="margin:8px 0;color:#ffd85a;font-size:31px">BRAVO${safeFirst?" "+safeFirst.toUpperCase():""} !</h1><p style="font-size:19px;line-height:1.5;margin:12px 0">Vous venez d’installer <b>Couteau Suisse</b> grâce à un parrainage.</p><div style="margin:22px auto;padding:18px;border-radius:18px;background:#0b7a42;font-size:22px;font-weight:900">VOUS GAGNEZ +96 POINTS</div><p style="font-size:17px;line-height:1.5">Appuyez sur le bouton pour valider votre adresse e-mail et profiter de vos points.</p><a href="${confirmUrl}" style="display:inline-block;margin:14px 0 4px;padding:17px 28px;background:#ffd43b;color:#07182d;text-decoration:none;border-radius:14px;font-size:19px;font-weight:900">ACTIVER MES 96 POINTS</a><p style="font-size:13px;color:#b8c7d9;margin-top:18px">Lien personnel valable 24 heures et utilisable une seule fois.</p></div></div>`;
  return brevoSendHtml(env,email,subject,text,html);
}
async function sendReferralSponsorEmail(env,email,friendName,rewarded){
  const safeFriend=String(friendName||"votre ami").replace(/[<>&"']/g,"");
  const subject="🎉 Bravo ! Votre ami a installé Couteau Suisse";
  const pointsText=rewarded?"Vos 320 points ont été ajoutés au concours.":"Vos 320 points sont réservés et seront ajoutés dès votre inscription au concours.";
  const text=`Bravo ! ${safeFriend} a installé Couteau Suisse et a validé son parrainage. ${pointsText}`;
  const html=`<div style="margin:0;background:#07182d;padding:24px;font-family:Arial,sans-serif;color:#fff"><div style="max-width:620px;margin:auto;background:linear-gradient(180deg,#0d2f5a,#06172d);border:3px solid #f7c94b;border-radius:24px;padding:28px;text-align:center"><div style="font-size:48px">🏆</div><h1 style="color:#ffd85a;margin:8px 0">BRAVO !</h1><p style="font-size:19px;line-height:1.5"><b>${safeFriend}</b> a installé Couteau Suisse et a validé votre parrainage.</p><div style="margin:22px auto;padding:18px;border-radius:18px;background:#0b7a42;font-size:22px;font-weight:900">+320 POINTS POUR VOUS</div><p style="font-size:16px;line-height:1.5">${pointsText}</p><p style="font-size:14px;color:#b8c7d9">Continuez à partager l’application depuis Réglages → Partager à un ami.</p></div></div>`;
  return brevoSendHtml(env,email,subject,text,html);
}
async function referralCreate(request,env){
  await ensureContestTables(env);const d=await body(request),sub=await contestSubscription(env,d);if(!sub)return json({ok:false,error:"COMPTE_REQUIS_POUR_PARRAINER"},403);
  const p=await env.DB.prepare("SELECT banned FROM contest_participants WHERE subscription_id=? LIMIT 1").bind(sub.id).first();if(p&&Number(p.banned))return json({ok:false,error:"PARRAINAGE_SUSPENDU"},403);
  const token=referralToken(),hash=await sha256Text("referral:"+token),id=contestId(),now=Date.now(),expires=now+REFERRAL_INVITE_MS;
  await env.DB.prepare("INSERT INTO contest_referral_invites(id,sponsor_subscription_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)").bind(id,sub.id,hash,now,expires).run();
  return json({ok:true,url:new URL(request.url).origin+"/installer.html?ref="+encodeURIComponent(token),expiresAt:expires});
}
async function ensureReferralTrialSubscription(env,deviceId,email,first,last){
  const cfg=await ensureContestTables(env),now=Date.now(),freeUntil=Number(cfg.end_at)+CONTEST_APP_FREE_EXTRA_MS,emailHash=await sha256Text(email),trialHash=await sha256Text("contest-trial:"+deviceId),trialEmailHash=await sha256Text("contest-trial-email:"+deviceId+":"+email);
  let row=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC LIMIT 1").bind(deviceId,deviceId).first();
  if(row){const paid=!!row.lifetime||(row.code_hash!==trialHash&&row.expires_at&&Date.parse(row.expires_at)>now),expiry=paid?row.expires_at:new Date(freeUntil).toISOString(),stored=paid?emailHash:trialEmailHash;await env.DB.prepare("UPDATE subscriptions SET expires_at=?,active=1,phone_device=?,recovery_email_hash=?,recovery_email_mask=?,account_first_name=?,account_last_name=?,account_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(expiry,deviceId,stored,email,first,last,now,row.id).run();return await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(row.id).first()}
  await env.DB.prepare("INSERT INTO subscriptions(code_hash,expires_at,lifetime,active,phone_device,recovery_email_hash,recovery_email_mask,account_first_name,account_last_name,account_updated_at) VALUES(?,?,0,1,?,?,?,?,?,?)").bind(trialHash,new Date(freeUntil).toISOString(),deviceId,trialEmailHash,email,first,last,now).run();
  return await env.DB.prepare("SELECT * FROM subscriptions WHERE phone_device=? ORDER BY id DESC LIMIT 1").bind(deviceId).first();
}
async function referralStart(request,env){
  const cfg=await ensureContestTables(env),now=Date.now();if(now>=Number(cfg.end_at))return json({ok:false,error:"CONCOURS_TERMINE"},409);
  const d=await body(request),deviceId=String(d.deviceId||"").trim(),token=String(d.referralToken||"").trim(),email=normalizeEmail(d.email),first=contestCleanName(d.firstName),last=contestCleanName(d.lastName);
  if(!validDevice(deviceId)||!token)return json({ok:false,error:"PARRAINAGE_INVALIDE"},400);if(first.length<2||last.length<2)return json({ok:false,error:"NOM_PRENOM_OBLIGATOIRES"},400);if(!validEmail(email))return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);
  if(!(await registeredVerificationDevice(env,deviceId)))return json({ok:false,error:"AJOUT_ECRAN_ACCUEIL_REQUIS"},403);
  const th=await sha256Text("referral:"+token),invite=await env.DB.prepare("SELECT * FROM contest_referral_invites WHERE token_hash=? LIMIT 1").bind(th).first();if(!invite||Number(invite.expires_at)<now)return json({ok:false,error:"LIEN_PARRAINAGE_EXPIRE"},410);
  const sponsor=await env.DB.prepare("SELECT * FROM subscriptions WHERE id=? AND active=1 LIMIT 1").bind(invite.sponsor_subscription_id).first();if(!sponsor)return json({ok:false,error:"PARRAIN_INTROUVABLE"},404);if(String(sponsor.phone_device||"")===deviceId||String(sponsor.autoradio_device||"")===deviceId)return json({ok:false,error:"AUTO_PARRAINAGE_INTERDIT"},409);if(normalizeEmail(sponsor.recovery_email_mask)===email)return json({ok:false,error:"AUTO_PARRAINAGE_INTERDIT"},409);
  const eh=await sha256Text(email),byEmail=await env.DB.prepare("SELECT referee_device_id FROM contest_referrals WHERE email_hash=? LIMIT 1").bind(eh).first(),byDevice=await env.DB.prepare("SELECT * FROM contest_referrals WHERE referee_device_id=? LIMIT 1").bind(deviceId).first();
  if(byEmail&&String(byEmail.referee_device_id)!==deviceId)return json({ok:false,error:"EMAIL_DEJA_PARRAINE"},409);if(byDevice&&String(byDevice.invite_id)!==String(invite.id))return json({ok:false,error:"APPAREIL_DEJA_PARRAINE"},409);
  const es=await env.DB.prepare("SELECT id,phone_device,autoradio_device FROM subscriptions WHERE lower(COALESCE(recovery_email_mask,''))=? AND active=1 ORDER BY id DESC LIMIT 1").bind(email).first();if(es&&String(es.phone_device||"")!==deviceId&&String(es.autoradio_device||"")!==deviceId)return json({ok:false,error:"EMAIL_DEJA_UTILISEE_AUTRE_TELEPHONE"},409);
  const sub=await ensureReferralTrialSubscription(env,deviceId,email,first,last);if(!sub)return json({ok:false,error:"COMPTE_IMPOSSIBLE"},500);if(Number(sub.id)===Number(invite.sponsor_subscription_id))return json({ok:false,error:"AUTO_PARRAINAGE_INTERDIT"},409);if(invite.claimed_subscription_id&&Number(invite.claimed_subscription_id)!==Number(sub.id))return json({ok:false,error:"LIEN_PARRAINAGE_DEJA_UTILISE"},409);
  let row=byDevice&&String(byDevice.invite_id)===String(invite.id)?byDevice:null;if(row&&row.status==="verified")return json({ok:true,alreadyVerified:true,referralId:row.id,emailMask:emailMask(email)});if(row&&Number(row.sms_sent_at||0)>now-60000)return json({ok:false,error:"EMAIL_TROP_RAPIDE",referralId:row.id,emailMask:emailMask(email)},429);
  const day=parisDay(),usage=await env.DB.prepare("SELECT sent_count FROM brevo_daily_usage WHERE day=?").bind(day).first();if(Number(usage&&usage.sent_count||0)>=200)return json({ok:false,error:"QUOTA_EMAIL_JOURNALIER"},429);
  const id=row?row.id:contestId(),magic=referralToken(),ch=await referralMagicHash(id,magic,env),ih=await sha256Text(`refip:${env.CODE_PEPPER||"ref"}:${request.headers.get("CF-Connecting-IP")||""}`),placeholderPhoneHash=row&&row.phone_hash?String(row.phone_hash):await sha256Text("referral-no-phone:"+deviceId),mask=emailMask(email),expires=now+REFERRAL_EMAIL_MS;
  if(row)await env.DB.prepare("UPDATE contest_referrals SET referee_subscription_id=?,email_hash=?,phone_hash=?,ip_hash=?,phone_mask=?,status='email_link_pending',sms_code_hash=?,sms_expires_at=?,sms_attempts=0,sms_sent_at=?,updated_at=? WHERE id=?").bind(sub.id,eh,placeholderPhoneHash,ih,mask,ch,expires,now,now,id).run();else await env.DB.prepare("INSERT INTO contest_referrals(id,invite_id,sponsor_subscription_id,referee_subscription_id,referee_device_id,email_hash,phone_hash,ip_hash,phone_mask,status,sms_code_hash,sms_expires_at,sms_attempts,sms_sent_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'email_link_pending',?,?,0,?,?,?)").bind(id,invite.id,invite.sponsor_subscription_id,sub.id,deviceId,eh,placeholderPhoneHash,ih,mask,ch,expires,now,now,now).run();
  await env.DB.prepare("UPDATE contest_referral_invites SET claimed_subscription_id=?,claimed_at=? WHERE id=? AND claimed_subscription_id IS NULL").bind(sub.id,now,invite.id).run();
  const confirmUrl=new URL(request.url).origin+"/api/referral/confirm?id="+encodeURIComponent(id)+"&token="+encodeURIComponent(magic);
  if(!(await sendReferralEmail(env,email,confirmUrl,first)))return json({ok:false,error:"EMAIL_ENVOI_INDISPONIBLE",referralId:id,emailMask:mask},503);
  await env.DB.prepare("INSERT INTO brevo_daily_usage(day,sent_count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET sent_count=sent_count+1").bind(day).run();
  return json({ok:true,referralId:id,emailMask:mask,emailExpiresAt:expires,email,firstName:first,lastName:last,magicLinkSent:true,expiresAt:new Date(Number(cfg.end_at)+CONTEST_APP_FREE_EXTRA_MS).toISOString()});
}
async function applyReferralRewards(env,row){
  let sponsorRewarded=Number(row.sponsor_rewarded||0)===1,refereeRewarded=Number(row.referee_rewarded||0)===1;
  if(!sponsorRewarded&&await env.DB.prepare("SELECT subscription_id FROM contest_participants WHERE subscription_id=? AND banned=0 LIMIT 1").bind(row.sponsor_subscription_id).first()){await contestAddScoreEvent(env,row.sponsor_subscription_id,"referral-sponsor",row.id,"Parrainage validé",REFERRAL_SPONSOR_POINTS,1,REFERRAL_SPONSOR_POINTS);await env.DB.prepare("UPDATE contest_referrals SET sponsor_rewarded=1,updated_at=? WHERE id=?").bind(Date.now(),row.id).run();sponsorRewarded=true;await contestPushMessage(env,row.sponsor_subscription_id,"🎁 Parrainage validé : +320 points.","referral")}
  if(!refereeRewarded&&await env.DB.prepare("SELECT subscription_id FROM contest_participants WHERE subscription_id=? AND banned=0 LIMIT 1").bind(row.referee_subscription_id).first()){await contestAddScoreEvent(env,row.referee_subscription_id,"referral-friend",row.id,"Bienvenue par parrainage",REFERRAL_FRIEND_POINTS,1,REFERRAL_FRIEND_POINTS);await env.DB.prepare("UPDATE contest_referrals SET referee_rewarded=1,updated_at=? WHERE id=?").bind(Date.now(),row.id).run();refereeRewarded=true;await contestPushMessage(env,row.referee_subscription_id,"🎁 Bienvenue ! Parrainage validé : +96 points.","referral")}
  return {sponsorRewarded,refereeRewarded};
}
async function applyPendingReferralRewards(env,subscriptionId){const rows=(await env.DB.prepare("SELECT * FROM contest_referrals WHERE status='verified' AND ((sponsor_subscription_id=? AND sponsor_rewarded=0) OR (referee_subscription_id=? AND referee_rewarded=0)) LIMIT 20").bind(subscriptionId,subscriptionId).all()).results||[];for(const r of rows)await applyReferralRewards(env,r)}
async function referralConfirm(request,env){
  await ensureContestTables(env);
  const url=new URL(request.url),id=String(url.searchParams.get("id")||"").trim(),token=String(url.searchParams.get("token")||"").trim(),origin=url.origin;
  const go=(state,extra="")=>Response.redirect(origin+"/index.html?referral_confirmed="+encodeURIComponent(state)+(extra?"&"+extra:""),302);
  if(!id||!token)return go("invalid");
  const row=await env.DB.prepare("SELECT * FROM contest_referrals WHERE id=? LIMIT 1").bind(id).first();
  if(!row)return go("invalid");
  if(row.status==="verified"){const rewards=await applyReferralRewards(env,row);return go("ok","friendPoints=96&sponsorPoints=320&friendRewarded="+(rewards.refereeRewarded?"1":"0")+"&sponsorRewarded="+(rewards.sponsorRewarded?"1":"0"));}
  if(row.status!=="email_link_pending")return go("invalid");
  if(Number(row.sms_expires_at||0)<Date.now())return go("expired");
  const expected=String(row.sms_code_hash||""),actual=await referralMagicHash(id,token,env);if(!expected||actual!==expected)return go("invalid");
  const now=Date.now();
  await env.DB.prepare("UPDATE contest_referrals SET status='verified',verified_at=?,sms_code_hash='',updated_at=? WHERE id=? AND status='email_link_pending'").bind(now,now,id).run();
  const fresh=await env.DB.prepare("SELECT * FROM contest_referrals WHERE id=? LIMIT 1").bind(id).first(),rewards=await applyReferralRewards(env,fresh);
  try{
    const sponsor=await env.DB.prepare("SELECT recovery_email_mask,account_first_name FROM subscriptions WHERE id=? LIMIT 1").bind(fresh.sponsor_subscription_id).first();
    const friend=await env.DB.prepare("SELECT account_first_name,account_last_name FROM subscriptions WHERE id=? LIMIT 1").bind(fresh.referee_subscription_id).first();
    const sponsorEmail=normalizeEmail(sponsor&&sponsor.recovery_email_mask||"");
    const friendName=[String(friend&&friend.account_first_name||"").trim(),String(friend&&friend.account_last_name||"").trim()].filter(Boolean).join(" ")||"Votre ami";
    if(validEmail(sponsorEmail)){const sent=await sendReferralSponsorEmail(env,sponsorEmail,friendName,rewards.sponsorRewarded);if(sent){const day=parisDay();await env.DB.prepare("INSERT INTO brevo_daily_usage(day,sent_count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET sent_count=sent_count+1").bind(day).run();}}
  }catch(_){}
  return go("ok","friendPoints=96&sponsorPoints=320&friendRewarded="+(rewards.refereeRewarded?"1":"0")+"&sponsorRewarded="+(rewards.sponsorRewarded?"1":"0"));
}
async function referralVerify(request,env){
  await ensureContestTables(env);const d=await body(request),deviceId=String(d.deviceId||"").trim(),id=String(d.referralId||"").trim(),code=String(d.code||"").replace(/\D/g,"").slice(0,6);if(!validDevice(deviceId)||!id||code.length!==6)return json({ok:false,error:"CODE_EMAIL_INVALIDE"},400);
  const row=await env.DB.prepare("SELECT * FROM contest_referrals WHERE id=? AND referee_device_id=? LIMIT 1").bind(id,deviceId).first();if(!row)return json({ok:false,error:"PARRAINAGE_INTROUVABLE"},404);if(row.status==="verified"){const r=await applyReferralRewards(env,row);return json({ok:true,alreadyVerified:true,...r,sponsorPoints:320,friendPoints:96})}if(Number(row.sms_expires_at||0)<Date.now())return json({ok:false,error:"CODE_EMAIL_EXPIRE"},410);if(Number(row.sms_attempts||0)>=5)return json({ok:false,error:"CODE_EMAIL_TROP_ESSAIS"},429);
  const h=await emailCodeHash("referral:"+id,code,env);if(h!==String(row.sms_code_hash||"")){await env.DB.prepare("UPDATE contest_referrals SET sms_attempts=sms_attempts+1,updated_at=? WHERE id=?").bind(Date.now(),id).run();return json({ok:false,error:"CODE_EMAIL_INCORRECT"},400)}
  await env.DB.prepare("UPDATE contest_referrals SET status='verified',verified_at=?,sms_code_hash='',updated_at=? WHERE id=?").bind(Date.now(),Date.now(),id).run();const fresh=await env.DB.prepare("SELECT * FROM contest_referrals WHERE id=?").bind(id).first(),r=await applyReferralRewards(env,fresh);return json({ok:true,...r,sponsorPoints:320,friendPoints:96});
}
async function contestScoreSummary(env,subscriptionId){
  const events=(await env.DB.prepare("SELECT source_type,base_points,multiplier,awarded_points FROM contest_score_events WHERE subscription_id=?").bind(subscriptionId).all()).results||[];
  let bugPoints=0,bugEvents=0,referralPoints=0,referralCount=0;for(const e of events){if(e.source_type==='bug'){bugEvents++;bugPoints+=Number(e.awarded_points||0)}if(String(e.source_type||'').startsWith('referral-')){referralCount++;referralPoints+=Number(e.awarded_points||0)}}
  const markets=(await env.DB.prepare("SELECT points,base_points,breakdown_json FROM contest_market_points WHERE subscription_id=?").bind(subscriptionId).all()).results||[];
  let marketAwarded=0,marketBase=0,distanceBase=0;for(const r of markets){marketAwarded+=Number(r.points||0);marketBase+=Number(r.base_points||r.points||0);try{const a=JSON.parse(r.breakdown_json||'[]');for(const it of a)if(it&&it.key==='distance')distanceBase+=Number(it.points||0)}catch(_){}}
  const idea=await env.DB.prepare("SELECT COUNT(*) AS n FROM contest_reports WHERE subscription_id=? AND kind='idee' AND status='approved'").bind(subscriptionId).first();
  const p=await env.DB.prepare("SELECT points FROM contest_participants WHERE subscription_id=?").bind(subscriptionId).first();const total=Number(p&&p.points||0),known=marketAwarded+bugPoints+referralPoints;
  return {total,marketCount:markets.length,marketBasePoints:marketBase,marketInfoPoints:Math.max(0,marketBase-distanceBase),distancePoints:distanceBase,marketAwardedPoints:marketAwarded,bonusExtraPoints:Math.max(0,marketAwarded-marketBase),bugCount:bugEvents,bugPoints,referralCount,referralPoints,ideaCount:Number(idea&&idea.n||0),otherPoints:Math.max(0,total-known)};
}

async function contestMarketBreakdown(env,deviceId,marketKey,distanceKm){
  const rows=(await env.DB.prepare("SELECT field,value_norm FROM market_verification_votes WHERE market_key=? AND device_id=?").bind(marketKey,deviceId).all()).results||[],fields={};for(const r of rows)fields[r.field]=String(r.value_norm||"");
  const upload=await env.DB.prepare("SELECT uploaded_at FROM market_photo_uploads WHERE market_key=? AND device_id=?").bind(marketKey,deviceId).first();
  const meta=await env.DB.prepare("SELECT device_id FROM market_photo_metadata WHERE market_key=?").bind(marketKey).first();
  const gpsVote=await env.DB.prepare("SELECT address FROM market_location_votes WHERE market_key=? AND device_id=?").bind(marketKey,deviceId).first();
  const gpsConsensus=await env.DB.prepare("SELECT address FROM market_location_consensus WHERE market_key=?").bind(marketKey).first();
  const ownPhoto=!!upload||!!(meta&&String(meta.device_id)===String(deviceId)),ownGps=!!gpsVote||!!(meta&&String(meta.device_id)===String(deviceId)),hasAddress=ownGps&&!!String((gpsVote&&gpsVote.address)||(gpsConsensus&&gpsConsensus.address)||"").trim();
  const items=[];let total=0;const add=(key,label,points,ok)=>{if(ok){items.push({key,label,points});total+=points;return true}return false};
  const a=add('exists','Marché confirmé',7,fields.exists==='oui'),b=add('time','Horaire renseigné',4,!!fields.time),c=add('count','Nombre de commerçants',4,!!fields.count),d=add('draw','Tirage au sort',3,!!fields.draw),e=add('clientModel','Modèle de clients',3,!!fields.clientModel),f=add('welcome','Humeur du placier',3,!!fields.welcome),g=add('placer','Responsable Femme/Homme/Municipal',3,!!fields.placer),h=add('photo','Photo valide prise sur place',10,ownPhoto),i=add('gps','GPS valide sur place',10,ownGps),j=add('address','Lieu/adresse exacte confirmée',5,hasAddress);
  const fuel=contestDistanceFuel(distanceKm);add('distance',`Trajet aller ${contestNumberText(fuel.usedKm)} km — gasoil 2,23 €/L`,fuel.points,ownPhoto&&ownGps);
  const complete=a&&b&&c&&d&&e&&f&&g&&h&&i&&j;add('complete','Fiche entièrement complétée',10,complete);
  return {basePoints:total,items,complete,distanceKm:fuel.usedKm,distancePoints:fuel.points};
}

async function finalizeContestIfNeeded(env){
  const cfg=await ensureContestTables(env);if(Date.now()<Number(cfg.end_at)||cfg.finalized_at)return cfg;
  const top=await env.DB.prepare("SELECT * FROM contest_participants WHERE banned=0 ORDER BY points DESC, joined_at ASC LIMIT 5").all();let rank=0;
  for(const p of top.results||[]){rank++;const reward=rank<=2?"Abonnement à vie":"1 an d’abonnement gratuit";await env.DB.prepare("INSERT OR REPLACE INTO contest_results(rank,subscription_id,first_name,last_name,points,reward) VALUES(?,?,?,?,?,?)").bind(rank,p.subscription_id,p.first_name,p.last_name,p.points,reward).run();const sub=await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(p.subscription_id).first();if(sub){if(rank<=2)await env.DB.prepare("UPDATE subscriptions SET lifetime=1,expires_at=NULL,active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(sub.id).run();else if(!sub.lifetime){const base=Math.max(Date.now(),sub.expires_at?Date.parse(sub.expires_at):0),d=new Date(base);d.setFullYear(d.getFullYear()+1);await env.DB.prepare("UPDATE subscriptions SET expires_at=?,active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(d.toISOString(),sub.id).run()}const email=String(sub.recovery_email_mask||"");if(validEmail(email)&&!email.includes("***"))await sendContestMail(env,email,"Félicitations — vous êtes gagnant du concours Couteau Suisse",`Félicitations ${p.first_name} ${p.last_name} !\nVous terminez n°${rank} du concours avec ${p.points} points.\nVotre gain : ${reward}.`)}}
  const finalizedAt=Date.now();await env.DB.prepare("UPDATE contest_config SET finalized_at=?,results_until=? WHERE id=1").bind(finalizedAt,finalizedAt+CONTEST_RESULTS_MS).run();return await env.DB.prepare("SELECT * FROM contest_config WHERE id=1").first();
}

async function contestStatus(request,env){
  const data=await body(request),cfg=await finalizeContestIfNeeded(env),sub=await contestSubscription(env,data),now=Date.now(),ended=now>=Number(cfg.end_at),resultsUntil=Number(cfg.results_until||((cfg.finalized_at||0)+CONTEST_RESULTS_MS)),resultsVisible=!!cfg.finalized_at&&ended&&now<resultsUntil,closed=ended&&!resultsVisible;let profile=null,participant=null,messages=[],questions=[],scoreSummary=null,bonusState=null,bonusProgress=null;
  let onboarding=null;
  if(sub){profile={firstName:String(sub.account_first_name||""),lastName:String(sub.account_last_name||""),email:String(sub.recovery_email_mask||"")};participant=await env.DB.prepare("SELECT subscription_id,first_name,last_name,home_country,home_area,home_commune,return_place_lat,return_place_lon,return_place_label,camping_active,camping_lat,camping_lon,camping_label,camping_updated_at,points,banned,alert_count,change_allowed,joined_at FROM contest_participants WHERE subscription_id=?").bind(sub.id).first();const installed=await registeredVerificationDevice(env,String(data.deviceId||""));if(participant){await applyPendingReferralRewards(env,sub.id);participant=await env.DB.prepare("SELECT subscription_id,first_name,last_name,home_country,home_area,home_commune,return_place_lat,return_place_lon,return_place_label,camping_active,camping_lat,camping_lon,camping_label,camping_updated_at,points,banned,alert_count,change_allowed,joined_at FROM contest_participants WHERE subscription_id=?").bind(sub.id).first();bonusState=await contestRefreshBonusState(env,sub.id);scoreSummary=await contestScoreSummary(env,sub.id);bonusProgress=contestBonusProgress(scoreSummary.marketCount);const ob=await env.DB.prepare("SELECT status,start_at,end_at FROM contest_bonus_periods WHERE subscription_id=? AND source_key='onboarding-home-place' LIMIT 1").bind(sub.id).first();onboarding={installed,identity:!!(String(sub.account_first_name||'').trim()&&String(sub.account_last_name||'').trim()&&String(sub.recovery_email_hash||'').trim()),returnPlaceSaved:!!String(participant.return_place_label||'').trim(),bonusWon:!!ob,bonusStatus:ob&&ob.status||''};const m=await env.DB.prepare("SELECT id,kind,message,created_at FROM contest_messages WHERE subscription_id=? AND read_at IS NULL ORDER BY created_at DESC LIMIT 8").bind(sub.id).all();messages=m.results||[];const q=await env.DB.prepare("SELECT id,new_place,previous_place,message,user_answer,status,created_at FROM contest_travel_alerts WHERE subscription_id=? AND status='pending' AND user_answer='' ORDER BY created_at DESC").bind(sub.id).all();questions=q.results||[]}}
  const ranking=await env.DB.prepare("SELECT first_name,last_name,points,joined_at FROM contest_participants WHERE banned=0 ORDER BY points DESC,joined_at ASC").all();const results=resultsVisible?(await env.DB.prepare("SELECT * FROM contest_results ORDER BY rank").all()).results||[]:[];
  return json({ok:true,active:!ended,ended,resultsVisible,closed,phase:!ended?"active":resultsVisible?"results":"closed",startAt:Number(cfg.start_at),endAt:Number(cfg.end_at),resultsUntil,appFreeUntil:Number(cfg.end_at)+CONTEST_APP_FREE_EXTRA_MS,daysRemaining:Math.max(0,Math.ceil((Number(cfg.end_at)-now)/86400000)),profile,participant,ranking:ranking.results||[],messages,questions,results,scoreSummary,bonusState,bonusProgress,onboarding});
}
async function contestCommunes(url){
  const country=String(url.searchParams.get("country")||"FR").toUpperCase(),area=String(url.searchParams.get("area")||"").trim(),q=String(url.searchParams.get("q")||"").trim();
  if(country==="FR"){if(!/^[0-9A-Z]{2,3}$/i.test(area))return json({ok:false,error:"DEPARTEMENT_INVALIDE"},400);try{const r=await fetch(`https://geo.api.gouv.fr/departements/${encodeURIComponent(area)}/communes?fields=nom,code,centre,codesPostaux&format=json&geometry=centre`,{headers:{accept:"application/json"}});if(!r.ok)throw 0;const a=await r.json();return json({ok:true,communes:(a||[]).map(c=>({name:c.nom,code:c.code,lat:c.centre&&c.centre.coordinates?Number(c.centre.coordinates[1]):null,lon:c.centre&&c.centre.coordinates?Number(c.centre.coordinates[0]):null})).filter(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lon)).sort((a,b)=>a.name.localeCompare(b.name,"fr"))})}catch(_){return json({ok:false,error:"COMMUNES_INDISPONIBLES"},503)}}
  if(country==="BE"){if(q.length<2)return json({ok:true,communes:[]});try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&country=Belgium&q=${encodeURIComponent(q+(area?", "+area:""))}&limit=12`,{headers:{"user-agent":"CouteauSuisse-Contest/1.0"}});if(!r.ok)throw 0;const a=await r.json();return json({ok:true,communes:(a||[]).map(x=>({name:String(x.display_name||q).split(",")[0],code:"",lat:Number(x.lat),lon:Number(x.lon)})).filter(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lon))})}catch(_){return json({ok:false,error:"COMMUNES_INDISPONIBLES"},503)}}
  return json({ok:false,error:"PAYS_INVALIDE"},400);
}
async function contestRegister(request,env){
  const cfg=await ensureContestTables(env);if(Date.now()>=Number(cfg.end_at))return json({ok:false,error:"CONCOURS_TERMINE"},409);const data=await body(request),sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);
  const first=contestCleanName(sub.account_first_name||data.firstName),last=contestCleanName(sub.account_last_name||data.lastName),country=String(data.country||"FR").toUpperCase(),area=String(data.area||"").trim().slice(0,80),commune=String(data.commune||"").trim().slice(0,120),lat=Number(data.lat),lon=Number(data.lon);if(first.length<2||last.length<2)return json({ok:false,error:"NOM_ET_PRENOM_OBLIGATOIRES"},400);if(!area||!commune||!Number.isFinite(lat)||!Number.isFinite(lon))return json({ok:false,error:"COMMUNE_OBLIGATOIRE"},400);
  const old=await env.DB.prepare("SELECT * FROM contest_participants WHERE subscription_id=?").bind(sub.id).first();if(old&&!old.change_allowed)return json({ok:false,error:"COMMUNE_VERROUILLEE"},409);const emailHash=String(sub.recovery_email_hash||"");
  await env.DB.prepare("UPDATE subscriptions SET account_first_name=?,account_last_name=?,account_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(first,last,Date.now(),sub.id).run();
  if(old)await env.DB.prepare("UPDATE contest_participants SET device_id=?,first_name=?,last_name=?,home_country=?,home_area=?,home_commune=?,home_lat=?,home_lon=?,return_place_lat=NULL,return_place_lon=NULL,return_place_label='',camping_active=0,camping_lat=NULL,camping_lon=NULL,camping_label='',camping_updated_at=NULL,change_allowed=0,updated_at=? WHERE subscription_id=?").bind(String(data.deviceId||""),first,last,country,area,commune,lat,lon,Date.now(),sub.id).run();else await env.DB.prepare("INSERT INTO contest_participants(subscription_id,device_id,first_name,last_name,email_hash,home_country,home_area,home_commune,home_lat,home_lon,joined_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(sub.id,String(data.deviceId||""),first,last,emailHash,country,area,commune,lat,lon,Date.now(),Date.now()).run();
  await applyPendingReferralRewards(env,sub.id);
  return json({ok:true,message:"Bravo, vous participez au concours !"});
}
async function contestReport(request,env){const cfg=await ensureContestTables(env);if(Date.now()>=Number(cfg.end_at))return json({ok:false,error:"CONCOURS_TERMINE"},409);const data=await body(request),sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);const p=await env.DB.prepare("SELECT * FROM contest_participants WHERE subscription_id=? AND banned=0").bind(sub.id).first();if(!p)return json({ok:false,error:"INSCRIPTION_CONCOURS_REQUISE"},403);const kind=["bug","probleme","idee"].includes(String(data.kind))?String(data.kind):"idee",desc=String(data.description||"").trim().slice(0,1500);if(desc.length<5)return json({ok:false,error:"DESCRIPTION_TROP_COURTE"},400);const fp=await sha256Text(kind+":"+desc.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," "));const dup=await env.DB.prepare("SELECT id FROM contest_reports WHERE fingerprint=? AND status IN ('pending','approved') LIMIT 1").bind(fp).first();if(dup)return json({ok:false,error:"SIGNALEMENT_DEJA_CONNU"},409);await env.DB.prepare("INSERT INTO contest_reports(id,subscription_id,kind,description,fingerprint,created_at) VALUES(?,?,?,?,?,?)").bind(contestId(),sub.id,kind,desc,fp,Date.now()).run();return json({ok:true})}
async function contestCommuneRequest(request,env){const data=await body(request),sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);const p=await env.DB.prepare("SELECT * FROM contest_participants WHERE subscription_id=? AND banned=0").bind(sub.id).first();if(!p)return json({ok:false,error:"INSCRIPTION_CONCOURS_REQUISE"},403);const exists=await env.DB.prepare("SELECT id FROM contest_commune_requests WHERE subscription_id=? AND status='pending' LIMIT 1").bind(sub.id).first();if(exists)return json({ok:true,already:true});await env.DB.prepare("INSERT INTO contest_commune_requests(id,subscription_id,created_at) VALUES(?,?,?)").bind(contestId(),sub.id,Date.now()).run();return json({ok:true})}
async function contestTravelAnswer(request,env){const data=await body(request),sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);const id=String(data.id||""),ans=String(data.answer||"").toLowerCase();const row=await env.DB.prepare("SELECT * FROM contest_travel_alerts WHERE id=? AND subscription_id=? AND status='pending'").bind(id,sub.id).first();if(!row)return json({ok:false,error:"ALERTE_INTROUVABLE"},404);let place="";if(ans==="non"&&Number.isFinite(Number(data.lat))&&Number.isFinite(Number(data.lon)))place=await contestPlaceLabel(Number(data.lat),Number(data.lon));await env.DB.prepare("UPDATE contest_travel_alerts SET user_answer=?,answer_place=?,answered_at=? WHERE id=?").bind(ans==="oui"?"oui":"non",place,Date.now(),id).run();return json({ok:true,place})}
async function contestReadMessages(request,env){const data=await body(request),sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);await env.DB.prepare("UPDATE contest_messages SET read_at=? WHERE subscription_id=? AND read_at IS NULL").bind(Date.now(),sub.id).run();return json({ok:true})}

async function queueContestMarketReview(env,deviceId,marketKey,marketName,photo){
  try{
    const cfg=await ensureContestTables(env);if(Date.now()>=Number(cfg.end_at))return;
    const p=await env.DB.prepare("SELECT * FROM contest_participants WHERE device_id=? AND banned=0 LIMIT 1").bind(deviceId).first();if(!p)return;
    if(await env.DB.prepare("SELECT id FROM contest_market_points WHERE subscription_id=? AND market_key=?").bind(p.subscription_id,marketKey).first())return;
    if(await env.DB.prepare("SELECT id FROM contest_market_reviews WHERE subscription_id=? AND market_key=?").bind(p.subscription_id,marketKey).first())return;
    const meta=await env.DB.prepare("SELECT market_latitude,market_longitude,captured_at,device_id FROM market_photo_metadata WHERE market_key=?").bind(marketKey).first();if(!meta||String(meta.device_id)!==String(deviceId))return;
    const lat=Number(meta.market_latitude),lon=Number(meta.market_longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
    const campingOn=Number(p.camping_active)===1&&Number.isFinite(Number(p.camping_lat))&&Number.isFinite(Number(p.camping_lon)),startLat=campingOn?Number(p.camping_lat):(Number.isFinite(Number(p.return_place_lat))?Number(p.return_place_lat):Number(p.home_lat)),startLon=campingOn?Number(p.camping_lon):(Number.isFinite(Number(p.return_place_lon))?Number(p.return_place_lon):Number(p.home_lon));
    const rawKm=contestKm(startLat,startLon,lat,lon),score=await contestMarketBreakdown(env,deviceId,marketKey,rawKm),bonus=await contestRefreshBonusState(env,p.subscription_id),multiplier=bonus.active?Math.max(1,Number(bonus.active.multiplier||1)):1,pts=score.basePoints*multiplier,place=await contestPlaceLabel(lat,lon);
    const prevRows=await env.DB.prepare("SELECT market_lat,market_lon,place_label FROM contest_market_points WHERE subscription_id=? ORDER BY awarded_at DESC LIMIT 5").bind(p.subscription_id).all();const prev=(prevRows.results||[])[0];let unusual=0,previousPlace="";if(campingOn){const jump=contestKm(startLat,startLon,lat,lon);if(jump>=350){unusual=1;previousPlace=String(p.camping_label||"").trim()||await contestPlaceLabel(startLat,startLon)}}else if(prev&&(prevRows.results||[]).length>=3){const jump=contestKm(prev.market_lat,prev.market_lon,lat,lon);if(jump>=350){unusual=1;previousPlace=prev.place_label||await contestPlaceLabel(prev.market_lat,prev.market_lon)}}
    const rid=contestId();await env.DB.prepare("INSERT INTO contest_market_reviews(id,subscription_id,market_key,market_name,device_id,market_lat,market_lon,place_label,photo_captured_at,distance_km,base_points,multiplier,points,breakdown_json,unusual,previous_place,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(rid,p.subscription_id,marketKey,String(marketName||"Marché").slice(0,160),deviceId,lat,lon,place,String(meta.captured_at||photo&&photo.capturedAt||""),score.distanceKm,score.basePoints,multiplier,pts,JSON.stringify(score.items),unusual,previousPlace,Date.now()).run();
    if(unusual){const msg=`⚠️ Nous avons détecté un déplacement inhabituel vers ${place}. Vous êtes parti avec les campings ? Si oui, vérifiez que votre lieu de camping est bien à jour dans « Lieu de départ ». Un ancien emplacement ou de mauvaises coordonnées peuvent déclencher des alertes. Au troisième déplacement inhabituel non justifié, vous risquez d'être exclu du classement.`;await env.DB.prepare("INSERT INTO contest_travel_alerts(id,subscription_id,review_id,new_place,previous_place,message,created_at) VALUES(?,?,?,?,?,?,?)").bind(contestId(),p.subscription_id,rid,place,previousPlace,msg,Date.now()).run()}
    else if(Number(score.distanceKm)>150){await contestEnqueueBonus(env,p.subscription_id,2,"trajet aller de plus de 150 km","long-trip:"+marketKey,CONTEST_LONG_TRIP_BONUS_MS,true)}
  }catch(_){}
}


async function ensureAppMessages(env){await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_messages(id TEXT PRIMARY KEY,subscription_id INTEGER,first_name TEXT NOT NULL DEFAULT '',last_name TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL DEFAULT 'Message',message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,read_at INTEGER)`).run()}
async function appMessage(request,env){await ensureAppMessages(env);const d=await body(request),sub=await contestSubscription(env,d);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);const p=await env.DB.prepare("SELECT first_name,last_name,home_commune,home_area FROM contest_participants WHERE subscription_id=? LIMIT 1").bind(sub.id).first();const first=String((p&&p.first_name)||sub.account_first_name||"").trim(),last=String((p&&p.last_name)||sub.account_last_name||"").trim(),address=p?String(p.home_commune||"")+(p.home_area?" ("+p.home_area+")":""):"Adresse non renseignée",kind=String(d.kind||"Message").trim().slice(0,80),message=String(d.message||"").trim().slice(0,3000);if(message.length<3)return json({ok:false,error:"MESSAGE_TROP_COURT"},400);await env.DB.prepare("INSERT INTO app_messages(id,subscription_id,first_name,last_name,address,kind,message,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(contestId(),sub.id,first,last,address,kind,message,Date.now()).run();return json({ok:true})}
async function adminAppMessages(request,env){if(!(await adminAuthorized(request,env)))return json({ok:false,error:"SECRET_INCORRECT"},401);await ensureAppMessages(env);if(request.method==="POST"){const d=await body(request);await env.DB.prepare("UPDATE app_messages SET status='read',read_at=? WHERE id=?").bind(Date.now(),String(d.id||"")).run()}const messages=(await env.DB.prepare("SELECT * FROM app_messages WHERE status='pending' ORDER BY created_at DESC LIMIT 200").all()).results||[];return json({ok:true,messages,count:messages.length})}

function contestIdeaMultiplier(description){
  const text=String(description||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const major=["securite","danger","accident","urgence","donnees perdues","perte de donnees","paiement","abonnement bloque","application bloquee","impossible d'utiliser","ne fonctionne plus","pirat","fraude"];
  if(major.some(word=>text.includes(word))||text.length>=300)return 10;
  const important=["gps","navigation","carte","notification","message","classement","concours","camping","compte","connexion","adresse","marche","evenement","sauvegarde","accessibilite","plusieurs personnes"];
  const matches=important.filter(word=>text.includes(word)).length;
  if(matches>=2||text.length>=140)return 5;
  return 2;
}

async function adminContest(request,env){
  if(!(await adminAuthorized(request,env)))return json({ok:false,error:"SECRET_INCORRECT"},401);const cfg=await finalizeContestIfNeeded(env);const participants=(await env.DB.prepare("SELECT subscription_id,first_name,last_name,home_commune,home_area,camping_active,camping_label,camping_updated_at,points,banned,alert_count,joined_at FROM contest_participants ORDER BY points DESC,joined_at ASC").all()).results||[];for(const p of participants){const b=await contestRefreshBonusState(env,p.subscription_id);p.active_bonus=b.active?{multiplier:b.active.multiplier,end_at:b.active.end_at}:null}
  const reviews=(await env.DB.prepare("SELECT r.*,p.first_name,p.last_name,p.alert_count FROM contest_market_reviews r JOIN contest_participants p ON p.subscription_id=r.subscription_id WHERE r.status='pending' ORDER BY r.created_at DESC").all()).results||[];for(const r of reviews){try{r.breakdown=JSON.parse(r.breakdown_json||'[]')}catch(_){r.breakdown=[]}}
  const reports=(await env.DB.prepare("SELECT r.*,p.first_name,p.last_name,p.home_commune,p.home_area FROM contest_reports r JOIN contest_participants p ON p.subscription_id=r.subscription_id WHERE r.status='pending' ORDER BY r.created_at DESC").all()).results||[];for(const r of reports){r.suggested_multiplier=r.kind==='idee'?contestIdeaMultiplier(r.description):null}const communes=(await env.DB.prepare("SELECT c.*,p.first_name,p.last_name,p.home_commune,p.home_area FROM contest_commune_requests c JOIN contest_participants p ON p.subscription_id=c.subscription_id WHERE c.status='pending' ORDER BY c.created_at DESC").all()).results||[];const alerts=(await env.DB.prepare("SELECT a.*,p.first_name,p.last_name,p.alert_count FROM contest_travel_alerts a JOIN contest_participants p ON p.subscription_id=a.subscription_id WHERE a.status='pending' ORDER BY a.created_at DESC").all()).results||[];return json({ok:true,config:cfg,participants,reviews,reports,communes,alerts})
}
function contestCongratsMessage(r,awarded){
  let items=[];try{items=JSON.parse(r.breakdown_json||'[]')}catch(_){}const dist=items.find(x=>x&&x.key==='distance'),distancePts=Number(dist&&dist.points||0),base=Number(r.base_points||0),info=Math.max(0,base-distancePts),mult=Math.max(1,Number(r.multiplier||1));
  return `🎉 BRAVO !\nFiche renseignée : +${contestNumberText(info)} points\nTrajet aller : ${contestNumberText(r.distance_km)} km\nGasoil : 2,23 €/L\nDéplacement : +${contestNumberText(distancePts)} points${mult>1?`\nBonus ×${mult} actif`:''}\n🏆 TOTAL GAGNÉ : +${contestNumberText(awarded)} POINTS`;
}

async function adminContestAction(request,env){
  if(!(await adminAuthorized(request,env)))return json({ok:false,error:"SECRET_INCORRECT"},401);await ensureContestTables(env);const d=await body(request),type=String(d.type||""),id=String(d.id||""),approve=d.approve===true;
  if(type==="review"){
    const r=await env.DB.prepare("SELECT * FROM contest_market_reviews WHERE id=? AND status='pending'").bind(id).first();if(!r)return json({ok:false,error:"DEMANDE_INTROUVABLE"},404);
    if(approve){const duplicate=await env.DB.prepare("SELECT id FROM contest_market_points WHERE subscription_id=? AND market_key=?").bind(r.subscription_id,r.market_key).first();let awarded=Number(r.points||0);if(!duplicate){const base=Number(r.base_points||r.points||0),mult=Math.max(1,Number(r.multiplier||1));awarded=Number(r.points||base*mult);await env.DB.prepare("INSERT INTO contest_market_points(subscription_id,market_key,market_name,distance_km,points,base_points,multiplier,breakdown_json,market_lat,market_lon,place_label,awarded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(r.subscription_id,r.market_key,r.market_name,r.distance_km,awarded,base,mult,r.breakdown_json||'[]',r.market_lat,r.market_lon,r.place_label,Date.now()).run();await contestAddScoreEvent(env,r.subscription_id,'market',r.market_key,r.market_name,base,mult,awarded);await contestApplyMarketMilestones(env,r.subscription_id);if(Number(r.distance_km)>150&&Number(r.unusual))await contestEnqueueBonus(env,r.subscription_id,2,"trajet aller de plus de 150 km validé par l’administrateur","long-trip:"+r.market_key,CONTEST_LONG_TRIP_BONUS_MS,true)}await contestPushMessage(env,r.subscription_id,contestCongratsMessage(r,awarded),"approved")}
    else{if(Number(r.unusual)){await env.DB.prepare("UPDATE contest_participants SET alert_count=alert_count+1,updated_at=? WHERE subscription_id=?").bind(Date.now(),r.subscription_id).run();const p=await env.DB.prepare("SELECT alert_count FROM contest_participants WHERE subscription_id=?").bind(r.subscription_id).first();if(Number(p&&p.alert_count||0)>=3)await env.DB.prepare("UPDATE contest_participants SET banned=1 WHERE subscription_id=?").bind(r.subscription_id).run()}await contestPushMessage(env,r.subscription_id,`❌ Votre demande pour ${r.market_name} a été refusée — aucun point ajouté.`,`denied`)}
    await env.DB.prepare("UPDATE contest_market_reviews SET status=?,decided_at=? WHERE id=?").bind(approve?"approved":"denied",Date.now(),id).run();return json({ok:true});
  }
  if(type==="report"){const r=await env.DB.prepare("SELECT * FROM contest_reports WHERE id=? AND status='pending'").bind(id).first();if(!r)return json({ok:false,error:"DEMANDE_INTROUVABLE"},404);if(approve){if(r.kind==='idee'){const multiplier=contestIdeaMultiplier(r.description);await env.DB.prepare("UPDATE contest_reports SET status='approved',points=0,decided_at=? WHERE id=?").bind(Date.now(),id).run();await contestEnqueueBonus(env,r.subscription_id,multiplier,"idée acceptée par l’administrateur","idea:"+r.id,CONTEST_BONUS_MS,false,`🎉 Bravo, vous bénéficiez du multiplicateur ×${multiplier} pendant 3 jours.`)}else{await contestAddScoreEvent(env,r.subscription_id,'bug',r.id,r.description,153,1,153);await env.DB.prepare("UPDATE contest_reports SET status='approved',points=153,decided_at=? WHERE id=?").bind(Date.now(),id).run();await contestPushMessage(env,r.subscription_id,"✅ Votre bug / problème a été confirmé — +153 points.","approved")}}else{await contestPushMessage(env,r.subscription_id,"❌ Votre signalement / idée a été refusé — aucun point ajouté.","denied");await env.DB.prepare("UPDATE contest_reports SET status='denied',points=0,decided_at=? WHERE id=?").bind(Date.now(),id).run()}return json({ok:true})}
  if(type==="commune"){const r=await env.DB.prepare("SELECT * FROM contest_commune_requests WHERE id=? AND status='pending'").bind(id).first();if(!r)return json({ok:false,error:"DEMANDE_INTROUVABLE"},404);await env.DB.prepare("UPDATE contest_commune_requests SET status=?,decided_at=? WHERE id=?").bind(approve?"approved":"denied",Date.now(),id).run();if(approve)await env.DB.prepare("UPDATE contest_participants SET change_allowed=1,updated_at=? WHERE subscription_id=?").bind(Date.now(),r.subscription_id).run();await contestPushMessage(env,r.subscription_id,approve?"✅ Votre demande est acceptée. Vous pouvez maintenant changer votre commune dans le jeu concours.":"❌ Votre demande de changement de commune a été refusée.",approve?"approved":"denied");return json({ok:true})}
  if(type==="message"){const sid=Number(d.subscriptionId);if(!sid)return json({ok:false,error:"PARTICIPANT_INVALIDE"},400);await contestPushMessage(env,sid,String(d.message||"").trim()||"Message de l’administrateur.","admin");return json({ok:true})}
  if(type==="travel-question"){const a=await env.DB.prepare("SELECT * FROM contest_travel_alerts WHERE id=? AND status='pending'").bind(id).first();if(!a)return json({ok:false,error:"ALERTE_INTROUVABLE"},404);await contestPushMessage(env,a.subscription_id,a.message,"travel");return json({ok:true})}
  if(type==="travel-close"){await env.DB.prepare("UPDATE contest_travel_alerts SET status='closed' WHERE id=?").bind(id).run();return json({ok:true})}
  return json({ok:false,error:"ACTION_INCONNUE"},400)
}
// ===== FIN JEU CONCOURS V191 CAMPING =====

class InjectAppFiles {
  element(element) {
    element.append('<link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/mobile-overrides.css?v=62"><link rel="stylesheet" href="/subscription-locks.css?v=62"><link rel="stylesheet" href="/home-work.css?v=62"><script src="/weather-all-pages.js?v=68-notifications-globales" defer></script><script src="/subscription-web.js?v=238-admin-email-devis" defer></script><script src="/home-work.js?v=62" defer></script><script src="/market-presence-global.js?v=176" defer></script><script src="/market-navigation-confirm-v189.js?v=189" defer></script><script src="/contest-v188.js?v=235-parrainage-email-bouton" defer></script><script src="/referral-v232.js?v=235" defer></script>', { html: true });
  }
}

class FixAndroidLinks {
  element(element) {
    const href = element.getAttribute("href") || "";
    const prefix = "file:///android_asset/";
    if (href.startsWith(prefix)) element.setAttribute("href", "/" + href.slice(prefix.length));
  }
}

class InjectMarketLive {
  element(element) {
    const src = element.getAttribute("src") || "";
    if (/market-(?:final|clean)\.js(?:\?|$)/.test(src)) element.before('<script src="/market-live.js?v=1"></script>', { html: true });
  }
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/api/activate" && request.method === "POST") return activate(request, env);
    if (url.pathname === "/api/status" && request.method === "POST") return subscriptionStatus(request, env);
    if (url.pathname === "/api/recover-code" && request.method === "POST") return recoverSubscriptionCode(request, env);
    if (url.pathname === "/api/subscription-email" && request.method === "POST") return updateSubscriptionEmail(request, env);
    if (url.pathname === "/api/contest/trial-identity" && request.method === "POST") return contestTrialIdentity(request, env);
    if (url.pathname === "/api/referral/create" && request.method === "POST") return referralCreate(request, env);
    if (url.pathname === "/api/referral/start" && request.method === "POST") return referralStart(request, env);
    if (url.pathname === "/api/referral/confirm" && request.method === "GET") return referralConfirm(request, env);
    if (url.pathname === "/api/referral/verify" && request.method === "POST") return referralVerify(request, env);
    if (url.pathname === "/api/presence" && (request.method === "GET" || request.method === "POST")) return presence(request, env);
    if (url.pathname === "/api/installations" && request.method === "POST") return installations(request, env);
    if (url.pathname === "/api/admin/login/request" && request.method === "POST") return requestAdminEmailLogin(request, env);
    if (url.pathname === "/api/admin/login/verify" && request.method === "POST") return verifyAdminEmailLogin(request, env);
    if (url.pathname === "/api/admin/session" && request.method === "GET") return adminSessionStatus(request, env);
    if (url.pathname === "/api/admin/logout" && request.method === "POST") return adminLogout(request, env);
    if (url.pathname === "/api/admin/installations" && request.method === "GET") return adminInstallations(request, env);
    if (url.pathname === "/api/admin/presence" && request.method === "GET") return adminPresenceStatus(env);
    if (url.pathname === "/api/admin/presence" && request.method === "POST") return adminPresenceAction(request, env);
    if (url.pathname === "/api/admin/subscriptions" && request.method === "POST") return createSubscription(request, env);
    if (url.pathname === "/api/admin/subscriptions/action" && request.method === "POST") return subscriptionAction(request, env);
    if (url.pathname === "/api/mail-event" && request.method === "POST") return recordMailEvent(request, env);
    if (url.pathname === "/api/admin/mail-counters" && request.method === "GET") return adminMailCounters(request, env);
    if (url.pathname === "/api/admin/gps-push" && (request.method === "GET" || request.method === "POST")) return adminGpsPush(request, env);
    if (url.pathname === "/api/gps-unlock-request" && request.method === "POST") return requestGpsUnlock(request, env);
    if (url.pathname === "/api/gps-unlock-status" && request.method === "GET") return gpsUnlockStatus(url, env);
    if (url.pathname === "/api/admin/gps-unlock-requests" && (request.method === "GET" || request.method === "POST")) return adminGpsUnlockRequests(request, env);
    if (url.pathname === "/download-autoradio.apk" && request.method === "GET") return downloadAutoradioApk();
    if (url.pathname === "/api/rne-pdf" && request.method === "GET") return downloadRne(url);
    if (url.pathname === "/api/markets" && request.method === "GET") return listMarkets(env);
    if (url.pathname === "/api/admin/markets/import" && request.method === "POST") return importMarkets(request, env);
    if (url.pathname === "/api/market-verifications" && request.method === "GET") return getMarketVerification(url, env);
    if (url.pathname === "/api/market-verifications" && request.method === "POST") return submitMarketVerification(request, env);
    if (url.pathname === "/api/market-verifications/batch" && request.method === "POST") return batchMarketVerifications(request, env);
    if (url.pathname === "/api/market-presence/disabled" && request.method === "GET") return disabledMarketPresence(env);
    if (url.pathname === "/api/market-photo" && request.method === "GET") return marketPhoto(url, env);
    if (url.pathname === "/api/vigilance" && request.method === "GET") return vigilanceForPlace(url);
    if (url.pathname === "/api/place-address" && request.method === "GET") return reversePlaceAddress(url, env);
    if (url.pathname === "/api/place-context" && request.method === "GET") return reversePlaceContext(url, env);
    if (url.pathname === "/api/contest/status" && request.method === "POST") return contestStatus(request, env);
    if (url.pathname === "/api/contest/communes" && request.method === "GET") return contestCommunes(url);
    if (url.pathname === "/api/contest/register" && request.method === "POST") return contestRegister(request, env);
    if (url.pathname === "/api/contest/home-place" && request.method === "POST") return contestHomePlace(request, env);
    if (url.pathname === "/api/contest/camping-place" && request.method === "POST") return contestCampingPlace(request, env);
    if (url.pathname === "/api/contest/camping-stop" && request.method === "POST") return contestCampingStop(request, env);
    if (url.pathname === "/api/contest/report" && request.method === "POST") return contestReport(request, env);
    if (url.pathname === "/api/contest/change-commune-request" && request.method === "POST") return contestCommuneRequest(request, env);
    if (url.pathname === "/api/contest/travel-answer" && request.method === "POST") return contestTravelAnswer(request, env);
    if (url.pathname === "/api/contest/read-messages" && request.method === "POST") return contestReadMessages(request, env);
    if (url.pathname === "/api/app-message" && request.method === "POST") return appMessage(request, env);
    if (url.pathname === "/api/admin/app-messages" && (request.method === "GET" || request.method === "POST")) return adminAppMessages(request, env);
    if (url.pathname === "/api/admin/contest" && request.method === "GET") return adminContest(request, env);
    if (url.pathname === "/api/admin/contest/action" && request.method === "POST") return adminContestAction(request, env);
    // Laisser Cloudflare Static Assets résoudre "/" vers index.html.
    // Ne pas réécrire "/" en "/index.html" ici : avec html_handling automatique,
    // cela peut créer une boucle / <-> /index.html.
    let response = await env.ASSETS.fetch(request);
    if (url.pathname === "/sw.js" || url.pathname === "/app-version.json") {
      const h = new Headers(response.headers);
      h.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
    }
    const type = response.headers.get("content-type") || "";
    if (type.includes("text/html") && url.pathname !== "/admin.html" && url.pathname !== "/admin" && url.pathname !== "/import-marches.html") {
      const transformed = new HTMLRewriter().on("head", new InjectAppFiles()).on("a", new FixAndroidLinks()).on("script", new InjectMarketLive()).transform(response);
      const headers = new Headers(transformed.headers);
      headers.set("cache-control", "no-store, no-cache, must-revalidate");
      return new Response(transformed.body, { status: transformed.status, statusText: transformed.statusText, headers });
    }
    return response;
  }
};
