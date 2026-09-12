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
  await ensureGpsUnlockTables(env); await ensureSubscriptionEmailColumns(env); await ensureMarketVerificationTables(env);
  const data=await body(request),marketKey=cleanMarketKey(data.marketKey),deviceId=String(data.deviceId||""),requesterEmail=normalizeEmail(data.requesterEmail);
  if(!marketKey||!validDevice(deviceId)||!(await registeredVerificationDevice(env,deviceId))) return json({ok:false,error:"DONNEES_INVALIDES"},400);
  const requesterName=String(data.requesterName||"").trim().replace(/\s+/g," ").slice(0,100);
  if(requesterName.split(" ").filter(Boolean).length<2)return json({ok:false,error:"NOM_ET_PRENOM_OBLIGATOIRES"},400);
  if(!validEmail(requesterEmail))return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);
  const sub=await env.DB.prepare("SELECT id,recovery_email_hash,expires_at,lifetime,active FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) LIMIT 1").bind(deviceId,deviceId).first();
  if(!sub)return json({ok:false,error:"COMPTE_ABONNEMENT_INTROUVABLE"},403);
  if(!sub.lifetime&&(!sub.expires_at||Date.parse(sub.expires_at)<=Date.now()))return json({ok:false,error:"ABONNEMENT_EXPIRE"},403);
  const emailHash=await sha256Text(requesterEmail);
  if(!sub.recovery_email_hash||String(sub.recovery_email_hash)!==emailHash)return json({ok:false,error:"EMAIL_NE_CORRESPOND_PAS"},403);
  const editableScopes=["gps","photo","time","count","draw","clientModel","welcome","placer"],scope=editableScopes.includes(data.scope)?data.scope:"gps",now=Date.now(),id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID(),tokenHash=await sha256Text(token);
  await env.DB.prepare("UPDATE gps_unlock_requests SET status='expired',updated_at=? WHERE device_id=? AND market_key=? AND scope=? AND status='pending'").bind(now,deviceId,marketKey,scope).run();
  const informationScope=["time","count","draw","clientModel","welcome","placer"].includes(scope),proposedValue=informationScope?String(data.proposedValue||'').slice(0,100):(scope==='gps'?'Correction du point GPS':scope==='photo'?'Remplacement de la photo':'');
  if(informationScope&&!normalizedVerification(scope,proposedValue))return json({ok:false,error:'VALEUR_INVALIDE'},400);
  let currentValue='';
  if(informationScope){const current=await env.DB.prepare("SELECT value_display FROM market_verification_consensus WHERE market_key=? AND field=? LIMIT 1").bind(marketKey,scope).first();currentValue=String(current&&current.value_display||'').slice(0,100);}
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
  if(approve&&["time","count","draw","clientModel","welcome","placer"].includes(row.scope)){const value=normalizedVerification(row.scope,row.proposed_value);if(!value)return json({ok:false,error:'VALEUR_INVALIDE'},400);await env.DB.prepare(`INSERT INTO market_verification_consensus(market_key,field,value_norm,value_display,confirmations,updated_at) VALUES(?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(market_key,field) DO UPDATE SET value_norm=excluded.value_norm,value_display=excluded.value_display,confirmations=1,updated_at=CURRENT_TIMESTAMP`).bind(row.market_key,row.scope,value.norm,value.display).run();await env.DB.prepare("UPDATE gps_unlock_requests SET status='completed',consumed=1,decided_at=?,updated_at=? WHERE id=?").bind(now,now,id).run();return json({ok:true,status:'completed'});}
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
function validDevice(value) { return /^[a-zA-Z0-9-]{16,80}$/.test(String(value || "")); }
function normalizeEmail(value){return String(value||"").trim().toLowerCase().slice(0,254)}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)}
async function ensureSubscriptionEmailColumns(env){
  try{await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN recovery_email_hash TEXT").run()}catch(_){}
  try{await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN recovery_email_mask TEXT").run()}catch(_){}
  try{await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN recovery_code_box TEXT").run()}catch(_){}
  try{await env.DB.prepare("ALTER TABLE subscriptions ADD COLUMN last_recovery_sent_at INTEGER").run()}catch(_){}
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

async function activate(request, env) {
  await ensureSubscriptionEmailColumns(env);
  const data = await body(request);
  const code = normalizeCode(data.code);
  const email=normalizeEmail(data.email);
  const emailProof=String(data.emailProof||"");
  const deviceId = String(data.deviceId || "");
  const type = data.deviceType === "autoradio" ? "autoradio" : "phone";
  if (!validEmail(email)) return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);
  if (!validCode(code) || !validDevice(deviceId)) return json({ ok: false, error: "DONNEES_INVALIDES" }, 400);
  const codeHash = await hashCode(code, env.CODE_PEPPER);
  const row = await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash = ? AND active = 1").bind(codeHash).first();
  if (!row) return json({ ok: false, error: "CODE_INCORRECT" }, 403);
  if (!row.lifetime && (!row.expires_at || Date.parse(row.expires_at) <= Date.now())) return json({ ok: false, error: "ABONNEMENT_EXPIRE" }, 403);
  const column = type === "autoradio" ? "autoradio_device" : "phone_device";
  const registered = row[column];
  const emailHash=await sha256Text(email),storedEmail=String(row.recovery_email_hash||"");
  if(storedEmail&&storedEmail!==emailHash&&registered&&registered!==deviceId)return json({ok:false,error:"EMAIL_NE_CORRESPOND_PAS"},403);
  const emailOwner=await env.DB.prepare("SELECT id FROM subscriptions WHERE recovery_email_hash=? AND id<>?").bind(emailHash,row.id).first();
  if(emailOwner)return json({ok:false,error:"EMAIL_DEJA_UTILISEE"},409);
  const recoveryCodeBox=await sealRecoveryCode(code,env);
  await env.DB.prepare(`UPDATE subscriptions SET recovery_email_hash=?,recovery_email_mask=?,recovery_code_box=?,${column}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(emailHash,email,recoveryCodeBox,deviceId,row.id).run();
  return json({ok:true,lifetime:!!row.lifetime,expiresAt:row.expires_at||null,deviceType:type,email});
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
  const owner=await env.DB.prepare("SELECT id FROM subscriptions WHERE recovery_email_hash=? AND id<>?").bind(challenge.email_hash,row.id).first();if(owner)return json({ok:false,error:"EMAIL_DEJA_UTILISEE"},409);
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
  return json({ ok: true, lifetime: !!row.lifetime, expiresAt: row.expires_at || null, deviceType: type });
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
  const result = await env.DB.prepare("SELECT country,area,kind,name,city,day,hours,address,merchants,draw,registration,note,latitude,longitude FROM imported_markets ORDER BY country,area,day,city,name").all();
  return json({ ok: true, markets: result.results || [] });
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
  if (field === "draw") {
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
    const allowed={gentil:"Gentil",correct:"Correct",diable:"Diable"},key=value.toLowerCase();
    return allowed[key]?{norm:key,display:allowed[key]}:null;
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

  for (const field of ["time", "count", "draw", "clientModel", "welcome", "placer"]) {
    const locked = await env.DB.prepare("SELECT field,value_display,confirmations,updated_at FROM market_verification_consensus WHERE market_key=? AND field=?").bind(marketKey,field).first();
    const mayReplaceTime=locked&&isAdminRequest;
    if (locked&&!mayReplaceTime) { results[field]={field,leadingValue:locked.value_display,confirmations:Number(locked.confirmations||1),confirmed:locked,locked:true}; continue; }
    const value = normalizedVerification(field, data.values && data.values[field]);
    if (!value) continue;
    if(mayReplaceTime){await env.DB.prepare(`INSERT INTO market_verification_consensus(market_key,field,value_norm,value_display,confirmations,updated_at) VALUES(?,?,?,?,1,CURRENT_TIMESTAMP)
      ON CONFLICT(market_key,field) DO UPDATE SET value_norm=excluded.value_norm,value_display=excluded.value_display,confirmations=1,updated_at=CURRENT_TIMESTAMP`).bind(marketKey,field,value.norm,value.display).run();results[field]={field,leadingValue:value.display,confirmations:1,confirmed:{field,value_display:value.display,confirmations:1},locked:true};if(grantRow&&grantRow.scope==='time')grantUsed=true;continue;}
    await env.DB.prepare(`INSERT INTO market_verification_votes(market_key,field,value_norm,value_display,device_id,ip_hash,created_at,updated_at)
      VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(market_key,field,device_id) DO UPDATE SET value_norm=excluded.value_norm,value_display=excluded.value_display,ip_hash=excluded.ip_hash,updated_at=CURRENT_TIMESTAMP`)
      .bind(marketKey, field, value.norm, value.display, deviceId, ipHash).run();
    results[field] = await refreshMarketConsensus(env, marketKey, field);
  }

  let photo = null, locationResult = await refreshMarketLocationConsensus(env,marketKey), locationVote=null;
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

class InjectAppFiles {
  element(element) {
    element.append('<link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/mobile-overrides.css?v=62"><link rel="stylesheet" href="/subscription-locks.css?v=62"><link rel="stylesheet" href="/home-work.css?v=62"><script src="/weather-all-pages.js?v=62" defer></script><script src="/subscription-web.js?v=62" defer></script><script src="/home-work.js?v=62" defer></script>', { html: true });
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
    if (url.pathname === "/api/market-photo" && request.method === "GET") return marketPhoto(url, env);
    if (url.pathname === "/api/vigilance" && request.method === "GET") return vigilanceForPlace(url);
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
