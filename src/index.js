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
  if (!supplied) return false;
  if (env.ADMIN_SECRET && supplied === String(env.ADMIN_SECRET).trim()) return true;
  return (await sha256Text(supplied)) === ADMIN_FALLBACK_SHA256;
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
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS subscription_email_challenges(id TEXT PRIMARY KEY,subscription_id INTEGER NOT NULL,email TEXT NOT NULL,email_hash TEXT NOT NULL,device_id TEXT NOT NULL,device_type TEXT NOT NULL,code_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_email_challenge_device ON subscription_email_challenges(device_id,created_at)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS brevo_daily_usage(day TEXT PRIMARY KEY, sent_count INTEGER NOT NULL DEFAULT 0)").run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS email_identity_challenges(id TEXT PRIMARY KEY,email TEXT NOT NULL,email_hash TEXT NOT NULL,device_id TEXT NOT NULL,code_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,verified INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL)`).run();
}
function emailMask(email){return email.replace(/^(.{2}).*(@.*)$/,'$1***$2')}
function parisDay(){return new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function randomEmailCode(){const a=new Uint32Array(1);crypto.getRandomValues(a);return String(a[0]%1000000).padStart(6,"0")}
async function emailCodeHash(id,code,env){return sha256Text(id+":"+code+":"+(env.CODE_PEPPER||"carplay-email"))}
async function sendBrevoCode(env,email,code){
  if(!env.BREVO_API_KEY||!env.BREVO_SENDER_EMAIL)throw new Error("EMAIL_CONFIG");
  const response=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{accept:"application/json","content-type":"application/json","api-key":env.BREVO_API_KEY},body:JSON.stringify({sender:{name:"CarPlay Téléphone",email:String(env.BREVO_SENDER_EMAIL)},to:[{email}],subject:"Votre code de confirmation CarPlay",textContent:"Votre code de confirmation CarPlay est : "+code+". Il est valable 10 minutes.",htmlContent:'<div style="font-family:Arial,sans-serif"><h2>CarPlay Téléphone</h2><p>Votre code de confirmation est :</p><p style="font-size:32px;font-weight:bold;letter-spacing:7px">'+code+'</p><p>Ce code est valable 10 minutes.</p></div>'})});
  if(!response.ok)throw new Error("EMAIL_SEND");
}
async function sendBrevoSubscriptionCode(env,email,code){
  if(!env.BREVO_API_KEY||!env.BREVO_SENDER_EMAIL)throw new Error("EMAIL_CONFIG");
  const response=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{accept:"application/json","content-type":"application/json","api-key":env.BREVO_API_KEY},body:JSON.stringify({sender:{name:"CarPlay Téléphone",email:String(env.BREVO_SENDER_EMAIL)},to:[{email}],subject:"Votre code d’abonnement CarPlay",textContent:"Votre code d’abonnement CarPlay est : "+code+". Entrez ce même code sur votre nouveau téléphone pour récupérer votre abonnement. L’ancien téléphone sera automatiquement remplacé pour cet abonnement.",htmlContent:'<div style="font-family:Arial,sans-serif"><h2>CarPlay Téléphone</h2><p>Voici le code rattaché à votre abonnement :</p><p style="font-size:32px;font-weight:bold;letter-spacing:7px">'+code+'</p><p>Entrez ce même code sur votre nouveau téléphone pour récupérer votre abonnement. L’ancien téléphone sera automatiquement remplacé pour cet abonnement.</p></div>'})});
  if(!response.ok)throw new Error("EMAIL_SEND");
}
async function recoverSubscriptionCode(request,env){
  await ensureSubscriptionEmailColumns(env);
  const data=await body(request),email=normalizeEmail(data.email),deviceId=String(data.deviceId||''),now=Date.now(),day=parisDay();
  if(!validEmail(email))return json({ok:false,error:'EMAIL_OBLIGATOIRE'},400);
  if(!validDevice(deviceId))return json({ok:false,error:'DONNEES_INVALIDES'},400);
  const emailHash=await sha256Text(email);
  const row=await env.DB.prepare("SELECT * FROM subscriptions WHERE recovery_email_hash=? AND active=1 LIMIT 1").bind(emailHash).first();
  if(!row)return json({ok:false,error:'EMAIL_INTROUVABLE'},404);
  if(!row.lifetime&&(!row.expires_at||Date.parse(row.expires_at)<=now))return json({ok:false,error:'ABONNEMENT_EXPIRE'},403);
  if(Number(row.last_recovery_sent_at||0)&&now-Number(row.last_recovery_sent_at)<60000)return json({ok:false,error:'CODE_EMAIL_TROP_RAPIDE'},429);
  const usage=await env.DB.prepare("SELECT sent_count FROM brevo_daily_usage WHERE day=?").bind(day).first();
  if(Number(usage?.sent_count||0)>=200)return json({ok:false,error:'QUOTA_EMAIL_JOURNALIER'},429);
  let code='';
  try{code=await openRecoveryCode(row.recovery_code_box,env)}catch(_){return json({ok:false,error:'CODE_RECUPERATION_NON_INITIALISE'},409)}
  try{await sendBrevoSubscriptionCode(env,email,code)}catch(_){return json({ok:false,error:'EMAIL_ENVOI_INDISPONIBLE'},503)}
  await env.DB.batch([
    env.DB.prepare("UPDATE subscriptions SET last_recovery_sent_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(now,row.id),
    env.DB.prepare("INSERT INTO brevo_daily_usage(day,sent_count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET sent_count=sent_count+1").bind(day)
  ]);
  return json({ok:true,email});
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
  const email=normalizeEmail(data.email);
  const emailProof=String(data.emailProof||"");
  const deviceId = String(data.deviceId || "");
  const type = data.deviceType === "autoradio" ? "autoradio" : "phone";
  const firstName=String(data.firstName||"").trim().replace(/\s+/g," ").slice(0,60), lastName=String(data.lastName||"").trim().replace(/\s+/g," ").slice(0,60);
  if (!validEmail(email)) return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);
  if (firstName.length<2 || lastName.length<2) return json({ok:false,error:"NOM_ET_PRENOM_OBLIGATOIRES"},400);
  if (!validCode(code) || !validDevice(deviceId)) return json({ ok: false, error: "DONNEES_INVALIDES" }, 400);
  const codeHash = await hashCode(code, env.CODE_PEPPER);
  const row = await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash = ? AND active = 1").bind(codeHash).first();
  if (!row) return json({ ok: false, error: "CODE_INCORRECT" }, 403);
  if (!row.lifetime && (!row.expires_at || Date.parse(row.expires_at) <= Date.now())) return json({ ok: false, error: "ABONNEMENT_EXPIRE" }, 403);
  const column = type === "autoradio" ? "autoradio_device" : "phone_device";
  const registered = row[column];
  const emailHash=await sha256Text(email),storedEmail=String(row.recovery_email_hash||"");
  const changingPhone=!!registered&&registered!==deviceId;
  if(storedEmail&&storedEmail!==emailHash&&changingPhone)return json({ok:false,error:"EMAIL_NE_CORRESPOND_PAS"},403);
  const storedFirst=String(row.account_first_name||""),storedLast=String(row.account_last_name||"");
  if(changingPhone&&storedFirst&&storedLast&&(subscriptionIdentityKey(storedFirst)!==subscriptionIdentityKey(firstName)||subscriptionIdentityKey(storedLast)!==subscriptionIdentityKey(lastName)))return json({ok:false,error:"IDENTITE_NE_CORRESPOND_PAS"},403);
  const emailOwner=await activeEmailOwner(env,emailHash,row.id);
  if(emailOwner)return json({ok:false,error:"EMAIL_DEJA_UTILISEE"},409);
  const recoveryCodeBox=await sealRecoveryCode(code,env);
  await env.DB.prepare(`UPDATE subscriptions SET recovery_email_hash=?,recovery_email_mask=?,recovery_code_box=?,account_first_name=?,account_last_name=?,account_updated_at=?,${column}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(emailHash,email,recoveryCodeBox,firstName,lastName,Date.now(),deviceId,row.id).run();
  return json({ok:true,lifetime:!!row.lifetime,expiresAt:row.expires_at||null,deviceType:type,email,firstName,lastName});
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
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "SECRET_INCORRECT" }, 401);
  await ensureSubscriptionEmailColumns(env);
  const data = await body(request);
  const code = normalizeCode(data.code);
  if (!validCode(code)) return json({ ok: false, error: "CODE_6_CARACTERES_REQUIS" }, 400);
  const lifetime = data.lifetime === true;
  const days = Math.max(1, Math.min(3650, Number(data.days) || 365));
  const expires = lifetime ? null : new Date(Date.now() + days * 86400000).toISOString();
  const codeHash = await hashCode(code, env.CODE_PEPPER);
  const recoveryCodeBox = await sealRecoveryCode(code, env);
  const existing = await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash = ?").bind(codeHash).first();

  if (existing) {
    const stillReserved = !!existing.lifetime || (existing.expires_at && Date.parse(existing.expires_at) > Date.now());
    if (stillReserved) return json({ ok: false, error: "CODE_DEJA_UTILISE" }, 409);

    await env.DB.prepare(
      "UPDATE subscriptions SET expires_at=?, lifetime=?, active=1, recovery_code_box=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(expires, lifetime ? 1 : 0, recoveryCodeBox, existing.id).run();

    return json({ ok: true, code, lifetime, expiresAt: expires, renewed: true });
  }

  await env.DB.prepare("INSERT INTO subscriptions(code_hash, expires_at, lifetime, active, recovery_code_box) VALUES (?, ?, ?, 1, ?)")
    .bind(codeHash, expires, lifetime ? 1 : 0, recoveryCodeBox).run();

  return json({ ok: true, code, lifetime, expiresAt: expires, renewed: false });
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
    headers.set("content-disposition", 'attachment; filename="CarPlay-V5-Autoradio.apk"');
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
    const r = await fetch(u, { headers: { 'User-Agent': 'CarPlay-Marches/1.0', 'Accept-Language': 'fr' } });
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
  if (!env.MARKET_PHOTOS) return { ok: false, error: "STOCKAGE_PHOTO_NON_CONFIGURE" };
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

  const objectKey = `market-photos/${await sha256Text(marketKey)}.jpg`;
  await env.MARKET_PHOTOS.put(objectKey, bytes, { httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=3600" } });
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
  if (!env.DB || !env.MARKET_PHOTOS) return new Response("Photo indisponible", { status: 404, headers: cors });
  await ensureMarketVerificationTables(env);
  const marketKey = cleanMarketKey(url.searchParams.get("marketKey"));
  const row = marketKey && await env.DB.prepare("SELECT object_key,mime_type FROM market_photo_metadata WHERE market_key=?").bind(marketKey).first();
  if (!row) return new Response("Photo indisponible", { status: 404, headers: cors });
  const object = await env.MARKET_PHOTOS.get(row.object_key);
  if (!object) return new Response("Photo indisponible", { status: 404, headers: cors });
  return new Response(object.body, { headers: { ...cors, "content-type": row.mime_type || "image/jpeg", "cache-control": "public, max-age=3600" } });
}

async function vigilanceForPlace(url) {
  const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ ok: false, error: "POSITION_INVALIDE" }, 400);
  try {
    const geo = await fetch(`https://geo.api.gouv.fr/communes?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&fields=codeDepartement,departement&format=json`, { headers: { accept: "application/json", "user-agent": "CarPlay-Weather/1.0" } });
    const communes = geo.ok ? await geo.json() : [];
    const commune = Array.isArray(communes) && communes[0];
    const department = commune && commune.departement && commune.departement.nom || "";
    const code = commune && commune.codeDepartement || "";
    if (!department) return json({ ok: true, department: "", code: "", orangeThunderstorm: false });
    const feed = await fetch("https://feeds.meteoalarm.org/api/v1/warnings/feeds-france", { headers: { accept: "application/json", "user-agent": "CarPlay-Weather/1.0" }, cf: { cacheTtl: 300, cacheEverything: true } });
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
  try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=12`,{headers:{"user-agent":"CarPlay-Contest/1.0"}});if(r.ok){const j=await r.json(),a=j.address||{};return String(a.city||a.town||a.village||a.municipality||j.display_name||"Lieu inconnu").slice(0,120)}}catch(_){}
  return "Lieu non identifié";
}

async function reversePlaceAddress(url){
  const lat=Number(url.searchParams.get('lat')),lon=Number(url.searchParams.get('lon'));if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return json({ok:false,error:'POSITION_INVALIDE'},400);
  try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,{headers:{'user-agent':'CarPlay-ReturnPlace/1.0','accept-language':'fr'}});if(r.ok){const j=await r.json(),a=j.address||{},parts=[];const road=[a.house_number,a.road||a.pedestrian||a.square||a.place].filter(Boolean).join(' ');if(road)parts.push(road);const pc=a.postcode||'',city=a.city||a.town||a.village||a.municipality||a.hamlet||'';if(pc||city)parts.push([pc,city].filter(Boolean).join(' '));if(a.country)parts.push(a.country);const address=parts.join(', ')||String(j.display_name||'').slice(0,240);if(address)return json({ok:true,address})}}catch(_){}
  return json({ok:true,address:await contestPlaceLabel(lat,lon)});
}

async function reversePlaceContext(url){
  const lat=Number(url.searchParams.get('lat')),lon=Number(url.searchParams.get('lon'));
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return json({ok:false,error:'POSITION_INVALIDE'},400);
  let address='';
  try{
    const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,{headers:{'user-agent':'CarPlay-ReturnPlace/1.0','accept-language':'fr'}});
    if(r.ok){const j=await r.json(),a=j.address||{},parts=[];const road=[a.house_number,a.road||a.pedestrian||a.square||a.place].filter(Boolean).join(' ');if(road)parts.push(road);const pc=a.postcode||'',city=a.city||a.town||a.village||a.municipality||a.hamlet||'';if(pc||city)parts.push([pc,city].filter(Boolean).join(' '));if(a.country)parts.push(a.country);address=parts.join(', ')||String(j.display_name||'').slice(0,240)}
  }catch(_){ }
  if(!address)address=await contestPlaceLabel(lat,lon);
  let nearby=[];
  try{
    const q=`[out:json][timeout:8];(nwr(around:3000,${lat},${lon})[\"name\"][\"amenity\"~\"fast_food|cafe|restaurant|fuel\"];nwr(around:3000,${lat},${lon})[\"name\"][\"shop\"~\"supermarket|mall|convenience\"];);out center tags 70;`;
    const r=await fetch('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(q),{headers:{'user-agent':'CarPlay-ReturnPlace/1.0'}});
    if(r.ok){const j=await r.json(),known=/mcdonald|burger king|leclerc|e\.leclerc|carrefour|auchan|intermarch|lidl|aldi|super u|hyper u|kfc|quick|flunch|casino|monoprix/i,seen=new Set();nearby=(j.elements||[]).map(e=>{const la=Number(e.lat??e.center?.lat),lo=Number(e.lon??e.center?.lon),name=String(e.tags?.name||e.tags?.brand||'').trim();if(!name||!Number.isFinite(la)||!Number.isFinite(lo))return null;const d=Math.round(haversineMeters(lat,lon,la,lo));return {name,distanceMeters:d,known:known.test(name),type:String(e.tags?.amenity||e.tags?.shop||'')};}).filter(Boolean).filter(x=>{const k=x.name.toLowerCase();if(seen.has(k))return false;seen.add(k);return x.distanceMeters<=3000}).sort((a,b)=>(Number(b.known)-Number(a.known))||a.distanceMeters-b.distanceMeters).slice(0,3).map(({name,distanceMeters,type})=>({name,distanceMeters,type}));}
  }catch(_){ }
  return json({ok:true,address,nearby,radiusMeters:3000});
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
async function sendContestMail(env,email,subject,text){if(!validEmail(email)||!env.BREVO_API_KEY||!env.BREVO_SENDER_EMAIL)return false;try{const r=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{accept:"application/json","content-type":"application/json","api-key":env.BREVO_API_KEY},body:JSON.stringify({sender:{name:"CarPlay Téléphone",email:String(env.BREVO_SENDER_EMAIL)},to:[{email}],subject,textContent:text,htmlContent:`<div style="font-family:Arial,sans-serif"><h2>🏆 Jeu concours CarPlay</h2><p>${String(text).replace(/\n/g,"<br>")}</p></div>`})});return r.ok}catch(_){return false}}

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
async function contestScoreSummary(env,subscriptionId){
  const events=(await env.DB.prepare("SELECT source_type,base_points,multiplier,awarded_points FROM contest_score_events WHERE subscription_id=?").bind(subscriptionId).all()).results||[];
  let bugPoints=0,bugEvents=0;for(const e of events){if(e.source_type==='bug'){bugEvents++;bugPoints+=Number(e.awarded_points||0)}}
  const markets=(await env.DB.prepare("SELECT points,base_points,breakdown_json FROM contest_market_points WHERE subscription_id=?").bind(subscriptionId).all()).results||[];
  let marketAwarded=0,marketBase=0,distanceBase=0;for(const r of markets){marketAwarded+=Number(r.points||0);marketBase+=Number(r.base_points||r.points||0);try{const a=JSON.parse(r.breakdown_json||'[]');for(const it of a)if(it&&it.key==='distance')distanceBase+=Number(it.points||0)}catch(_){}}
  const idea=await env.DB.prepare("SELECT COUNT(*) AS n FROM contest_reports WHERE subscription_id=? AND kind='idee' AND status='approved'").bind(subscriptionId).first();
  const p=await env.DB.prepare("SELECT points FROM contest_participants WHERE subscription_id=?").bind(subscriptionId).first();const total=Number(p&&p.points||0),known=marketAwarded+bugPoints;
  return {total,marketCount:markets.length,marketBasePoints:marketBase,marketInfoPoints:Math.max(0,marketBase-distanceBase),distancePoints:distanceBase,marketAwardedPoints:marketAwarded,bonusExtraPoints:Math.max(0,marketAwarded-marketBase),bugCount:bugEvents,bugPoints,ideaCount:Number(idea&&idea.n||0),otherPoints:Math.max(0,total-known)};
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
  for(const p of top.results||[]){rank++;const reward=rank<=2?"Abonnement à vie":"1 an d’abonnement gratuit";await env.DB.prepare("INSERT OR REPLACE INTO contest_results(rank,subscription_id,first_name,last_name,points,reward) VALUES(?,?,?,?,?,?)").bind(rank,p.subscription_id,p.first_name,p.last_name,p.points,reward).run();const sub=await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(p.subscription_id).first();if(sub){if(rank<=2)await env.DB.prepare("UPDATE subscriptions SET lifetime=1,expires_at=NULL,active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(sub.id).run();else if(!sub.lifetime){const base=Math.max(Date.now(),sub.expires_at?Date.parse(sub.expires_at):0),d=new Date(base);d.setFullYear(d.getFullYear()+1);await env.DB.prepare("UPDATE subscriptions SET expires_at=?,active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(d.toISOString(),sub.id).run()}const email=String(sub.recovery_email_mask||"");if(validEmail(email)&&!email.includes("***"))await sendContestMail(env,email,"Félicitations — vous êtes gagnant du concours CarPlay",`Félicitations ${p.first_name} ${p.last_name} !\nVous terminez n°${rank} du concours avec ${p.points} points.\nVotre gain : ${reward}.`)}}
  const finalizedAt=Date.now();await env.DB.prepare("UPDATE contest_config SET finalized_at=?,results_until=? WHERE id=1").bind(finalizedAt,finalizedAt+CONTEST_RESULTS_MS).run();return await env.DB.prepare("SELECT * FROM contest_config WHERE id=1").first();
}

async function contestStatus(request,env){
  const data=await body(request),cfg=await finalizeContestIfNeeded(env),sub=await contestSubscription(env,data),now=Date.now(),ended=now>=Number(cfg.end_at),resultsUntil=Number(cfg.results_until||((cfg.finalized_at||0)+CONTEST_RESULTS_MS)),resultsVisible=!!cfg.finalized_at&&ended&&now<resultsUntil,closed=ended&&!resultsVisible;let profile=null,participant=null,messages=[],questions=[],scoreSummary=null,bonusState=null,bonusProgress=null;
  let onboarding=null;
  if(sub){profile={firstName:String(sub.account_first_name||""),lastName:String(sub.account_last_name||""),email:String(sub.recovery_email_mask||"")};participant=await env.DB.prepare("SELECT subscription_id,first_name,last_name,home_country,home_area,home_commune,return_place_lat,return_place_lon,return_place_label,camping_active,camping_lat,camping_lon,camping_label,camping_updated_at,points,banned,alert_count,change_allowed,joined_at FROM contest_participants WHERE subscription_id=?").bind(sub.id).first();const installed=await registeredVerificationDevice(env,String(data.deviceId||""));if(participant){bonusState=await contestRefreshBonusState(env,sub.id);scoreSummary=await contestScoreSummary(env,sub.id);bonusProgress=contestBonusProgress(scoreSummary.marketCount);const ob=await env.DB.prepare("SELECT status,start_at,end_at FROM contest_bonus_periods WHERE subscription_id=? AND source_key='onboarding-home-place' LIMIT 1").bind(sub.id).first();onboarding={installed,identity:!!(String(sub.account_first_name||'').trim()&&String(sub.account_last_name||'').trim()&&String(sub.recovery_email_hash||'').trim()),returnPlaceSaved:!!String(participant.return_place_label||'').trim(),bonusWon:!!ob,bonusStatus:ob&&ob.status||''};const m=await env.DB.prepare("SELECT id,kind,message,created_at FROM contest_messages WHERE subscription_id=? AND read_at IS NULL ORDER BY created_at DESC LIMIT 8").bind(sub.id).all();messages=m.results||[];const q=await env.DB.prepare("SELECT id,new_place,previous_place,message,user_answer,status,created_at FROM contest_travel_alerts WHERE subscription_id=? AND status='pending' AND user_answer='' ORDER BY created_at DESC").bind(sub.id).all();questions=q.results||[]}}
  const ranking=await env.DB.prepare("SELECT first_name,last_name,points,joined_at FROM contest_participants WHERE banned=0 ORDER BY points DESC,joined_at ASC").all();const results=resultsVisible?(await env.DB.prepare("SELECT * FROM contest_results ORDER BY rank").all()).results||[]:[];
  return json({ok:true,active:!ended,ended,resultsVisible,closed,phase:!ended?"active":resultsVisible?"results":"closed",startAt:Number(cfg.start_at),endAt:Number(cfg.end_at),resultsUntil,appFreeUntil:Number(cfg.end_at)+CONTEST_APP_FREE_EXTRA_MS,daysRemaining:Math.max(0,Math.ceil((Number(cfg.end_at)-now)/86400000)),profile,participant,ranking:ranking.results||[],messages,questions,results,scoreSummary,bonusState,bonusProgress,onboarding});
}
async function contestCommunes(url){
  const country=String(url.searchParams.get("country")||"FR").toUpperCase(),area=String(url.searchParams.get("area")||"").trim(),q=String(url.searchParams.get("q")||"").trim();
  if(country==="FR"){if(!/^[0-9A-Z]{2,3}$/i.test(area))return json({ok:false,error:"DEPARTEMENT_INVALIDE"},400);try{const r=await fetch(`https://geo.api.gouv.fr/departements/${encodeURIComponent(area)}/communes?fields=nom,code,centre,codesPostaux&format=json&geometry=centre`,{headers:{accept:"application/json"}});if(!r.ok)throw 0;const a=await r.json();return json({ok:true,communes:(a||[]).map(c=>({name:c.nom,code:c.code,lat:c.centre&&c.centre.coordinates?Number(c.centre.coordinates[1]):null,lon:c.centre&&c.centre.coordinates?Number(c.centre.coordinates[0]):null})).filter(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lon)).sort((a,b)=>a.name.localeCompare(b.name,"fr"))})}catch(_){return json({ok:false,error:"COMMUNES_INDISPONIBLES"},503)}}
  if(country==="BE"){if(q.length<2)return json({ok:true,communes:[]});try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&country=Belgium&q=${encodeURIComponent(q+(area?", "+area:""))}&limit=12`,{headers:{"user-agent":"CarPlay-Contest/1.0"}});if(!r.ok)throw 0;const a=await r.json();return json({ok:true,communes:(a||[]).map(x=>({name:String(x.display_name||q).split(",")[0],code:"",lat:Number(x.lat),lon:Number(x.lon)})).filter(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lon))})}catch(_){return json({ok:false,error:"COMMUNES_INDISPONIBLES"},503)}}
  return json({ok:false,error:"PAYS_INVALIDE"},400);
}
async function contestRegister(request,env){
  const cfg=await ensureContestTables(env);if(Date.now()>=Number(cfg.end_at))return json({ok:false,error:"CONCOURS_TERMINE"},409);const data=await body(request),sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);
  const first=contestCleanName(sub.account_first_name||data.firstName),last=contestCleanName(sub.account_last_name||data.lastName),country=String(data.country||"FR").toUpperCase(),area=String(data.area||"").trim().slice(0,80),commune=String(data.commune||"").trim().slice(0,120),lat=Number(data.lat),lon=Number(data.lon);if(first.length<2||last.length<2)return json({ok:false,error:"NOM_ET_PRENOM_OBLIGATOIRES"},400);if(!area||!commune||!Number.isFinite(lat)||!Number.isFinite(lon))return json({ok:false,error:"COMMUNE_OBLIGATOIRE"},400);
  const old=await env.DB.prepare("SELECT * FROM contest_participants WHERE subscription_id=?").bind(sub.id).first();if(old&&!old.change_allowed)return json({ok:false,error:"COMMUNE_VERROUILLEE"},409);const emailHash=String(sub.recovery_email_hash||"");
  await env.DB.prepare("UPDATE subscriptions SET account_first_name=?,account_last_name=?,account_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(first,last,Date.now(),sub.id).run();
  if(old)await env.DB.prepare("UPDATE contest_participants SET device_id=?,first_name=?,last_name=?,home_country=?,home_area=?,home_commune=?,home_lat=?,home_lon=?,return_place_lat=NULL,return_place_lon=NULL,return_place_label='',camping_active=0,camping_lat=NULL,camping_lon=NULL,camping_label='',camping_updated_at=NULL,change_allowed=0,updated_at=? WHERE subscription_id=?").bind(String(data.deviceId||""),first,last,country,area,commune,lat,lon,Date.now(),sub.id).run();else await env.DB.prepare("INSERT INTO contest_participants(subscription_id,device_id,first_name,last_name,email_hash,home_country,home_area,home_commune,home_lat,home_lon,joined_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(sub.id,String(data.deviceId||""),first,last,emailHash,country,area,commune,lat,lon,Date.now(),Date.now()).run();
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
    element.append('<link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/mobile-overrides.css?v=62"><link rel="stylesheet" href="/subscription-locks.css?v=62"><link rel="stylesheet" href="/home-work.css?v=62"><script src="/weather-all-pages.js?v=68-notifications-globales" defer></script><script src="/subscription-web.js?v=202-reparation-acces" defer></script><script src="/home-work.js?v=62" defer></script><script src="/market-presence-global.js?v=176" defer></script><script src="/market-navigation-confirm-v189.js?v=189" defer></script><script src="/contest-v188.js?v=203-bienvenue" defer></script>', { html: true });
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
    if (url.pathname === "/api/presence" && (request.method === "GET" || request.method === "POST")) return presence(request, env);
    if (url.pathname === "/api/installations" && request.method === "POST") return installations(request, env);
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
    if (url.pathname === "/api/place-address" && request.method === "GET") return reversePlaceAddress(url);
    if (url.pathname === "/api/place-context" && request.method === "GET") return reversePlaceContext(url);
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
