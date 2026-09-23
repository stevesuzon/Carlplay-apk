const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-mushroom-access"
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

  // V414 : compatibilité complète entre les deux systèmes admin.
  // 1) Session temporaire obtenue par confirmation e-mail.
  if (env.DB) {
    try {
      await ensureAdminAuthTables(env);
      const tokenHash = await sha256Text(supplied);
      const now = Date.now();
      const row = await env.DB.prepare("SELECT token_hash,expires_at FROM admin_sessions WHERE token_hash=? AND expires_at>? LIMIT 1").bind(tokenHash, now).first();
      if (row) {
        try { await env.DB.prepare("UPDATE admin_sessions SET last_seen_at=? WHERE token_hash=?").bind(now, tokenHash).run(); } catch(_) {}
        return true;
      }
    } catch(_) {}
  }

  // 2) Ancien panneau de génération de codes : secret administrateur historique.
  // On le conserve uniquement pour Steve afin que les anciens écrans encore en cache
  // continuent de fonctionner pendant la migration vers la connexion par e-mail.
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
// V294 : même canal push pour TOUTES les nouvelles demandes qui attendent Steve
// dans Administration > Demandes à valider. Une panne push ne doit jamais bloquer
// l'enregistrement de la demande elle-même.
async function notifyAdminPendingRequest(env) {
  try { await notifyAdminGpsRequest(env); } catch(_) {}
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
async function ensureMarketUpdateAnnouncements(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_update_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_key TEXT NOT NULL,
    market_name TEXT NOT NULL DEFAULT 'Marché',
    first_name TEXT NOT NULL DEFAULT 'Une personne',
    update_kind TEXT NOT NULL DEFAULT 'fiche',
    created_at INTEGER NOT NULL
  )`).run();
}
function marketUpdateFirstName(fullName) {
  const first=String(fullName||'').trim().replace(/\s+/g,' ').split(' ')[0]||'Une personne';
  return first.slice(0,50);
}
function marketUpdateKindLabel(scope) {
  return ({gps:'le point GPS',photo:'la photo',time:'les horaires',count:'le nombre de commerçants',draw:'le tirage au sort',clientModel:'le modèle de clients',welcome:'l’accueil du placier',placer:'le responsable',exists:'la présence du marché'})[scope]||'la fiche';
}
async function recordMarketUpdateAnnouncement(env,row,scope) {
  if(!row||!row.market_key)return;
  await ensureMarketUpdateAnnouncements(env);
  await env.DB.prepare("INSERT INTO market_update_announcements(market_key,market_name,first_name,update_kind,created_at) VALUES(?,?,?,?,?)")
    .bind(String(row.market_key).slice(0,180),String(row.market_name||'Marché').slice(0,150),marketUpdateFirstName(row.requester_name),marketUpdateKindLabel(scope||row.scope),Date.now()).run();
}
async function marketUpdateAnnouncements(url,env) {
  if(!env.DB)return json({ok:false,error:'DB_INDISPONIBLE'},503);
  await ensureMarketUpdateAnnouncements(env);
  const after=Math.max(0,Number(url.searchParams.get('after')||0));
  const rows=await env.DB.prepare("SELECT id,market_name,first_name,update_kind,created_at FROM market_update_announcements WHERE id>? ORDER BY id ASC LIMIT 20").bind(after).all();
  return json({ok:true,announcements:rows.results||[]});
}
async function requestGpsUnlock(request, env) {
  await ensureGpsUnlockTables(env); await ensureSubscriptionEmailColumns(env); await ensureMarketVerificationTables(env); await ensureInstallationsTable(env);
  const data=await body(request),marketKey=cleanMarketKey(data.marketKey),deviceId=String(data.deviceId||"").trim(),subscriptionCode=normalizeCode(data.subscriptionCode);
  if(!marketKey||!validDevice(deviceId)) return json({ok:false,error:"DONNEES_INVALIDES"},400);

  // Toujours enregistrer le téléphone avant la demande.
  const seen=Math.floor(Date.now()/1000);
  await env.DB.prepare(`INSERT INTO app_installations(device_id,platform,first_seen,last_seen) VALUES(?,?,?,?)
    ON CONFLICT(device_id) DO UPDATE SET last_seen=excluded.last_seen`).bind(deviceId,"market-change",seen,seen).run();

  // Retrouver le même compte : d'abord par appareil, puis par code, puis par
  // l'identité déjà enregistrée sur ce téléphone (utile après réinstallation).
  let sub=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC LIMIT 1").bind(deviceId,deviceId).first();
  if(!sub&&validCode(subscriptionCode)){
    const codeHash=await hashCode(subscriptionCode,env.CODE_PEPPER);
    const byCode=await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash=? AND active=1 LIMIT 1").bind(codeHash).first();
    if(byCode){
      if(!byCode.lifetime&&(!byCode.expires_at||Date.parse(byCode.expires_at)<=Date.now()))return json({ok:false,error:"ABONNEMENT_EXPIRE"},403);
      if(byCode.phone_device&&byCode.phone_device!==deviceId&&byCode.autoradio_device!==deviceId)return json({ok:false,error:"APPAREIL_REMPLACE"},409);
      if(!byCode.phone_device)await env.DB.prepare("UPDATE subscriptions SET phone_device=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(deviceId,byCode.id).run();
      sub=byCode;
    }
  }
  let appIdentity=null;
  if(!sub){
    try{
      await ensureAppIdentityTables(env);
      appIdentity=await env.DB.prepare("SELECT email,first_name,last_name FROM app_identities WHERE device_id=? ORDER BY updated_at DESC LIMIT 1").bind(deviceId).first();
      const aiEmail=normalizeEmail(appIdentity&&appIdentity.email||"");
      if(validEmail(aiEmail)){
        const candidate=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND lower(COALESCE(recovery_email_mask,''))=? ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC LIMIT 1").bind(aiEmail).first();
        if(candidate){
          const fn=String(appIdentity.first_name||"").trim(),ln=String(appIdentity.last_name||"").trim();
          const namesOk=(!candidate.account_first_name||!candidate.account_last_name)||(subscriptionIdentityKey(candidate.account_first_name)===subscriptionIdentityKey(fn)&&subscriptionIdentityKey(candidate.account_last_name)===subscriptionIdentityKey(ln));
          if(namesOk&& (candidate.lifetime||(candidate.expires_at&&Date.parse(candidate.expires_at)>Date.now()))){
            await env.DB.prepare("UPDATE subscriptions SET phone_device=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(deviceId,candidate.id).run();
            sub=candidate;
          }
        }
      }
    }catch(_){}
  }
  if(!sub)return json({ok:false,error:"COMPTE_ABONNEMENT_INTROUVABLE"},403);
  if(!sub.lifetime&&(!sub.expires_at||Date.parse(sub.expires_at)<=Date.now()))return json({ok:false,error:"ABONNEMENT_EXPIRE"},403);

  // V273 : accepte aussi les anciennes pages qui envoyaient firstName/lastName
  // sans requesterName/requesterEmail, afin que le correctif fonctionne même
  // avant le rafraîchissement du cache du téléphone.
  let requesterEmail=normalizeEmail(data.requesterEmail);
  if(!validEmail(requesterEmail)){
    const storedEmail=normalizeEmail(sub.recovery_email_mask);
    if(validEmail(storedEmail)&&!storedEmail.includes("***"))requesterEmail=storedEmail;
    else{
      if(!appIdentity)try{await ensureAppIdentityTables(env);appIdentity=await env.DB.prepare("SELECT email,first_name,last_name FROM app_identities WHERE device_id=? ORDER BY updated_at DESC LIMIT 1").bind(deviceId).first()}catch(_){}
      const aiEmail=normalizeEmail(appIdentity&&appIdentity.email||"");if(validEmail(aiEmail))requesterEmail=aiEmail;
    }
  }
  let requesterName=String(data.requesterName||"").trim().replace(/\s+/g," ").slice(0,100);
  if(requesterName.split(" ").filter(Boolean).length<2){
    requesterName=[String(data.firstName||"").trim(),String(data.lastName||"").trim()].filter(Boolean).join(" ").replace(/\s+/g," ").slice(0,100);
  }
  if(requesterName.split(" ").filter(Boolean).length<2){
    requesterName=[String(sub.account_first_name||"").trim(),String(sub.account_last_name||"").trim()].filter(Boolean).join(" ").replace(/\s+/g," ").slice(0,100);
  }
  if(requesterName.split(" ").filter(Boolean).length<2&&appIdentity){
    requesterName=[String(appIdentity.first_name||"").trim(),String(appIdentity.last_name||"").trim()].filter(Boolean).join(" ").replace(/\s+/g," ").slice(0,100);
  }
  if(requesterName.split(" ").filter(Boolean).length<2)return json({ok:false,error:"NOM_ET_PRENOM_OBLIGATOIRES"},400);
  if(!validEmail(requesterEmail))return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);

  const emailHash=await sha256Text(requesterEmail);
  if(!sub.recovery_email_hash){
    const owner=await activeEmailOwner(env,emailHash,sub.id);
    if(owner)return json({ok:false,error:"EMAIL_DEJA_UTILISEE_AUTRE_TELEPHONE"},409);
    await env.DB.prepare("UPDATE subscriptions SET recovery_email_hash=?,recovery_email_mask=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(emailHash,requesterEmail,sub.id).run();
  }else if(String(sub.recovery_email_hash)!==emailHash){
    const legacyEmail=normalizeEmail(sub.recovery_email_mask);
    // Les comptes d'essai utilisent une empreinte spéciale, mais gardent l'e-mail
    // lisible dans recovery_email_mask : si cet e-mail correspond, la demande reste valide.
    if(legacyEmail&&legacyEmail===requesterEmail){
      if(!String(sub.recovery_email_hash).startsWith("contest-trial-email:")){
        // On ne remplace pas arbitrairement l'empreinte d'un autre compte.
        // Le champ lisible correspondant suffit pour authentifier cette demande.
      }
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

  // La notification push ne doit jamais faire échouer la demande si le service push
  // est indisponible ou mal configuré.
  await notifyAdminPendingRequest(env)
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
  const data=await body(request),id=String(data.id||""),approve=data.approve===true,row=await env.DB.prepare("SELECT status,request_expires_at,scope,market_key,market_name,requester_name,proposed_value FROM gps_unlock_requests WHERE id=?").bind(id).first();
  if(!row||row.status!=="pending"||now>Number(row.request_expires_at)) return json({ok:false,error:"DEMANDE_EXPIREE"},409);
  if(approve&&row.scope==='exists'){const value=normalizedVerification('exists',row.proposed_value);if(!value)return json({ok:false,error:'VALEUR_INVALIDE'},400);await env.DB.prepare(`INSERT INTO market_verification_consensus(market_key,field,value_norm,value_display,confirmations,updated_at) VALUES(?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(market_key,field) DO UPDATE SET value_norm=excluded.value_norm,value_display=excluded.value_display,confirmations=1,updated_at=CURRENT_TIMESTAMP`).bind(row.market_key,'exists',value.norm,value.display).run();await env.DB.prepare("UPDATE gps_unlock_requests SET status='completed',consumed=1,decided_at=?,updated_at=? WHERE id=?").bind(now,now,id).run();await recordMarketUpdateAnnouncement(env,row,row.scope);return json({ok:true,status:'completed',marketExists:value.display==='Oui'});}
  if(approve&&["time","count","draw","clientModel","welcome","placer"].includes(row.scope)){const value=normalizedVerification(row.scope,row.proposed_value);if(!value)return json({ok:false,error:'VALEUR_INVALIDE'},400);await env.DB.prepare(`INSERT INTO market_verification_consensus(market_key,field,value_norm,value_display,confirmations,updated_at) VALUES(?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(market_key,field) DO UPDATE SET value_norm=excluded.value_norm,value_display=excluded.value_display,confirmations=1,updated_at=CURRENT_TIMESTAMP`).bind(row.market_key,row.scope,value.norm,value.display).run();await env.DB.prepare(`INSERT INTO market_verification_consensus(market_key,field,value_norm,value_display,confirmations,updated_at) VALUES(?,'exists','oui','Oui',1,CURRENT_TIMESTAMP) ON CONFLICT(market_key,field) DO UPDATE SET value_norm='oui',value_display='Oui',confirmations=1,updated_at=CURRENT_TIMESTAMP`).bind(row.market_key).run();await env.DB.prepare("UPDATE gps_unlock_requests SET status='completed',consumed=1,decided_at=?,updated_at=? WHERE id=?").bind(now,now,id).run();await recordMarketUpdateAnnouncement(env,row,row.scope);return json({ok:true,status:'completed'});}
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
let _subscriptionEmailSchemaPromise=null;
async function ensureSubscriptionEmailColumns(env){
  if(_subscriptionEmailSchemaPromise)return _subscriptionEmailSchemaPromise;
  _subscriptionEmailSchemaPromise=(async()=>{
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
    for(const sql of [
      "CREATE INDEX IF NOT EXISTS idx_subscriptions_active_phone ON subscriptions(active,phone_device)",
      "CREATE INDEX IF NOT EXISTS idx_subscriptions_active_autoradio ON subscriptions(active,autoradio_device)",
      "CREATE INDEX IF NOT EXISTS idx_subscriptions_active_code ON subscriptions(active,code_hash)",
      "CREATE INDEX IF NOT EXISTS idx_subscriptions_active_recovery_hash ON subscriptions(active,recovery_email_hash)",
      "CREATE INDEX IF NOT EXISTS idx_subscriptions_recovery_mask_ci ON subscriptions(lower(COALESCE(recovery_email_mask,'')))"
    ])try{await env.DB.prepare(sql).run()}catch(_){}
  })().catch(e=>{_subscriptionEmailSchemaPromise=null;throw e});
  return _subscriptionEmailSchemaPromise;
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

async function verifiedIdentityCanReplaceSubscriptionDevice(env,deviceId,row,email,firstName,lastName){
  try{
    if(!validDevice(deviceId)||!row||!validEmail(email))return false;
    await ensureAppIdentityTables(env);
    const ai=await env.DB.prepare("SELECT email,first_name,last_name,email_verified_at FROM app_identities WHERE device_id=? AND lower(email)=? AND email_verified_at>0 ORDER BY updated_at DESC LIMIT 1")
      .bind(deviceId,normalizeEmail(email)).first();
    if(!ai)return false;
    const aiFirst=String(ai.first_name||"").trim(),aiLast=String(ai.last_name||"").trim();
    const rowFirst=String(row.account_first_name||firstName||"").trim(),rowLast=String(row.account_last_name||lastName||"").trim();
    if(rowFirst&&rowLast&&(subscriptionIdentityKey(rowFirst)!==subscriptionIdentityKey(aiFirst)||subscriptionIdentityKey(rowLast)!==subscriptionIdentityKey(aiLast)))return false;
    const stored=normalizeEmail(row.recovery_email_mask||"");
    if(validEmail(stored)&&!stored.includes("***")&&stored!==normalizeEmail(email))return false;
    return true;
  }catch(_){return false}
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

  // V414 : un code neuf n'appartient à aucun compte avant sa première activation.
  // On cherche d'abord le compte par e-mail validé, jamais par l'ancien téléphone.
  // Ainsi un ancien compte resté sur le même appareil ne provoque plus
  // "EMAIL_NE_CORRESPOND_PAS" pour un nouveau code.
  if (freshCode) {
    const account = await env.DB.prepare(
      `SELECT * FROM subscriptions
       WHERE id<>? AND (recovery_email_hash=? OR lower(COALESCE(recovery_email_mask,''))=?)
       ORDER BY CASE WHEN recovery_email_hash=? THEN 0 ELSE 1 END,
                CASE WHEN active=1 THEN 0 ELSE 1 END,
                COALESCE(account_updated_at,0) DESC, id DESC
       LIMIT 1`
    ).bind(row.id,emailHash,email,emailHash).first();

    if (account) {
      const storedEmail = String(account.recovery_email_hash || "");
      const storedVisibleEmail = normalizeEmail(account.recovery_email_mask || "");
      const storedFirst = String(account.account_first_name || "");
      const storedLast = String(account.account_last_name || "");
      const sameVisibleEmail = storedVisibleEmail === email;

      // Les anciens comptes d'essai utilisent parfois une empreinte spéciale.
      // L'e-mail lisible validé reste alors la référence pour rattacher la recharge.
      if (storedEmail && storedEmail !== emailHash && !sameVisibleEmail) {
        return json({ok:false,error:"EMAIL_NE_CORRESPOND_PAS"},403);
      }
      if (storedFirst && storedLast &&
          (subscriptionIdentityKey(storedFirst)!==subscriptionIdentityKey(firstName) ||
           subscriptionIdentityKey(storedLast)!==subscriptionIdentityKey(lastName))) {
        return json({ok:false,error:"IDENTITE_NE_CORRESPOND_PAS"},403);
      }
      if (Number(account.lifetime)) return json({ok:false,error:"ABONNEMENT_DEJA_A_VIE"},409);

      const recoveryCodeBox = await sealRecoveryCode(code,env);
      const oldEnd = account.expires_at ? Date.parse(account.expires_at) : 0;
      const base = Number.isFinite(oldEnd) && oldEnd > now ? oldEnd : now;
      const becomesLifetime = Number(row.lifetime) === 1;
      const newExpires = becomesLifetime ? null : new Date(base + durationDays * 86400000).toISOString();

      // Le nouveau code devient le code actuel du même compte.
      // Les jours restants sont conservés puis la nouvelle durée est ajoutée.
      // Si ce téléphone était encore rattaché à un autre compte, on libère seulement
      // son emplacement téléphone/autoradio ; l'ancien compte reste intact sur le serveur.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM subscriptions WHERE id=?").bind(row.id),
        env.DB.prepare(`UPDATE subscriptions SET ${column}=NULL,updated_at=CURRENT_TIMESTAMP WHERE id<>? AND ${column}=?`).bind(account.id,deviceId),
        env.DB.prepare(`UPDATE subscriptions SET code_hash=?,recovery_code_box=?,expires_at=?,lifetime=?,active=1,
          recovery_email_hash=?,recovery_email_mask=?,account_first_name=?,account_last_name=?,account_updated_at=?,
          duration_days=?,redeemed_at=?,${column}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(codeHash,recoveryCodeBox,newExpires,becomesLifetime?1:0,emailHash,email,firstName,lastName,now,durationDays,now,deviceId,account.id)
      ]);

      const info = subscriptionRemainingInfo({lifetime:becomesLifetime?1:0,expires_at:newExpires},now);
      return json({ok:true,lifetime:becomesLifetime,expiresAt:newExpires,deviceType:type,email,firstName,lastName,renewed:true,addedDays:becomesLifetime?null:durationDays,remainingDays:info.remainingDays});
    }

    // Aucun compte existant avec cet e-mail : première activation réelle du code.
    // Le code se lie à cette adresse e-mail validée et devient son abonnement.
    const owner = await activeEmailOwner(env,emailHash,row.id);
    if (owner) return json({ok:false,error:"EMAIL_DEJA_UTILISEE"},409);
    const recoveryCodeBox = await sealRecoveryCode(code,env);
    const becomesLifetime = Number(row.lifetime) === 1;
    const expiresAt = becomesLifetime ? null : new Date(now + durationDays * 86400000).toISOString();

    await env.DB.batch([
      env.DB.prepare(`UPDATE subscriptions SET ${column}=NULL,updated_at=CURRENT_TIMESTAMP WHERE id<>? AND ${column}=?`).bind(row.id,deviceId),
      env.DB.prepare(`UPDATE subscriptions SET expires_at=?,recovery_email_hash=?,recovery_email_mask=?,recovery_code_box=?,
        account_first_name=?,account_last_name=?,account_updated_at=?,duration_days=?,redeemed_at=?,${column}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(expiresAt,emailHash,email,recoveryCodeBox,firstName,lastName,now,durationDays,now,deviceId,row.id)
    ]);
    const info = subscriptionRemainingInfo({lifetime:becomesLifetime?1:0,expires_at:expiresAt},now);
    return json({ok:true,lifetime:becomesLifetime,expiresAt,deviceType:type,email,firstName,lastName,renewed:false,addedDays:becomesLifetime?null:durationDays,remainingDays:info.remainingDays});
  }

  // Code déjà rattaché à un compte : connexion/récupération normale, sans ajouter
  // une seconde fois les 365 jours.
  // Un abonnement accepte un seul téléphone et un seul autoradio. Le même code
  // ne peut pas remplacer silencieusement l'un de ces deux appareils.
  const occupiedDevice = type === "autoradio" ? String(row.autoradio_device || "") : String(row.phone_device || "");
  // V380 : si ce code appartient bien au même compte, le nouvel appareil remplace
  // automatiquement l'ancien appareil du même type après contrôle e-mail + nom + prénom.
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
  const occupiedDevice=String(row[column]||"");
  if(occupiedDevice&&occupiedDevice!==deviceId)return json({ok:false,error:"APPAREIL_DEJA_UTILISE"},409);
  await env.DB.batch([env.DB.prepare(`UPDATE subscriptions SET recovery_email_hash=?,recovery_email_mask=?,${column}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(challenge.email_hash,emailMask(challenge.email),deviceId,row.id),env.DB.prepare("UPDATE subscription_email_challenges SET consumed=1 WHERE id=?").bind(challengeId)]);
  return json({ok:true,lifetime:!!row.lifetime,expiresAt:row.expires_at||null,deviceType:challenge.device_type,email:challenge.email});
}

async function subscriptionProfileV156(request,env){
  await ensureSubscriptionEmailColumns(env);
  const data=await body(request),deviceId=String(data.deviceId||"").trim(),code=normalizeCode(data.subscriptionCode||data.code||"");
  if(!validDevice(deviceId))return json({ok:false,error:"DONNEES_INVALIDES"},400);
  let row=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC LIMIT 1").bind(deviceId,deviceId).first();
  if(!row&&validCode(code)){
    const h=await hashCode(code,env.CODE_PEPPER);
    row=await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash=? AND active=1 LIMIT 1").bind(h).first();
    if(row&&row.phone_device&&row.phone_device!==deviceId&&row.autoradio_device!==deviceId)return json({ok:false,error:"APPAREIL_REMPLACE"},409);
    if(row&&!row.phone_device)await env.DB.prepare("UPDATE subscriptions SET phone_device=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(deviceId,row.id).run();
  }
  let ai=null;
  if(!row){
    try{
      await ensureAppIdentityTables(env);
      ai=await env.DB.prepare("SELECT email,first_name,last_name FROM app_identities WHERE device_id=? ORDER BY updated_at DESC LIMIT 1").bind(deviceId).first();
      const e=normalizeEmail(ai&&ai.email||"");
      if(validEmail(e)){
        const candidate=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND lower(COALESCE(recovery_email_mask,''))=? ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC LIMIT 1").bind(e).first();
        if(candidate){
          const namesOk=(!candidate.account_first_name||!candidate.account_last_name)||(subscriptionIdentityKey(candidate.account_first_name)===subscriptionIdentityKey(ai.first_name)&&subscriptionIdentityKey(candidate.account_last_name)===subscriptionIdentityKey(ai.last_name));
          if(namesOk){await env.DB.prepare("UPDATE subscriptions SET phone_device=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(deviceId,candidate.id).run();row=candidate}
        }
      }
    }catch(_){}
  }
  if(!row)return json({ok:false,error:"COMPTE_ABONNEMENT_INTROUVABLE"},403);
  if(!row.lifetime&&(!row.expires_at||Date.parse(row.expires_at)<=Date.now()))return json({ok:false,error:"ABONNEMENT_EXPIRE"},403);
  const storedEmail=normalizeEmail(row.recovery_email_mask),email=validEmail(storedEmail)&&!storedEmail.includes("***")?storedEmail:normalizeEmail(ai&&ai.email||"");
  return json({ok:true,email,firstName:String(row.account_first_name||ai&&ai.first_name||""),lastName:String(row.account_last_name||ai&&ai.last_name||""),lifetime:!!row.lifetime,expiresAt:row.expires_at||null});
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
  if (String(data.kind||'subscription') === 'mushroom') return createMushroomAdminCode(env,data);
  let code = normalizeCode(data.code);
  if (data.generate === true) {
    for(let i=0;i<30;i++){
      const candidate=randomSubscriptionCode(),h=await hashCode(candidate,env.CODE_PEPPER),exists=await env.DB.prepare("SELECT id FROM subscriptions WHERE code_hash=? LIMIT 1").bind(h).first();
      if(!exists){code=candidate;break}
    }
  }
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
  try{await env.DB.prepare("CREATE INDEX IF NOT EXISTS app_presence_last_seen_idx ON app_presence(last_seen)").run()}catch(_){}
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

async function ensureHomeInstallationsV360(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_home_installations (
    device_id TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL
  )`).run();
}

// Base manuelle demandée par le propriétaire ; ce n'est pas un total historique mesuré.
// Initialisée une seule fois en D1, avant l'enregistrement des nouveaux visiteurs.
async function ensureVisitorBaselineV362(env) {
  await ensureInstallationsTable(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_visitor_counter_baseline (
    id INTEGER PRIMARY KEY CHECK(id=1), base_total INTEGER NOT NULL,
    initial_count INTEGER NOT NULL, created_at INTEGER NOT NULL
  )`).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO app_visitor_counter_baseline(id,base_total,initial_count,created_at)
    SELECT 1,475,COUNT(*),? FROM app_installations WHERE length(trim(device_id))>0`)
    .bind(Math.floor(Date.now()/1000)).run();
}

async function visitorDisplayTotalV362(env) {
  await ensureVisitorBaselineV362(env);
  const row = await env.DB.prepare(`SELECT b.base_total + MAX(0,
    (SELECT COUNT(*) FROM app_installations WHERE length(trim(device_id))>0)-b.initial_count) AS total
    FROM app_visitor_counter_baseline b WHERE b.id=1`).first();
  return Number(row.total);
}

async function installations(request, env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE", count: 0 }, 503);
  await ensureInstallationsTable(env);
  if (request.method === "POST") {
    const data = await body(request);
    const deviceId = String(data.deviceId || "").trim().slice(0, 100);
    const platform = String(data.platform || "unknown").slice(0, 32);
    if (!deviceId) return json({ ok: false, error: "APPAREIL_INVALIDE" }, 400);
    await ensureVisitorBaselineV362(env);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(`INSERT INTO app_installations(device_id,platform,first_seen,last_seen)
      VALUES(?,?,?,?)
      ON CONFLICT(device_id) DO UPDATE SET platform=excluded.platform,last_seen=excluded.last_seen`)
      .bind(deviceId, platform, now, now).run();
    if (data.homeScreen === true) {
      await ensureHomeInstallationsV360(env);
      await env.DB.prepare(`INSERT INTO app_home_installations(device_id,first_seen,last_seen)
        VALUES(?,?,?) ON CONFLICT(device_id) DO UPDATE SET last_seen=excluded.last_seen`)
        .bind(deviceId,now,now).run();
    }
    return json({ ok: true });
  }
  return json({ ok: false, error: "METHODE_INVALIDE" }, 405);
}

async function uniqueAppUserCount(env) {
  // V305 : les nouveaux comptes ne sont comptés qu'après confirmation e-mail.
  // Les comptes déjà enregistrés avant cette fonction sont conservés automatiquement comme comptes historiques.
  try{
    await ensureAppIdentityTables(env);
    const row=await env.DB.prepare(`SELECT COUNT(DISTINCT lower(trim(email))) AS count FROM app_identities
      WHERE email_verified_at>0
        AND length(trim(first_name))>=2 AND length(trim(last_name))>=2
        AND instr(trim(email),'@')>1 AND instr(substr(trim(email),instr(trim(email),'@')+1),'.')>1`).first();
    return Number(row&&row.count||0);
  }catch(_){return 0}
}

// V361 : total historique des appareils/navigateurs, avec ou sans compte.
// Un retour sur le site conserve le même device_id et ne fait pas monter le total.
async function visitorCountV361(env, start, end) {
  await ensureInstallationsTable(env);
  let query = env.DB.prepare(`SELECT COUNT(*) AS count FROM app_installations
    WHERE length(trim(device_id))>0${start == null ? '' : ' AND first_seen>=? AND first_seen<?'}`);
  if (start != null) query = query.bind(start, end);
  const row = await query.first();
  return Number(row && row.count || 0);
}

async function publicUserStats(env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE", total: 0, new15Days: 0, show15DayGrowth: false }, 503);
  const total = await visitorDisplayTotalV362(env);
  const now = Math.floor(Date.now() / 1000);
  const interval = 15 * 24 * 60 * 60;
  const visibleFor = 2 * 24 * 60 * 60;
  // Point de départ V285 : 16 septembre 2026 à 14 h en France (12 h UTC).
  const anchor = 1789560000;
  const elapsed = now - anchor;
  let new15Days = 0, show15DayGrowth = false, periodStart = 0, periodEnd = 0;
  if (elapsed >= interval) {
    const cycle = Math.floor(elapsed / interval);
    periodEnd = anchor + cycle * interval;
    periodStart = periodEnd - interval;
    show15DayGrowth = (now - periodEnd) < visibleFor;
    if (show15DayGrowth) {
      new15Days = await visitorCountV361(env, periodStart, periodEnd);
    }
  }
  return json({ ok: true, total, new15Days, show15DayGrowth, periodStart, periodEnd });
}

async function adminInstallations(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ ok: false, error: "SECRET_INCORRECT" }, 401);
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE", count: 0 }, 503);
  await ensureHomeInstallationsV360(env);
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM app_home_installations
    WHERE length(trim(device_id))>0`).first();
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
    phone TEXT NOT NULL DEFAULT '',
    date_label TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL DEFAULT '',
    end_date TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    latitude REAL,
    longitude REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  try { await env.DB.prepare("ALTER TABLE imported_markets ADD COLUMN latitude REAL").run(); } catch (_) {}
  try { await env.DB.prepare("ALTER TABLE imported_markets ADD COLUMN longitude REAL").run(); } catch (_) {}
  try { await env.DB.prepare("ALTER TABLE imported_markets ADD COLUMN registration TEXT NOT NULL DEFAULT ''").run(); } catch (_) {}
  try { await env.DB.prepare("ALTER TABLE imported_markets ADD COLUMN phone TEXT NOT NULL DEFAULT ''").run(); } catch (_) {}
  try { await env.DB.prepare("ALTER TABLE imported_markets ADD COLUMN date_label TEXT NOT NULL DEFAULT ''").run(); } catch (_) {}
  try { await env.DB.prepare("ALTER TABLE imported_markets ADD COLUMN start_date TEXT NOT NULL DEFAULT ''").run(); } catch (_) {}
  try { await env.DB.prepare("ALTER TABLE imported_markets ADD COLUMN end_date TEXT NOT NULL DEFAULT ''").run(); } catch (_) {}
  try { await env.DB.prepare("ALTER TABLE imported_markets ADD COLUMN source_url TEXT NOT NULL DEFAULT ''").run(); } catch (_) {}
  try { await env.DB.prepare("ALTER TABLE imported_markets ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP").run(); } catch (_) {}
}

function cleanMarket(value, max = 240) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeMarket(input) {
  const country = cleanMarket(input.country || input.pays, 2).toUpperCase() === "BE" ? "BE" : "FR";
  const area = cleanMarket(input.area || input.department || input.departement || input.province, 80).toUpperCase();
  const rawKind = cleanMarket(input.kind || input.type, 80).toLowerCase();
  const kind = /voyageur|traveller|forain/.test(rawKind) ? "voyageur" : /no[eë]l|christmas|kerst/.test(rawKind) ? "noel" : /brocante|vide[ -]?grenier|foire|braderie|puces|rederie|r[eé]derie/.test(rawKind) ? "brocante" : "marche";
  const name = cleanMarket(input.name || input.nom);
  const city = cleanMarket(input.city || input.ville || input.commune, 120);
  const dateLabel = cleanMarket(input.dateLabel || input.date_label || input.date || input.day || input.jour, 120);
  const day = cleanMarket(input.day || input.jour || input.dateLabel || input.date_label || input.date, 120).toLowerCase();
  const hours = cleanMarket(input.hours || input.horaires, 80);
  const address = cleanMarket(input.address || input.adresse, 240);
  const merchants = cleanMarket(input.merchants || input.commercants || input.nombre_commercants || input.exposants || input.emplacements || input.stands || input.chalets || input.capacity || input.capacite, 60);
  const draw = cleanMarket(input.draw || input.tirage || input.tirage_au_sort, 30);
  const registration = cleanMarket(input.registration || input.inscription || input.organizer || input.organisateur, 160);
  const note = cleanMarket(input.note || input.remarques, 500);
  const phone = cleanMarket(input.phone || input.telephone || input.tel, 40);
  const startDate = cleanMarket(input.start || input.start_date || input.date_debut, 20);
  const endDate = cleanMarket(input.end || input.end_date || input.date_fin || startDate, 20);
  const sourceUrl = cleanMarket(input.sourceUrl || input.source_url || input.url || input.source, 500);
  const latitude = Number(input.latitude != null ? input.latitude : input.lat);
  const longitude = Number(input.longitude != null ? input.longitude : (input.lng != null ? input.lng : input.lon));
  if (!area || !name || !day) return null;
  const fingerprint = [country, area, kind, name, city, day].join("|").toLowerCase();
  return { fingerprint, country, area, kind, name, city, day, hours, address, merchants, draw, registration, note, phone, dateLabel, startDate, endDate, sourceUrl,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null };
}

async function listMarkets(env) {
  await ensureMarketTable(env);
  await ensureMarketVerificationTables(env);
  const result = await env.DB.prepare("SELECT country,area,kind,name,city,day,hours,address,merchants,draw,registration,note,phone,date_label,start_date,end_date,source_url,latitude,longitude,updated_at FROM imported_markets ORDER BY country,area,day,city,name").all();
  const removed = await env.DB.prepare("SELECT market_key FROM market_verification_consensus WHERE field='exists' AND lower(value_norm)='non'").all();
  const disabled = new Set((removed.results || []).map(r => String(r.market_key || '')));
  const markets = (result.results || []).filter(m => {
    const key = [String(m.country || '').toLowerCase(),m.area,m.name,m.city,m.day,m.address || ''].join('|');
    return !disabled.has(key) && !storedMarketExpired(m);
  });
  const latest = (result.results || []).reduce((m,r) => String(r.updated_at || '') > m ? String(r.updated_at || '') : m, '');
  return json({ ok: true, markets, updatedAt: latest || null, serverTime: Date.now() });
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
      (fingerprint,country,area,kind,name,city,day,hours,address,merchants,draw,registration,note,phone,date_label,start_date,end_date,source_url,latitude,longitude,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(fingerprint) DO UPDATE SET country=excluded.country,area=excluded.area,kind=excluded.kind,name=excluded.name,city=excluded.city,day=excluded.day,hours=excluded.hours,address=excluded.address,merchants=excluded.merchants,draw=excluded.draw,registration=excluded.registration,note=excluded.note,phone=excluded.phone,date_label=excluded.date_label,start_date=excluded.start_date,end_date=excluded.end_date,source_url=excluded.source_url,latitude=excluded.latitude,longitude=excluded.longitude,updated_at=CURRENT_TIMESTAMP`).bind(m.fingerprint,m.country,m.area,m.kind,m.name,m.city,m.day,m.hours,m.address,m.merchants,m.draw,m.registration,m.note,m.phone,m.dateLabel,m.startDate,m.endDate,m.sourceUrl,m.latitude,m.longitude).run();
    if (existing) updated++; else added++;
  }
  return json({ ok: true, added, updated, duplicates, invalid, total: source.length });
}


// V318 — Mise à jour progressive des marchés : une seule zone/catégorie par passage.
// Les événements terminés rendent leur zone prioritaire. Le téléphone ne scrute jamais le Web :
// le Worker met D1 à jour en arrière-plan puis /api/markets diffuse uniquement la base légère.
const MARKET_REFRESH_FR_AREAS = ["01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16","17","18","19","2A","2B","21","22","23","24","25","26","27","28","29","30","31","32","33","34","35","36","37","38","39","40","41","42","43","44","45","46","47","48","49","50","51","52","53","54","55","56","57","58","59","60","61","62","63","64","65","66","67","68","69","70","71","72","73","74","75","76","77","78","79","80","81","82","83","84","85","86","87","88","89","90","91","92","93","94","95","971","972","973","974","976"];
const MARKET_REFRESH_BE_AREAS = ["bruxelles","anvers","limbourg","flandre-occidentale","flandre-orientale","brabant-flamand","brabant-wallon","hainaut","liege","luxembourg","namur"];
const MARKET_REFRESH_EVENT_KINDS = new Set(["brocante","noel","voyageur"]);

function marketTodayIso(){return new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)}
function marketIsoDate(v){
  const x=String(v||'').trim(); if(/^\d{4}-\d{2}-\d{2}$/.test(x))return x;
  const months={janvier:1,fevrier:2,"février":2,mars:3,avril:4,mai:5,juin:6,juillet:7,aout:8,"août":8,septembre:9,octobre:10,novembre:11,decembre:12,"décembre":12,januari:1,februari:2,maart:3,april:4,mei:5,juni:6,juli:7,augustus:8,oktober:10,november:11,december:12};
  const all=[...x.matchAll(/(\d{1,2})\s+(janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre|januari|februari|maart|april|mei|juni|juli|augustus|oktober|december)\s+(20\d{2})/gi)];
  if(all.length){const m=all[all.length-1],mo=months[m[2].toLowerCase()]||0;return mo?`${m[3]}-${String(mo).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`:''}
  const nums=[...x.matchAll(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/g)];
  if(nums.length){const m=nums[nums.length-1];return `${m[3]}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`}
  return '';
}
function storedMarketExpired(m){const k=String(m&&m.kind||'').toLowerCase();if(!MARKET_REFRESH_EVENT_KINDS.has(k)&&k!=='brocante')return false;const e=marketIsoDate(m.end_date||m.date_label||m.day);return !!e&&e<marketTodayIso()}
function marketPlainText(html){return String(html||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(?:h1|h2|h3|h4|p|li|div|article|section)>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&eacute;/gi,'é').replace(/&Eacute;/g,'É').replace(/&agrave;/gi,'à').replace(/&egrave;/gi,'è').replace(/&ecirc;/gi,'ê').replace(/&ocirc;/gi,'ô').replace(/&ucirc;/gi,'û').replace(/&ccedil;/gi,'ç').replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim()}
function marketPhoneFromText(t,country){const re=country==='BE'?/(?:\+32|0)[\s.\-\/]*(?:\d[\s.\-\/]*){8,9}/:/(?:\+33|0)[\s.\-\/]*(?:\d[\s.\-\/]*){9}/;const m=String(t||'').match(re);return m?String(m[0]).replace(/[^0-9+]/g,'').slice(0,20):''}
function marketCapacityFromText(t){
  const raw=String(t||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ');
  let m;
  // Prefer an exact number of physical pitches/stands/chalets when the source publishes one.
  m=raw.match(/\b(?:environ\s+|env\.?\s+|pr[eè]s de\s+)?(\d{1,4})\s+(emplacements?|stands?|chalets?)\b(?!\s+par\s+exposant)/i);
  if(m){const n=m[1],u=m[2].toLowerCase();return n+' '+(u.startsWith('chalet')?'chalets':u.startsWith('stand')?'stands':'emplacements')}
  // Then use a published exact exhibitor/merchant count.
  m=raw.match(/\b(?:environ\s+|env\.?\s+|pr[eè]s de\s+)?(\d{1,4})\s+(exposants?|commer[cç]ants?)\b/i);
  if(m)return m[1]+' '+(/commer/i.test(m[2])?'commerçants':'exposants');
  // Brocabrac and similar agendas often publish a range such as “Exposants De 50 à 100”.
  m=raw.match(/\bexposants?\s*[:\-]?\s*(?:de\s+)?(\d{1,4})\s*(?:à|a|-)\s*(\d{1,4})\b/i);
  if(m)return m[1]+' à '+m[2]+' exposants';
  m=raw.match(/\bexposants?\s*[:\-]?\s*(moins de|plus de)\s*(\d{1,4})\b/i);
  if(m)return m[1].replace(/^./,c=>c.toUpperCase())+' '+m[2]+' exposants';
  // Structured JSON fields occasionally expose a numeric capacity directly.
  m=raw.match(/\"(?:maxCapacity|capacity|numberOfParticipants|numberOfExhibitors|numberOfStands)\"\s*:\s*\"?(\d{1,4})\b/i);
  if(m)return m[1]+' emplacements / exposants';
  return '';
}
function marketRejectSpam(title){const t=String(title||'').toLowerCase();return /(retour d.?affection|voyance|rituel|marabout|amour rapide)/.test(t)||(String(title||'').match(/\d/g)||[]).length>8}
function marketClassFromText(t){t=String(t||'').toLowerCase();if(/no[eë]l|kerst/.test(t))return'noel';if(/voyageur|forain|f[oê]te foraine/.test(t))return'voyageur';if(/brocante|vide[ -]?grenier|foire(?: à| a)? tout|braderie|puces|r[eé]derie|rommel|vlooien/.test(t))return'brocante';return'marche'}
function marketLabelFromKindText(t){t=String(t||'').toLowerCase();if(/vide[ -]?grenier/.test(t))return'Vide-grenier';if(/foire/.test(t))return'Foire';if(/braderie/.test(t))return'Braderie';if(/puces|vlooien/.test(t))return'Marché aux puces';if(/rommel/.test(t))return'Brocante / Rommelmarkt';return'Brocante'}
function htmlHeadingBlocks(html){
  const src=String(html||''), heads=[]; let m;
  const re=/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  while((m=re.exec(src))){heads.push({level:Number(m[1]),raw:m[2],text:marketPlainText(m[2]),start:m.index,end:re.lastIndex})}
  for(let i=0;i<heads.length;i++){heads[i].before=src.slice(i?heads[i-1].end:Math.max(0,heads[i].start-1200),heads[i].start);heads[i].after=src.slice(heads[i].end,heads[i+1]?heads[i+1].start:Math.min(src.length,heads[i].end+1600))}
  return heads;
}
function marketEmailFromHtml(html){
  const raw=String(html||'');
  let m=raw.match(/mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  if(m)return String(m[1]||'').trim();
  m=marketPlainText(raw).match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return m?String(m[0]||'').trim():'';
}
function marketRegistrationLinkFromHtml(html,baseUrl){
  const raw=String(html||''),re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  const wanted=/inscri|s.?inscrire|exposant|emplacement|formulaire|r[eé]serv|particip|register|registration|inschrijven|aanmelden|standhouder|standplaats/i;
  while((m=re.exec(raw))){
    const href=String(m[1]||'').trim(),label=marketPlainText(m[2]||'');
    if(!href||/^mailto:|^tel:|^javascript:/i.test(href)||!wanted.test(label+' '+href))continue;
    try{return new URL(href,baseUrl).href}catch(_){if(/^https:\/\//i.test(href))return href}
  }
  return'';
}
async function sourceDetailInfo(url,country){
  if(!/^https:\/\//i.test(String(url||'')))return{phone:'',merchants:'',registration:'',email:''};
  try{
    const r=await fetch(url,{headers:{'user-agent':'Couteau-Suisse/337 (+market-contact)','accept-language':'fr-FR,fr;q=0.9'},cf:{cacheTtl:1800}});
    if(!r.ok)return{phone:'',merchants:'',registration:'',email:''};
    const raw=await r.text(),plain=marketPlainText(raw),email=marketEmailFromHtml(raw),form=marketRegistrationLinkFromHtml(raw,url);
    return{phone:marketPhoneFromText(plain,country),merchants:marketCapacityFromText(plain),registration:form||(email?('mailto:'+email):''),email};
  }catch(_){return{phone:'',merchants:'',registration:'',email:''}}
}
async function sourceDetailPhone(url,country){return (await sourceDetailInfo(url,country)).phone}

function registrationContextFromText(plain){
  const lines=String(plain||'').split(/\n+/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
  const hit=/inscri|s.?inscrire|reservation|réservation|exposant|emplacement|particip|stand|dossier|formulaire|piece d.identite|pièce d.identité|identiteitskaart|passeport|paspoort|attestation|siret|kbis|assurance|ambulant|domicile|photo|tarif|prix|paiement|m[eè]tre|vehicule|véhicule|remorque|immatriculation|objets? vendus?|activité|activite/i;
  const out=[];const seen=new Set();
  for(let i=0;i<lines.length;i++){
    if(!hit.test(lines[i]))continue;
    for(let j=Math.max(0,i-1);j<=Math.min(lines.length-1,i+1);j++){
      const line=lines[j];if(line.length<3||line.length>500||seen.has(line))continue;seen.add(line);out.push(line);if(out.length>=45)return out.join('\n');
    }
  }
  return out.join('\n');
}
function eventRegistrationExtract(html,baseUrl,country){
  const plain=marketPlainText(String(html||'')).slice(0,350000);
  const context=registrationContextFromText(plain);
  const n=String(context||plain).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const req=[];
  const add=(id,label,test)=>{if(test.test(n)&&!req.some(x=>x.id===id))req.push({id,label})};
  add('id','Pièce d’identité — recto + verso',/piece d.?identite|carte d.?identite|\bcni\b|passeport|identiteitskaart|paspoort|recto|verso/);
  add('honor','Attestation sur l’honneur',/attestation.{0,45}honneur|declaration.{0,45}honneur|verklaring op eer/);
  add('siret','SIRET / Kbis / numéro d’entreprise',/\bsiret\b|\bkbis\b|extrait k|numero d.?entreprise|ondernemingsnummer|\bbce\b/);
  add('insurance','Attestation d’assurance',/assurance|responsabilite civile|\brc pro\b|verzekering|aansprakelijk/);
  add('card','Carte de commerçant ambulant',/carte.{0,35}(commercant|ambulant)|commercant ambulant|leurkaart|ambulante handel/);
  add('proof','Justificatif de domicile',/justificatif.{0,35}domicile|preuve.{0,35}domicile|bewijs.{0,35}woonplaats/);
  add('photos','Photos du stand / des produits',/photo.{0,45}(stand|produit|article|marchandise)|foto.{0,45}(stand|product|artik)/);
  add('other','Autre document demandé par l’organisateur',/autorisation parentale|licence|certificat|permis|document complementaire|document supplémentaire/);

  const fields=[];const field=(id,label,test)=>{if(test.test(n)&&!fields.some(x=>x.id===id))fields.push({id,label})};
  field('address','Adresse',/\badresse\b|domicile|woonplaats|adres/);
  field('siret','SIRET / Kbis / numéro d’entreprise',/\bsiret\b|\bkbis\b|numero d.?entreprise|ondernemingsnummer|\bbce\b/);
  field('sellerType','Particulier / professionnel',/particulier|professionnel|commercant|commerçant|handelaar/);
  field('meters','Mètres / dimensions de l’emplacement',/metre(?:s)? lineaire|m[eè]tres? d.?emplacement|dimension.{0,30}emplacement|longueur.{0,30}stand|breedte.{0,30}stand|standplaats.{0,30}meter/);
  field('vehicle','Véhicule / remorque / immatriculation',/vehicule|véhicule|remorque|immatriculation|plaque|voertuig|aanhangwagen|nummerplaat/);
  field('items','Objets / activité vendus',/objets? vendus?|nature.{0,30}(objets|marchandises)|produits? vendus?|activite|activité|artikelen|producten/);

  const email=marketEmailFromHtml(html);
  const phone=marketPhoneFromText(context||plain,country);
  const registrationUrl=marketRegistrationLinkFromHtml(html,baseUrl);
  const snippets=String(context||'').split(/\n+/).map(x=>x.trim()).filter(x=>x.length>=12&&x.length<=260).slice(0,12);
  let price='';
  for(const line of snippets){if(/(?:tarif|prix|emplacement|stand|m[eè]tre)/i.test(line)&&/\b\d{1,4}(?:[,.]\d{1,2})?\s*(?:€|eur)/i.test(line)){price=line;break}}
  let deadline='';
  for(const line of snippets){if(/date limite|avant le|inscri.{0,30}jusqu|cloture|clôture|deadline|uiterlijk/i.test(line)){deadline=line;break}}
  return{email,phone,registrationUrl,requirements:req,fields,instructions:snippets,price,deadline};
}
async function eventRegistrationInfo(request){
  const u=new URL(request.url),source=String(u.searchParams.get('url')||'').trim(),country=String(u.searchParams.get('country')||'FR').toUpperCase()==='BE'?'BE':'FR';
  if(!safePublicDiningUrl(source))return json({ok:false,error:'SOURCE_INVALIDE'},400);
  try{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2600);
    const r=await fetch(source,{headers:{'user-agent':'Mozilla/5.0 (compatible; CouteauSuisseInscription/1.0)','accept':'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2','accept-language':'fr-FR,fr;q=0.9,nl;q=0.6'},redirect:'follow',signal:controller.signal,cf:{cacheTtl:3600}});
    clearTimeout(timer);
    if(!r.ok)return json({ok:false,error:'SOURCE_'+r.status},200);
    const type=String(r.headers.get('content-type')||'').toLowerCase();
    if(type&&!/text\/html|application\/xhtml\+xml|text\/plain/.test(type))return json({ok:false,error:'FORMAT_NON_TEXTE',officialUrl:r.url||source},200);
    const html=(await r.text()).slice(0,600000),data=eventRegistrationExtract(html,r.url||source,country);
    return json({ok:true,sourceUrl:r.url||source,...data});
  }catch(_){return json({ok:false,error:'SOURCE_INACCESSIBLE'},200)}
}
function parseBrocabrac(html,area){
  const hs=htmlHeadingBlocks(html),out=[];let date='';
  for(const h of hs){if(h.level===2){const d=marketIsoDate(h.text);if(d)date=d;continue}if(h.level!==3||!date)continue;let title=h.text.trim();if(!title||marketRejectSpam(title))continue;const after=marketPlainText(h.after).split('\n').map(x=>x.trim()).filter(Boolean).slice(0,8);const info=after.find(x=>/^\d{5}\s*-\s*/.test(x))||'';if(!info)continue;const parts=info.split(/\s+-\s+/),cp=(parts[0]||'').match(/\d{5}/),typ=parts[1]||'',addr=parts.slice(2).join(' - ');const combined=title+' '+typ;if(!/brocante|vide[ -]?grenier|foire(?: à| a)? tout|braderie|puces/i.test(combined))continue;const href=(h.raw.match(/href=["']([^"']+)["']/i)||[])[1]||'';const sourceUrl=href?(href.startsWith('http')?href:'https://brocabrac.fr'+(href.startsWith('/')?'':'/')+href):`https://brocabrac.fr/${area}/`;
    out.push({country:'FR',area:String(area).toUpperCase(),kind:'brocante',name:title,city:'',day:date,dateLabel:date,start:date,end:date,hours:'',address:[addr,cp&&cp[0]].filter(Boolean).join(', '),merchants:marketCapacityFromText(marketPlainText(h.after)),note:`${marketLabelFromKindText(combined)} — source Brocabrac`,sourceUrl});if(out.length>=50)break}
  return out;
}
function parseBrocantesBe(html,area){
  const hs=htmlHeadingBlocks(html),out=[];let date='';
  for(const h of hs){if(h.level===2){const d=marketIsoDate(h.text);if(d)date=d;continue}if(h.level!==3)continue;let title=h.text.trim();if(!title||marketRejectSpam(title))continue;const before=marketPlainText(h.before||'').split('\n').map(x=>x.trim()).filter(Boolean).slice(-8),after=marketPlainText(h.after).split('\n').map(x=>x.trim()).filter(Boolean).slice(0,10);let d=date;for(const x of before.concat(after)){const z=marketIsoDate(x);if(z){d=z;break}}if(!d)continue;const loc=after.find(x=>/^\d{4}\s+/.test(x))||'';if(!loc)continue;const lm=loc.match(/^(\d{4})\s+(.+?)(?:\s+(?:Anvers|Antwerpen|Limbourg|Limburg|Hainaut|Namur|Li[eè]ge|Luxembourg|Brabant|Flandre|Vlaams|West-Vlaanderen|Oost-Vlaanderen|Bruxelles).*)?$/i);const cp=lm?lm[1]:'',city=lm?lm[2].trim():'';const href=(h.raw.match(/href=["']([^"']+)["']/i)||[])[1]||'';const sourceUrl=href?(href.startsWith('http')?href:'https://www.brocantes.be'+(href.startsWith('/')?'':'/')+href):`https://www.brocantes.be/fr/agenda/province/${encodeURIComponent(area)}/Brocantes`;
    out.push({country:'BE',area:String(area).toUpperCase(),kind:'brocante',name:title,city,day:d,dateLabel:d,start:d,end:d,hours:'',address:[cp,city].filter(Boolean).join(' '),merchants:marketCapacityFromText(marketPlainText(h.after)),note:'Brocante / vide-grenier — source Brocantes.be',sourceUrl});if(out.length>=50)break}
  return out;
}
function deepValuesByKey(obj,re,out=[],depth=0){if(depth>8||obj==null)return out;if(Array.isArray(obj)){for(const v of obj)deepValuesByKey(v,re,out,depth+1);return out}if(typeof obj==='object'){for(const [k,v] of Object.entries(obj)){if(re.test(k))out.push(v);deepValuesByKey(v,re,out,depth+1)}}return out}
function firstScalar(v){if(v==null)return'';if(typeof v==='string'||typeof v==='number')return String(v);if(Array.isArray(v)){for(const x of v){const z=firstScalar(x);if(z)return z}}if(typeof v==='object'){for(const k of ['fr','nl','en','label','value','name']){if(v[k]!=null){const z=firstScalar(v[k]);if(z)return z}}for(const x of Object.values(v)){const z=firstScalar(x);if(z)return z}}return''}
function datatourismeToMarket(o,area,queryKind){
  const label=firstScalar(o&&o.label)||firstScalar(deepValuesByKey(o,/^(name|title)$/i)[0]);if(!label)return null;const addrObj=deepValuesByKey(o,/^address$/i)[0]||{};const city=firstScalar(deepValuesByKey(addrObj,/hasAddressCity|city/i)[0]);const zip=firstScalar(deepValuesByKey(addrObj,/postal|zip/i)[0]);const street=firstScalar(deepValuesByKey(addrObj,/street|address1|addressLocality/i)[0]);const geo=deepValuesByKey(o,/^geo$/i)[0]||{};const lat=Number(firstScalar(deepValuesByKey(geo,/lat/i)[0])),lon=Number(firstScalar(deepValuesByKey(geo,/long|lng|lon/i)[0]));const all=JSON.stringify(o);const dates=[...all.matchAll(/20\d{2}-\d{2}-\d{2}/g)].map(m=>m[0]).sort();const future=dates.filter(d=>d>=marketTodayIso());const start=future[0]||dates[0]||'',end=future[future.length-1]||dates[dates.length-1]||start;if(!start)return null;const phone=marketPhoneFromText(all,'FR');const sourceUrl=String(o.uri||o.url||'');const kind=marketClassFromText(label+' '+all.slice(0,4000));if(queryKind==='brocante'&&kind!=='brocante')return null;if(queryKind==='noel'&&kind!=='noel')return null;return{country:'FR',area:String(area).toUpperCase(),kind:kind||queryKind,name:label,city,day:start,dateLabel:start===end?start:(start+' au '+end),start,end,hours:'',address:[street,zip,city].filter(Boolean).join(', '),phone,merchants:marketCapacityFromText(all),note:'Mise à jour automatique DATAtourisme',sourceUrl,latitude:Number.isFinite(lat)?lat:null,longitude:Number.isFinite(lon)?lon:null}}
async function upsertAutoMarket(env,raw){
  const m=normalizeMarket(raw);if(!m)return false;
  // V323 : l'empreinte contient le jour. Une URL source peut donc correspondre à plusieurs jours
  // (ex. mardi + vendredi). On ne fusionne plus deux jours différents sur la seule source_url.
  await env.DB.prepare(`INSERT INTO imported_markets (fingerprint,country,area,kind,name,city,day,hours,address,merchants,draw,registration,note,phone,date_label,start_date,end_date,source_url,latitude,longitude,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(fingerprint) DO UPDATE SET
      country=excluded.country,area=excluded.area,kind=excluded.kind,name=excluded.name,city=excluded.city,day=excluded.day,
      hours=CASE WHEN excluded.hours<>'' THEN excluded.hours ELSE imported_markets.hours END,
      address=CASE WHEN excluded.address<>'' THEN excluded.address ELSE imported_markets.address END,
      merchants=CASE WHEN excluded.merchants<>'' THEN excluded.merchants ELSE imported_markets.merchants END,
      draw=CASE WHEN excluded.draw<>'' THEN excluded.draw ELSE imported_markets.draw END,
      registration=CASE WHEN excluded.registration<>'' THEN excluded.registration ELSE imported_markets.registration END,
      note=CASE WHEN excluded.note<>'' THEN excluded.note ELSE imported_markets.note END,
      phone=CASE WHEN excluded.phone<>'' THEN excluded.phone ELSE imported_markets.phone END,
      date_label=CASE WHEN excluded.date_label<>'' THEN excluded.date_label ELSE imported_markets.date_label END,
      start_date=CASE WHEN excluded.start_date<>'' THEN excluded.start_date ELSE imported_markets.start_date END,
      end_date=CASE WHEN excluded.end_date<>'' THEN excluded.end_date ELSE imported_markets.end_date END,
      source_url=CASE WHEN excluded.source_url<>'' THEN excluded.source_url ELSE imported_markets.source_url END,
      latitude=COALESCE(excluded.latitude,imported_markets.latitude),longitude=COALESCE(excluded.longitude,imported_markets.longitude),updated_at=CURRENT_TIMESTAMP`)
    .bind(m.fingerprint,m.country,m.area,m.kind,m.name,m.city,m.day,m.hours,m.address,m.merchants,m.draw,m.registration,m.note,m.phone,m.dateLabel,m.startDate,m.endDate,m.sourceUrl,m.latitude,m.longitude).run();
  return true;
}


// V323 — Import renforcé Jours-de-Marché.fr, récupérée progressivement par département.
// Objectif : compléter les marchés classiques / périodiques et récupérer aussi les marchés de Noël
// ainsi que les vide-greniers, brocantes et foires publiés sur cette source, sans supprimer les sources
// déjà présentes (DATAtourisme, Brocabrac, Brocantes.be, données locales vérifiées).
const JDM_FR_SLUGS={
  "01":"ain","02":"aisne","03":"allier","04":"alpes-de-haute-provence","05":"hautes-alpes","06":"alpes-maritimes","07":"ardeche","08":"ardennes","09":"ariege","10":"aube","11":"aude","12":"aveyron","13":"bouches-du-rhone","14":"calvados","15":"cantal","16":"charente","17":"charente-maritime","18":"cher","19":"correze","20":"corse","21":"cote-d-or","22":"cotes-d-armor","23":"creuse","24":"dordogne","25":"doubs","26":"drome","27":"eure","28":"eure-et-loir","29":"finistere","30":"gard","31":"haute-garonne","32":"gers","33":"gironde","34":"herault","35":"ille-et-vilaine","36":"indre","37":"indre-et-loire","38":"isere","39":"jura","40":"landes","41":"loir-et-cher","42":"loire","43":"haute-loire","44":"loire-atlantique","45":"loiret","46":"lot","47":"lot-et-garonne","48":"lozere","49":"maine-et-loire","50":"manche","51":"marne","52":"haute-marne","53":"mayenne","54":"meurthe-et-moselle","55":"meuse","56":"morbihan","57":"moselle","58":"nievre","59":"nord","60":"oise","61":"orne","62":"pas-de-calais","63":"puy-de-dome","64":"pyrenees-atlantiques","65":"hautes-pyrenees","66":"pyrenees-orientales","67":"bas-rhin","68":"haut-rhin","69":"rhone","70":"haute-saone","71":"saone-et-loire","72":"sarthe","73":"savoie","74":"haute-savoie","75":"paris","76":"seine-maritime","77":"seine-et-marne","78":"yvelines","79":"deux-sevres","80":"somme","81":"tarn","82":"tarn-et-garonne","83":"var","84":"vaucluse","85":"vendee","86":"vienne","87":"haute-vienne","88":"vosges","89":"yonne","90":"territoire-de-belfort","91":"essonne","92":"hauts-de-seine","93":"seine-saint-denis","94":"val-de-marne","95":"val-d-oise"
};
const JDM_WEEKDAYS=['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
function jdmDecodeUrl(href){try{return new URL(String(href||''),'https://www.jours-de-marche.fr').href}catch(_){return''}}
function jdmCityUrls(html){
  const out=[],seen=new Set(),src=String(html||'');let m;
  const re=/href=["'](\/\d{5}-[a-z0-9][a-z0-9-]*\/)["']/gi;
  while((m=re.exec(src))){const u=jdmDecodeUrl(m[1]);if(u&&!seen.has(u)){seen.add(u);out.push(u)}}
  return out;
}
function jdmCleanAddress(v){
  let s=String(v||'').replace(/\s+/g,' ').trim();
  if(!s)return'';
  const mid=Math.floor(s.length/2),a=s.slice(0,mid).trim(),b=s.slice(mid).trim();
  if(a&&b&&normMarketText(a)===normMarketText(b))s=a;
  return s.slice(0,240);
}
function normMarketText(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,"'").replace(/\s+/g,' ').trim().toLowerCase()}
function jdmDateRange(text){
  const t=String(text||'');let m=t.match(/(?:uniquement\s+)?du\s+(\d{1,2})\/(\d{1,2})\/(20\d{2})\s+au\s+(\d{1,2})\/(\d{1,2})\/(20\d{2})/i);
  if(m)return{start:`${m[3]}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`,end:`${m[6]}-${String(Number(m[5])).padStart(2,'0')}-${String(Number(m[4])).padStart(2,'0')}`,label:`${m[1]}/${m[2]}/${m[3]} au ${m[4]}/${m[5]}/${m[6]}`};
  m=t.match(/(?:uniquement\s+)?(?:le\s+)?(\d{1,2})\/(\d{1,2})\/(20\d{2})/i);
  if(m){const d=`${m[3]}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`;return{start:d,end:d,label:`${m[1]}/${m[2]}/${m[3]}`}}
  return{start:'',end:'',label:''};
}
function jdmHours(text){
  const t=String(text||'').replace(/\s+/g,' '),m=t.match(/\bde\s+([0-2]?\d(?:h|:)[0-5]?\d?)\s+(?:à|a)\s+([0-2]?\d(?:h|:)[0-5]?\d?)/i);
  return m?`${m[1]}-${m[2]}`:'';
}
function jdmDays(text){
  const t=normMarketText(text),out=[];let m=t.match(/jours suivants\s*:\s*([^.;]+?)(?:\s+de\s+\d|\s+info\s*:|\s+adresse\s*:|$)/i);
  const src=m?m[1]:t;
  for(const d of JDM_WEEKDAYS)if(new RegExp(`\\b${d}\\b`,'i').test(src))out.push(d);
  if(out.length)return out;
  m=t.match(/\ble\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i);return m?[m[1].toLowerCase()]:[];
}
function jdmPostalCity(text){
  const t=String(text||'').replace(/\s+/g,' ').trim(),all=[...t.matchAll(/(?:\s|^)à\s+(\d{5})\s+([A-Za-zÀ-ÿŒœ'’ -]{2,80})(?=$|\s+(?:Info|Adresse)\s*:)/gi)];
  if(all.length){const m=all[all.length-1];return{postal:m[1],city:m[2].trim(),index:m.index}}
  const b=[...t.matchAll(/\b(\d{5})\s+([A-Za-zÀ-ÿŒœ'’ -]{2,80})$/g)];if(b.length){const m=b[b.length-1];return{postal:m[1],city:m[2].trim(),index:m.index}}
  return{postal:'',city:'',index:-1};
}
function jdmAreaForPostal(area,pc){
  const a=String(area||'').toUpperCase(),postal=String(pc&&pc.postal||'');
  if(a!=='20')return a;
  // Jours-de-Marché regroupe la Corse en département 20 ; l'application garde 2A / 2B.
  if(/^20[01]/.test(postal))return '2A';
  if(/^20[246]/.test(postal))return '2B';
  return '20';
}
function jdmAddress(text,pc){
  const t=String(text||'').replace(/\s+/g,' ').trim(),i=t.toLowerCase().lastIndexOf('adresse :');if(i<0)return'';
  let a=t.slice(i+9,pc&&pc.index>i?pc.index:t.length).trim();
  // Les pages répètent souvent deux fois la même adresse avant « à 75000 Ville ».
  const words=a.split(' ');if(words.length>=4){for(let k=2;k<=Math.floor(words.length/2);k++){const left=words.slice(0,k).join(' '),right=words.slice(k,k*2).join(' ');if(normMarketText(left)===normMarketText(right)){a=left+' '+words.slice(k*2).join(' ');break}}}
  return jdmCleanAddress(a);
}
function jdmFullAddress(address,pc){const a=String(address||'').trim();if(/\b\d{5}\b/.test(a))return a;return[a,pc&&pc.postal,pc&&pc.city].filter(Boolean).join(', ')}
function jdmPeriodic(text){return /(1er|premier|2e|2eme|deuxieme|3e|3eme|troisieme|4e|4eme|quatrieme)\s+(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(?:de|du)\s+chaque\s+mois|mensuel|trimestriel|une semaine sur deux|toutes? les deux semaines|toutes? les 2 semaines/i.test(normMarketText(text))}
function parseJdmMarketPage(html,area,pageUrl){
  const out=[],hs=htmlHeadingBlocks(html),today=marketTodayIso();
  for(const h of hs){
    if(h.level!==3)continue;
    const title=String(h.text||'').trim(),body=marketPlainText(h.after||'');
    if(!title||!/ce march[eé] a lieu/i.test(normMarketText(body)))continue;
    const combined=title+' '+body,kind=marketClassFromText(combined),n=normMarketText(combined);
    // Le projet exclut les « marchés de producteurs » / drives fermiers des marchés classiques.
    if(kind==='marche'&&/march[eé] de producteurs?|drive fermier|cagette/.test(n))continue;
    if(kind==='brocante')continue; // récupérées sur la rubrique vide-greniers.
    const range=jdmDateRange(body),days=jdmDays(body),hours=jdmHours(body),pc=jdmPostalCity(body),address=jdmAddress(body,pc);
    const actualArea=jdmAreaForPostal(area,pc);
    const href=(h.raw.match(/href=["']([^"']+)["']/i)||[])[1]||'',sourceUrl=href?jdmDecodeUrl(href):String(pageUrl||'');
    const periodic=jdmPeriodic(body),phone=marketPhoneFromText(body,'FR'),merchants=marketCapacityFromText(body);
    const note=(periodic?'Marché périodique — ':'')+'Source Jours-de-Marché.fr. '+String(body||'').slice(0,420);
    if(range.end&&range.end<today)continue;
    if(kind==='noel'||range.start){
      const day=range.label||range.start||days.join(', ');
      if(day)out.push({country:'FR',area:actualArea,kind:kind==='noel'?'noel':'marche',name:title,city:pc.city,day,dateLabel:range.label||day,start:range.start,end:range.end||range.start,hours,address:jdmFullAddress(address,pc),merchants,phone,note,sourceUrl});
      continue;
    }
    // IMPORTANT : un même marché présent lundi + dimanche donne bien 2 fiches distinctes.
    for(const day of days){out.push({country:'FR',area:actualArea,kind:'marche',name:title,city:pc.city,day,dateLabel:day,hours,address:jdmFullAddress(address,pc),merchants,phone,note,sourceUrl})}
  }
  return out;
}
function parseJdmVideGreniers(html,area,pageUrl){
  const out=[],hs=htmlHeadingBlocks(html),today=marketTodayIso();
  for(const h of hs){if(h.level!==3)continue;const title=String(h.text||'').trim(),body=marketPlainText(h.after||''),combined=title+' '+body,n=normMarketText(combined);if(!title||!/vide[ -]?grenier|brocante|foire|braderie|bric ?a ?brac|bourse d.?echange|puces/.test(n))continue;
    const range=jdmDateRange(body),pc=jdmPostalCity(body);if(!range.start)continue;if(range.end&&range.end<today)continue;
    const href=(h.raw.match(/href=["']([^"']+)["']/i)||[])[1]||'',sourceUrl=href?jdmDecodeUrl(href):String(pageUrl||'');
    out.push({country:'FR',area:jdmAreaForPostal(area,pc),kind:'brocante',name:title,city:pc.city,day:range.label,dateLabel:range.label,start:range.start,end:range.end||range.start,hours:jdmHours(body),address:[pc.postal,pc.city].filter(Boolean).join(' '),merchants:marketCapacityFromText(body),phone:marketPhoneFromText(body,'FR'),note:`${marketLabelFromKindText(combined)} — source Jours-de-Marché.fr. ${String(body||'').slice(0,380)}`,sourceUrl});
  }
  return out;
}
async function ensureJdmRefreshTable(env){await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_jdm_refresh_state(area TEXT PRIMARY KEY,city_cursor INTEGER NOT NULL DEFAULT 0,city_count INTEGER NOT NULL DEFAULT 0,next_check_at INTEGER NOT NULL DEFAULT 0,last_check_at INTEGER NOT NULL DEFAULT 0,last_found INTEGER NOT NULL DEFAULT 0,last_pages INTEGER NOT NULL DEFAULT 0,last_message TEXT NOT NULL DEFAULT '')`).run();try{await env.DB.prepare('CREATE INDEX IF NOT EXISTS market_jdm_due ON market_jdm_refresh_state(next_check_at)').run()}catch(_){} }
async function seedJdmRefreshQueue(env){await ensureJdmRefreshTable(env);const now=Date.now(),jobs=[];for(const area of Object.keys(JDM_FR_SLUGS))jobs.push(env.DB.prepare('INSERT OR IGNORE INTO market_jdm_refresh_state(area,next_check_at) VALUES(?,?)').bind(area,now));for(let i=0;i<jobs.length;i+=40)await env.DB.batch(jobs.slice(i,i+40))}
async function jdmFetch(url){try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (compatible; Couteau-Suisse/324; +https://carplay-telephone.appli-suzon.workers.dev/)','accept-language':'fr-FR,fr;q=0.9','accept':'text/html,application/xhtml+xml'},cf:{cacheTtl:3600}});if(!r.ok)return'';return await r.text()}catch(_){return''}}
async function refreshJdmArea(env,state){
  const area=String(state.area||'').toUpperCase(),slug=JDM_FR_SLUGS[area];if(!slug)return{area,count:0,pages:0,pending:false,message:'département non pris en charge'};
  const deptUrl=`https://www.jours-de-marche.fr/${area}-${slug}/`,deptHtml=await jdmFetch(deptUrl);if(!deptHtml)return{area,count:0,pages:0,pending:false,message:'page département indisponible'};
  const cityUrls=jdmCityUrls(deptHtml),batchSize=12,start=Math.max(0,Number(state.city_cursor||0))%Math.max(1,cityUrls.length),selected=[];
  if(cityUrls.length){for(let i=0;i<Math.min(batchSize,cityUrls.length);i++)selected.push(cityUrls[(start+i)%cityUrls.length])}
  let events=parseJdmMarketPage(deptHtml,area,deptUrl),pages=1;
  for(const u of selected){const html=await jdmFetch(u);if(!html)continue;pages++;events.push(...parseJdmMarketPage(html,area,u));if(events.length>900)break}
  const brocUrl=`https://www.jours-de-marche.fr/vide-greniers/${area}-${slug}/`,brocHtml=await jdmFetch(brocUrl);if(brocHtml){pages++;events.push(...parseJdmVideGreniers(brocHtml,area,brocUrl))}
  // Les mêmes marchés présents sur plusieurs jours restent plusieurs entrées (une par jour),
  // mais un doublon strict de même marché / ville / jour n'est enregistré qu'une fois par fingerprint D1.
  let count=0;for(const e of events){if(await upsertAutoMarket(env,e))count++}
  const consumed=cityUrls.length?Math.min(batchSize,cityUrls.length):0,nextCursor=cityUrls.length?(start+consumed)%cityUrls.length:0,wrapped=!cityUrls.length||start+consumed>=cityUrls.length;
  const next=Date.now()+(wrapped?30*86400000:2*3600000),msg=`Jours-de-Marché: ${count} fiches · ${pages} pages · villes ${cityUrls.length}`;
  await env.DB.prepare('UPDATE market_jdm_refresh_state SET city_cursor=?,city_count=?,next_check_at=?,last_check_at=?,last_found=?,last_pages=?,last_message=? WHERE area=?').bind(nextCursor,cityUrls.length,next,Date.now(),count,pages,msg,area).run();
  return{area,count,pages,pending:!wrapped,message:msg};
}
async function runJdmIncremental(env){
  await seedJdmRefreshQueue(env);
  const results=[];
  // Deux lots par passage : assez rapide pour remplir la France, sans lancer tout le pays d'un coup.
  for(let i=0;i<2;i++){
    const row=await env.DB.prepare('SELECT area,city_cursor,city_count,next_check_at FROM market_jdm_refresh_state WHERE next_check_at<=? ORDER BY next_check_at ASC,area ASC LIMIT 1').bind(Date.now()).first();
    if(!row)break;
    try{results.push(await refreshJdmArea(env,row))}
    catch(e){await env.DB.prepare('UPDATE market_jdm_refresh_state SET next_check_at=?,last_check_at=?,last_message=? WHERE area=?').bind(Date.now()+6*3600000,Date.now(),String(e&&e.message||e).slice(0,250),row.area).run()}
  }
  return results;
}


// V334 — Recherche automatique douce : une seule page source par heure.
// Objectif : continuer à découvrir marchés, foires, brocantes et braderies sans charger l'application
// ni relancer les gros traitements qui avaient provoqué des dépassements CPU Cloudflare.
const MARKET_GENTLE_IMPORT_LIMIT = 18;
async function upsertAutoMarketsLimited(env, events, limit=MARKET_GENTLE_IMPORT_LIMIT){
  let count=0;
  for(const e of (events||[]).slice(0,Math.max(1,limit))){if(await upsertAutoMarket(env,e))count++}
  return count;
}
async function ensureGentleMarketCursor(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_gentle_cursor(
    id INTEGER PRIMARY KEY CHECK(id=1), phase INTEGER NOT NULL DEFAULT 0,
    fr_market_idx INTEGER NOT NULL DEFAULT 0, fr_event_idx INTEGER NOT NULL DEFAULT 0,
    be_event_idx INTEGER NOT NULL DEFAULT 0, last_run_at INTEGER NOT NULL DEFAULT 0,
    last_message TEXT NOT NULL DEFAULT '')`).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO market_gentle_cursor(id,phase,fr_market_idx,fr_event_idx,be_event_idx,last_run_at,last_message)
    VALUES(1,0,0,0,0,0,'')`).run();
}
async function gentleJdmDepartment(env,area){
  const slug=JDM_FR_SLUGS[String(area||'').toUpperCase()];
  if(!slug)return{count:0,message:'département JDM non pris en charge'};
  const url=`https://www.jours-de-marche.fr/${area}-${slug}/`;
  const html=await jdmFetch(url);
  if(!html)return{count:0,message:'Jours-de-Marché indisponible'};
  // Une seule page départementale : marchés classiques / périodiques et événements publiés dessus.
  const events=parseJdmMarketPage(html,area,url).filter(e=>!e.end||e.end>=marketTodayIso());
  const count=await upsertAutoMarketsLimited(env,events);
  return{count,message:`Jours-de-Marché ${area}: ${count} fiche(s)`};
}
async function gentleBrocantePage(env,country,area){
  let events=[],source='';
  try{
    if(country==='FR'){
      source=`https://brocabrac.fr/${encodeURIComponent(area)}/`;
      const r=await fetch(source,{headers:{'user-agent':'Mozilla/5.0 Couteau-Suisse/337 (+gentle-market-refresh)','accept-language':'fr-FR,fr;q=0.9'},cf:{cacheTtl:3600}});
      if(r.ok)events=parseBrocabrac(await r.text(),area);
    }else{
      const slug=String(area||'').toLowerCase();
      source=`https://www.brocantes.be/fr/agenda/province/${encodeURIComponent(slug)}/Brocantes`;
      const r=await fetch(source,{headers:{'user-agent':'Mozilla/5.0 Couteau-Suisse/337 (+gentle-market-refresh)','accept-language':'fr-FR,fr;q=0.9'},cf:{cacheTtl:3600}});
      if(r.ok)events=parseBrocantesBe(await r.text(),slug);
    }
  }catch(_){}
  events=events.filter(e=>!e.end||e.end>=marketTodayIso());
  // V337 : seulement 3 fiches détaillées par passage pour trouver téléphone / e-mail / formulaire
  // sans refaire monter la consommation CPU ou le nombre de sous-requêtes.
  for(let i=0;i<Math.min(events.length,3);i++){
    const e=events[i];if(!e||!e.sourceUrl)continue;
    const d=await sourceDetailInfo(e.sourceUrl,country);
    if(!e.phone&&d.phone)e.phone=d.phone;
    if(!e.merchants&&d.merchants)e.merchants=d.merchants;
    if(!e.registration&&d.registration)e.registration=d.registration;
  }
  const count=await upsertAutoMarketsLimited(env,events);
  return{count,source,message:`${country} ${area}: ${count} foire(s)/brocante(s)/braderie(s)`};
}
async function runGentleMarketRefresh(env){
  if(!env.DB)return null;
  await ensureMarketTable(env);
  await ensureGentleMarketCursor(env);
  const state=await env.DB.prepare('SELECT phase,fr_market_idx,fr_event_idx,be_event_idx FROM market_gentle_cursor WHERE id=1').first()||{};
  const phase=((Number(state.phase)||0)%3+3)%3;
  let nextPhase=(phase+1)%3, message='', result=null;
  let frMarket=Number(state.fr_market_idx)||0, frEvent=Number(state.fr_event_idx)||0, beEvent=Number(state.be_event_idx)||0;
  if(phase===0){
    const areas=Object.keys(JDM_FR_SLUGS);
    const area=areas[frMarket%areas.length];
    result=await gentleJdmDepartment(env,area);
    frMarket=(frMarket+1)%areas.length;
    message=result.message;
  }else if(phase===1){
    const area=MARKET_REFRESH_FR_AREAS[frEvent%MARKET_REFRESH_FR_AREAS.length];
    result=await gentleBrocantePage(env,'FR',area);
    frEvent=(frEvent+1)%MARKET_REFRESH_FR_AREAS.length;
    message=result.message;
  }else{
    const area=MARKET_REFRESH_BE_AREAS[beEvent%MARKET_REFRESH_BE_AREAS.length];
    result=await gentleBrocantePage(env,'BE',area);
    beEvent=(beEvent+1)%MARKET_REFRESH_BE_AREAS.length;
    message=result.message;
  }
  await env.DB.prepare(`UPDATE market_gentle_cursor SET phase=?,fr_market_idx=?,fr_event_idx=?,be_event_idx=?,last_run_at=?,last_message=? WHERE id=1`)
    .bind(nextPhase,frMarket,frEvent,beEvent,Date.now(),String(message||'').slice(0,240)).run();
  return{mode:'doux',phase,result,message};
}

async function ensureMarketRefreshTables(env){await ensureMarketTable(env);await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_refresh_state(country TEXT NOT NULL,area TEXT NOT NULL,kind TEXT NOT NULL,next_check_at INTEGER NOT NULL DEFAULT 0,last_check_at INTEGER NOT NULL DEFAULT 0,last_status TEXT NOT NULL DEFAULT '',last_found INTEGER NOT NULL DEFAULT 0,last_message TEXT NOT NULL DEFAULT '',PRIMARY KEY(country,area,kind))`).run();try{await env.DB.prepare('CREATE INDEX IF NOT EXISTS market_refresh_due ON market_refresh_state(next_check_at)').run()}catch(_){} }
async function seedMarketRefreshQueue(env){await ensureMarketRefreshTables(env);const now=Date.now(),c=await env.DB.prepare('SELECT COUNT(*) n FROM market_refresh_state').first();if(Number(c&&c.n||0)<50){const jobs=[];for(let i=0;i<MARKET_REFRESH_FR_AREAS.length;i++)jobs.push(env.DB.prepare(`INSERT OR IGNORE INTO market_refresh_state(country,area,kind,next_check_at) VALUES('FR',?,'brocante',?)`).bind(MARKET_REFRESH_FR_AREAS[i],now+i*1800000));for(let i=0;i<MARKET_REFRESH_BE_AREAS.length;i++)jobs.push(env.DB.prepare(`INSERT OR IGNORE INTO market_refresh_state(country,area,kind,next_check_at) VALUES('BE',?,'brocante',?)`).bind(MARKET_REFRESH_BE_AREAS[i].toUpperCase(),now+i*1800000));for(let i=0;i<jobs.length;i+=40)await env.DB.batch(jobs.slice(i,i+40))}await env.DB.prepare(`INSERT OR IGNORE INTO market_refresh_state(country,area,kind,next_check_at) SELECT upper(country),upper(area),lower(kind),? FROM imported_markets WHERE kind IN ('marche','voyageur','noel') GROUP BY upper(country),upper(area),lower(kind)`).bind(now+6*3600000).run()}
async function prioritizeExpiredScopes(env){const today=marketTodayIso(),now=Date.now();const q=await env.DB.prepare("SELECT country,area,kind,MAX(end_date) max_end FROM imported_markets WHERE kind IN ('brocante','noel','voyageur') AND end_date<>'' GROUP BY country,area,kind").all();for(const r of q.results||[]){if(marketIsoDate(r.max_end)&&marketIsoDate(r.max_end)<today)await env.DB.prepare('UPDATE market_refresh_state SET next_check_at=MIN(next_check_at,?) WHERE country=? AND area=? AND kind=?').bind(now,String(r.country).toUpperCase(),String(r.area).toUpperCase(),String(r.kind).toLowerCase()).run()}}
async function refreshExistingSourceRows(env,country,area,kind){const q=await env.DB.prepare("SELECT id,source_url,phone,merchants,registration,date_label,end_date FROM imported_markets WHERE country=? AND area=? AND kind=? AND source_url<>'' ORDER BY updated_at ASC LIMIT 3").bind(country,area,kind).all();let changed=0;for(const row of q.results||[]){const u=String(row.source_url||'');if(!/^https:\/\//i.test(u))continue;try{const dInfo=await sourceDetailInfo(u,country);const r=await fetch(u,{headers:{'user-agent':'Couteau-Suisse/337 (+market-update)','accept-language':'fr-FR,fr;q=0.9'},cf:{cacheTtl:1800}});let d='';if(r.ok){const txt=await r.text();d=marketIsoDate(marketPlainText(txt))}const phone=dInfo.phone||'',merchants=dInfo.merchants||'',registration=dInfo.registration||'';if(phone||merchants||registration||d){await env.DB.prepare("UPDATE imported_markets SET phone=CASE WHEN ?<>'' THEN ? ELSE phone END,merchants=CASE WHEN ?<>'' THEN ? ELSE merchants END,registration=CASE WHEN ?<>'' THEN ? ELSE registration END,date_label=CASE WHEN ?<>'' THEN ? ELSE date_label END,end_date=CASE WHEN ?<>'' THEN ? ELSE end_date END,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(phone,phone,merchants,merchants,registration,registration,d,d,d,d,row.id).run();changed++}}catch(_){}}return changed}
async function refreshBrocanteScope(env,country,area){let events=[],src='';try{if(country==='FR'){src=`https://brocabrac.fr/${encodeURIComponent(area)}/`;const r=await fetch(src,{headers:{'user-agent':'Mozilla/5.0 Couteau-Suisse/337','accept-language':'fr-FR,fr;q=0.9'},cf:{cacheTtl:1800}});if(r.ok)events=parseBrocabrac(await r.text(),area)}else{const slug=String(area||'').toLowerCase();src=`https://www.brocantes.be/fr/agenda/province/${encodeURIComponent(slug)}/Brocantes`;const r=await fetch(src,{headers:{'user-agent':'Mozilla/5.0 Couteau-Suisse/337','accept-language':'fr-FR,fr;q=0.9'},cf:{cacheTtl:1800}});if(r.ok)events=parseBrocantesBe(await r.text(),slug)}}catch(_){}events=events.filter(x=>!x.end||x.end>=marketTodayIso());for(let i=0;i<Math.min(events.length,5);i++){if(events[i].sourceUrl&&(!events[i].phone||!events[i].merchants||!events[i].registration)){const d=await sourceDetailInfo(events[i].sourceUrl,country);if(!events[i].phone)events[i].phone=d.phone;if(!events[i].merchants)events[i].merchants=d.merchants;if(!events[i].registration)events[i].registration=d.registration}}let n=0;for(const e of events){if(await upsertAutoMarket(env,e))n++}return{count:n,source:src}}
async function refreshDatatourismeScope(env,area,kind){if(!env.DATATOURISME_API_KEY)return{count:0,skipped:'DATATOURISME_API_KEY absente'};const terms=kind==='brocante'?['brocante','vide-grenier','foire à tout']:kind==='noel'?['marché de Noël']:kind==='voyageur'?['fête foraine']:['marché'];let n=0;for(const term of terms){try{const filters=`isLocatedAt.address.hasAddressCity.isPartOfDepartment.insee[eq]=${area}`;const u='https://api.datatourisme.fr/v1/entertainmentAndEvent?lang=fr&page_size=80&sort=lastUpdate[desc]&search='+encodeURIComponent(term)+'&filters='+encodeURIComponent(filters);const r=await fetch(u,{headers:{'X-API-Key':String(env.DATATOURISME_API_KEY),'accept':'application/json'}});if(!r.ok)continue;const j=await r.json();for(const o of j.objects||[]){const e=datatourismeToMarket(o,area,kind);if(e&&(!e.end||e.end>=marketTodayIso())&&await upsertAutoMarket(env,e))n++}}catch(_){}}return{count:n}}
async function refreshMarketScope(env,state){const country=String(state.country||'FR').toUpperCase(),area=String(state.area||'').toUpperCase(),kind=String(state.kind||'marche').toLowerCase();let found=0,parts=[];if(kind==='brocante'){const a=await refreshBrocanteScope(env,country,area);found+=a.count;parts.push('agenda:'+a.count)}if(country==='FR'){const a=await refreshDatatourismeScope(env,area,kind);found+=a.count;parts.push(a.skipped||('DATAtourisme:'+a.count))}const rechecked=await refreshExistingSourceRows(env,country,area,kind);parts.push('fiches:'+rechecked);const now=Date.now();let next=now+(kind==='marche'?30:kind==='voyageur'?7:2)*86400000;const max=await env.DB.prepare("SELECT MAX(end_date) e FROM imported_markets WHERE country=? AND area=? AND kind=? AND end_date>=?").bind(country,area,kind,marketTodayIso()).first();if(max&&marketIsoDate(max.e)){const t=Date.parse(marketIsoDate(max.e)+'T23:59:59Z')+86400000;if(t>now&&t<next)next=t}await env.DB.prepare('UPDATE market_refresh_state SET next_check_at=?,last_check_at=?,last_status=?,last_found=?,last_message=? WHERE country=? AND area=? AND kind=?').bind(next,now,'ok',found,parts.join(' · ').slice(0,300),country,area,kind).run();return{country,area,kind,found,message:parts.join(' · ')}}
async function runIncrementalMarketRefresh(env){if(!env.DB)return null;const jdm=await runJdmIncremental(env);await seedMarketRefreshQueue(env);await prioritizeExpiredScopes(env);const row=await env.DB.prepare('SELECT country,area,kind,next_check_at FROM market_refresh_state WHERE next_check_at<=? ORDER BY next_check_at ASC LIMIT 1').bind(Date.now()).first();if(!row)return{joursDeMarche:jdm,marketRefresh:null};try{return{joursDeMarche:jdm,marketRefresh:await refreshMarketScope(env,row)}}catch(e){await env.DB.prepare('UPDATE market_refresh_state SET next_check_at=?,last_check_at=?,last_status=?,last_message=? WHERE country=? AND area=? AND kind=?').bind(Date.now()+6*3600000,Date.now(),'error',String(e&&e.message||e).slice(0,250),row.country,row.area,row.kind).run();return{joursDeMarche:jdm,marketRefresh:null}}}

// V343 — Actualisation UNIQUEMENT des événements spéciaux.
// Marchés hebdomadaires : ne pas modifier / ne pas rescanner ici.
// Brocantes, braderies et foires : chaque zone est réactualisée tous les 90 jours.
// Marchés de voyageurs : chaque zone est réactualisée tous les 60 jours.
const SPECIAL_EVENT_REFRESH_DAYS = { brocante: 90, voyageur: 60 };
async function ensureSpecialEventRefreshTable(env){
  await ensureMarketTable(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_special_refresh_state(
    country TEXT NOT NULL, area TEXT NOT NULL, kind TEXT NOT NULL,
    next_check_at INTEGER NOT NULL DEFAULT 0, last_check_at INTEGER NOT NULL DEFAULT 0,
    last_found INTEGER NOT NULL DEFAULT 0, last_message TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(country,area,kind)
  )`).run();
  try{await env.DB.prepare('CREATE INDEX IF NOT EXISTS market_special_refresh_due ON market_special_refresh_state(next_check_at)').run()}catch(_){}
}
async function seedSpecialEventRefreshQueue(env){
  await ensureSpecialEventRefreshTable(env);
  const now=Date.now(), jobs=[];
  // Brocantes / braderies / foires : France + Belgique.
  for(let i=0;i<MARKET_REFRESH_FR_AREAS.length;i++) jobs.push(env.DB.prepare(`INSERT OR IGNORE INTO market_special_refresh_state(country,area,kind,next_check_at) VALUES('FR',?,'brocante',?)`).bind(MARKET_REFRESH_FR_AREAS[i],now+i*60000));
  for(let i=0;i<MARKET_REFRESH_BE_AREAS.length;i++) jobs.push(env.DB.prepare(`INSERT OR IGNORE INTO market_special_refresh_state(country,area,kind,next_check_at) VALUES('BE',?,'brocante',?)`).bind(MARKET_REFRESH_BE_AREAS[i].toUpperCase(),now+i*60000));
  // Marchés de voyageurs : même couverture géographique pour pouvoir découvrir de nouvelles fiches.
  for(let i=0;i<MARKET_REFRESH_FR_AREAS.length;i++) jobs.push(env.DB.prepare(`INSERT OR IGNORE INTO market_special_refresh_state(country,area,kind,next_check_at) VALUES('FR',?,'voyageur',?)`).bind(MARKET_REFRESH_FR_AREAS[i],now+(i+5)*60000));
  for(let i=0;i<MARKET_REFRESH_BE_AREAS.length;i++) jobs.push(env.DB.prepare(`INSERT OR IGNORE INTO market_special_refresh_state(country,area,kind,next_check_at) VALUES('BE',?,'voyageur',?)`).bind(MARKET_REFRESH_BE_AREAS[i].toUpperCase(),now+(i+5)*60000));
  for(let i=0;i<jobs.length;i+=40) await env.DB.batch(jobs.slice(i,i+40));
}
async function refreshSpecialEventScope(env,state){
  const country=String(state.country||'FR').toUpperCase(), area=String(state.area||'').toUpperCase(), kind=String(state.kind||'brocante').toLowerCase();
  if(!(kind in SPECIAL_EVENT_REFRESH_DAYS)) return null;
  let found=0, parts=[];
  if(kind==='brocante'){
    const a=await refreshBrocanteScope(env,country,area); found+=a.count; parts.push('agenda:'+a.count);
    if(country==='FR'){
      const d=await refreshDatatourismeScope(env,area,'brocante'); found+=d.count; parts.push(d.skipped||('DATAtourisme:'+d.count));
    }
  }else if(kind==='voyageur'){
    if(country==='FR'){
      const d=await refreshDatatourismeScope(env,area,'voyageur'); found+=d.count; parts.push(d.skipped||('DATAtourisme:'+d.count));
    }
  }
  // Réactualise aussi les coordonnées et modalités d'inscription des fiches déjà connues.
  const rechecked=await refreshExistingSourceRows(env,country,area,kind); parts.push('coordonnées/formulaire:'+rechecked);
  const now=Date.now(), days=SPECIAL_EVENT_REFRESH_DAYS[kind], next=now+days*86400000;
  await env.DB.prepare(`UPDATE market_special_refresh_state SET next_check_at=?,last_check_at=?,last_found=?,last_message=? WHERE country=? AND area=? AND kind=?`)
    .bind(next,now,found,parts.join(' · ').slice(0,300),country,area,kind).run();
  return {country,area,kind,found,nextCheckAt:next,message:parts.join(' · ')};
}
async function runSpecialEventRefresh(env){
  if(!env.DB)return null;
  await seedSpecialEventRefreshQueue(env);
  // Une seule zone par heure : charge CPU / sous-requêtes limitée.
  const row=await env.DB.prepare(`SELECT country,area,kind,next_check_at FROM market_special_refresh_state WHERE next_check_at<=? ORDER BY next_check_at ASC,country,kind,area LIMIT 1`).bind(Date.now()).first();
  if(!row)return null;
  try{return await refreshSpecialEventScope(env,row)}
  catch(e){
    await env.DB.prepare(`UPDATE market_special_refresh_state SET next_check_at=?,last_check_at=?,last_message=? WHERE country=? AND area=? AND kind=?`)
      .bind(Date.now()+12*3600000,Date.now(),('ERREUR: '+String(e&&e.message||e)).slice(0,300),row.country,row.area,row.kind).run();
    return null;
  }
}

async function marketRefreshStatus(env){await ensureMarketRefreshTables(env);await ensureJdmRefreshTable(env);const last=await env.DB.prepare('SELECT country,area,kind,last_check_at,last_status,last_found,last_message,next_check_at FROM market_refresh_state ORDER BY last_check_at DESC LIMIT 12').all();const due=await env.DB.prepare('SELECT COUNT(*) n FROM market_refresh_state WHERE next_check_at<=?').bind(Date.now()).first();const jdm=await env.DB.prepare('SELECT area,city_cursor,city_count,last_check_at,last_found,last_pages,last_message,next_check_at FROM market_jdm_refresh_state ORDER BY last_check_at DESC LIMIT 12').all();const jdmDue=await env.DB.prepare('SELECT COUNT(*) n FROM market_jdm_refresh_state WHERE next_check_at<=?').bind(Date.now()).first();return json({ok:true,mode:'progressif',due:Number(due&&due.n||0),last:last.results||[],joursDeMarche:{due:Number(jdmDue&&jdmDue.n||0),last:jdm.results||[]},serverTime:Date.now()})}

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
  try{await env.DB.prepare("CREATE INDEX IF NOT EXISTS market_consensus_disabled_idx ON market_verification_consensus(field,value_norm,updated_at DESC)").run()}catch(_){}
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

function workersAiBinding(env){return env&&(env.AI||env.ai||env.WORKERS_AI||env.WorkersAI)||null}

function parseVisionJson(value) {
  const text = String(value && (value.response || value.result || value.choices?.[0]?.message?.content) || value || "")
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (_) { return null; }
}

async function inspectMarketPhoto(env, dataUrl) {
  const ai=workersAiBinding(env); if (!ai) return { ok: true, validationMode: "fallback", stallCount: 0, qualityScore: 55, reason: "Contrôle automatique indisponible : photo acceptée avec confirmation utilisateur et GPS." };
  try {
    const response = await ai.run("@cf/google/gemma-4-26b-a4b-it", {
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

async function saveMarketPhoto(env, marketKey, deviceId, photo, locationOverride = false, photoOverride = false, adminOverride = false) {
  if (photo.generalView !== true && !adminOverride) return { ok: false, error: "VUE_GENERALE_NON_CONFIRMEE" };
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
  } else if (!adminOverride && distance > Math.max(accuracy, 30)) return { ok:false, error:"GPS_ET_PHOTO_NON_COHERENTS" };

  const bytes = decodePhoto(photo.dataUrl);
  if (!bytes) return { ok: false, error: "PHOTO_INVALIDE_OU_TROP_LOURDE" };
  const inspection = adminOverride ? {ok:true,validationMode:"admin",stallCount:0,qualityScore:100,reason:"Photo remplacée par l’administrateur"} : await inspectMarketPhoto(env, photo.dataUrl);
  if (!inspection.ok) return inspection;

  const current = await env.DB.prepare("SELECT quality_score,replacement_count,device_id FROM market_photo_metadata WHERE market_key=?").bind(marketKey).first();
  const replacementsUsed = current ? Math.max(0,Number(current.replacement_count||0)) : 0;
  if (current && replacementsUsed >= 2 && !photoOverride) return { ok:false, error:"PHOTO_VERROUILLEE_APRES_2_REMPLACEMENTS", replacementsUsed:2, replacementsRemaining:0 };
  if (current && !photoOverride) {
    if ((inspection.validationMode||'ai') === 'fallback') return { ok:true, keptExisting:true, message:"CONTROLE_AUTO_INDISPONIBLE_PHOTO_EXISTANTE_CONSERVEE", qualityScore:inspection.qualityScore, stallCount:inspection.stallCount, distanceMeters:Math.round(distance), replacementsUsed, replacementsRemaining:Math.max(0,2-replacementsUsed), validationMode:'fallback' };
    if (Number(inspection.qualityScore||0) <= Number(current.quality_score||0)) return { ok:true, keptExisting:true, message:"LA_PHOTO_EXISTANTE_EST_MEILLEURE_OU_EQUIVALENTE", qualityScore:inspection.qualityScore, stallCount:inspection.stallCount, distanceMeters:Math.round(distance), replacementsUsed, replacementsRemaining:Math.max(0,2-replacementsUsed), validationMode:inspection.validationMode||'ai' };
  }

  const photoHash = await sha256Text(marketKey);
  let objectKey = env.MARKET_PHOTOS ? `market-photos/${photoHash}.jpg` : `d1:${photoHash}`, stored = false;
  if (env.MARKET_PHOTOS) {
    try {
      await env.MARKET_PHOTOS.put(objectKey, bytes, { httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=3600" } });
      stored = true;
      try { await env.DB.prepare("DELETE FROM market_photo_blobs WHERE market_key=?").bind(marketKey).run(); } catch (_) {}
    } catch (_) {
      // Si R2 est temporairement indisponible, on garde une copie de secours dans D1
      // afin que l'envoi de l'utilisateur ne soit pas perdu.
    }
  }
  if (!stored) {
    try {
      const encoded = String(photo.dataUrl || "").replace(/^data:image\/(?:jpeg|jpg);base64,/i, "");
      objectKey = `d1:${photoHash}`;
      await env.DB.prepare(`INSERT INTO market_photo_blobs(market_key,data_base64,mime_type,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(market_key) DO UPDATE SET data_base64=excluded.data_base64,mime_type=excluded.mime_type,updated_at=CURRENT_TIMESTAMP`)
        .bind(marketKey, encoded, "image/jpeg").run();
      stored = true;
    } catch (_) {}
  }
  if (!stored) return { ok:false, error:"STOCKAGE_PHOTO_INDISPONIBLE" };
  const capturedAt = new Date().toISOString(), newReplacementCount=current?replacementsUsed+1:0;
  await env.DB.prepare(`INSERT INTO market_photo_metadata(market_key,object_key,mime_type,device_id,user_latitude,user_longitude,market_latitude,market_longitude,distance_meters,quality_score,stall_count,ai_reason,replacement_count,captured_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(market_key) DO UPDATE SET object_key=excluded.object_key,mime_type=excluded.mime_type,device_id=excluded.device_id,user_latitude=excluded.user_latitude,user_longitude=excluded.user_longitude,market_latitude=excluded.market_latitude,market_longitude=excluded.market_longitude,distance_meters=excluded.distance_meters,quality_score=excluded.quality_score,stall_count=excluded.stall_count,ai_reason=excluded.ai_reason,replacement_count=excluded.replacement_count,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(marketKey, objectKey, "image/jpeg", deviceId, userLat, userLon, marketLat, marketLon, distance, inspection.qualityScore, inspection.stallCount, inspection.reason, newReplacementCount, capturedAt).run();
  await env.DB.prepare(`INSERT INTO market_photo_uploads(market_key,device_id,uploaded_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(market_key,device_id) DO UPDATE SET uploaded_at=CURRENT_TIMESTAMP`).bind(marketKey, deviceId).run();
  return { ok:true, replaced:!!current, distanceMeters:Math.round(distance), stallCount:inspection.stallCount, qualityScore:inspection.qualityScore, capturedAt, replacementsUsed:newReplacementCount, replacementsRemaining:Math.max(0,2-newReplacementCount), locked:newReplacementCount>=2, validationMode:inspection.validationMode||"ai" };
}

async function submitMarketVerificationCore(request, env) {
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
    grantRow=await env.DB.prepare("SELECT id,scope,token_hash,status,grant_expires_at,consumed,market_key,market_name,requester_name,device_id FROM gps_unlock_requests WHERE id=?").bind(String(data.gpsUnlockId)).first();
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
    photo = await saveMarketPhoto(env, marketKey, deviceId, data.photo, locationOverride, photoOverride, isAdminRequest);
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
  if(grantUsed&&grantRow){await env.DB.prepare("UPDATE gps_unlock_requests SET consumed=1,status='consumed',updated_at=? WHERE id=? AND consumed=0").bind(Date.now(),grantRow.id).run();await recordMarketUpdateAnnouncement(env,grantRow,grantRow.scope);}
  if(confirmsPresence){await env.DB.prepare(`INSERT INTO market_verification_consensus(market_key,field,value_norm,value_display,confirmations,updated_at) VALUES(?,'exists','oui','Oui',1,CURRENT_TIMESTAMP) ON CONFLICT(market_key,field) DO UPDATE SET value_norm='oui',value_display='Oui',confirmations=1,updated_at=CURRENT_TIMESTAMP`).bind(marketKey).run();}
  if(photo&&photo.ok&&!isAdminRequest) await queueContestMarketReview(env,deviceId,marketKey,String(data.marketName||'Marché'),photo);
  return json({ ok: true, required: 1, locationRequired:1, results, photo, locationResult, locationVote, state: await marketVerificationState(env, marketKey) });
}


async function submitMarketVerification(request, env) {
  try {
    return await submitMarketVerificationCore(request, env);
  } catch (error) {
    const detail = String(error && error.message || error || "ERREUR_INCONNUE").slice(0, 180);
    try { console.error("market-verifications", detail); } catch (_) {}
    return json({ ok:false, error:"ERREUR_SERVEUR_VERIFICATION" }, 500);
  }
}

async function getMarketVerification(url, env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE" }, 503);
  const marketKey = cleanMarketKey(url.searchParams.get("marketKey"));
  if (!marketKey) return json({ ok: false, error: "MARCHE_INVALIDE" }, 400);
  return json({ ok: true, ...(await marketVerificationState(env, marketKey)) });
}


async function adminMarketVerificationForms(request, env) {
  if (!(await adminAuthorized(request, env))) return json({ok:false,error:"SECRET_INCORRECT"},401);
  if (!env.DB) return json({ok:false,error:"DB_INDISPONIBLE"},503);
  await ensureMarketVerificationTables(env);

  const rows=await env.DB.prepare(`
    SELECT market_key,field,value_display,confirmations,updated_at
    FROM market_verification_consensus
    ORDER BY updated_at DESC
    LIMIT 3000
  `).all();

  const map=new Map();
  const ensure=(key)=>{
    key=String(key||"");
    if(!map.has(key)){
      let raw=key.replace(/^marketVerifyV9:/,""),country="",parts=[];
      const c=raw.indexOf(":");
      if(c>=0){country=raw.slice(0,c);raw=raw.slice(c+1)}
      parts=raw.split("|");
      const name=String(parts[2]||parts[0]||"Marché");
      const city=String(parts[3]||"");
      const day=String(parts[4]||"");
      map.set(key,{marketKey:key,country,name,city,day,values:{},updatedAt:""});
    }
    return map.get(key);
  };

  for(const row of rows.results||[]){
    const item=ensure(row.market_key);
    item.values[String(row.field||"")]=String(row.value_display||"");
    if(!item.updatedAt||String(row.updated_at||"")>item.updatedAt)item.updatedAt=String(row.updated_at||"");
  }

  const photos=await env.DB.prepare("SELECT market_key,updated_at FROM market_photo_metadata ORDER BY updated_at DESC LIMIT 1000").all();
  for(const row of photos.results||[]){const item=ensure(row.market_key);item.hasPhoto=true;if(!item.updatedAt||String(row.updated_at||"")>item.updatedAt)item.updatedAt=String(row.updated_at||"")}
  const locs=await env.DB.prepare("SELECT market_key,address,updated_at FROM market_location_consensus ORDER BY updated_at DESC LIMIT 1000").all();
  for(const row of locs.results||[]){const item=ensure(row.market_key);item.address=String(row.address||"");if(!item.updatedAt||String(row.updated_at||"")>item.updatedAt)item.updatedAt=String(row.updated_at||"")}

  const forms=[...map.values()].sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||""))).slice(0,500);
  return json({ok:true,forms});
}

async function batchMarketVerifications(request, env) {
  if (!env.DB) return json({ ok: false, error: "DB_INDISPONIBLE" }, 503);
  await ensureMarketVerificationTables(env);
  const data = await body(request);
  const keys = [...new Set((Array.isArray(data.keys) ? data.keys : []).map(cleanMarketKey).filter(Boolean))].slice(0, 200);
  const states = {};
  for (const key of keys) states[key] = { marketKey:key, required:1, fieldsLocked:true, locationRequired:1, locationVotes:0, values:{}, leaders:{}, photo:null, location:null };
  if (!keys.length) return json({ ok:true, required:MARKET_CONSENSUS_REQUIRED, states });

  // V333 CPU : ancien code = jusqu'à 5 requêtes D1 PAR marché (plus de 1000 requêtes pour 200 cartes).
  // On charge maintenant tous les états en 5 requêtes D1 au total.
  const ph = keys.map(()=>'?').join(',');
  const consensus = await env.DB.prepare(`SELECT market_key,field,value_display,confirmations,updated_at FROM market_verification_consensus WHERE market_key IN (${ph})`).bind(...keys).all();
  for (const row of consensus.results || []) {
    const st=states[String(row.market_key||'')]; if(!st) continue;
    st.values[row.field]={value:row.value_display,confirmations:Number(row.confirmations||1),updatedAt:row.updated_at,locked:true};
  }

  const pending = await env.DB.prepare(`SELECT market_key,field,value_display,COUNT(DISTINCT device_id) AS confirmations FROM market_verification_votes WHERE market_key IN (${ph}) GROUP BY market_key,field,value_norm,value_display ORDER BY market_key,field,confirmations DESC`).bind(...keys).all();
  for (const row of pending.results || []) {
    const st=states[String(row.market_key||'')]; if(!st || st.values[row.field] || st.leaders[row.field]) continue;
    st.leaders[row.field]={value:row.value_display,confirmations:Number(row.confirmations||0),required:1};
  }

  const photos = await env.DB.prepare(`SELECT market_key,distance_meters,quality_score,stall_count,replacement_count,captured_at,updated_at FROM market_photo_metadata WHERE market_key IN (${ph})`).bind(...keys).all();
  for (const row of photos.results || []) {
    const key=String(row.market_key||''),st=states[key]; if(!st) continue;
    const replacementsUsed=Math.max(0,Number(row.replacement_count||0));
    st.photo={url:`/api/market-photo?marketKey=${encodeURIComponent(key)}&v=${encodeURIComponent(row.updated_at)}`,distanceMeters:Math.round(Number(row.distance_meters)),qualityScore:Number(row.quality_score||0),stallCount:Number(row.stall_count||0),replacementsUsed,replacementsRemaining:Math.max(0,2-replacementsUsed),locked:replacementsUsed>=2,capturedAt:row.captured_at};
  }

  const locations = await env.DB.prepare(`SELECT market_key,latitude,longitude,address,confirmations,updated_at FROM market_location_consensus WHERE market_key IN (${ph})`).bind(...keys).all();
  for (const row of locations.results || []) {
    const st=states[String(row.market_key||'')]; if(!st) continue;
    st.location={latitude:Number(row.latitude),longitude:Number(row.longitude),address:row.address||'',confirmations:Number(row.confirmations||1),required:1,locked:true,updatedAt:row.updated_at};
  }

  const voteCounts = await env.DB.prepare(`SELECT market_key,COUNT(*) AS n FROM market_location_votes WHERE market_key IN (${ph}) GROUP BY market_key`).bind(...keys).all();
  for (const row of voteCounts.results || []) { const st=states[String(row.market_key||'')]; if(st) st.locationVotes=Number(row.n||0); }
  return json({ ok: true, required: MARKET_CONSENSUS_REQUIRED, states });
}


async function ensureMarketAttendanceTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_attendance (
    market_key TEXT NOT NULL,
    date_key TEXT NOT NULL,
    actor_key TEXT NOT NULL,
    device_id TEXT NOT NULL DEFAULT '',
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    trade TEXT NOT NULL DEFAULT '',
    market_name TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (market_key,date_key,actor_key)
  )`).run();
  try { await env.DB.prepare("CREATE INDEX IF NOT EXISTS market_attendance_date_idx ON market_attendance(date_key,market_key)").run(); } catch (_) {}
}
function marketDateKey(value) {
  const v=String(value||'').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:new Date().toISOString().slice(0,10);
}
async function marketAttendance(request,url,env) {
  if(!env.DB)return json({ok:false,error:'DB_INDISPONIBLE'},503);
  await ensureMarketAttendanceTable(env);
  if(request.method==='POST'){
    const d=await body(request),marketKey=cleanMarketKey(d.marketKey||d.market||''),dateKey=marketDateKey(d.date),deviceId=cleanIdentityText(d.deviceId||d.device||'',120);
    if(!marketKey||!deviceId)return json({ok:false,error:'MARCHE_OU_APPAREIL_MANQUANT'},400);
    const email=normalizeEmail(d.email||''),first=cleanIdentityText(d.firstName||d.first_name||'',80),last=cleanIdentityText(d.lastName||d.last_name||'',80),trade=cleanIdentityText(d.trade||'',80),marketName=cleanIdentityText(d.marketName||d.name||'Marché',180);
    const actorKey=email?('email:'+email):('device:'+deviceId);
    await env.DB.prepare(`INSERT INTO market_attendance(market_key,date_key,actor_key,device_id,first_name,last_name,email,trade,market_name,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(market_key,date_key,actor_key) DO UPDATE SET device_id=excluded.device_id,first_name=excluded.first_name,last_name=excluded.last_name,email=excluded.email,trade=excluded.trade,market_name=excluded.market_name,updated_at=excluded.updated_at`)
      .bind(marketKey,dateKey,actorKey,deviceId,first,last,email,trade,marketName,Date.now()).run();
    try{await env.DB.prepare("DELETE FROM market_attendance WHERE date_key < ?").bind(new Date(Date.now()-8*86400000).toISOString().slice(0,10)).run()}catch(_){}
    const c=await env.DB.prepare("SELECT COUNT(*) AS n FROM market_attendance WHERE market_key=? AND date_key=?").bind(marketKey,dateKey).first();
    return json({ok:true,count:Number(c&&c.n||0),marketKey,date:dateKey});
  }
  const marketKey=cleanMarketKey(url.searchParams.get('marketKey')||url.searchParams.get('market')||''),dateKey=marketDateKey(url.searchParams.get('date'));
  if(!marketKey)return json({ok:false,error:'MARCHE_MANQUANT'},400);
  const c=await env.DB.prepare("SELECT COUNT(*) AS n FROM market_attendance WHERE market_key=? AND date_key=?").bind(marketKey,dateKey).first();
  return json({ok:true,count:Number(c&&c.n||0),marketKey,date:dateKey});
}
async function marketAttendanceBatch(request,env){
  if(!env.DB)return json({ok:false,error:'DB_INDISPONIBLE'},503);
  await ensureMarketAttendanceTable(env);
  const d=await body(request),keys=[...new Set((Array.isArray(d.keys)?d.keys:[]).map(cleanMarketKey).filter(Boolean))].slice(0,250),dateKey=marketDateKey(d.date),counts={};
  for(const key of keys)counts[key]=0;
  if(keys.length){
    // V333 CPU : une seule requête GROUP BY au lieu d'une requête D1 par carte marché.
    const ph=keys.map(()=>'?').join(',');
    const rows=await env.DB.prepare(`SELECT market_key,COUNT(*) AS n FROM market_attendance WHERE date_key=? AND market_key IN (${ph}) GROUP BY market_key`).bind(dateKey,...keys).all();
    for(const row of rows.results||[])if(Object.prototype.hasOwnProperty.call(counts,String(row.market_key||'')))counts[String(row.market_key||'')]=Number(row.n||0);
  }
  return json({ok:true,date:dateKey,counts});
}
async function adminMarketAttendance(request,url,env){
  if(!(await adminAuthorized(request,env)))return json({ok:false,error:'SECRET_INCORRECT'},401);if(!env.DB)return json({ok:false,error:'DB_INDISPONIBLE'},503);await ensureMarketAttendanceTable(env);
  const marketKey=cleanMarketKey(url.searchParams.get('marketKey')||''),dateKey=marketDateKey(url.searchParams.get('date'));if(!marketKey)return json({ok:false,error:'MARCHE_MANQUANT'},400);
  const r=await env.DB.prepare("SELECT first_name,last_name,email,trade,updated_at FROM market_attendance WHERE market_key=? AND date_key=? ORDER BY updated_at DESC").bind(marketKey,dateKey).all();return json({ok:true,date:dateKey,people:r.results||[]});
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
const CONTEST_APP_FREE_EXTRA_MS=0;
const POST_PROMO_FIRST_TRIAL_MS=7*86400000;
const CONTEST_DIESEL_PRICE=2.40;
const CONTEST_REFERENCE_L_PER_100KM=7;
// Ancien repère conservé pour compatibilité avec le bouton de rattrapage.
// Depuis V300, les fiches terrain gagnent leurs points automatiquement et restent visibles
// à l’administrateur pour contrôle. Seuls les bugs / idées attendent une validation avant gain.
const CONTEST_EXISTING_FORMS_CATCHUP_CUTOFF=Date.parse("2026-09-19T07:43:00+02:00");
function contestRound2(v){return Math.round(((Number(v)||0)+Number.EPSILON)*100)/100}
function contestNumberText(v){
  const n=contestRound2(v);
  return n.toFixed(2).replace(/0+$/,'').replace(/[.,]$/,'').replace('.',',');
}
function contestMoneyText(v){return contestRound2(v).toFixed(2).replace('.',',')}
function contestDistanceFuel(km){
  const hundredths=Math.max(0,Math.floor((Number(km)||0)*100+1e-9));
  const usedKm=hundredths/100;
  const litersRaw=usedKm*CONTEST_REFERENCE_L_PER_100KM/100;
  const liters=contestRound2(litersRaw);
  const costEuro=contestRound2(litersRaw*CONTEST_DIESEL_PRICE);
  // 1 € réellement dépensé en gasoil = 1 point de déplacement.
  const points=costEuro;
  return {usedKm,liters,pricePerLiter:CONTEST_DIESEL_PRICE,costEuro,points};
}
function contestFuelBreakdownLabel(fuel){
  return `Trajet aller ${contestNumberText(fuel.usedKm)} km — ${contestMoneyText(fuel.liters)} L × ${contestMoneyText(fuel.pricePerLiter)} €/L = ${contestMoneyText(fuel.costEuro)} €`;
}

function contestTravelFuelForParticipant(p,destLat,destLon){
  const campingOn=Number(p&&p.camping_active)===1&&Number.isFinite(Number(p&&p.camping_lat))&&Number.isFinite(Number(p&&p.camping_lon));
  const startLat=campingOn?Number(p.camping_lat):(Number.isFinite(Number(p&&p.return_place_lat))?Number(p.return_place_lat):Number(p&&p.home_lat));
  const startLon=campingOn?Number(p.camping_lon):(Number.isFinite(Number(p&&p.return_place_lon))?Number(p.return_place_lon):Number(p&&p.home_lon));
  const hasStart=Number.isFinite(startLat)&&Number.isFinite(startLon)&&!(startLat===0&&startLon===0)&&Number.isFinite(Number(destLat))&&Number.isFinite(Number(destLon));
  const rawKm=hasStart?contestKm(startLat,startLon,Number(destLat),Number(destLon)):0;
  return {campingOn,startLat,startLon,hasStart,fuel:contestDistanceFuel(rawKm)};
}
async function contestRetractScoreEvent(env,subscriptionId,sourceType,sourceId){
  const row=await env.DB.prepare("SELECT id,awarded_points FROM contest_score_events WHERE subscription_id=? AND source_type=? AND source_id=? LIMIT 1").bind(subscriptionId,sourceType,sourceId).first();
  if(!row)return 0;
  const pts=contestRound2(Number(row.awarded_points||0));
  await env.DB.prepare("DELETE FROM contest_score_events WHERE id=?").bind(row.id).run();
  await env.DB.prepare("UPDATE contest_participants SET points=MAX(0,ROUND(points-?,2)),updated_at=? WHERE subscription_id=?").bind(pts,Date.now(),subscriptionId).run();
  return pts;
}
function contestMushroomBreakdown(baseInfo,fuel,hasStart){
  const items=[{key:'mushroom',label:'Fiche Champignons enregistrée',points:Number(baseInfo||MUSHROOM_CONTEST_POINTS)}];
  if(hasStart)items.push({key:'distance',label:contestFuelBreakdownLabel(fuel),points:fuel.points,liters:fuel.liters,pricePerLiter:fuel.pricePerLiter,costEuro:fuel.costEuro});
  return items;
}

// V297 : remet aussi les ANCIENS trajets déjà validés au tarif actuel de 2,40 €/L.
// Le calcul est idempotent : on repart du détail de chaque fiche, puis on applique uniquement
// la différence au total du participant. Les autres gains (bugs, parrainages, champignons, etc.)
// sont conservés tels quels.
async function contestRepriceHistoricalFuelV297(env){
  const migrationKey='contest-fuel-240-v297';
  try{
    const done=await env.DB.prepare("SELECT key FROM contest_migrations WHERE key=? LIMIT 1").bind(migrationKey).first();
    if(done)return {ok:true,already:true,participants:0,marketForms:0,deltaPoints:0};
    const rows=(await env.DB.prepare("SELECT subscription_id,market_key,distance_km,points,base_points,multiplier,breakdown_json FROM contest_market_points ORDER BY awarded_at,id").all()).results||[];
    const deltas=new Map();let changed=0,totalDelta=0;
    for(const r of rows){
      let items=[];try{items=JSON.parse(r.breakdown_json||'[]')}catch(_){items=[]}
      const idx=items.findIndex(x=>x&&x.key==='distance');if(idx<0)continue;
      const oldDistance=Number(items[idx]&&items[idx].points||0),oldAwarded=Number(r.points||0),oldBase=Number(r.base_points||oldAwarded),infoBase=Math.max(0,oldBase-oldDistance),fuel=contestDistanceFuel(r.distance_km),newBase=contestRound2(infoBase+fuel.points),mult=Math.max(1,Number(r.multiplier||1)),newAwarded=contestRound2(newBase*mult),delta=contestRound2(newAwarded-oldAwarded);
      items[idx]=Object.assign({},items[idx],{label:contestFuelBreakdownLabel(fuel),points:fuel.points,liters:fuel.liters,pricePerLiter:fuel.pricePerLiter,costEuro:fuel.costEuro});
      const breakdown=JSON.stringify(items);
      await env.DB.prepare("UPDATE contest_market_points SET points=?,base_points=?,breakdown_json=? WHERE subscription_id=? AND market_key=?").bind(newAwarded,newBase,breakdown,r.subscription_id,r.market_key).run();
      await env.DB.prepare("UPDATE contest_market_reviews SET points=?,base_points=?,breakdown_json=? WHERE subscription_id=? AND market_key=? AND status='approved'").bind(newAwarded,newBase,breakdown,r.subscription_id,r.market_key).run();
      await env.DB.prepare("UPDATE contest_score_events SET base_points=?,multiplier=?,awarded_points=? WHERE subscription_id=? AND source_type='market' AND source_id=?").bind(newBase,mult,newAwarded,r.subscription_id,r.market_key).run();
      if(Math.abs(delta)>0.0000001){deltas.set(Number(r.subscription_id),contestRound2(Number(deltas.get(Number(r.subscription_id))||0)+delta));totalDelta=contestRound2(totalDelta+delta);changed++}
    }
    for(const [sid,delta] of deltas)await env.DB.prepare("UPDATE contest_participants SET points=ROUND(points+?,2),updated_at=? WHERE subscription_id=?").bind(delta,Date.now(),sid).run();
    await env.DB.prepare("UPDATE contest_participants SET points=ROUND(points,2)").run();
    await env.DB.prepare("INSERT OR REPLACE INTO contest_migrations(key,applied_at) VALUES(?,?)").bind(migrationKey,Date.now()).run();
    return {ok:true,already:false,participants:deltas.size,marketForms:changed,deltaPoints:contestRound2(totalDelta)};
  }catch(e){return {ok:false,error:String(e&&e.message||e)}}
}
function contestDurationText(ms){const h=Math.max(1,Math.round(Number(ms||0)/3600000));return h%24===0?(h/24)+" jour"+((h/24)>1?"s":""):h+" heures"}

async function contestAutoEnrollIdentityV303(env,cfg,identity){
  const now=Date.now(),email=normalizeEmail(identity&&identity.email),first=contestCleanName(identity&&identity.first_name),last=contestCleanName(identity&&identity.last_name),deviceId=String(identity&&identity.device_id||'').trim();
  if(!validEmail(email)||email.includes('***')||first.length<2||last.length<2)return {ok:false,skipped:true};
  const hasDevice=validDevice(deviceId),emailHash=await sha256Text(email);
  let sub=hasDevice?await env.DB.prepare("SELECT * FROM subscriptions WHERE lower(COALESCE(recovery_email_mask,''))=? OR phone_device=? OR autoradio_device=? ORDER BY CASE WHEN lower(COALESCE(recovery_email_mask,''))=? THEN 0 ELSE 1 END,lifetime DESC,COALESCE(expires_at,'') DESC,id DESC LIMIT 1").bind(email,deviceId,deviceId,email).first():await env.DB.prepare("SELECT * FROM subscriptions WHERE lower(COALESCE(recovery_email_mask,''))=? ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC,id DESC LIMIT 1").bind(email).first();
  if(!sub&&hasDevice){
    const endAt=Number(cfg&&cfg.end_at||contestFiveMonthEnd(now)),trialHash=await sha256Text("contest-trial:"+deviceId),trialEmailHash=await sha256Text("contest-trial-email:"+deviceId+":"+email);
    await env.DB.prepare("INSERT INTO subscriptions(code_hash,expires_at,lifetime,active,phone_device,recovery_email_hash,recovery_email_mask,account_first_name,account_last_name,account_updated_at) VALUES(?,?,0,1,?,?,?,?,?,?)").bind(trialHash,new Date(endAt).toISOString(),deviceId,trialEmailHash,email,first,last,now).run();
    sub=await env.DB.prepare("SELECT * FROM subscriptions WHERE phone_device=? ORDER BY id DESC LIMIT 1").bind(deviceId).first();
  }else if(sub){
    const storedFirst=contestCleanName(sub.account_first_name),storedLast=contestCleanName(sub.account_last_name),storedEmail=normalizeEmail(sub.recovery_email_mask);
    if(!storedFirst||!storedLast||!validEmail(storedEmail)){
      const updates=[],values=[];
      if(!storedFirst){updates.push('account_first_name=?');values.push(first)}
      if(!storedLast){updates.push('account_last_name=?');values.push(last)}
      if(!validEmail(storedEmail)){updates.push('recovery_email_mask=?');values.push(email)}
      if(!String(sub.recovery_email_hash||'').trim()){updates.push('recovery_email_hash=?');values.push(emailHash)}
      if(updates.length){updates.push('account_updated_at=?','updated_at=CURRENT_TIMESTAMP');values.push(now,sub.id);await env.DB.prepare(`UPDATE subscriptions SET ${updates.join(',')} WHERE id=?`).bind(...values).run()}
    }
  }
  if(!sub)return {ok:false,skipped:true};
  const participantDevice=hasDevice?deviceId:String(sub.phone_device||sub.autoradio_device||'').trim();
  const joinedAt=Math.max(Number(cfg&&cfg.start_at||now),Number(identity&&identity.created_at||sub.account_updated_at||now));
  // Une même adresse e-mail ne doit produire qu'une seule personne dans le concours,
  // même après changement ou réinstallation du téléphone.
  const sameEmail=await env.DB.prepare("SELECT subscription_id FROM contest_participants WHERE email_hash=? ORDER BY joined_at ASC LIMIT 1").bind(emailHash).first();
  if(sameEmail&&Number(sameEmail.subscription_id)!==Number(sub.id)){
    await env.DB.prepare("UPDATE contest_participants SET device_id=?,first_name=?,last_name=?,auto_enrolled=1,contest_excluded=0,updated_at=? WHERE subscription_id=?").bind(participantDevice,first,last,now,Number(sameEmail.subscription_id)).run();
    return {ok:true,subscriptionId:Number(sameEmail.subscription_id),existingByEmail:true};
  }
  await env.DB.prepare("INSERT OR IGNORE INTO contest_participants(subscription_id,device_id,first_name,last_name,email_hash,home_country,home_area,home_commune,home_lat,home_lon,points,banned,alert_count,change_allowed,auto_enrolled,contest_excluded,joined_at,updated_at) VALUES(?,?,?,?,?,'FR','','',0,0,0,0,0,1,1,0,?,?)")
    .bind(sub.id,participantDevice,first,last,emailHash,joinedAt,now).run();
  await env.DB.prepare("UPDATE contest_participants SET device_id=?,first_name=?,last_name=?,email_hash=?,auto_enrolled=1,contest_excluded=0,updated_at=? WHERE subscription_id=?")
    .bind(participantDevice,first,last,emailHash,now,sub.id).run();
  return {ok:true,subscriptionId:Number(sub.id)};
}

async function backfillContestParticipants(env,cfg){
  if(!env.DB||Date.now()>=Number(cfg&&cfg.end_at||0))return;
  try{
    const now=Date.now(),maintenanceKey='participants-backfill-v305',intervalMs=24*60*60*1000;
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS contest_maintenance_state(key TEXT PRIMARY KEY,last_run INTEGER NOT NULL)").run();
    const claim=await env.DB.prepare(`INSERT INTO contest_maintenance_state(key,last_run) VALUES(?,?)
      ON CONFLICT(key) DO UPDATE SET last_run=excluded.last_run WHERE contest_maintenance_state.last_run<?`).bind(maintenanceKey,now,now-intervalMs).run();
    if(Number(claim&&claim.meta&&claim.meta.changes||0)===0)return;
    await ensureAppIdentityTables(env);
    const seenEmails=new Set();
    const identities=(await env.DB.prepare("SELECT email,first_name,last_name,device_id,email_verified_at AS created_at FROM app_identities WHERE email_verified_at>0 AND email<>'' AND first_name<>'' AND last_name<>'' ORDER BY email_verified_at").all()).results||[];
    for(const identity of identities){try{
      const email=normalizeEmail(identity.email);if(seenEmails.has(email))continue;seenEmails.add(email);
      await contestAutoEnrollIdentityV303(env,cfg,identity);
    }catch(_){}}
    // V305 : les comptes déjà enregistrés avant la mise en place de la confirmation e-mail
    // sont conservés comme comptes existants. Ils ne doivent pas refaire le formulaire.
    // Le rattrapage ci-dessus remet aussi leurs participants au concours si nécessaire.
    // V310 : le compte administrateur participe et gagne des points comme les autres.
    // Il reste uniquement non éligible aux lots lors de la sélection finale des gagnants.
    const adminHash=await sha256Text(ONLY_ADMIN_EMAIL);
    await env.DB.prepare("UPDATE contest_participants SET contest_excluded=0,updated_at=? WHERE email_hash=? OR subscription_id IN (SELECT id FROM subscriptions WHERE lower(COALESCE(recovery_email_mask,''))=?)").bind(now,adminHash,ONLY_ADMIN_EMAIL).run();
  }catch(_){ }
}

async function initializeContestTablesV301(env){
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

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_participants(subscription_id INTEGER PRIMARY KEY,device_id TEXT NOT NULL,first_name TEXT NOT NULL,last_name TEXT NOT NULL,email_hash TEXT NOT NULL DEFAULT '',home_country TEXT NOT NULL DEFAULT 'FR',home_area TEXT NOT NULL,home_commune TEXT NOT NULL,home_lat REAL NOT NULL,home_lon REAL NOT NULL,return_place_lat REAL,return_place_lon REAL,return_place_label TEXT NOT NULL DEFAULT '',points REAL NOT NULL DEFAULT 0,banned INTEGER NOT NULL DEFAULT 0,alert_count INTEGER NOT NULL DEFAULT 0,change_allowed INTEGER NOT NULL DEFAULT 0,auto_enrolled INTEGER NOT NULL DEFAULT 0,contest_excluded INTEGER NOT NULL DEFAULT 0,joined_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`).run();
  for(const sql of ["ALTER TABLE contest_participants ADD COLUMN return_place_lat REAL","ALTER TABLE contest_participants ADD COLUMN return_place_lon REAL","ALTER TABLE contest_participants ADD COLUMN return_place_label TEXT NOT NULL DEFAULT ''","ALTER TABLE contest_participants ADD COLUMN camping_active INTEGER NOT NULL DEFAULT 0","ALTER TABLE contest_participants ADD COLUMN camping_lat REAL","ALTER TABLE contest_participants ADD COLUMN camping_lon REAL","ALTER TABLE contest_participants ADD COLUMN camping_label TEXT NOT NULL DEFAULT ''","ALTER TABLE contest_participants ADD COLUMN camping_updated_at INTEGER","ALTER TABLE contest_participants ADD COLUMN auto_enrolled INTEGER NOT NULL DEFAULT 0","ALTER TABLE contest_participants ADD COLUMN contest_excluded INTEGER NOT NULL DEFAULT 0"])try{await env.DB.prepare(sql).run()}catch(_){}
  await backfillContestParticipants(env,cfg);
  // V310 : réactive immédiatement Steve dans le concours, même si le rattrapage V305 a déjà tourné.
  try{const adminHash=await sha256Text(ONLY_ADMIN_EMAIL);await env.DB.prepare("UPDATE contest_participants SET contest_excluded=0,updated_at=? WHERE email_hash=? OR subscription_id IN (SELECT id FROM subscriptions WHERE lower(COALESCE(recovery_email_mask,''))=?)").bind(Date.now(),adminHash,ONLY_ADMIN_EMAIL).run()}catch(_){}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_market_points(id INTEGER PRIMARY KEY AUTOINCREMENT,subscription_id INTEGER NOT NULL,market_key TEXT NOT NULL,market_name TEXT NOT NULL,distance_km REAL NOT NULL,points REAL NOT NULL,base_points REAL NOT NULL DEFAULT 0,multiplier INTEGER NOT NULL DEFAULT 1,breakdown_json TEXT NOT NULL DEFAULT '{}',market_lat REAL,market_lon REAL,place_label TEXT NOT NULL DEFAULT '',awarded_at INTEGER NOT NULL,UNIQUE(subscription_id,market_key))`).run();
  for(const sql of ["ALTER TABLE contest_market_points ADD COLUMN base_points INTEGER NOT NULL DEFAULT 0","ALTER TABLE contest_market_points ADD COLUMN multiplier INTEGER NOT NULL DEFAULT 1","ALTER TABLE contest_market_points ADD COLUMN breakdown_json TEXT NOT NULL DEFAULT '{}'"])try{await env.DB.prepare(sql).run()}catch(_){}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_market_reviews(id TEXT PRIMARY KEY,subscription_id INTEGER NOT NULL,market_key TEXT NOT NULL,market_name TEXT NOT NULL,device_id TEXT NOT NULL,market_lat REAL NOT NULL,market_lon REAL NOT NULL,place_label TEXT NOT NULL DEFAULT '',photo_captured_at TEXT NOT NULL DEFAULT '',distance_km REAL NOT NULL,base_points INTEGER NOT NULL DEFAULT 0,multiplier INTEGER NOT NULL DEFAULT 1,points INTEGER NOT NULL,breakdown_json TEXT NOT NULL DEFAULT '{}',unusual INTEGER NOT NULL DEFAULT 0,previous_place TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,decided_at INTEGER,UNIQUE(subscription_id,market_key))`).run();
  for(const sql of ["ALTER TABLE contest_market_reviews ADD COLUMN base_points INTEGER NOT NULL DEFAULT 0","ALTER TABLE contest_market_reviews ADD COLUMN multiplier INTEGER NOT NULL DEFAULT 1","ALTER TABLE contest_market_reviews ADD COLUMN breakdown_json TEXT NOT NULL DEFAULT '{}'"])try{await env.DB.prepare(sql).run()}catch(_){}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_mushroom_reviews(
    id TEXT PRIMARY KEY,subscription_id INTEGER NOT NULL,spot_id TEXT NOT NULL UNIQUE,base_points INTEGER NOT NULL DEFAULT 50,
    awarded_points REAL NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,decided_at INTEGER
  )`).run();
  for(const sql of [
    "ALTER TABLE contest_mushroom_reviews ADD COLUMN distance_km REAL NOT NULL DEFAULT 0",
    "ALTER TABLE contest_mushroom_reviews ADD COLUMN multiplier INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE contest_mushroom_reviews ADD COLUMN breakdown_json TEXT NOT NULL DEFAULT '[]'"
  ])try{await env.DB.prepare(sql).run()}catch(_){}
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
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contest_migrations(key TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)`).run();
  for(const sql of [
    "CREATE INDEX IF NOT EXISTS contest_participants_ranking_idx ON contest_participants(banned,points DESC,joined_at ASC)",
    "CREATE INDEX IF NOT EXISTS contest_participants_eligible_ranking_v303_idx ON contest_participants(contest_excluded,banned,points DESC,joined_at ASC)",
    "CREATE INDEX IF NOT EXISTS contest_participants_email_v303_idx ON contest_participants(email_hash)",
    "CREATE INDEX IF NOT EXISTS contest_participants_device_idx ON contest_participants(device_id)",
    "CREATE INDEX IF NOT EXISTS contest_market_reviews_pending_idx ON contest_market_reviews(status,created_at DESC)",
    "CREATE INDEX IF NOT EXISTS contest_mushroom_reviews_pending_idx ON contest_mushroom_reviews(status,created_at DESC)",
    "CREATE INDEX IF NOT EXISTS contest_reports_pending_idx ON contest_reports(status,created_at DESC)",
    "CREATE INDEX IF NOT EXISTS contest_reports_fingerprint_idx ON contest_reports(fingerprint,status)",
    "CREATE INDEX IF NOT EXISTS contest_commune_pending_idx ON contest_commune_requests(status,created_at DESC)",
    "CREATE INDEX IF NOT EXISTS contest_travel_pending_idx ON contest_travel_alerts(status,created_at DESC)",
    "CREATE INDEX IF NOT EXISTS contest_travel_user_idx ON contest_travel_alerts(subscription_id,status,user_answer,created_at DESC)",
    "CREATE INDEX IF NOT EXISTS contest_messages_unread_idx ON contest_messages(subscription_id,read_at,created_at DESC)",
    "CREATE INDEX IF NOT EXISTS contest_market_points_sub_idx ON contest_market_points(subscription_id,awarded_at DESC)",
    "CREATE INDEX IF NOT EXISTS contest_market_reviews_sub_idx ON contest_market_reviews(subscription_id,market_key)",
    "CREATE INDEX IF NOT EXISTS contest_mushroom_reviews_sub_idx ON contest_mushroom_reviews(subscription_id,created_at DESC)"
  ])try{await env.DB.prepare(sql).run()}catch(_){}
  return cfg;
}

let _contestSchemaReadyV301=false,_contestSchemaInitPromiseV301=null;
async function ensureContestTables(env){
  if(_contestSchemaReadyV301){
    const cfg=await env.DB.prepare("SELECT * FROM contest_config WHERE id=1").first();
    if(cfg)return cfg;
    _contestSchemaReadyV301=false;
  }
  if(!_contestSchemaInitPromiseV301){
    _contestSchemaInitPromiseV301=initializeContestTablesV301(env).then(cfg=>{_contestSchemaReadyV301=true;return cfg}).catch(e=>{_contestSchemaInitPromiseV301=null;throw e});
  }
  return _contestSchemaInitPromiseV301;
}

async function contestSubscription(env,data){
  await ensureSubscriptionEmailColumns(env);const deviceId=String(data.deviceId||""),code=normalizeCode(data.subscriptionCode||data.code||""),identityEmail=normalizeEmail(data.email);let row=null;
  if(validDevice(deviceId)){row=validEmail(identityEmail)?await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) ORDER BY CASE WHEN lower(COALESCE(recovery_email_mask,''))=? THEN 0 ELSE 1 END,lifetime DESC,COALESCE(expires_at,'') DESC LIMIT 1").bind(deviceId,deviceId,identityEmail).first():await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC LIMIT 1").bind(deviceId,deviceId).first()}
  if(!row&&validCode(code)){const h=await hashCode(code,env.CODE_PEPPER);row=await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash=? AND active=1 LIMIT 1").bind(h).first()}
  if(!row)return null;if(!row.lifetime&&(!row.expires_at||Date.parse(row.expires_at)<=Date.now()))return null;return row;
}
async function isContestTrialRow(row){
  if(!row)return false;
  const previousDevice=String(row.phone_device||row.autoradio_device||"").trim();
  if(!previousDevice)return false;
  const expected=await sha256Text("contest-trial:"+previousDevice);
  return String(row.code_hash||"")===expected;
}
async function contestTrialIdentity(request,env){
  const cfg=await ensureContestTables(env),now=Date.now(),globalFreeUntil=Number(cfg.end_at)+CONTEST_APP_FREE_EXTRA_MS;
  const data=await body(request),deviceId=String(data.deviceId||""),email=normalizeEmail(data.email),firstName=contestCleanName(data.firstName),lastName=contestCleanName(data.lastName);
  if(!validDevice(deviceId))return json({ok:false,error:"DONNEES_INVALIDES"},400);
  if(firstName.length<2||lastName.length<2)return json({ok:false,error:"NOM_PRENOM_OBLIGATOIRES"},400);
  if(!validEmail(email))return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);
  await ensureAppIdentityTables(env);
  const verifiedIdentity=await env.DB.prepare("SELECT email_verified_at,email_verified_device_id FROM app_identities WHERE lower(email)=? LIMIT 1").bind(email).first();
  if(!verifiedIdentity||Number(verifiedIdentity.email_verified_at||0)<=0||String(verifiedIdentity.email_verified_device_id||'')!==deviceId)return json({ok:false,error:"EMAIL_NON_CONFIRMEE",message:"Confirmez votre adresse e-mail depuis le lien reçu avant d’activer le compte."},403);
  const emailHash=await sha256Text(email),trialHash=await sha256Text("contest-trial:"+deviceId),trialEmailHash=await sha256Text("contest-trial-email:"+deviceId+":"+email);
  let row=await env.DB.prepare("SELECT * FROM subscriptions WHERE phone_device=? OR autoradio_device=? OR lower(COALESCE(recovery_email_mask,''))=? ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC LIMIT 1").bind(deviceId,deviceId,email).first();
  if(row){
    const isTrial=await isContestTrialRow(row);
    if(!isTrial){
      const storedFirst=String(row.account_first_name||"").trim(),storedLast=String(row.account_last_name||"").trim();
      const namesMatch=(!storedFirst||!storedLast)||(subscriptionIdentityKey(storedFirst)===subscriptionIdentityKey(firstName)&&subscriptionIdentityKey(storedLast)===subscriptionIdentityKey(lastName));
      const accountActive=!!row.lifetime||(row.expires_at&&Date.parse(row.expires_at)>now);
      if(!namesMatch||!accountActive){
        return json({ok:false,error:"ABONNEMENT_EXISTANT_A_RECUPERER",message:"Un abonnement existe déjà pour cette adresse e-mail. Récupérez votre compte avec les mêmes nom, prénom et e-mail."},409);
      }
      // V273 : après suppression/réinstallation, rattacher le nouveau téléphone
      // au même compte permet de retrouver immédiatement la participation concours,
      // les points et le classement existants sans recréer une inscription.
      await env.DB.prepare("UPDATE subscriptions SET phone_device=?,account_first_name=?,account_last_name=?,account_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(deviceId,storedFirst||firstName,storedLast||lastName,now,row.id).run();
      return json({ok:true,existingAccount:true,email,firstName:storedFirst||firstName,lastName:storedLast||lastName,lifetime:!!row.lifetime,expiresAt:row.expires_at||null});
    }
    const existingExpiry=row.expires_at?Date.parse(row.expires_at):0;
    if(!existingExpiry||existingExpiry<=now){
      return json({ok:false,error:"ESSAI_DEJA_UTILISE",message:"Votre essai gratuit a déjà été utilisé. Un abonnement est maintenant nécessaire."},403);
    }
    // Même personne sur un téléphone réinstallé/changé : on conserve strictement la date de fin,
    // sans redonner 7 jours, et on rattache l'essai au nouvel appareil.
    await env.DB.prepare("UPDATE subscriptions SET code_hash=?,active=1,phone_device=?,autoradio_device=NULL,recovery_email_hash=?,recovery_email_mask=?,account_first_name=?,account_last_name=?,account_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(trialHash,deviceId,trialEmailHash,email,firstName,lastName,now,row.id).run();
    return json({ok:true,trial:true,trialMode:now<=globalFreeUntil?"global":"seven_day",existingTrial:true,email,firstName,lastName,expiresAt:new Date(existingExpiry).toISOString()});
  }
  // Pendant les 5 mois gratuits : tout nouvel utilisateur finit le même jour que la période globale.
  // Après ces 5 mois : chaque nouvelle personne dispose une seule fois de 7 jours gratuits.
  const expiryMs=now<=globalFreeUntil?globalFreeUntil:now+POST_PROMO_FIRST_TRIAL_MS;
  await env.DB.prepare("INSERT INTO subscriptions(code_hash,expires_at,lifetime,active,phone_device,recovery_email_hash,recovery_email_mask,account_first_name,account_last_name,account_updated_at) VALUES(?,?,0,1,?,?,?,?,?,?)")
    .bind(trialHash,new Date(expiryMs).toISOString(),deviceId,trialEmailHash,email,firstName,lastName,now).run();
  return json({ok:true,trial:true,trialMode:now<=globalFreeUntil?"global":"seven_day",newTrial:true,email,firstName,lastName,expiresAt:new Date(expiryMs).toISOString()});
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
  await ensureContestTables(env);const data=await body(request);
  // L'autoradio partage bien le même abonnement et les mêmes points, mais son bouton
  // « Retourner sur la place » reste uniquement un repère de navigation local au véhicule.
  // Il ne doit jamais devenir le point de départ utilisé pour calculer les points du concours.
  if(String(data.deviceType||'').toLowerCase()==='autoradio')return json({ok:true,participant:true,ignoredForPoints:true});
  const sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:'ABONNEMENT_REQUIS'},403);const p=await env.DB.prepare("SELECT * FROM contest_participants WHERE subscription_id=? AND banned=0").bind(sub.id).first();if(!p)return json({ok:true,participant:false});
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
  if(n>=5)await contestEnqueueBonus(env,subscriptionId,2,"5 fiches enregistrées","market-milestone-5");
  if(n>=15)await contestEnqueueBonus(env,subscriptionId,3,"10 nouvelles fiches enregistrées après le premier bonus","market-milestone-15");
  if(n>=40)await contestEnqueueBonus(env,subscriptionId,5,"25 nouvelles fiches enregistrées après le bonus ×3","market-milestone-40");
  return n;
}
function contestBonusProgress(n){n=Number(n||0);if(n<5)return {done:false,label:"Bonus ×2",current:n,target:5,remaining:5-n};if(n<15)return {done:false,label:"Bonus ×3",current:n-5,target:10,remaining:15-n};if(n<40)return {done:false,label:"Bonus ×5",current:n-15,target:25,remaining:40-n};return {done:true,label:"Tous les bonus fiches ont été gagnés",current:25,target:25,remaining:0}}

function contestDistanceMultiplier(distanceKm){
  const km=Number(distanceKm||0);
  if(km>=50)return 10;
  if(km>15)return 7;
  if(km>10)return 3;
  return 1;
}
const CONTEST_RANDOM_GIFT_MIN_V415=450,CONTEST_RANDOM_GIFT_MAX_V415=1250,CONTEST_RANDOM_GIFT_SOURCE_V415="gift-450-1250-v415";
function contestRandomGiftAmountV415(usedPoints){
  const used=usedPoints instanceof Set?usedPoints:new Set(),span=CONTEST_RANDOM_GIFT_MAX_V415-CONTEST_RANDOM_GIFT_MIN_V415+1;
  for(let i=0;i<span*2;i++){
    const a=new Uint32Array(1);crypto.getRandomValues(a);
    const points=CONTEST_RANDOM_GIFT_MIN_V415+(a[0]%span);
    if(!used.has(points))return points;
  }
  for(let points=CONTEST_RANDOM_GIFT_MIN_V415;points<=CONTEST_RANDOM_GIFT_MAX_V415;points++)if(!used.has(points))return points;
  const a=new Uint32Array(1);crypto.getRandomValues(a);
  return CONTEST_RANDOM_GIFT_MIN_V415+(a[0]%span);
}
async function contestEnsureRandomGiftV415(env,subscriptionId){
  const rows=(await env.DB.prepare("SELECT id,source_id,awarded_points FROM contest_score_events WHERE subscription_id=? AND source_type='random-gift' ORDER BY created_at,id").bind(subscriptionId).all()).results||[];
  const current=rows.find(r=>String(r.source_id||"")===CONTEST_RANDOM_GIFT_SOURCE_V415);
  if(current){
    const extras=rows.filter(r=>String(r.id)!==String(current.id));
    let removed=0;
    for(const r of extras){removed+=Number(r.awarded_points||0);await env.DB.prepare("DELETE FROM contest_score_events WHERE id=? AND subscription_id=? AND source_type='random-gift'").bind(r.id,subscriptionId).run()}
    if(removed)await env.DB.prepare("UPDATE contest_participants SET points=points-?,updated_at=? WHERE subscription_id=?").bind(removed,Date.now(),subscriptionId).run();
    return {awarded:true,points:Number(current.awarded_points||0),source:CONTEST_RANDOM_GIFT_SOURCE_V415};
  }
  const usedRows=(await env.DB.prepare("SELECT awarded_points FROM contest_score_events WHERE source_type='random-gift' AND source_id=?").bind(CONTEST_RANDOM_GIFT_SOURCE_V415).all()).results||[];
  const used=new Set(usedRows.map(r=>Number(r.awarded_points||0)).filter(n=>Number.isFinite(n)&&n>=CONTEST_RANDOM_GIFT_MIN_V415&&n<=CONTEST_RANDOM_GIFT_MAX_V415));
  const points=contestRandomGiftAmountV415(used);
  if(rows.length){
    const oldTotal=rows.reduce((sum,r)=>sum+Number(r.awarded_points||0),0),primary=rows[0];
    await env.DB.prepare("UPDATE contest_score_events SET source_id=?,description=?,base_points=?,multiplier=1,awarded_points=? WHERE id=? AND subscription_id=? AND source_type='random-gift'").bind(CONTEST_RANDOM_GIFT_SOURCE_V415,"Cadeau concours personnel 450 à 1250 points",points,points,primary.id,subscriptionId).run();
    for(let i=1;i<rows.length;i++)await env.DB.prepare("DELETE FROM contest_score_events WHERE id=? AND subscription_id=? AND source_type='random-gift'").bind(rows[i].id,subscriptionId).run();
    const delta=points-oldTotal;
    if(delta)await env.DB.prepare("UPDATE contest_participants SET points=points+?,updated_at=? WHERE subscription_id=?").bind(delta,Date.now(),subscriptionId).run();
    return {awarded:true,points,source:CONTEST_RANDOM_GIFT_SOURCE_V415};
  }
  const added=await contestAddScoreEvent(env,subscriptionId,"random-gift",CONTEST_RANDOM_GIFT_SOURCE_V415,"Cadeau concours personnel 450 à 1250 points",points,1,points);
  return {awarded:!!added,points:added?points:0,source:CONTEST_RANDOM_GIFT_SOURCE_V415};
}

async function contestBackfillRandomGiftsV415(env){
  const rows=(await env.DB.prepare("SELECT p.subscription_id FROM contest_participants p LEFT JOIN contest_score_events e ON e.subscription_id=p.subscription_id AND e.source_type='random-gift' AND e.source_id=? WHERE p.banned=0 AND COALESCE(p.contest_excluded,0)=0 AND e.id IS NULL LIMIT 500").bind(CONTEST_RANDOM_GIFT_SOURCE_V415).all()).results||[];
  for(const r of rows)await contestEnsureRandomGiftV415(env,r.subscription_id);
  return rows.length;
}

async function contestAddScoreEvent(env,subscriptionId,sourceType,sourceId,description,basePoints,multiplier,awardedPoints){
  // Garde-fou central : seuls les comptes bannis ou explicitement exclus sont bloqués.
  // V310 : le compte administrateur n'est plus exclu et gagne donc ses points normalement.
  const eligible=await env.DB.prepare("SELECT subscription_id FROM contest_participants WHERE subscription_id=? AND banned=0 AND COALESCE(contest_excluded,0)=0 LIMIT 1").bind(subscriptionId).first();
  if(!eligible)return false;
  const r=await env.DB.prepare("INSERT OR IGNORE INTO contest_score_events(id,subscription_id,source_type,source_id,description,base_points,multiplier,awarded_points,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(contestId(),subscriptionId,sourceType,sourceId,String(description||"").slice(0,200),Number(basePoints||0),Number(multiplier||1),Number(awardedPoints||0),Date.now()).run();
  if(r.meta&&Number(r.meta.changes)>0){await env.DB.prepare("UPDATE contest_participants SET points=points+?,updated_at=? WHERE subscription_id=?").bind(Number(awardedPoints||0),Date.now(),subscriptionId).run();return true}return false;
}
async function contestAddScoreWithActiveBonus(env,subscriptionId,sourceType,sourceId,description,basePoints){
  const eligible=await env.DB.prepare("SELECT subscription_id FROM contest_participants WHERE subscription_id=? AND banned=0 AND COALESCE(contest_excluded,0)=0 LIMIT 1").bind(subscriptionId).first();
  if(!eligible)return {added:false,multiplier:1,awardedPoints:0,excluded:true};
  const bonus=await contestRefreshBonusState(env,subscriptionId),multiplier=bonus.active?Math.max(1,Number(bonus.active.multiplier||1)):1,awardedPoints=contestRound2(Number(basePoints||0)*multiplier);
  const added=await contestAddScoreEvent(env,subscriptionId,sourceType,sourceId,description,basePoints,multiplier,awardedPoints);
  return {added,multiplier,awardedPoints};
}

const REFERRAL_SPONSOR_POINTS=320,REFERRAL_FRIEND_POINTS=96,ADMIN_REFERRAL_FRIEND_POINTS=250,REFERRAL_INVITE_MS=30*86400000,REFERRAL_EMAIL_MS=24*60*60000;
async function referralRewardProfile(env,sponsorSubscriptionId){
  const sponsor=await env.DB.prepare("SELECT recovery_email_mask FROM subscriptions WHERE id=? LIMIT 1").bind(sponsorSubscriptionId).first();
  const adminSponsor=normalizeEmail(sponsor&&sponsor.recovery_email_mask||"")===ONLY_ADMIN_EMAIL;
  return {adminSponsor,sponsorPoints:adminSponsor?0:REFERRAL_SPONSOR_POINTS,friendPoints:adminSponsor?ADMIN_REFERRAL_FRIEND_POINTS:REFERRAL_FRIEND_POINTS};
}
function referralToken(){const b=new Uint8Array(24);crypto.getRandomValues(b);let x="";for(const n of b)x+=String.fromCharCode(n);return btoa(x).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
async function referralMagicHash(id,token,env){return sha256Text("referral-magic:"+id+":"+token+":"+(env.CODE_PEPPER||"carplay-referral"))}
async function brevoSendHtml(env,to,subject,text,html){
  if(!validEmail(to)||!env.BREVO_API_KEY||!env.BREVO_SENDER_EMAIL)return false;
  try{
    const r=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{accept:"application/json","content-type":"application/json","api-key":String(env.BREVO_API_KEY)},body:JSON.stringify({sender:{name:"Couteau Suisse",email:String(env.BREVO_SENDER_EMAIL)},to:[{email:to}],subject,textContent:text,htmlContent:html})});
    return r.ok;
  }catch(_){return false}
}
async function sendReferralEmail(env,email,confirmUrl,firstName,friendPoints=REFERRAL_FRIEND_POINTS){
  const safeFirst=String(firstName||"").replace(/[<>&"']/g,""),pts=Number(friendPoints||0);
  const subject=`🎁 Bravo ! Vos ${pts} points Couteau Suisse vous attendent`;
  const text=`Bravo${safeFirst?" "+safeFirst:""} ! Vous venez d’installer Couteau Suisse grâce à un parrainage. Vous bénéficiez de ${pts} points. Appuyez sur ce lien pour en profiter : ${confirmUrl}`;
  const html=`<div style="margin:0;background:#07182d;padding:24px;font-family:Arial,sans-serif;color:#fff"><div style="max-width:620px;margin:auto;background:linear-gradient(180deg,#0d2f5a,#06172d);border:3px solid #f7c94b;border-radius:24px;padding:28px;text-align:center;box-shadow:0 12px 36px rgba(0,0,0,.35)"><div style="font-size:48px">🎁</div><h1 style="margin:8px 0;color:#ffd85a;font-size:31px">BRAVO${safeFirst?" "+safeFirst.toUpperCase():""} !</h1><p style="font-size:19px;line-height:1.5;margin:12px 0">Vous venez d’installer <b>Couteau Suisse</b> grâce à un parrainage.</p><div style="margin:22px auto;padding:18px;border-radius:18px;background:#0b7a42;font-size:22px;font-weight:900">VOUS GAGNEZ +${pts} POINTS</div><p style="font-size:17px;line-height:1.5">Appuyez sur le bouton pour valider votre adresse e-mail et profiter de vos points.</p><a href="${confirmUrl}" style="display:inline-block;margin:14px 0 4px;padding:17px 28px;background:#ffd43b;color:#07182d;text-decoration:none;border-radius:14px;font-size:19px;font-weight:900">ACTIVER MES ${pts} POINTS</a><p style="font-size:13px;color:#b8c7d9;margin-top:18px">Lien personnel valable 24 heures et utilisable une seule fois.</p></div></div>`;
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
  const rewardProfile=await referralRewardProfile(env,sub.id);
  return json({ok:true,url:new URL(request.url).origin+"/installer.html?ref="+encodeURIComponent(token),expiresAt:expires,sponsorPoints:rewardProfile.sponsorPoints,friendPoints:rewardProfile.friendPoints,adminSponsor:rewardProfile.adminSponsor});
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
  const sponsor=await env.DB.prepare("SELECT * FROM subscriptions WHERE id=? AND active=1 LIMIT 1").bind(invite.sponsor_subscription_id).first();if(!sponsor)return json({ok:false,error:"PARRAIN_INTROUVABLE"},404);
  const eh=await sha256Text(email);
  // V272 : on ne se fie plus uniquement à recovery_email_mask du parrain.
  // Une ancienne tentative faite depuis le même téléphone pouvait écraser ce champ avec
  // l'e-mail du filleul et provoquer ensuite le faux message « auto-parrainage ».
  // Le profil concours conserve une empreinte d'identité plus stable : on l'utilise en priorité.
  const sponsorParticipant=await env.DB.prepare("SELECT device_id,email_hash FROM contest_participants WHERE subscription_id=? LIMIT 1").bind(invite.sponsor_subscription_id).first();
  let sameSponsorEmail=false;
  if(sponsorParticipant&&String(sponsorParticipant.email_hash||"")){
    const stored=String(sponsorParticipant.email_hash||""),sponsorContestDevice=String(sponsorParticipant.device_id||"");
    const trialIdentity=sponsorContestDevice?await sha256Text("contest-trial-email:"+sponsorContestDevice+":"+email):"";
    sameSponsorEmail=stored===eh||!!trialIdentity&&stored===trialIdentity;
  }else sameSponsorEmail=normalizeEmail(sponsor.recovery_email_mask)===email;
  const sponsorContestDevice=String(sponsorParticipant&&sponsorParticipant.device_id||"");
  const sameSponsorDevice=String(sponsor.phone_device||"")===deviceId||String(sponsor.autoradio_device||"")===deviceId||!!sponsorContestDevice&&sponsorContestDevice===deviceId;
  if(sameSponsorEmail)return json({ok:false,error:"AUTO_PARRAINAGE_INTERDIT"},409);
  // Même identifiant appareil mais identité différente = identifiant copié/caché, pas auto-parrainage.
  if(sameSponsorDevice)return json({ok:false,error:"IDENTIFIANT_FILLEUL_A_RECREER"},409);
  const byEmail=await env.DB.prepare("SELECT referee_device_id FROM contest_referrals WHERE email_hash=? LIMIT 1").bind(eh).first(),byDevice=await env.DB.prepare("SELECT * FROM contest_referrals WHERE referee_device_id=? LIMIT 1").bind(deviceId).first();
  if(byEmail&&String(byEmail.referee_device_id)!==deviceId)return json({ok:false,error:"EMAIL_DEJA_PARRAINE"},409);if(byDevice&&String(byDevice.invite_id)!==String(invite.id))return json({ok:false,error:"APPAREIL_DEJA_PARRAINE"},409);
  const es=await env.DB.prepare("SELECT * FROM subscriptions WHERE lower(COALESCE(recovery_email_mask,''))=? AND active=1 ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC,id DESC LIMIT 1").bind(email).first();
  let sub=null;
  // V273 : un filleul peut déjà avoir son compte et participer au concours.
  // Dans ce cas on rattache le parrainage à CE compte existant au lieu de demander
  // un nouveau compte ou de bloquer parce que l'ancien téléphone est encore enregistré.
  if(es&&Number(es.id)!==Number(invite.sponsor_subscription_id)){
    const storedFirst=String(es.account_first_name||"").trim(),storedLast=String(es.account_last_name||"").trim();
    const namesMatch=(!storedFirst||!storedLast)||(subscriptionIdentityKey(storedFirst)===subscriptionIdentityKey(first)&&subscriptionIdentityKey(storedLast)===subscriptionIdentityKey(last));
    const accountActive=!!es.lifetime||(es.expires_at&&Date.parse(es.expires_at)>now);
    if(!namesMatch)return json({ok:false,error:"IDENTITE_NE_CORRESPOND_PAS"},403);
    if(!accountActive)return json({ok:false,error:"ABONNEMENT_EXPIRE"},403);
    await env.DB.prepare("UPDATE subscriptions SET phone_device=?,account_first_name=?,account_last_name=?,account_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(deviceId,storedFirst||first,storedLast||last,now,es.id).run();
    sub=await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(es.id).first();
  }
  if(!sub)sub=await ensureReferralTrialSubscription(env,deviceId,email,first,last);
  if(!sub)return json({ok:false,error:"COMPTE_IMPOSSIBLE"},500);
  // Dernier garde-fou : si une vieille donnée a encore rattaché ce nouvel appareil au compte
  // du parrain alors que l'identité e-mail est différente, on crée une fiche filleul séparée.
  if(Number(sub.id)===Number(invite.sponsor_subscription_id)){
    const freeUntil=Number(cfg.end_at)+CONTEST_APP_FREE_EXTRA_MS,trialHash=await sha256Text("contest-referee:"+deviceId+":"+email+":"+referralToken()),trialEmailHash=await sha256Text("contest-trial-email:"+deviceId+":"+email);
    await env.DB.prepare("INSERT INTO subscriptions(code_hash,expires_at,lifetime,active,phone_device,recovery_email_hash,recovery_email_mask,account_first_name,account_last_name,account_updated_at) VALUES(?,?,0,1,?,?,?,?,?,?)").bind(trialHash,new Date(freeUntil).toISOString(),deviceId,trialEmailHash,email,first,last,now).run();
    sub=await env.DB.prepare("SELECT * FROM subscriptions WHERE code_hash=? AND active=1 ORDER BY id DESC LIMIT 1").bind(trialHash).first();
    if(!sub||Number(sub.id)===Number(invite.sponsor_subscription_id))return json({ok:false,error:"COMPTE_IMPOSSIBLE"},500);
  }
  // Répare uniquement l'ancien cas impossible où le lien s'était réclamé lui-même.
  if(invite.claimed_subscription_id&&Number(invite.claimed_subscription_id)===Number(invite.sponsor_subscription_id)){
    await env.DB.prepare("UPDATE contest_referral_invites SET claimed_subscription_id=NULL,claimed_at=NULL WHERE id=? AND claimed_subscription_id=?").bind(invite.id,invite.sponsor_subscription_id).run();
    invite.claimed_subscription_id=null;invite.claimed_at=null;
  }
  if(invite.claimed_subscription_id&&Number(invite.claimed_subscription_id)!==Number(sub.id))return json({ok:false,error:"LIEN_PARRAINAGE_DEJA_UTILISE"},409);
  let row=byDevice&&String(byDevice.invite_id)===String(invite.id)?byDevice:null;if(row&&row.status==="verified"){const rewardProfile=await referralRewardProfile(env,invite.sponsor_subscription_id);return json({ok:true,alreadyVerified:true,referralId:row.id,emailMask:emailMask(email),sponsorPoints:rewardProfile.sponsorPoints,friendPoints:rewardProfile.friendPoints,adminSponsor:rewardProfile.adminSponsor});}if(row&&Number(row.sms_sent_at||0)>now-60000)return json({ok:false,error:"EMAIL_TROP_RAPIDE",referralId:row.id,emailMask:emailMask(email)},429);
  const day=parisDay(),usage=await env.DB.prepare("SELECT sent_count FROM brevo_daily_usage WHERE day=?").bind(day).first();if(Number(usage&&usage.sent_count||0)>=200)return json({ok:false,error:"QUOTA_EMAIL_JOURNALIER"},429);
  const id=row?row.id:contestId(),magic=referralToken(),ch=await referralMagicHash(id,magic,env),ih=await sha256Text(`refip:${env.CODE_PEPPER||"ref"}:${request.headers.get("CF-Connecting-IP")||""}`),placeholderPhoneHash=row&&row.phone_hash?String(row.phone_hash):await sha256Text("referral-no-phone:"+deviceId),mask=emailMask(email),expires=now+REFERRAL_EMAIL_MS;
  if(row)await env.DB.prepare("UPDATE contest_referrals SET referee_subscription_id=?,email_hash=?,phone_hash=?,ip_hash=?,phone_mask=?,status='email_link_pending',sms_code_hash=?,sms_expires_at=?,sms_attempts=0,sms_sent_at=?,updated_at=? WHERE id=?").bind(sub.id,eh,placeholderPhoneHash,ih,mask,ch,expires,now,now,id).run();else await env.DB.prepare("INSERT INTO contest_referrals(id,invite_id,sponsor_subscription_id,referee_subscription_id,referee_device_id,email_hash,phone_hash,ip_hash,phone_mask,status,sms_code_hash,sms_expires_at,sms_attempts,sms_sent_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'email_link_pending',?,?,0,?,?,?)").bind(id,invite.id,invite.sponsor_subscription_id,sub.id,deviceId,eh,placeholderPhoneHash,ih,mask,ch,expires,now,now,now).run();
  await env.DB.prepare("UPDATE contest_referral_invites SET claimed_subscription_id=?,claimed_at=? WHERE id=? AND claimed_subscription_id IS NULL").bind(sub.id,now,invite.id).run();
  const confirmUrl=new URL(request.url).origin+"/api/referral/confirm?id="+encodeURIComponent(id)+"&token="+encodeURIComponent(magic);
  const rewardProfile=await referralRewardProfile(env,invite.sponsor_subscription_id);
  if(!(await sendReferralEmail(env,email,confirmUrl,first,rewardProfile.friendPoints)))return json({ok:false,error:"EMAIL_ENVOI_INDISPONIBLE",referralId:id,emailMask:mask},503);
  await env.DB.prepare("INSERT INTO brevo_daily_usage(day,sent_count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET sent_count=sent_count+1").bind(day).run();
  return json({ok:true,referralId:id,emailMask:mask,emailExpiresAt:expires,email,firstName:first,lastName:last,magicLinkSent:true,expiresAt:new Date(Number(cfg.end_at)+CONTEST_APP_FREE_EXTRA_MS).toISOString(),sponsorPoints:rewardProfile.sponsorPoints,friendPoints:rewardProfile.friendPoints,adminSponsor:rewardProfile.adminSponsor});
}
async function applyReferralRewards(env,row){
  const profile=await referralRewardProfile(env,row.sponsor_subscription_id);
  let sponsorRewarded=Number(row.sponsor_rewarded||0)===1,refereeRewarded=Number(row.referee_rewarded||0)===1;

  if(!sponsorRewarded){
    if(profile.adminSponsor){
      await env.DB.prepare("UPDATE contest_referrals SET sponsor_rewarded=1,updated_at=? WHERE id=?").bind(Date.now(),row.id).run();
      sponsorRewarded=true;
    }else if(await env.DB.prepare("SELECT subscription_id FROM contest_participants WHERE subscription_id=? AND banned=0 AND COALESCE(contest_excluded,0)=0 LIMIT 1").bind(row.sponsor_subscription_id).first()){
      const gain=await contestAddScoreWithActiveBonus(env,row.sponsor_subscription_id,"referral-sponsor",row.id,"Parrainage validé",profile.sponsorPoints);
      await env.DB.prepare("UPDATE contest_referrals SET sponsor_rewarded=1,updated_at=? WHERE id=?").bind(Date.now(),row.id).run();
      sponsorRewarded=true;
      await contestPushMessage(env,row.sponsor_subscription_id,`🎁 Parrainage validé : +${contestNumberText(gain.awardedPoints)} points${gain.multiplier>1?` (bonus ×${gain.multiplier})`:''}.`,"referral");
    }
  }

  if(!refereeRewarded&&await env.DB.prepare("SELECT subscription_id FROM contest_participants WHERE subscription_id=? AND banned=0 AND COALESCE(contest_excluded,0)=0 LIMIT 1").bind(row.referee_subscription_id).first()){
    let gain;
    if(profile.adminSponsor){
      const added=await contestAddScoreEvent(env,row.referee_subscription_id,"referral-friend",row.id,"Bienvenue par partage administrateur",profile.friendPoints,1,profile.friendPoints);
      gain={added,multiplier:1,awardedPoints:profile.friendPoints};
    }else{
      gain=await contestAddScoreWithActiveBonus(env,row.referee_subscription_id,"referral-friend",row.id,"Bienvenue par parrainage",profile.friendPoints);
    }
    await env.DB.prepare("UPDATE contest_referrals SET referee_rewarded=1,updated_at=? WHERE id=?").bind(Date.now(),row.id).run();
    refereeRewarded=true;
    await contestPushMessage(env,row.referee_subscription_id,`🎁 Bienvenue ! Parrainage validé : +${contestNumberText(gain.awardedPoints)} points${gain.multiplier>1?` (bonus ×${gain.multiplier})`:''}.`,"referral");
  }
  return {sponsorRewarded,refereeRewarded,sponsorPoints:profile.sponsorPoints,friendPoints:profile.friendPoints,adminSponsor:profile.adminSponsor};
}
async function applyPendingReferralRewards(env,subscriptionId){const rows=(await env.DB.prepare("SELECT * FROM contest_referrals WHERE status='verified' AND ((sponsor_subscription_id=? AND sponsor_rewarded=0) OR (referee_subscription_id=? AND referee_rewarded=0)) LIMIT 20").bind(subscriptionId,subscriptionId).all()).results||[];for(const r of rows)await applyReferralRewards(env,r)}
async function referralConfirm(request,env){
  await ensureContestTables(env);
  const url=new URL(request.url),id=String(url.searchParams.get("id")||"").trim(),token=String(url.searchParams.get("token")||"").trim(),origin=url.origin;
  const go=(state,extra="")=>Response.redirect(origin+"/index.html?referral_confirmed="+encodeURIComponent(state)+(extra?"&"+extra:""),302);
  if(!id||!token)return go("invalid");
  const row=await env.DB.prepare("SELECT * FROM contest_referrals WHERE id=? LIMIT 1").bind(id).first();
  if(!row)return go("invalid");
  if(row.status==="verified"){const rewards=await applyReferralRewards(env,row);return go("ok","friendPoints="+encodeURIComponent(rewards.friendPoints)+"&sponsorPoints="+encodeURIComponent(rewards.sponsorPoints)+"&friendRewarded="+(rewards.refereeRewarded?"1":"0")+"&sponsorRewarded="+(rewards.sponsorRewarded?"1":"0"));}
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
    if(rewards.sponsorPoints>0&&validEmail(sponsorEmail)){const sent=await sendReferralSponsorEmail(env,sponsorEmail,friendName,rewards.sponsorRewarded);if(sent){const day=parisDay();await env.DB.prepare("INSERT INTO brevo_daily_usage(day,sent_count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET sent_count=sent_count+1").bind(day).run();}}
  }catch(_){}
  return go("ok","friendPoints="+encodeURIComponent(rewards.friendPoints)+"&sponsorPoints="+encodeURIComponent(rewards.sponsorPoints)+"&friendRewarded="+(rewards.refereeRewarded?"1":"0")+"&sponsorRewarded="+(rewards.sponsorRewarded?"1":"0"));
}
async function referralVerify(request,env){
  await ensureContestTables(env);const d=await body(request),deviceId=String(d.deviceId||"").trim(),id=String(d.referralId||"").trim(),code=String(d.code||"").replace(/\D/g,"").slice(0,6);if(!validDevice(deviceId)||!id||code.length!==6)return json({ok:false,error:"CODE_EMAIL_INVALIDE"},400);
  const row=await env.DB.prepare("SELECT * FROM contest_referrals WHERE id=? AND referee_device_id=? LIMIT 1").bind(id,deviceId).first();if(!row)return json({ok:false,error:"PARRAINAGE_INTROUVABLE"},404);if(row.status==="verified"){const r=await applyReferralRewards(env,row);return json({ok:true,alreadyVerified:true,...r,sponsorPoints:r.sponsorPoints,friendPoints:r.friendPoints})}if(Number(row.sms_expires_at||0)<Date.now())return json({ok:false,error:"CODE_EMAIL_EXPIRE"},410);if(Number(row.sms_attempts||0)>=5)return json({ok:false,error:"CODE_EMAIL_TROP_ESSAIS"},429);
  const h=await emailCodeHash("referral:"+id,code,env);if(h!==String(row.sms_code_hash||"")){await env.DB.prepare("UPDATE contest_referrals SET sms_attempts=sms_attempts+1,updated_at=? WHERE id=?").bind(Date.now(),id).run();return json({ok:false,error:"CODE_EMAIL_INCORRECT"},400)}
  await env.DB.prepare("UPDATE contest_referrals SET status='verified',verified_at=?,sms_code_hash='',updated_at=? WHERE id=?").bind(Date.now(),Date.now(),id).run();const fresh=await env.DB.prepare("SELECT * FROM contest_referrals WHERE id=?").bind(id).first(),r=await applyReferralRewards(env,fresh);return json({ok:true,...r,sponsorPoints:r.sponsorPoints,friendPoints:r.friendPoints});
}
async function contestScoreSummary(env,subscriptionId){
  const events=(await env.DB.prepare("SELECT source_type,base_points,multiplier,awarded_points FROM contest_score_events WHERE subscription_id=?").bind(subscriptionId).all()).results||[];
  let bugPoints=0,bugEvents=0,referralPoints=0,referralCount=0,giftPoints=0,giftCount=0,eventBonusExtra=0,marketEventBonusExtra=0,mushroomAwarded=0,mushroomEventBonusExtra=0;for(const e of events){const extra=Math.max(0,Number(e.awarded_points||0)-Number(e.base_points||0));eventBonusExtra+=extra;if(e.source_type==='market')marketEventBonusExtra+=extra;if(e.source_type==='mushroom'){mushroomAwarded+=Number(e.awarded_points||0);mushroomEventBonusExtra+=extra}if(e.source_type==='bug'){bugEvents++;bugPoints+=Number(e.awarded_points||0)}if(String(e.source_type||'').startsWith('referral-')){referralCount++;referralPoints+=Number(e.awarded_points||0)}if(e.source_type==='random-gift'){giftCount++;giftPoints+=Number(e.awarded_points||0)}}
  const markets=(await env.DB.prepare("SELECT points,base_points,breakdown_json FROM contest_market_points WHERE subscription_id=?").bind(subscriptionId).all()).results||[];
  let marketAwarded=0,marketBase=0,marketDistanceBase=0;for(const r of markets){marketAwarded+=Number(r.points||0);marketBase+=Number(r.base_points||r.points||0);try{const a=JSON.parse(r.breakdown_json||'[]');for(const it of a)if(it&&it.key==='distance')marketDistanceBase+=Number(it.points||0)}catch(_){}}
  const mushrooms=(await env.DB.prepare("SELECT base_points,awarded_points,breakdown_json,status FROM contest_mushroom_reviews WHERE subscription_id=? AND status<>'denied' AND awarded_points>0").bind(subscriptionId).all()).results||[];let mushroomBase=0,mushroomDistanceBase=0;for(const r of mushrooms){mushroomBase+=Number(r.base_points||0);try{const a=JSON.parse(r.breakdown_json||'[]');for(const it of a)if(it&&it.key==='distance')mushroomDistanceBase+=Number(it.points||0)}catch(_){}}
  const idea=await env.DB.prepare("SELECT COUNT(*) AS n FROM contest_reports WHERE subscription_id=? AND kind='idee' AND status='approved'").bind(subscriptionId).first();
  const p=await env.DB.prepare("SELECT points FROM contest_participants WHERE subscription_id=?").bind(subscriptionId).first();const total=Number(p&&p.points||0),known=marketAwarded+mushroomAwarded+bugPoints+referralPoints+giftPoints;
  const legacyMarketBonus=Math.max(0,(marketAwarded-marketBase)-marketEventBonusExtra),distanceBase=contestRound2(marketDistanceBase+mushroomDistanceBase),infoBase=contestRound2(Math.max(0,marketBase-marketDistanceBase)+Math.max(0,mushroomBase-mushroomDistanceBase));
  return {total,marketCount:markets.length,mushroomCount:mushrooms.length,formCount:markets.length+mushrooms.length,marketBasePoints:marketBase,mushroomBasePoints:mushroomBase,marketInfoPoints:infoBase,distancePoints:distanceBase,marketAwardedPoints:marketAwarded,mushroomAwardedPoints:mushroomAwarded,bonusExtraPoints:eventBonusExtra+legacyMarketBonus,bugCount:bugEvents,bugPoints,referralCount,referralPoints,giftCount,giftPoints,ideaCount:Number(idea&&idea.n||0),otherPoints:Math.max(0,total-known)};
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
  const fuel=contestDistanceFuel(distanceKm);if(ownPhoto&&ownGps){items.push({key:'distance',label:contestFuelBreakdownLabel(fuel),points:fuel.points,liters:fuel.liters,pricePerLiter:fuel.pricePerLiter,costEuro:fuel.costEuro});total=contestRound2(total+fuel.points);}
  const complete=a&&b&&c&&d&&e&&f&&g&&h&&i&&j;add('complete','Fiche entièrement complétée',10,complete);
  return {basePoints:total,items,complete,distanceKm:fuel.usedKm,distancePoints:fuel.points};
}

async function finalizeContestIfNeeded(env){
  const cfg=await ensureContestTables(env);if(Date.now()<Number(cfg.end_at)||cfg.finalized_at)return cfg;
  const top=await env.DB.prepare("SELECT * FROM contest_participants WHERE banned=0 AND COALESCE(contest_excluded,0)=0 AND subscription_id NOT IN (SELECT id FROM subscriptions WHERE lower(COALESCE(recovery_email_mask,''))=?) ORDER BY points DESC, joined_at ASC LIMIT 5").bind(ONLY_ADMIN_EMAIL).all();let rank=0;
  for(const p of top.results||[]){rank++;const reward=rank<=2?"Abonnement à vie":"1 an d’abonnement gratuit";await env.DB.prepare("INSERT OR REPLACE INTO contest_results(rank,subscription_id,first_name,last_name,points,reward) VALUES(?,?,?,?,?,?)").bind(rank,p.subscription_id,p.first_name,p.last_name,p.points,reward).run();const sub=await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(p.subscription_id).first();if(sub){if(rank<=2)await env.DB.prepare("UPDATE subscriptions SET lifetime=1,expires_at=NULL,active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(sub.id).run();else if(!sub.lifetime){const base=Math.max(Date.now(),sub.expires_at?Date.parse(sub.expires_at):0),d=new Date(base);d.setFullYear(d.getFullYear()+1);await env.DB.prepare("UPDATE subscriptions SET expires_at=?,active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(d.toISOString(),sub.id).run()}const email=String(sub.recovery_email_mask||"");if(validEmail(email)&&!email.includes("***"))await sendContestMail(env,email,"Félicitations — vous êtes gagnant du concours Couteau Suisse",`Félicitations ${p.first_name} ${p.last_name} !\nVous terminez n°${rank} du concours avec ${p.points} points.\nVotre gain : ${reward}.`)}}
  const finalizedAt=Date.now();await env.DB.prepare("UPDATE contest_config SET finalized_at=?,results_until=? WHERE id=1").bind(finalizedAt,finalizedAt+CONTEST_RESULTS_MS).run();return await env.DB.prepare("SELECT * FROM contest_config WHERE id=1").first();
}

async function contestStatus(request,env){
  await ensureContestTables(env);await contestRepriceHistoricalFuelV297(env);await contestAutoCreditPendingV300(env);await contestBackfillRandomGiftsV415(env);
  const data=await body(request),includeRanking=data.includeRanking===true,cfg=await finalizeContestIfNeeded(env),now=Date.now(),ended=now>=Number(cfg.end_at),resultsUntil=Number(cfg.results_until||((cfg.finalized_at||0)+CONTEST_RESULTS_MS)),resultsVisible=!!cfg.finalized_at&&ended&&now<resultsUntil,closed=ended&&!resultsVisible;
  let sub=await contestSubscription(env,data),profile=null,participant=null,messages=[],questions=[],scoreSummary=null,bonusState=null,bonusProgress=null,onboarding=null,randomGift=null;
  const adminSession=await adminAuthorized(request,env);
  if(adminSession){
    // V365 : l'administrateur participe comme tout le monde. Son compte reste simplement
    // non éligible aux lots lors de la sélection finale.
    let adminSub=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND lower(COALESCE(recovery_email_mask,''))=? ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC,id DESC LIMIT 1").bind(ONLY_ADMIN_EMAIL).first();
    if(adminSub)sub=adminSub;
    const enrolled=await contestAutoEnrollIdentityV303(env,cfg,{email:ONLY_ADMIN_EMAIL,first_name:"Steve",last_name:"Suzon",device_id:String(data.deviceId||""),created_at:now});
    if(enrolled&&enrolled.ok&&Number(enrolled.subscriptionId)){
      const enrolledSub=await env.DB.prepare("SELECT * FROM subscriptions WHERE id=? LIMIT 1").bind(Number(enrolled.subscriptionId)).first();
      if(enrolledSub)sub=enrolledSub;
    }
  }
  if(sub){profile={firstName:adminSession?"Steve":String(sub.account_first_name||""),lastName:adminSession?"Suzon":String(sub.account_last_name||""),email:adminSession?ONLY_ADMIN_EMAIL:String(sub.recovery_email_mask||"")};const currentDevice=String(data.deviceId||"").trim();if(validDevice(currentDevice))await env.DB.prepare("UPDATE contest_participants SET device_id=?,updated_at=? WHERE subscription_id=? AND device_id<>?").bind(currentDevice,now,sub.id,currentDevice).run();participant=await env.DB.prepare("SELECT subscription_id,first_name,last_name,home_country,home_area,home_commune,return_place_lat,return_place_lon,return_place_label,camping_active,camping_lat,camping_lon,camping_label,camping_updated_at,points,banned,alert_count,change_allowed,auto_enrolled,joined_at FROM contest_participants WHERE subscription_id=?").bind(sub.id).first();const installed=await registeredVerificationDevice(env,currentDevice);if(participant){await applyPendingReferralRewards(env,sub.id);if(!ended)randomGift=await contestEnsureRandomGiftV415(env,sub.id);participant=await env.DB.prepare("SELECT subscription_id,first_name,last_name,home_country,home_area,home_commune,return_place_lat,return_place_lon,return_place_label,camping_active,camping_lat,camping_lon,camping_label,camping_updated_at,points,banned,alert_count,change_allowed,auto_enrolled,joined_at FROM contest_participants WHERE subscription_id=?").bind(sub.id).first();bonusState=await contestRefreshBonusState(env,sub.id);scoreSummary=await contestScoreSummary(env,sub.id);bonusProgress=contestBonusProgress(scoreSummary.marketCount);const ob=await env.DB.prepare("SELECT status,start_at,end_at FROM contest_bonus_periods WHERE subscription_id=? AND source_key='onboarding-home-place' LIMIT 1").bind(sub.id).first();onboarding={installed,identity:!!(String(sub.account_first_name||'').trim()&&String(sub.account_last_name||'').trim()&&String(sub.recovery_email_hash||'').trim()),returnPlaceSaved:!!String(participant.return_place_label||'').trim(),bonusWon:!!ob,bonusStatus:ob&&ob.status||''};const m=await env.DB.prepare("SELECT id,kind,message,created_at FROM contest_messages WHERE subscription_id=? AND read_at IS NULL ORDER BY created_at DESC LIMIT 8").bind(sub.id).all();messages=m.results||[];const q=await env.DB.prepare("SELECT id,new_place,previous_place,message,user_answer,status,created_at FROM contest_travel_alerts WHERE subscription_id=? AND status='pending' AND user_answer='' ORDER BY created_at DESC").bind(sub.id).all();questions=q.results||[]}}
  const ranking=includeRanking?await env.DB.prepare("SELECT first_name,last_name,points,joined_at,CASE WHEN subscription_id=? THEN 1 ELSE 0 END AS is_me,CASE WHEN subscription_id IN (SELECT id FROM subscriptions WHERE lower(COALESCE(recovery_email_mask,''))=?) THEN 1 ELSE 0 END AS non_winner FROM contest_participants WHERE banned=0 AND COALESCE(contest_excluded,0)=0 ORDER BY points DESC,joined_at ASC").bind(sub?sub.id:-1,ONLY_ADMIN_EMAIL).all():{results:[]};const results=resultsVisible?(await env.DB.prepare("SELECT * FROM contest_results ORDER BY rank").all()).results||[]:[];
  return json({ok:true,active:!ended,ended,resultsVisible,closed,phase:!ended?"active":resultsVisible?"results":"closed",startAt:Number(cfg.start_at),endAt:Number(cfg.end_at),resultsUntil,appFreeUntil:Number(cfg.end_at)+CONTEST_APP_FREE_EXTRA_MS,daysRemaining:Math.max(0,Math.ceil((Number(cfg.end_at)-now)/86400000)),profile,participant,ranking:ranking.results||[],messages,questions,results,scoreSummary,bonusState,bonusProgress,onboarding,randomGift});
}
async function contestScoreStatus(request,env){
  await ensureContestTables(env);await contestRepriceHistoricalFuelV297(env);await contestAutoCreditPendingV300(env);
  const data=await body(request);let sub=await contestSubscription(env,data);
  if(await adminAuthorized(request,env)){
    const adminSub=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND lower(COALESCE(recovery_email_mask,''))=? ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC,id DESC LIMIT 1").bind(ONLY_ADMIN_EMAIL).first();
    if(adminSub)sub=adminSub;
    const cfg=await ensureContestTables(env),enrolled=await contestAutoEnrollIdentityV303(env,cfg,{email:ONLY_ADMIN_EMAIL,first_name:"Steve",last_name:"Suzon",device_id:String(data.deviceId||""),created_at:Date.now()});
    if(enrolled&&enrolled.ok&&Number(enrolled.subscriptionId)){const enrolledSub=await env.DB.prepare("SELECT * FROM subscriptions WHERE id=? LIMIT 1").bind(Number(enrolled.subscriptionId)).first();if(enrolledSub)sub=enrolledSub}
  }
  if(!sub)return json({ok:true,participant:null,ranking:[]});
  const participant=await env.DB.prepare("SELECT subscription_id,points,banned FROM contest_participants WHERE subscription_id=? LIMIT 1").bind(sub.id).first();
  const ranking=await env.DB.prepare("SELECT first_name,last_name,points,joined_at,CASE WHEN subscription_id=? THEN 1 ELSE 0 END AS is_me,CASE WHEN subscription_id IN (SELECT id FROM subscriptions WHERE lower(COALESCE(recovery_email_mask,''))=?) THEN 1 ELSE 0 END AS non_winner FROM contest_participants WHERE banned=0 AND COALESCE(contest_excluded,0)=0 ORDER BY points DESC,joined_at ASC").bind(sub.id,ONLY_ADMIN_EMAIL).all();
  return json({ok:true,participant:participant?{points:Number(participant.points||0),banned:Number(participant.banned||0)}:null,ranking:ranking.results||[],serverTime:Date.now()});
}
async function contestCommunes(url){
  const country=String(url.searchParams.get("country")||"FR").toUpperCase(),area=String(url.searchParams.get("area")||"").trim(),q=String(url.searchParams.get("q")||"").trim();
  if(country==="FR"){if(!/^[0-9A-Z]{2,3}$/i.test(area))return json({ok:false,error:"DEPARTEMENT_INVALIDE"},400);try{const r=await fetch(`https://geo.api.gouv.fr/departements/${encodeURIComponent(area)}/communes?fields=nom,code,centre,codesPostaux&format=json&geometry=centre`,{headers:{accept:"application/json"}});if(!r.ok)throw 0;const a=await r.json();return json({ok:true,communes:(a||[]).map(c=>({name:c.nom,code:c.code,lat:c.centre&&c.centre.coordinates?Number(c.centre.coordinates[1]):null,lon:c.centre&&c.centre.coordinates?Number(c.centre.coordinates[0]):null})).filter(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lon)).sort((a,b)=>a.name.localeCompare(b.name,"fr"))})}catch(_){return json({ok:false,error:"COMMUNES_INDISPONIBLES"},503)}}
  if(country==="BE"){if(q.length<2)return json({ok:true,communes:[]});try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&country=Belgium&q=${encodeURIComponent(q+(area?", "+area:""))}&limit=12`,{headers:{"user-agent":"CouteauSuisse-Contest/1.0"}});if(!r.ok)throw 0;const a=await r.json();return json({ok:true,communes:(a||[]).map(x=>({name:String(x.display_name||q).split(",")[0],code:"",lat:Number(x.lat),lon:Number(x.lon)})).filter(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lon))})}catch(_){return json({ok:false,error:"COMMUNES_INDISPONIBLES"},503)}}
  return json({ok:false,error:"PAYS_INVALIDE"},400);
}
async function contestRegister(request,env){
  const cfg=await ensureContestTables(env);if(Date.now()>=Number(cfg.end_at))return json({ok:false,error:"CONCOURS_TERMINE"},409);const data=await body(request),sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);
  await ensureAppIdentityTables(env);const contestEmail=normalizeEmail(sub.recovery_email_mask);const emailVerified=validEmail(contestEmail)?await env.DB.prepare("SELECT email_verified_at FROM app_identities WHERE lower(email)=? AND email_verified_at>0 LIMIT 1").bind(contestEmail).first():null;if(!emailVerified)return json({ok:false,error:"EMAIL_NON_CONFIRMEE",message:"Confirmez votre adresse e-mail avant de participer au concours."},403);
  const first=contestCleanName(sub.account_first_name||data.firstName),last=contestCleanName(sub.account_last_name||data.lastName),country=String(data.country||"FR").toUpperCase(),area=String(data.area||"").trim().slice(0,80),commune=String(data.commune||"").trim().slice(0,120),lat=Number(data.lat),lon=Number(data.lon);if(first.length<2||last.length<2)return json({ok:false,error:"NOM_ET_PRENOM_OBLIGATOIRES"},400);if(!area||!commune||!Number.isFinite(lat)||!Number.isFinite(lon))return json({ok:false,error:"COMMUNE_OBLIGATOIRE"},400);
  const old=await env.DB.prepare("SELECT * FROM contest_participants WHERE subscription_id=?").bind(sub.id).first();if(old&&!old.change_allowed)return json({ok:false,error:"COMMUNE_VERROUILLEE"},409);const emailHash=String(sub.recovery_email_hash||"");
  await env.DB.prepare("UPDATE subscriptions SET account_first_name=?,account_last_name=?,account_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(first,last,Date.now(),sub.id).run();
  if(old)await env.DB.prepare("UPDATE contest_participants SET device_id=?,first_name=?,last_name=?,home_country=?,home_area=?,home_commune=?,home_lat=?,home_lon=?,return_place_lat=NULL,return_place_lon=NULL,return_place_label='',camping_active=0,camping_lat=NULL,camping_lon=NULL,camping_label='',camping_updated_at=NULL,change_allowed=0,contest_excluded=0,updated_at=? WHERE subscription_id=?").bind(String(data.deviceId||""),first,last,country,area,commune,lat,lon,Date.now(),sub.id).run();else await env.DB.prepare("INSERT INTO contest_participants(subscription_id,device_id,first_name,last_name,email_hash,home_country,home_area,home_commune,home_lat,home_lon,joined_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(sub.id,String(data.deviceId||""),first,last,emailHash,country,area,commune,lat,lon,Date.now(),Date.now()).run();
  await applyPendingReferralRewards(env,sub.id);
  return json({ok:true,message:"Bravo, vous participez au concours !"});
}
async function contestReport(request,env){const cfg=await ensureContestTables(env);if(Date.now()>=Number(cfg.end_at))return json({ok:false,error:"CONCOURS_TERMINE"},409);const data=await body(request),sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);const p=await env.DB.prepare("SELECT * FROM contest_participants WHERE subscription_id=? AND banned=0").bind(sub.id).first();if(!p)return json({ok:false,error:"INSCRIPTION_CONCOURS_REQUISE"},403);const kind=["bug","probleme","idee"].includes(String(data.kind))?String(data.kind):"idee",desc=String(data.description||"").trim().slice(0,1500);if(desc.length<5)return json({ok:false,error:"DESCRIPTION_TROP_COURTE"},400);const fp=await sha256Text(kind+":"+desc.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," "));const dup=await env.DB.prepare("SELECT id FROM contest_reports WHERE fingerprint=? AND status IN ('pending','approved') LIMIT 1").bind(fp).first();if(dup)return json({ok:false,error:"SIGNALEMENT_DEJA_CONNU"},409);await env.DB.prepare("INSERT INTO contest_reports(id,subscription_id,kind,description,fingerprint,created_at) VALUES(?,?,?,?,?,?)").bind(contestId(),sub.id,kind,desc,fp,Date.now()).run();await notifyAdminPendingRequest(env);return json({ok:true})}
async function contestCommuneRequest(request,env){const data=await body(request),sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);const p=await env.DB.prepare("SELECT * FROM contest_participants WHERE subscription_id=? AND banned=0").bind(sub.id).first();if(!p)return json({ok:false,error:"INSCRIPTION_CONCOURS_REQUISE"},403);const exists=await env.DB.prepare("SELECT id FROM contest_commune_requests WHERE subscription_id=? AND status='pending' LIMIT 1").bind(sub.id).first();if(exists)return json({ok:true,already:true});await env.DB.prepare("INSERT INTO contest_commune_requests(id,subscription_id,created_at) VALUES(?,?,?)").bind(contestId(),sub.id,Date.now()).run();await notifyAdminPendingRequest(env);return json({ok:true})}
async function contestTravelAnswer(request,env){const data=await body(request),sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);const id=String(data.id||""),ans=String(data.answer||"").toLowerCase();const row=await env.DB.prepare("SELECT * FROM contest_travel_alerts WHERE id=? AND subscription_id=? AND status='pending'").bind(id,sub.id).first();if(!row)return json({ok:false,error:"ALERTE_INTROUVABLE"},404);let place="";if(ans==="non"&&Number.isFinite(Number(data.lat))&&Number.isFinite(Number(data.lon)))place=await contestPlaceLabel(Number(data.lat),Number(data.lon));await env.DB.prepare("UPDATE contest_travel_alerts SET user_answer=?,answer_place=?,answered_at=? WHERE id=?").bind(ans==="oui"?"oui":"non",place,Date.now(),id).run();await notifyAdminPendingRequest(env);return json({ok:true,place})}
async function contestReadMessages(request,env){const data=await body(request),sub=await contestSubscription(env,data);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);await env.DB.prepare("UPDATE contest_messages SET read_at=? WHERE subscription_id=? AND read_at IS NULL").bind(Date.now(),sub.id).run();return json({ok:true})}

async function queueContestMarketReview(env,deviceId,marketKey,marketName,photo){
  try{
    const cfg=await ensureContestTables(env);if(Date.now()>=Number(cfg.end_at))return;
    let p=await env.DB.prepare("SELECT * FROM contest_participants WHERE device_id=? AND banned=0 AND COALESCE(contest_excluded,0)=0 LIMIT 1").bind(deviceId).first();
    if(!p){const linked=await env.DB.prepare("SELECT id FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) ORDER BY lifetime DESC,COALESCE(expires_at,'') DESC,id DESC LIMIT 1").bind(deviceId,deviceId).first();if(linked){p=await env.DB.prepare("SELECT * FROM contest_participants WHERE subscription_id=? AND banned=0 AND COALESCE(contest_excluded,0)=0 LIMIT 1").bind(linked.id).first();if(p){await env.DB.prepare("UPDATE contest_participants SET device_id=?,updated_at=? WHERE subscription_id=?").bind(deviceId,Date.now(),linked.id).run();p.device_id=deviceId}}}
    if(!p)return;
    if(await env.DB.prepare("SELECT id FROM contest_market_points WHERE subscription_id=? AND market_key=?").bind(p.subscription_id,marketKey).first())return;
    if(await env.DB.prepare("SELECT id FROM contest_market_reviews WHERE subscription_id=? AND market_key=?").bind(p.subscription_id,marketKey).first())return;
    const meta=await env.DB.prepare("SELECT market_latitude,market_longitude,captured_at,device_id FROM market_photo_metadata WHERE market_key=?").bind(marketKey).first();if(!meta||String(meta.device_id)!==String(deviceId))return;
    const lat=Number(meta.market_latitude),lon=Number(meta.market_longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
    const trip=contestTravelFuelForParticipant(p,lat,lon),score=await contestMarketBreakdown(env,deviceId,marketKey,trip.fuel.usedKm),bonus=await contestRefreshBonusState(env,p.subscription_id),activeMultiplier=bonus.active?Math.max(1,Number(bonus.active.multiplier||1)):1,distanceMultiplier=contestDistanceMultiplier(score.distanceKm),multiplier=Math.max(activeMultiplier,distanceMultiplier),pts=contestRound2(score.basePoints*multiplier),place=await contestPlaceLabel(lat,lon);
    const prevRows=await env.DB.prepare("SELECT market_lat,market_lon,place_label FROM contest_market_points WHERE subscription_id=? ORDER BY awarded_at DESC LIMIT 5").bind(p.subscription_id).all();const prev=(prevRows.results||[])[0];let unusual=0,previousPlace="";if(trip.campingOn){const jump=contestKm(trip.startLat,trip.startLon,lat,lon);if(jump>=350){unusual=1;previousPlace=String(p.camping_label||"").trim()||await contestPlaceLabel(trip.startLat,trip.startLon)}}else if(prev&&(prevRows.results||[]).length>=3){const jump=contestKm(prev.market_lat,prev.market_lon,lat,lon);if(jump>=350){unusual=1;previousPlace=prev.place_label||await contestPlaceLabel(prev.market_lat,prev.market_lon)}}
    const rid=contestId(),now=Date.now();await env.DB.prepare("INSERT INTO contest_market_reviews(id,subscription_id,market_key,market_name,device_id,market_lat,market_lon,place_label,photo_captured_at,distance_km,base_points,multiplier,points,breakdown_json,unusual,previous_place,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(rid,p.subscription_id,marketKey,String(marketName||"Marché").slice(0,160),deviceId,lat,lon,place,String(meta.captured_at||photo&&photo.capturedAt||""),score.distanceKm,score.basePoints,multiplier,pts,JSON.stringify(score.items),unusual,previousPlace,now).run();
    await env.DB.prepare("INSERT OR IGNORE INTO contest_market_points(subscription_id,market_key,market_name,distance_km,points,base_points,multiplier,breakdown_json,market_lat,market_lon,place_label,awarded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(p.subscription_id,marketKey,String(marketName||"Marché").slice(0,160),score.distanceKm,pts,score.basePoints,multiplier,JSON.stringify(score.items),lat,lon,place,now).run();
    const added=await contestAddScoreEvent(env,p.subscription_id,'market',marketKey,String(marketName||'Marché'),score.basePoints,multiplier,pts);
    if(added){await contestApplyMarketMilestones(env,p.subscription_id);await contestPushMessage(env,p.subscription_id,`🎉 Points ajoutés automatiquement pour ${String(marketName||'votre fiche')} !\n${contestCongratsMessage({breakdown_json:JSON.stringify(score.items),multiplier,distance_km:score.distanceKm,base_points:score.basePoints},pts)}\n👀 Votre fiche reste visible par l’administrateur pour contrôle.`,`auto-awarded`)}
    if(unusual){const msg=`⚠️ Nous avons détecté un déplacement inhabituel vers ${place}. Vous êtes parti avec les campings ? Si oui, vérifiez que votre lieu de camping est bien à jour dans « Lieu de départ ». Un ancien emplacement ou de mauvaises coordonnées peuvent déclencher des alertes. Au troisième déplacement inhabituel non justifié, vous risquez d'être exclu du classement.`;await env.DB.prepare("INSERT INTO contest_travel_alerts(id,subscription_id,review_id,new_place,previous_place,message,created_at) VALUES(?,?,?,?,?,?,?)").bind(contestId(),p.subscription_id,rid,place,previousPlace,msg,Date.now()).run()}
    await notifyAdminPendingRequest(env);
  }catch(_){ }
}


async function ensureAppMessages(env){await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_messages(id TEXT PRIMARY KEY,subscription_id INTEGER,first_name TEXT NOT NULL DEFAULT '',last_name TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL DEFAULT 'Message',message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,read_at INTEGER)`).run()}
async function appMessage(request,env){await ensureAppMessages(env);const d=await body(request),sub=await contestSubscription(env,d);if(!sub)return json({ok:false,error:"ABONNEMENT_REQUIS"},403);const p=await env.DB.prepare("SELECT first_name,last_name,home_commune,home_area FROM contest_participants WHERE subscription_id=? LIMIT 1").bind(sub.id).first();const first=String((p&&p.first_name)||sub.account_first_name||"").trim(),last=String((p&&p.last_name)||sub.account_last_name||"").trim(),address=p?String(p.home_commune||"")+(p.home_area?" ("+p.home_area+")":""):"Adresse non renseignée",kind=String(d.kind||"Message").trim().slice(0,80),message=String(d.message||"").trim().slice(0,3000);if(message.length<3)return json({ok:false,error:"MESSAGE_TROP_COURT"},400);await env.DB.prepare("INSERT INTO app_messages(id,subscription_id,first_name,last_name,address,kind,message,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(contestId(),sub.id,first,last,address,kind,message,Date.now()).run();await notifyAdminPendingRequest(env);return json({ok:true})}
async function adminAppMessages(request,env){
  if(!(await adminAuthorized(request,env)))return json({ok:false,error:"SECRET_INCORRECT"},401);
  await ensureAppMessages(env);await ensureAppIdentityTables(env);
  const now=Date.now(),cutoff=now-24*60*60*1000;
  await env.DB.prepare("UPDATE app_messages SET status='expired',read_at=? WHERE status='pending' AND created_at<?").bind(now,cutoff).run();
  if(request.method==="POST"){const d=await body(request);await env.DB.prepare("UPDATE app_messages SET status='read',read_at=? WHERE id=? AND status='pending' AND created_at>=?").bind(Date.now(),String(d.id||""),cutoff).run()}
  const q=await env.DB.prepare(`SELECT m.*,
    COALESCE(s.recovery_email_mask,ai.email,'') AS email, COALESCE(s.phone_device,s.autoradio_device,'') AS device_id
    FROM app_messages m
    LEFT JOIN subscriptions s ON s.id=m.subscription_id
    LEFT JOIN app_identities ai ON ai.rowid=(SELECT ai2.rowid FROM app_identities ai2 WHERE ai2.device_id=s.phone_device OR ai2.device_id=s.autoradio_device ORDER BY ai2.updated_at DESC LIMIT 1)
    WHERE m.status='pending' AND m.created_at>=? ORDER BY m.created_at DESC LIMIT 200`).bind(cutoff).all();
  const messages=q.results||[];return json({ok:true,messages,count:messages.length})
}

function contestIdeaMultiplier(description){
  const text=String(description||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const major=["securite","danger","accident","urgence","donnees perdues","perte de donnees","paiement","abonnement bloque","application bloquee","impossible d'utiliser","ne fonctionne plus","pirat","fraude"];
  if(major.some(word=>text.includes(word))||text.length>=300)return 10;
  const important=["gps","navigation","carte","notification","message","classement","concours","camping","compte","connexion","adresse","marche","evenement","sauvegarde","accessibilite","plusieurs personnes"];
  const matches=important.filter(word=>text.includes(word)).length;
  if(matches>=2||text.length>=140)return 5;
  return 2;
}

// V295 : une demande concours ne doit JAMAIS disparaître avant la décision de l'administrateur.
// Les anciennes versions expiraient automatiquement les demandes après 24 h.
// On rouvre ici ces anciennes demandes "expired" afin qu'elles réapparaissent
// dans Administration > Demandes à valider. Les points restent attribués
// uniquement après le bouton VALIDER : aucune demande récupérée n'est approuvée automatiquement.
async function contestRefreshPendingReviewFuel(env,r){
  if(!r)return r;
  let items=[];try{items=JSON.parse(r.breakdown_json||'[]')}catch(_){items=[]}
  const idx=items.findIndex(x=>x&&x.key==='distance');
  if(idx<0)return r;
  const oldDistance=Number(items[idx]&&items[idx].points||0),fuel=contestDistanceFuel(r.distance_km),infoBase=Math.max(0,Number(r.base_points||0)-oldDistance),base=contestRound2(infoBase+fuel.points),mult=Math.max(1,Number(r.multiplier||1),contestDistanceMultiplier(r.distance_km)),points=contestRound2(base*mult);
  items[idx]=Object.assign({},items[idx],{label:contestFuelBreakdownLabel(fuel),points:fuel.points,liters:fuel.liters,pricePerLiter:fuel.pricePerLiter,costEuro:fuel.costEuro});
  const breakdown=JSON.stringify(items);
  await env.DB.prepare("UPDATE contest_market_reviews SET base_points=?,points=?,breakdown_json=? WHERE id=?").bind(base,points,breakdown,r.id).run();
  return Object.assign({},r,{base_points:base,points,breakdown_json:breakdown,breakdown:items});
}
async function contestAuditApprovedMissingCredits(env){
  const result={market:0,mushroom:0,points:0};
  try{
    const rows=(await env.DB.prepare("SELECT r.* FROM contest_market_reviews r LEFT JOIN contest_market_points p ON p.subscription_id=r.subscription_id AND p.market_key=r.market_key WHERE r.status='approved' AND p.id IS NULL ORDER BY r.created_at").all()).results||[];
    for(let r of rows){
      r=await contestRefreshPendingReviewFuel(env,r);const base=Number(r.base_points||r.points||0),mult=Math.max(1,Number(r.multiplier||1)),awarded=contestRound2(Number(r.points||base*mult));
      await env.DB.prepare("INSERT OR IGNORE INTO contest_market_points(subscription_id,market_key,market_name,distance_km,points,base_points,multiplier,breakdown_json,market_lat,market_lon,place_label,awarded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(r.subscription_id,r.market_key,r.market_name,r.distance_km,awarded,base,mult,r.breakdown_json||'[]',r.market_lat,r.market_lon,r.place_label,Number(r.decided_at||Date.now())).run();
      const added=await contestAddScoreEvent(env,r.subscription_id,'market',r.market_key,r.market_name,base,mult,awarded);if(added){result.market++;result.points=contestRound2(result.points+awarded)}
    }
    const mush=(await env.DB.prepare("SELECT r.*,s.wood_name,s.species FROM contest_mushroom_reviews r LEFT JOIN mushroom_spots s ON s.id=r.spot_id WHERE r.status='approved' ORDER BY r.created_at").all()).results||[];
    for(const r of mush){
      const exists=await env.DB.prepare("SELECT id FROM contest_score_events WHERE subscription_id=? AND source_type='mushroom' AND source_id=? LIMIT 1").bind(r.subscription_id,r.spot_id).first();if(exists)continue;
      const base=Number(r.base_points||MUSHROOM_CONTEST_POINTS),awarded=Number(r.awarded_points||base),added=await contestAddScoreEvent(env,r.subscription_id,'mushroom',r.spot_id,'Fiche Champignons — '+String(r.wood_name||r.species||'coin signalé'),base,Math.max(1,Math.round(awarded/base)||1),awarded);if(added){result.mushroom++;result.points=contestRound2(result.points+awarded)}
    }
  }catch(_){}
  return result;
}
function contestCatchupPerson(map,r,points,kind){
  const sid=Number(r.subscription_id||0),key=String(sid||((r.first_name||'')+' '+(r.last_name||''))),name=((r.first_name||'')+' '+(r.last_name||'')).trim()||'Utilisateur';let x=map.get(key);if(!x){x={subscriptionId:sid,name,marketForms:0,mushroomForms:0,points:0};map.set(key,x)}if(kind==='market')x.marketForms++;else x.mushroomForms++;x.points=contestRound2(x.points+Number(points||0));
}
async function contestCatchUpExistingForms(env){
  await expireAdminPendingRequests(env);const people=new Map(),summary={marketForms:0,mushroomForms:0,points:0,people:[]};
  const reviews=(await env.DB.prepare("SELECT r.*,p.first_name,p.last_name FROM contest_market_reviews r JOIN contest_participants p ON p.subscription_id=r.subscription_id WHERE r.status='pending' AND r.created_at<=? ORDER BY r.created_at").bind(CONTEST_EXISTING_FORMS_CATCHUP_CUTOFF).all()).results||[];
  for(let r of reviews){
    r=await contestRefreshPendingReviewFuel(env,r);const duplicate=await env.DB.prepare("SELECT id FROM contest_market_points WHERE subscription_id=? AND market_key=?").bind(r.subscription_id,r.market_key).first();let credited=0,awarded=Number(r.points||0);
    if(!duplicate){const base=Number(r.base_points||r.points||0),mult=Math.max(1,Number(r.multiplier||1));awarded=contestRound2(Number(r.points||base*mult));await env.DB.prepare("INSERT INTO contest_market_points(subscription_id,market_key,market_name,distance_km,points,base_points,multiplier,breakdown_json,market_lat,market_lon,place_label,awarded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(r.subscription_id,r.market_key,r.market_name,r.distance_km,awarded,base,mult,r.breakdown_json||'[]',r.market_lat,r.market_lon,r.place_label,Date.now()).run();const added=await contestAddScoreEvent(env,r.subscription_id,'market',r.market_key,r.market_name,base,mult,awarded);if(added){credited=awarded;await contestApplyMarketMilestones(env,r.subscription_id);if(Number(r.distance_km)>150)await contestEnqueueBonus(env,r.subscription_id,2,"trajet aller de plus de 150 km validé par l’administrateur","long-trip:"+r.market_key,CONTEST_LONG_TRIP_BONUS_MS,true)}}
    await env.DB.prepare("UPDATE contest_market_reviews SET status='approved',decided_at=? WHERE id=?").bind(Date.now(),r.id).run();await contestPushMessage(env,r.subscription_id,credited>0?`🎉 Bravo ! Votre ancienne fiche ${String(r.market_name||'marché')} vient d’être rattrapée et validée.\n${contestCongratsMessage(r,credited)}\n🏆 Votre classement vient d’être mis à jour.`:`✅ Votre ancienne fiche ${String(r.market_name||'marché')} était déjà créditée. Aucun doublon de points n’a été ajouté.`,credited>0?'approved':'admin');summary.marketForms++;summary.points=contestRound2(summary.points+credited);contestCatchupPerson(people,r,credited,'market');
  }
  const mushrooms=(await env.DB.prepare("SELECT r.*,p.first_name,p.last_name,s.wood_name,s.species FROM contest_mushroom_reviews r JOIN contest_participants p ON p.subscription_id=r.subscription_id LEFT JOIN mushroom_spots s ON s.id=r.spot_id WHERE r.status='pending' AND r.created_at<=? ORDER BY r.created_at").bind(CONTEST_EXISTING_FORMS_CATCHUP_CUTOFF).all()).results||[];
  for(const r of mushrooms){const gain=await contestAddScoreWithActiveBonus(env,r.subscription_id,'mushroom',r.spot_id,'Fiche Champignons — '+String(r.wood_name||r.species||'coin signalé'),Number(r.base_points||MUSHROOM_CONTEST_POINTS)),credited=gain.added?Number(gain.awardedPoints||0):0;await env.DB.prepare("UPDATE contest_mushroom_reviews SET status='approved',awarded_points=?,decided_at=? WHERE id=?").bind(gain.awardedPoints,Date.now(),r.id).run();await contestPushMessage(env,r.subscription_id,credited>0?`🎉 Bravo ! Votre ancienne fiche Champignons vient d’être rattrapée et validée — +${contestNumberText(credited)} points. Votre classement est à jour.`:"✅ Votre ancienne fiche Champignons était déjà créditée. Aucun doublon de points n’a été ajouté.",credited>0?'approved':'admin');summary.mushroomForms++;summary.points=contestRound2(summary.points+credited);contestCatchupPerson(people,r,credited,'mushroom')}
  summary.people=[...people.values()].sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name));return summary;
}

async function expireAdminPendingRequests(env){
  const recovered={reviews:0,mushrooms:0,reports:0,communes:0,alerts:0,total:0};
  async function reopen(sql,key){
    try{
      const r=await env.DB.prepare(sql).run();
      const n=Math.max(0,Number(r&&r.meta&&r.meta.changes||0));
      recovered[key]=n;recovered.total+=n;
    }catch(_){}
  }
  await reopen("UPDATE contest_market_reviews SET status='pending',decided_at=NULL WHERE status='expired'",'reviews');
  await reopen("UPDATE contest_mushroom_reviews SET status='pending',decided_at=NULL WHERE status='expired'",'mushrooms');
  await reopen("UPDATE contest_reports SET status='pending',decided_at=NULL WHERE status='expired'",'reports');
  await reopen("UPDATE contest_commune_requests SET status='pending',decided_at=NULL WHERE status='expired'",'communes');
  await reopen("UPDATE contest_travel_alerts SET status='pending' WHERE status='expired'",'alerts');
  return recovered;
}
async function contestAutoCreditPendingV300(env){
  const key='contest-auto-credit-pending-v300';
  const done=await env.DB.prepare("SELECT key FROM contest_migrations WHERE key=? LIMIT 1").bind(key).first();if(done)return {ok:true,already:true,markets:0,mushrooms:0,points:0};
  let markets=0,mushrooms=0,points=0;
  const reviews=(await env.DB.prepare("SELECT * FROM contest_market_reviews WHERE status='pending' ORDER BY created_at").all()).results||[];
  for(let r of reviews){
    r=await contestRefreshPendingReviewFuel(env,r);const exists=await env.DB.prepare("SELECT id FROM contest_market_points WHERE subscription_id=? AND market_key=? LIMIT 1").bind(r.subscription_id,r.market_key).first();
    if(!exists){const base=Number(r.base_points||r.points||0),mult=Math.max(1,Number(r.multiplier||1)),awarded=contestRound2(Number(r.points||base*mult));await env.DB.prepare("INSERT INTO contest_market_points(subscription_id,market_key,market_name,distance_km,points,base_points,multiplier,breakdown_json,market_lat,market_lon,place_label,awarded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(r.subscription_id,r.market_key,r.market_name,r.distance_km,awarded,base,mult,r.breakdown_json||'[]',r.market_lat,r.market_lon,r.place_label,Number(r.created_at||Date.now())).run();const added=await contestAddScoreEvent(env,r.subscription_id,'market',r.market_key,r.market_name,base,mult,awarded);if(added){markets++;points=contestRound2(points+awarded);await contestApplyMarketMilestones(env,r.subscription_id);await contestPushMessage(env,r.subscription_id,`🎉 Vos points ont été ajoutés automatiquement pour ${String(r.market_name||'votre fiche')}.\n${contestCongratsMessage(r,awarded)}\n👀 La fiche reste consultable par l’administrateur.`,`auto-awarded`)}}
  }
  const oldMush=(await env.DB.prepare("SELECT r.*,s.wood_name,s.species,s.latitude,s.longitude,p.home_lat,p.home_lon,p.return_place_lat,p.return_place_lon,p.camping_active,p.camping_lat,p.camping_lon FROM contest_mushroom_reviews r LEFT JOIN mushroom_spots s ON s.id=r.spot_id JOIN contest_participants p ON p.subscription_id=r.subscription_id WHERE r.status='pending' ORDER BY r.created_at").all()).results||[];
  for(const r of oldMush){const ev=await env.DB.prepare("SELECT id FROM contest_score_events WHERE subscription_id=? AND source_type='mushroom' AND source_id=? LIMIT 1").bind(r.subscription_id,r.spot_id).first();if(ev)continue;const trip=contestTravelFuelForParticipant(r,Number(r.latitude),Number(r.longitude)),items=contestMushroomBreakdown(MUSHROOM_CONTEST_POINTS,trip.fuel,trip.hasStart),base=contestRound2(MUSHROOM_CONTEST_POINTS+(trip.hasStart?trip.fuel.points:0)),gain=await contestAddScoreWithActiveBonus(env,r.subscription_id,'mushroom',r.spot_id,'Fiche Champignons — '+String(r.wood_name||r.species||'coin signalé'),base);await env.DB.prepare("UPDATE contest_mushroom_reviews SET base_points=?,awarded_points=?,distance_km=?,multiplier=?,breakdown_json=? WHERE id=?").bind(base,gain.awardedPoints,trip.fuel.usedKm,gain.multiplier,JSON.stringify(items),r.id).run();if(gain.added){mushrooms++;points=contestRound2(points+Number(gain.awardedPoints||0));await contestPushMessage(env,r.subscription_id,`🎉 Points ajoutés automatiquement pour votre fiche Champignons !\n${contestCongratsMessage({breakdown_json:JSON.stringify(items),multiplier:gain.multiplier,distance_km:trip.fuel.usedKm,base_points:base},gain.awardedPoints)}\n👀 La fiche reste consultable par l’administrateur.`,`auto-awarded`)}}
  await env.DB.prepare("INSERT OR REPLACE INTO contest_migrations(key,applied_at) VALUES(?,?)").bind(key,Date.now()).run();return {ok:true,already:false,markets,mushrooms,points};
}

async function contestMaintenanceClaimV301(env,key,intervalMs){
  const now=Date.now();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS contest_maintenance_state(key TEXT PRIMARY KEY,last_run INTEGER NOT NULL)").run();
  const r=await env.DB.prepare(`INSERT INTO contest_maintenance_state(key,last_run) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET last_run=excluded.last_run WHERE contest_maintenance_state.last_run<?`).bind(key,now,now-Math.max(1000,Number(intervalMs||0))).run();
  return Number(r&&r.meta&&r.meta.changes||0)>0;
}
async function adminContest(request,env){
  if(!(await adminAuthorized(request,env)))return json({ok:false,error:"SECRET_INCORRECT"},401);
  await ensureContestTables(env);
  await ensureMarketVerificationTables(env);
  const url=new URL(request.url),summary=url.searchParams.get('summary')==='1',mode=url.searchParams.get('mode')||'',cfg=await finalizeContestIfNeeded(env);
  if(summary){
    const c=await env.DB.prepare("SELECT COUNT(*) AS n FROM contest_participants WHERE COALESCE(contest_excluded,0)=0").first();
    return json({ok:true,config:cfg,participantCount:Number(c&&c.n||0),participants:[]});
  }
  if(mode==='pending-summary'){
    const c=await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM contest_market_reviews WHERE status='pending')+
      (SELECT COUNT(*) FROM contest_mushroom_reviews WHERE status='pending')+
      (SELECT COUNT(*) FROM contest_reports WHERE status='pending')+
      (SELECT COUNT(*) FROM contest_commune_requests WHERE status='pending')+
      (SELECT COUNT(*) FROM contest_travel_alerts WHERE status='pending') AS n`).first();
    const latest=await env.DB.prepare(`SELECT kind,created_at,first_name,last_name,email FROM (
      SELECT 'Fiche marché / événement' AS kind,r.created_at,p.first_name,p.last_name,COALESCE(s.recovery_email_mask,'') AS email FROM contest_market_reviews r JOIN contest_participants p ON p.subscription_id=r.subscription_id LEFT JOIN subscriptions s ON s.id=p.subscription_id WHERE r.status='pending' ORDER BY r.created_at DESC LIMIT 1
    ) UNION ALL SELECT kind,created_at,first_name,last_name,email FROM (
      SELECT 'Fiche Champignons' AS kind,r.created_at,p.first_name,p.last_name,COALESCE(s.recovery_email_mask,'') AS email FROM contest_mushroom_reviews r JOIN contest_participants p ON p.subscription_id=r.subscription_id LEFT JOIN subscriptions s ON s.id=p.subscription_id WHERE r.status='pending' ORDER BY r.created_at DESC LIMIT 1
    ) UNION ALL SELECT kind,created_at,first_name,last_name,email FROM (
      SELECT CASE WHEN r.kind='idee' THEN 'Idée' ELSE 'Bug / problème' END AS kind,r.created_at,p.first_name,p.last_name,COALESCE(s.recovery_email_mask,'') AS email FROM contest_reports r JOIN contest_participants p ON p.subscription_id=r.subscription_id LEFT JOIN subscriptions s ON s.id=p.subscription_id WHERE r.status='pending' ORDER BY r.created_at DESC LIMIT 1
    ) UNION ALL SELECT kind,created_at,first_name,last_name,email FROM (
      SELECT 'Changement de commune' AS kind,c.created_at,p.first_name,p.last_name,COALESCE(s.recovery_email_mask,'') AS email FROM contest_commune_requests c JOIN contest_participants p ON p.subscription_id=c.subscription_id LEFT JOIN subscriptions s ON s.id=p.subscription_id WHERE c.status='pending' ORDER BY c.created_at DESC LIMIT 1
    ) UNION ALL SELECT kind,created_at,first_name,last_name,email FROM (
      SELECT 'Alerte déplacement' AS kind,a.created_at,p.first_name,p.last_name,COALESCE(s.recovery_email_mask,'') AS email FROM contest_travel_alerts a JOIN contest_participants p ON p.subscription_id=a.subscription_id LEFT JOIN subscriptions s ON s.id=p.subscription_id WHERE a.status='pending' ORDER BY a.created_at DESC LIMIT 1
    ) ORDER BY created_at DESC LIMIT 1`).first();
    return json({ok:true,config:cfg,pendingCount:Number(c&&c.n||0),latest:latest||null});
  }
  const repriced=await contestRepriceHistoricalFuelV297(env),autoCredit=await contestAutoCreditPendingV300(env);
  let recovered={reviews:0,mushrooms:0,reports:0,communes:0,alerts:0,total:0},audit={market:0,mushroom:0,points:0};
  if(await contestMaintenanceClaimV301(env,'admin-recovery-audit-v301',10*60*1000)){recovered=await expireAdminPendingRequests(env);audit=await contestAuditApprovedMissingCredits(env)}
  const reviews=(await env.DB.prepare("SELECT r.*,p.first_name,p.last_name,p.alert_count,COALESCE(s.recovery_email_mask,'') AS email FROM contest_market_reviews r JOIN contest_participants p ON p.subscription_id=r.subscription_id LEFT JOIN subscriptions s ON s.id=p.subscription_id WHERE r.status='pending' ORDER BY r.created_at DESC").all()).results||[];
  for(let i=0;i<reviews.length;i++){
    reviews[i]=await contestRefreshPendingReviewFuel(env,reviews[i]);
    try{reviews[i].breakdown=JSON.parse(reviews[i].breakdown_json||'[]')}catch(_){reviews[i].breakdown=[]}
    try{
      const votes=(await env.DB.prepare("SELECT field,value_norm,value_display,updated_at FROM market_verification_votes WHERE market_key=? AND device_id=? ORDER BY field").bind(reviews[i].market_key,reviews[i].device_id).all()).results||[];
      reviews[i].submitted_fields={};
      for(const v of votes)reviews[i].submitted_fields[String(v.field||'')]={value:String(v.value_display||v.value_norm||''),norm:String(v.value_norm||''),updatedAt:String(v.updated_at||'')};
    }catch(_){reviews[i].submitted_fields={}}
    try{
      const loc=await env.DB.prepare("SELECT latitude,longitude,accuracy,address,created_at,updated_at FROM market_location_votes WHERE market_key=? AND device_id=? LIMIT 1").bind(reviews[i].market_key,reviews[i].device_id).first();
      reviews[i].gps_submission=loc?{latitude:Number(loc.latitude),longitude:Number(loc.longitude),accuracy:Number(loc.accuracy||0),address:String(loc.address||''),createdAt:String(loc.created_at||''),updatedAt:String(loc.updated_at||'')}:null;
    }catch(_){reviews[i].gps_submission=null}
    try{
      const pm=await env.DB.prepare("SELECT user_latitude,user_longitude,market_latitude,market_longitude,distance_meters,quality_score,stall_count,ai_reason,captured_at,updated_at,device_id FROM market_photo_metadata WHERE market_key=? LIMIT 1").bind(reviews[i].market_key).first();
      reviews[i].photo_meta=pm?{userLatitude:Number(pm.user_latitude),userLongitude:Number(pm.user_longitude),marketLatitude:Number(pm.market_latitude),marketLongitude:Number(pm.market_longitude),distanceMeters:Number(pm.distance_meters||0),qualityScore:Number(pm.quality_score||0),stallCount:Number(pm.stall_count||0),aiReason:String(pm.ai_reason||''),capturedAt:String(pm.captured_at||''),updatedAt:String(pm.updated_at||''),sameDevice:String(pm.device_id||'')===String(reviews[i].device_id||'')}:null;
    }catch(_){reviews[i].photo_meta=null}
    reviews[i].photo_url="/api/market-photo?marketKey="+encodeURIComponent(String(reviews[i].market_key||''));
  }
  const mushrooms=(await env.DB.prepare("SELECT r.*,p.first_name,p.last_name,COALESCE(sub.recovery_email_mask,'') AS email,s.wood_name,s.department,s.species,s.note,s.is_private,s.created_at AS spot_created_at FROM contest_mushroom_reviews r JOIN contest_participants p ON p.subscription_id=r.subscription_id LEFT JOIN subscriptions sub ON sub.id=p.subscription_id LEFT JOIN mushroom_spots s ON s.id=r.spot_id WHERE r.status='pending' ORDER BY r.created_at DESC").all()).results||[];for(const r of mushrooms){try{r.photo_url=await mushroomSignedPhotoUrl(env,r.spot_id,r.spot_created_at||r.created_at)}catch(_){r.photo_url=''}try{r.breakdown=JSON.parse(r.breakdown_json||'[]')}catch(_){r.breakdown=[]}}
  const reports=(await env.DB.prepare("SELECT r.*,p.first_name,p.last_name,p.home_commune,p.home_area,COALESCE(s.recovery_email_mask,'') AS email FROM contest_reports r JOIN contest_participants p ON p.subscription_id=r.subscription_id LEFT JOIN subscriptions s ON s.id=p.subscription_id WHERE r.status='pending' ORDER BY r.created_at DESC").all()).results||[];for(const r of reports){r.suggested_multiplier=r.kind==='idee'?contestIdeaMultiplier(r.description):null}
  const communes=(await env.DB.prepare("SELECT c.*,p.first_name,p.last_name,p.home_commune,p.home_area,COALESCE(s.recovery_email_mask,'') AS email FROM contest_commune_requests c JOIN contest_participants p ON p.subscription_id=c.subscription_id LEFT JOIN subscriptions s ON s.id=p.subscription_id WHERE c.status='pending' ORDER BY c.created_at DESC").all()).results||[];
  const alerts=(await env.DB.prepare("SELECT a.*,p.first_name,p.last_name,p.alert_count,COALESCE(s.recovery_email_mask,'') AS email FROM contest_travel_alerts a JOIN contest_participants p ON p.subscription_id=a.subscription_id LEFT JOIN subscriptions s ON s.id=p.subscription_id WHERE a.status='pending' ORDER BY a.created_at DESC").all()).results||[];
  // V311 : historique court visible sous les demandes. Il permet à Steve de voir
  // immédiatement qui vient d'être confirmé et combien de points ont été validés.
  const recentValidated=(await env.DB.prepare(`SELECT kind,label,points,decided_at,first_name,last_name,email FROM (
    SELECT 'FICHE MARCHÉ' AS kind,COALESCE(r.market_name,'Marché') AS label,CAST(COALESCE(r.points,0) AS REAL) AS points,r.decided_at,p.first_name,p.last_name,COALESCE(s.recovery_email_mask,'') AS email
      FROM contest_market_reviews r JOIN contest_participants p ON p.subscription_id=r.subscription_id LEFT JOIN subscriptions s ON s.id=p.subscription_id
      WHERE r.status='approved' AND r.decided_at IS NOT NULL
    UNION ALL
    SELECT 'FICHE CHAMPIGNONS' AS kind,COALESCE(m.wood_name,m.species,'Champignons') AS label,CAST(COALESCE(r.awarded_points,0) AS REAL) AS points,r.decided_at,p.first_name,p.last_name,COALESCE(s.recovery_email_mask,'') AS email
      FROM contest_mushroom_reviews r JOIN contest_participants p ON p.subscription_id=r.subscription_id LEFT JOIN subscriptions s ON s.id=p.subscription_id LEFT JOIN mushroom_spots m ON m.id=r.spot_id
      WHERE r.status='approved' AND r.decided_at IS NOT NULL
    UNION ALL
    SELECT 'BUG / PROBLÈME' AS kind,'Signalement confirmé' AS label,CAST(COALESCE(r.points,0) AS REAL) AS points,r.decided_at,p.first_name,p.last_name,COALESCE(s.recovery_email_mask,'') AS email
      FROM contest_reports r JOIN contest_participants p ON p.subscription_id=r.subscription_id LEFT JOIN subscriptions s ON s.id=p.subscription_id
      WHERE r.status='approved' AND r.kind<>'idee' AND r.decided_at IS NOT NULL
  ) WHERE points>0 ORDER BY decided_at DESC LIMIT 15`).all()).results||[];
  return json({ok:true,config:cfg,participantCount:null,participants:[],reviews,mushrooms,reports,communes,alerts,recentValidated,recovered,audit,repriced,autoCredit,catchupCutoff:CONTEST_EXISTING_FORMS_CATCHUP_CUTOFF})
}

function contestCongratsMessage(r,awarded){
  let items=[];try{items=JSON.parse(r.breakdown_json||'[]')}catch(_){}
  const mult=Math.max(1,Number(r.multiplier||1)),lines=['🎉 BRAVO !'];
  // V300 : la bulle détaille uniquement les éléments réellement crédités/contrôlés.
  // Pour le déplacement, on affiche les kilomètres, les litres utilisés, le coût total
  // du gasoil et les points, mais jamais le prix au litre.
  for(const it of items){
    if(!it)continue;
    if(it.key==='distance'){
      const fuel=contestDistanceFuel(r.distance_km),pts=Number(it.points||fuel.points||0);
      lines.push(`🚗 Trajet aller : ${contestNumberText(fuel.usedKm)} km`);
      lines.push(`⛽ Litres utilisés : ${contestMoneyText(fuel.liters)} L`);
      lines.push(`💶 Coût du gasoil : ${contestMoneyText(fuel.costEuro)} €`);
      lines.push(`Déplacement : +${contestNumberText(pts)} points`);
      continue;
    }
    const label=String(it.label||'').trim();
    if(label)lines.push(`${label} : +${contestNumberText(it.points||0)} points`);
  }
  if(items.length===0)lines.push(`Fiche validée : +${contestNumberText(Number(r.base_points||awarded||0))} points`);
  const kmMult=contestDistanceMultiplier(r.distance_km);
  if(kmMult>1)lines.push(`🚀 Bonus kilomètres ×${kmMult}`);
  if(mult>1)lines.push(`🎁 Multiplicateur retenu ×${mult}`);
  lines.push(`🏆 TOTAL GAGNÉ : +${contestNumberText(awarded)} POINTS`);
  return lines.join('\n');
}

async function contestCurrentTotalPoints(env,subscriptionId){
  try{const p=await env.DB.prepare("SELECT points FROM contest_participants WHERE subscription_id=? LIMIT 1").bind(subscriptionId).first();return contestRound2(Number(p&&p.points||0))}catch(_){return 0}
}

// V313 : lorsqu'une demande avec des points est confirmée par l'administrateur,
// tous les autres participants reçoivent une petite notification avec le gain
// et la nouvelle place de la personne dans le classement. Les refus restent privés.
async function contestBroadcastRankingUpdate(env,subscriptionId,gainedPoints){
  const sid=Number(subscriptionId||0),gain=contestRound2(Number(gainedPoints||0));
  if(!sid||gain<=0)return {sent:0,rank:0};
  try{
    const ranking=(await env.DB.prepare("SELECT subscription_id,first_name,last_name,points,joined_at FROM contest_participants WHERE banned=0 AND COALESCE(contest_excluded,0)=0 ORDER BY points DESC,joined_at ASC").all()).results||[];
    const idx=ranking.findIndex(x=>Number(x.subscription_id)===sid);
    if(idx<0)return {sent:0,rank:0};
    const person=ranking[idx],rank=idx+1,name=[String(person.first_name||'').trim(),String(person.last_name||'').trim()].filter(Boolean).join(' ')||'Un participant';
    const place=rank===1?'1er':`${rank}e`;
    const message=`🏆 ${name} a gagné ${contestNumberText(gain)} pt et est maintenant ${place} du classement.`;
    const now=Date.now();
    const result=await env.DB.prepare(`INSERT INTO contest_messages(id,subscription_id,kind,message,created_at)
      SELECT lower(hex(randomblob(16))),subscription_id,'ranking-update',?,?
      FROM contest_participants
      WHERE banned=0 AND COALESCE(contest_excluded,0)=0 AND subscription_id<>?`).bind(message,now,sid).run();
    return {sent:Math.max(0,Number(result&&result.meta&&result.meta.changes||0)),rank,name,message};
  }catch(_){return {sent:0,rank:0}}
}

async function adminContestAction(request,env){
  if(!(await adminAuthorized(request,env)))return json({ok:false,error:"SECRET_INCORRECT"},401);await ensureContestTables(env);await expireAdminPendingRequests(env);const d=await body(request),type=String(d.type||""),id=String(d.id||""),approve=d.approve===true;
  if(type==="catchup-existing-forms"){const summary=await contestCatchUpExistingForms(env);return json({ok:true,summary})}
  if(type==="review"){
    let r=await env.DB.prepare("SELECT * FROM contest_market_reviews WHERE id=? AND status='pending'").bind(id).first();if(!r)return json({ok:false,error:"DEMANDE_INTROUVABLE"},404);r=await contestRefreshPendingReviewFuel(env,r);
    if(approve){await env.DB.prepare("UPDATE contest_market_reviews SET status='approved',decided_at=? WHERE id=?").bind(Date.now(),id).run();await contestPushMessage(env,r.subscription_id,`✅ FICHE CONFIRMÉE — ${String(r.market_name||'Marché')}\n🏆 +${contestNumberText(r.points||0)} points confirmés et conservés dans votre classement.\nL’administrateur a vérifié et validé votre fiche.`,`approved`);const broadcast=await contestBroadcastRankingUpdate(env,r.subscription_id,Number(r.points||0));return json({ok:true,awardedPoints:0,keptPoints:Number(r.points||0),alreadyAwarded:true,broadcast})}
    const retracted=await contestRetractScoreEvent(env,r.subscription_id,'market',r.market_key);await env.DB.prepare("DELETE FROM contest_market_points WHERE subscription_id=? AND market_key=?").bind(r.subscription_id,r.market_key).run();if(Number(r.unusual)){await env.DB.prepare("UPDATE contest_participants SET alert_count=alert_count+1,updated_at=? WHERE subscription_id=?").bind(Date.now(),r.subscription_id).run();const p=await env.DB.prepare("SELECT alert_count FROM contest_participants WHERE subscription_id=?").bind(r.subscription_id).first();if(Number(p&&p.alert_count||0)>=3)await env.DB.prepare("UPDATE contest_participants SET banned=1 WHERE subscription_id=?").bind(r.subscription_id).run()}await env.DB.prepare("UPDATE contest_market_reviews SET status='denied',decided_at=? WHERE id=?").bind(Date.now(),id).run();const total=await contestCurrentTotalPoints(env,r.subscription_id);await contestPushMessage(env,r.subscription_id,`❌ DEMANDE REFUSÉE — FICHE MARCHÉ\nFiche concernée : ${String(r.market_name||'Marché')}\nCette fiche a été mal renseignée ou n’a pas pu être confirmée par l’administrateur.\n🏆 -${contestNumberText(retracted)} points : les points gagnés avec cette fiche ont été retirés.\nTotal actuel : ${contestNumberText(total)} pt.`,`denied`);return json({ok:true,awardedPoints:0,retractedPoints:retracted,newTotalPoints:total,refusedLabel:String(r.market_name||'Marché')});
  }
  if(type==="mushroom"){
    const r=await env.DB.prepare("SELECT r.*,s.wood_name,s.species FROM contest_mushroom_reviews r LEFT JOIN mushroom_spots s ON s.id=r.spot_id WHERE r.id=? AND r.status='pending'").bind(id).first();if(!r)return json({ok:false,error:"DEMANDE_INTROUVABLE"},404);
    if(approve){await env.DB.prepare("UPDATE contest_mushroom_reviews SET status='approved',decided_at=? WHERE id=?").bind(Date.now(),id).run();await contestPushMessage(env,r.subscription_id,`✅ FICHE CHAMPIGNONS CONFIRMÉE\n🏆 +${contestNumberText(r.awarded_points||0)} points confirmés et conservés dans votre classement.\nL’administrateur a vérifié et validé votre fiche.`,`approved`);const broadcast=await contestBroadcastRankingUpdate(env,r.subscription_id,Number(r.awarded_points||0));return json({ok:true,awardedPoints:0,keptPoints:Number(r.awarded_points||0),alreadyAwarded:true,broadcast})}
    const retracted=await contestRetractScoreEvent(env,r.subscription_id,'mushroom',r.spot_id);await env.DB.prepare("UPDATE contest_mushroom_reviews SET status='denied',awarded_points=0,decided_at=? WHERE id=?").bind(Date.now(),id).run();const total=await contestCurrentTotalPoints(env,r.subscription_id),fiche=[String(r.wood_name||'Bois signalé'),String(r.species||'')].filter(Boolean).join(' — ');await contestPushMessage(env,r.subscription_id,`❌ DEMANDE REFUSÉE — FICHE CHAMPIGNONS\nFiche concernée : ${fiche}\nCette fiche a été mal renseignée ou n’a pas pu être confirmée par l’administrateur.\n🏆 -${contestNumberText(retracted)} points : les points gagnés avec cette fiche ont été retirés.\nTotal actuel : ${contestNumberText(total)} pt.`,`denied`);return json({ok:true,awardedPoints:0,retractedPoints:retracted,newTotalPoints:total,refusedLabel:fiche});
  }
  if(type==="report"){const r=await env.DB.prepare("SELECT * FROM contest_reports WHERE id=? AND status='pending'").bind(id).first();if(!r)return json({ok:false,error:"DEMANDE_INTROUVABLE"},404);let awardedPoints=0;if(approve){if(r.kind==='idee'){const multiplier=contestIdeaMultiplier(r.description);await env.DB.prepare("UPDATE contest_reports SET status='approved',points=0,decided_at=? WHERE id=?").bind(Date.now(),id).run();await contestEnqueueBonus(env,r.subscription_id,multiplier,"idée acceptée par l’administrateur","idea:"+r.id,CONTEST_BONUS_MS,false,`🎉 Bravo, votre idée a été confirmée par l’administrateur. Vous bénéficiez du multiplicateur ×${multiplier} pendant 3 jours.`)}else{const gain=await contestAddScoreWithActiveBonus(env,r.subscription_id,'bug',r.id,r.description,153);awardedPoints=Number(gain.awardedPoints||0);await env.DB.prepare("UPDATE contest_reports SET status='approved',points=?,decided_at=? WHERE id=?").bind(gain.awardedPoints,Date.now(),id).run();await contestPushMessage(env,r.subscription_id,`✅ BUG / PROBLÈME CONFIRMÉ\n🏆 +${contestNumberText(gain.awardedPoints)} points ajoutés${gain.multiplier>1?` (bonus ×${gain.multiplier})`:''}.\nL’administrateur a validé votre signalement et votre classement est mis à jour.`,"approved");await contestBroadcastRankingUpdate(env,r.subscription_id,Number(gain.awardedPoints||0))}}else{await env.DB.prepare("UPDATE contest_reports SET status='denied',points=0,decided_at=? WHERE id=?").bind(Date.now(),id).run();const total=await contestCurrentTotalPoints(env,r.subscription_id),label=r.kind==='idee'?'IDÉE':'BUG / PROBLÈME';await contestPushMessage(env,r.subscription_id,`❌ DEMANDE REFUSÉE — ${label}\nDemande concernée : ${String(r.description||'Votre demande').slice(0,160)}\nL’administrateur n’a pas confirmé cette demande. Aucun point ni bonus n’est conservé pour celle-ci.\nTotal actuel : ${contestNumberText(total)} pt.`,"denied");return json({ok:true,awardedPoints:0,retractedPoints:0,newTotalPoints:total,refusedLabel:label})}return json({ok:true,awardedPoints})}
  if(type==="commune"){const r=await env.DB.prepare("SELECT * FROM contest_commune_requests WHERE id=? AND status='pending'").bind(id).first();if(!r)return json({ok:false,error:"DEMANDE_INTROUVABLE"},404);await env.DB.prepare("UPDATE contest_commune_requests SET status=?,decided_at=? WHERE id=?").bind(approve?"approved":"denied",Date.now(),id).run();if(approve)await env.DB.prepare("UPDATE contest_participants SET change_allowed=1,updated_at=? WHERE subscription_id=?").bind(Date.now(),r.subscription_id).run();await contestPushMessage(env,r.subscription_id,approve?"✅ Votre demande est acceptée. Vous pouvez maintenant changer votre commune dans le jeu concours.":"❌ Votre demande de changement de commune a été refusée.",approve?"approved":"denied");return json({ok:true})}
  if(type==="message"){const sid=Number(d.subscriptionId);if(!sid)return json({ok:false,error:"PARTICIPANT_INVALIDE"},400);await contestPushMessage(env,sid,String(d.message||"").trim()||"Message de l’administrateur.","admin");return json({ok:true})}
  if(type==="travel-question"){const a=await env.DB.prepare("SELECT * FROM contest_travel_alerts WHERE id=? AND status='pending'").bind(id).first();if(!a)return json({ok:false,error:"ALERTE_INTROUVABLE"},404);await contestPushMessage(env,a.subscription_id,a.message,"travel");return json({ok:true})}
  if(type==="travel-close"){await env.DB.prepare("UPDATE contest_travel_alerts SET status='closed' WHERE id=?").bind(id).run();return json({ok:true})}
  return json({ok:false,error:"ACTION_INCONNUE"},400)
}
// ===== FIN JEU CONCOURS V191 CAMPING =====



// ===== V242 ADMIN : HISTORIQUE INSTALLATIONS + BANNISSEMENT MANUEL =====
let _sanctionSchemaPromiseV301=null;
async function ensureSanctionTablesV242(env){
  if(_sanctionSchemaPromiseV301)return _sanctionSchemaPromiseV301;
  _sanctionSchemaPromiseV301=(async()=>{
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_user_sanctions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,subscription_id INTEGER,email_hash TEXT,email TEXT,requester_name TEXT,last_device_id TEXT,
      refusal_count INTEGER NOT NULL DEFAULT 0,app_banned INTEGER NOT NULL DEFAULT 0,contribution_blocked INTEGER NOT NULL DEFAULT 0,
      reactivation_requested INTEGER NOT NULL DEFAULT 0,ban_at INTEGER,reactivation_requested_at INTEGER,reactivated_at INTEGER,updated_at INTEGER NOT NULL
    )`).run();
    try{await env.DB.prepare("ALTER TABLE market_user_sanctions ADD COLUMN manual_ban INTEGER NOT NULL DEFAULT 0").run()}catch(_){}
    try{await env.DB.prepare("ALTER TABLE market_user_sanctions ADD COLUMN ban_reason TEXT NOT NULL DEFAULT ''").run()}catch(_){}
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_market_user_sanctions_device ON market_user_sanctions(last_device_id)").run();
    await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_market_user_sanctions_email ON market_user_sanctions(email_hash) WHERE email_hash IS NOT NULL AND email_hash<>''").run();
    await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_market_user_sanctions_subscription ON market_user_sanctions(subscription_id) WHERE subscription_id IS NOT NULL").run();
  })().catch(e=>{_sanctionSchemaPromiseV301=null;throw e});
  return _sanctionSchemaPromiseV301;
}
async function subscriptionForBanV242(env,deviceId,email){
  let row=null;
  if(deviceId)row=await env.DB.prepare("SELECT id,recovery_email_hash,recovery_email_mask FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) ORDER BY id DESC LIMIT 1").bind(deviceId,deviceId).first();
  if(!row&&validEmail(email)){const h=await sha256Text(email);row=await env.DB.prepare("SELECT id,recovery_email_hash,recovery_email_mask FROM subscriptions WHERE active=1 AND (recovery_email_hash=? OR lower(recovery_email_mask)=?) ORDER BY id DESC LIMIT 1").bind(h,email).first()}
  return row||null;
}
async function sanctionRowV242(env,{subscriptionId=null,emailHash='',deviceId=''}={}){
  await ensureSanctionTablesV242(env);let row=null;
  if(subscriptionId!=null)row=await env.DB.prepare("SELECT * FROM market_user_sanctions WHERE subscription_id=? LIMIT 1").bind(Number(subscriptionId)).first();
  if(!row&&emailHash)row=await env.DB.prepare("SELECT * FROM market_user_sanctions WHERE email_hash=? LIMIT 1").bind(emailHash).first();
  if(!row&&deviceId)row=await env.DB.prepare("SELECT * FROM market_user_sanctions WHERE last_device_id=? ORDER BY updated_at DESC LIMIT 1").bind(deviceId).first();
  return row||null;
}
async function adminBannedUsersV242(request,env){
  if(!(await adminAuthorized(request,env)))return json({ok:false,error:'SECRET_INCORRECT'},401);await ensureSanctionTablesV242(env);
  if(request.method==='GET'){const q=await env.DB.prepare("SELECT id,subscription_id,email,requester_name,last_device_id,refusal_count,app_banned,contribution_blocked,reactivation_requested,ban_at,reactivation_requested_at,updated_at,COALESCE(manual_ban,0) AS manual_ban,COALESCE(ban_reason,'') AS ban_reason FROM market_user_sanctions WHERE app_banned=1 ORDER BY reactivation_requested DESC,COALESCE(reactivation_requested_at,ban_at,updated_at) DESC").all();return json({ok:true,users:q.results||[]})}
  const d=await body(request),action=String(d.action||'');
  if(action==='ban'){
    const email=normalizeEmail(d.email),deviceId=String(d.deviceId||'').trim().slice(0,140),name=String(d.name||'').trim().replace(/\s+/g,' ').slice(0,120);
    if(!validEmail(email)&&!deviceId)return json({ok:false,error:'UTILISATEUR_INVALIDE'},400);
    if(email==='appli.suzon@gmail.com')return json({ok:false,error:'ADMIN_NON_BANNISSABLE'},403);
    const emailHash=validEmail(email)?await sha256Text(email):'',sub=await subscriptionForBanV242(env,deviceId,email),row=await sanctionRowV242(env,{subscriptionId:sub&&sub.id,emailHash,deviceId}),now=Date.now();
    if(row){await env.DB.prepare(`UPDATE market_user_sanctions SET subscription_id=COALESCE(?,subscription_id),email_hash=CASE WHEN ?<>'' THEN ? ELSE email_hash END,email=CASE WHEN ?<>'' THEN ? ELSE email END,requester_name=CASE WHEN ?<>'' THEN ? ELSE requester_name END,last_device_id=CASE WHEN ?<>'' THEN ? ELSE last_device_id END,app_banned=1,manual_ban=1,ban_reason='Banni manuellement par Steve Suzon',reactivation_requested=0,ban_at=?,updated_at=? WHERE id=?`).bind(sub&&sub.id||null,emailHash,emailHash,email,email,name,name,deviceId,deviceId,now,now,row.id).run();return json({ok:true,id:row.id,appBanned:true})}
    const r=await env.DB.prepare(`INSERT INTO market_user_sanctions(subscription_id,email_hash,email,requester_name,last_device_id,refusal_count,app_banned,contribution_blocked,reactivation_requested,ban_at,updated_at,manual_ban,ban_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(sub&&sub.id||null,emailHash||null,email||null,name||null,deviceId||null,0,1,0,0,now,now,1,'Banni manuellement par Steve Suzon').run();return json({ok:true,id:Number(r.meta&&r.meta.last_row_id||0),appBanned:true});
  }
  const id=Number(d.id||0);if(!id||action!=='unban')return json({ok:false,error:'DONNEES_INVALIDES'},400);
  const row=await env.DB.prepare("SELECT id,contribution_blocked,COALESCE(manual_ban,0) AS manual_ban FROM market_user_sanctions WHERE id=? LIMIT 1").bind(id).first();if(!row)return json({ok:false,error:'UTILISATEUR_INTROUVABLE'},404);
  const blocked=Number(row.manual_ban)?Number(row.contribution_blocked||0):1,now=Date.now();
  await env.DB.prepare("UPDATE market_user_sanctions SET app_banned=0,contribution_blocked=?,manual_ban=0,ban_reason='',reactivation_requested=0,reactivated_at=?,updated_at=? WHERE id=?").bind(blocked,now,now,id).run();return json({ok:true,appBanned:false,contributionBlocked:!!blocked});
}
async function adminAllUsersV278(request,env){
  if(!(await adminAuthorized(request,env)))return json({ok:false,error:'SECRET_INCORRECT'},401);
  if(!env.DB)return json({ok:false,error:'DB_INDISPONIBLE'},503);
  await ensureAppIdentityTables(env);await ensureSubscriptionEmailColumns(env);await ensureSanctionTablesV242(env);
  // V287 : nettoyage définitif des anciennes fiches d'identité sans e-mail valide.
  // On ne touche jamais aux abonnements, points, adresses, devis ou autres données métier.
  try{const legacy=(await env.DB.prepare("SELECT rowid AS rid,email FROM app_identities").all()).results||[];for(const r of legacy){if(!validEmail(normalizeEmail(r.email)))await env.DB.prepare("DELETE FROM app_identities WHERE rowid=?").bind(Number(r.rid)).run()}}catch(_){}
  const users=new Map(),add=(x)=>{const email=normalizeEmail(x.email),deviceId=String(x.deviceId||'').trim(),key=email?'e:'+email:(deviceId?'d:'+deviceId:'');if(!key)return;const old=users.get(key)||{};users.set(key,{email:email||old.email||'',firstName:contestCleanName(x.firstName)||old.firstName||'',lastName:contestCleanName(x.lastName)||old.lastName||'',deviceId:deviceId||old.deviceId||'',subscriptionId:Number(x.subscriptionId||old.subscriptionId||0)||null,createdAt:Number(x.createdAt||old.createdAt||0)})};
  try{const q=await env.DB.prepare("SELECT email,first_name,last_name,device_id,email_verified_at AS created_at FROM app_identities WHERE email_verified_at>0 ORDER BY email_verified_at").all();for(const r of q.results||[])add({email:r.email,firstName:r.first_name,lastName:r.last_name,deviceId:r.device_id,createdAt:r.created_at})}catch(_){}
  try{const q=await env.DB.prepare("SELECT id,recovery_email_mask,account_first_name,account_last_name,phone_device,autoradio_device,account_updated_at FROM subscriptions ORDER BY id").all();for(const r of q.results||[]){const em=normalizeEmail(r.recovery_email_mask),key=em?'e:'+em:'';if(key&&users.has(key))add({email:em,firstName:r.account_first_name,lastName:r.account_last_name,deviceId:r.phone_device||r.autoradio_device,subscriptionId:r.id,createdAt:r.account_updated_at})}}catch(_){}
  const sanctions=(await env.DB.prepare("SELECT id,subscription_id,email_hash,email,last_device_id,app_banned,contribution_blocked,COALESCE(manual_ban,0) AS manual_ban,refusal_count FROM market_user_sanctions").all()).results||[],bySub=new Map(),byEmail=new Map(),byHash=new Map(),byDevice=new Map();
  for(const s of sanctions){if(s.subscription_id!=null)bySub.set(Number(s.subscription_id),s);if(s.email)byEmail.set(normalizeEmail(s.email),s);if(s.email_hash)byHash.set(String(s.email_hash),s);if(s.last_device_id)byDevice.set(String(s.last_device_id),s)}
  let result=[];for(const u of users.values()){
    // V286 : sans adresse e-mail valide, aucune fiche utilisateur active n’est exposée à l’admin.
    // L’overlay d’accès oblige la personne à renseigner son e-mail avant d’utiliser l’application.
    if(!validEmail(u.email))continue;
    if(!u.firstName&&!u.lastName)continue;let s=u.subscriptionId?bySub.get(Number(u.subscriptionId)):null;if(!s&&u.email)s=byEmail.get(u.email);if(!s&&u.email)s=byHash.get(await sha256Text(u.email));if(!s&&u.deviceId)s=byDevice.get(u.deviceId);result.push({...u,name:[u.firstName,u.lastName].filter(Boolean).join(' '),sanctionId:s?Number(s.id):null,banned:!!Number(s&&s.app_banned),contributionBlocked:!!Number(s&&s.contribution_blocked),refusalCount:Number(s&&s.refusal_count||0),isAdmin:u.email==='appli.suzon@gmail.com'})}
  // Si un ancien doublon exact subsiste avec le même nom, on garde une seule fiche par e-mail.
  const seenUserKeys=new Set();result=result.filter(u=>{const k=subscriptionIdentityKey(u.firstName)+'|'+subscriptionIdentityKey(u.lastName)+'|'+normalizeEmail(u.email);if(seenUserKeys.has(k))return false;seenUserKeys.add(k);return true});
  result.sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base'})||a.email.localeCompare(b.email));
  return json({ok:true,users:result,count:result.length});
}

// ===== V289 : MESSAGES DIRECTS ADMIN AUX UTILISATEURS BANNIS =====
async function ensureAdminDirectMessagesV289(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_direct_messages(
    id TEXT PRIMARY KEY, sanction_id INTEGER, subscription_id INTEGER, email TEXT, device_id TEXT,
    message TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, seen_at INTEGER
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_admin_direct_messages_target ON admin_direct_messages(device_id,email,expires_at)").run();
}
async function adminDirectMessageV289(request,env){
  if(!env.DB)return json({ok:false,error:'DB_INDISPONIBLE'},503);
  await ensureAdminDirectMessagesV289(env);
  if(request.method==='GET'){
    const d=await body(request),deviceId=String(d.deviceId||'').trim().slice(0,140),email=normalizeEmail(d.email);
    if(!deviceId&&!validEmail(email))return json({ok:true,messages:[]});
    const rows=await env.DB.prepare(`SELECT id,message,created_at,expires_at FROM admin_direct_messages WHERE expires_at>? AND (seen_at IS NULL) AND (device_id=? OR (?<>'' AND email=?)) ORDER BY created_at DESC LIMIT 5`).bind(Date.now(),deviceId,email,email).all();
    return json({ok:true,messages:rows.results||[]});
  }
  if(request.method==='POST'){
    if(!(await adminAuthorized(request,env)))return json({ok:false,error:'SECRET_INCORRECT'},401);
    const d=await body(request),action=String(d.action||'send'),message=String(d.message||'').trim().slice(0,800);
    if(action==='seen'){
      const id=String(d.id||'').trim(),deviceId=String(d.deviceId||'').trim().slice(0,140),email=normalizeEmail(d.email);
      if(!id)return json({ok:false,error:'MESSAGE_INVALIDE'},400);
      await env.DB.prepare("UPDATE admin_direct_messages SET seen_at=? WHERE id=? AND (device_id=? OR (?<>'' AND email=?))").bind(Date.now(),id,deviceId,email,email).run();
      return json({ok:true});
    }
    const sanctionId=Number(d.sanctionId||0),row=await env.DB.prepare("SELECT id,subscription_id,email,last_device_id,app_banned FROM market_user_sanctions WHERE id=? LIMIT 1").bind(sanctionId).first();
    if(!row||!Number(row.app_banned))return json({ok:false,error:'UTILISATEUR_NON_BANNI'},409);
    if(!message)return json({ok:false,error:'MESSAGE_VIDE'},400);
    const now=Date.now(),id='admmsg-'+now+'-'+Math.random().toString(36).slice(2,10);
    await env.DB.prepare("INSERT INTO admin_direct_messages(id,sanction_id,subscription_id,email,device_id,message,created_at,expires_at,seen_at) VALUES(?,?,?,?,?,?,?,?,NULL)").bind(id,Number(row.id),row.subscription_id||null,normalizeEmail(row.email)||'',String(row.last_device_id||''),message,now,now+7*86400000).run();
    return json({ok:true,id,expiresAt:now+7*86400000});
  }
  return json({ok:false,error:'METHODE_INVALIDE'},405);
}
// ===== FIN V289 =====

async function sanctionStatusV242(request,env){
  if(!env.DB)return json({ok:true,appBanned:false,contributionBlocked:false,refusalCount:0,reactivationRequested:false});await ensureSanctionTablesV242(env);const d=await body(request),deviceId=String(d.deviceId||'').trim(),email=normalizeEmail(d.email),emailHash=validEmail(email)?await sha256Text(email):'',sub=await subscriptionForBanV242(env,deviceId,email),row=await sanctionRowV242(env,{subscriptionId:sub&&sub.id,emailHash:emailHash||(sub&&sub.recovery_email_hash)||'',deviceId});return json({ok:true,appBanned:!!Number(row&&row.app_banned),contributionBlocked:!!Number(row&&row.contribution_blocked),refusalCount:Number(row&&row.refusal_count||0),reactivationRequested:!!Number(row&&row.reactivation_requested)});
}
async function reactivationV242(request,env){
  if(!env.DB)return json({ok:false,error:'DB_INDISPONIBLE'},503);await ensureSanctionTablesV242(env);const d=await body(request),deviceId=String(d.deviceId||'').trim(),email=normalizeEmail(d.email),emailHash=validEmail(email)?await sha256Text(email):'',sub=await subscriptionForBanV242(env,deviceId,email),row=await sanctionRowV242(env,{subscriptionId:sub&&sub.id,emailHash:emailHash||(sub&&sub.recovery_email_hash)||'',deviceId});if(!row||!Number(row.app_banned))return json({ok:false,error:'COMPTE_NON_BANNI'},409);const now=Date.now();await env.DB.prepare("UPDATE market_user_sanctions SET reactivation_requested=1,reactivation_requested_at=?,updated_at=? WHERE id=?").bind(now,now,row.id).run();return json({ok:true,pending:true});
}
// ===== FIN V242 =====

// ===== V244 ACCÈS GLOBAL + COIN DÉTENTE & CHAMPIGNONS =====
function cleanIdentityText(v,max=120){return String(v||'').replace(/\s+/g,' ').trim().slice(0,max)}
function validIdentityEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(v||'').trim())}
let _appIdentitySchemaPromise=null;
async function ensureAppIdentityTables(env){
  if(_appIdentitySchemaPromise)return _appIdentitySchemaPromise;
  _appIdentitySchemaPromise=(async()=>{
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_identities(
      email TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, device_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`).run();
    try{await env.DB.prepare("ALTER TABLE app_identities ADD COLUMN email_verified_at INTEGER NOT NULL DEFAULT 0").run()}catch(_){}
    try{await env.DB.prepare("ALTER TABLE app_identities ADD COLUMN email_verified_device_id TEXT NOT NULL DEFAULT ''").run()}catch(_){}
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS app_identities_device_idx ON app_identities(device_id)").run();
    try{await env.DB.prepare("CREATE INDEX IF NOT EXISTS app_identities_verified_idx ON app_identities(email_verified_at,email_verified_device_id)").run()}catch(_){}
    try{await env.DB.prepare("CREATE INDEX IF NOT EXISTS app_identities_email_ci_idx ON app_identities(lower(email))").run()}catch(_){}
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_identity_email_links(
      id TEXT PRIMARY KEY,email TEXT NOT NULL,email_hash TEXT NOT NULL,first_name TEXT NOT NULL,last_name TEXT NOT NULL,
      device_id TEXT NOT NULL,platform TEXT NOT NULL DEFAULT 'pwa',token_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,
      confirmed_at INTEGER NOT NULL DEFAULT 0,handoff_hash TEXT NOT NULL DEFAULT '',handoff_expires_at INTEGER NOT NULL DEFAULT 0,
      handoff_consumed INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL
    )`).run();
    try{await env.DB.prepare("CREATE INDEX IF NOT EXISTS app_identity_links_device_idx ON app_identity_email_links(device_id,email_hash,created_at DESC)").run()}catch(_){}
    try{await env.DB.prepare("CREATE INDEX IF NOT EXISTS app_identity_links_handoff_idx ON app_identity_email_links(handoff_hash,handoff_expires_at)").run()}catch(_){}
    // V305 : les identités créées avant la V304 existaient déjà dans l'application.
    // On les considère comme comptes historiques et on ne leur impose pas une nouvelle
    // confirmation e-mail. La confirmation par lien reste obligatoire uniquement pour
    // les nouveaux comptes créés à partir de la V304/V305.
    try{
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_identity_migrations(key TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)`).run();
      const migrationKey='legacy-identities-grandfather-v305',cutoff=1789852260000;
      const done=await env.DB.prepare("SELECT key FROM app_identity_migrations WHERE key=? LIMIT 1").bind(migrationKey).first();
      if(!done){
        await env.DB.prepare(`UPDATE app_identities
          SET email_verified_at=CASE WHEN created_at>0 THEN created_at ELSE ? END,
              email_verified_device_id=CASE WHEN trim(COALESCE(device_id,''))<>'' THEN device_id ELSE email_verified_device_id END
          WHERE COALESCE(email_verified_at,0)<=0
            AND created_at>0 AND created_at<=?
            AND length(trim(first_name))>=2 AND length(trim(last_name))>=2
            AND instr(trim(email),'@')>1
            AND instr(substr(trim(email),instr(trim(email),'@')+1),'.')>1`).bind(cutoff,cutoff).run();
        await env.DB.prepare("INSERT OR REPLACE INTO app_identity_migrations(key,applied_at) VALUES(?,?)").bind(migrationKey,Date.now()).run();
      }
    }catch(_){}
  })().catch(e=>{_appIdentitySchemaPromise=null;throw e});
  return _appIdentitySchemaPromise;
}
async function appIdentityMagicHash(id,token,env){return sha256Text("app-identity-magic:"+id+":"+token+":"+(env.CODE_PEPPER||"couteau-suisse-identity"))}
async function appIdentityHandoffHash(token,env){return sha256Text("app-identity-handoff:"+token+":"+(env.CODE_PEPPER||"couteau-suisse-identity"))}
function appIdentityPlatform(v){v=cleanIdentityText(v||'pwa',32).toLowerCase();return /^(ios|android|pwa)$/.test(v)?v:'pwa'}
async function saveVerifiedAppIdentity(env,data,verifiedAt){
  await ensureAppIdentityTables(env);await ensureInstallationsTable(env);
  const firstName=cleanIdentityText(data&&data.firstName,80),lastName=cleanIdentityText(data&&data.lastName,80),email=normalizeEmail(data&&data.email),deviceId=cleanIdentityText(data&&data.deviceId,140),platform=appIdentityPlatform(data&&data.platform),now=Date.now(),verified=Math.max(1,Number(verifiedAt||now));
  if(firstName.length<2||lastName.length<2||!validIdentityEmail(email)||!validDevice(deviceId))throw new Error('IDENTITE_INCOMPLETE');
  const seen=Math.floor(now/1000);
  try{
    const legacy=await env.DB.prepare("SELECT email,first_name,last_name FROM app_identities").all(),fk=subscriptionIdentityKey(firstName),lk=subscriptionIdentityKey(lastName);
    for(const r of legacy.results||[]){const oldEmail=normalizeEmail(r.email);if(validEmail(oldEmail))continue;if(subscriptionIdentityKey(r.first_name)===fk&&subscriptionIdentityKey(r.last_name)===lk)await env.DB.prepare("DELETE FROM app_identities WHERE email=?").bind(String(r.email||'')).run()}
  }catch(_){}
  await env.DB.prepare(`INSERT INTO app_identities(email,first_name,last_name,device_id,created_at,updated_at,email_verified_at,email_verified_device_id)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,device_id=excluded.device_id,updated_at=excluded.updated_at,email_verified_at=MAX(app_identities.email_verified_at,excluded.email_verified_at),email_verified_device_id=excluded.email_verified_device_id`)
    .bind(email,firstName,lastName,deviceId,now,now,verified,deviceId).run();
  try{
    await ensureSanctionTablesV242(env);const emailHash=await sha256Text(email);
    const sanction=await env.DB.prepare(`SELECT id FROM market_user_sanctions WHERE (email_hash=? AND email_hash<>'') OR (last_device_id=? AND ?<>'') ORDER BY updated_at DESC LIMIT 1`).bind(emailHash,deviceId,deviceId).first();
    if(sanction)await env.DB.prepare(`UPDATE market_user_sanctions SET email_hash=?,email=?,requester_name=?,last_device_id=?,updated_at=? WHERE id=?`).bind(emailHash,email,firstName+' '+lastName,deviceId,now,Number(sanction.id)).run();
  }catch(_){}
  await env.DB.prepare(`INSERT INTO app_installations(device_id,platform,first_seen,last_seen) VALUES(?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET platform=excluded.platform,last_seen=excluded.last_seen`).bind(deviceId,platform,seen,seen).run();
  try{const cfg=await ensureContestTables(env);if(Date.now()<Number(cfg&&cfg.end_at||0))await contestAutoEnrollIdentityV303(env,cfg,{email,first_name:firstName,last_name:lastName,device_id:deviceId,created_at:verified})}catch(_){}
  return {firstName,lastName,email,deviceId,platform,verifiedAt:verified};
}
async function verifiedAppIdentityState(env,email,deviceId){
  await ensureAppIdentityTables(env);email=normalizeEmail(email);deviceId=cleanIdentityText(deviceId,140);
  if(!validEmail(email)||!validDevice(deviceId))return {verified:false};
  let row=await env.DB.prepare(`SELECT email,first_name,last_name,device_id,created_at,email_verified_at,email_verified_device_id FROM app_identities WHERE lower(email)=? LIMIT 1`).bind(email).first();
  if(!row||Number(row.email_verified_at||0)<=0)return {verified:false};
  let sub=null;try{sub=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND (lower(COALESCE(recovery_email_mask,''))=? OR phone_device=? OR autoradio_device=?) ORDER BY CASE WHEN lower(COALESCE(recovery_email_mask,''))=? THEN 0 ELSE 1 END,lifetime DESC,COALESCE(expires_at,'') DESC,id DESC LIMIT 1").bind(email,deviceId,deviceId,email).first()}catch(_){}
  if(String(row.email_verified_device_id||'')!==deviceId){
    const historical=Number(row.created_at||0)>0&&Number(row.created_at||0)<=1789852260000;
    const knownDevice=String(row.device_id||'')===deviceId||!!(sub&&(String(sub.phone_device||'')===deviceId||String(sub.autoradio_device||'')===deviceId));
    if(!historical||!knownDevice)return {verified:false};
    try{await env.DB.prepare("UPDATE app_identities SET device_id=?,email_verified_device_id=?,updated_at=? WHERE lower(email)=?").bind(deviceId,deviceId,Date.now(),email).run();row.device_id=deviceId;row.email_verified_device_id=deviceId}catch(_){}
  }
  let trial=false;try{trial=!!(sub&&await isContestTrialRow(sub))}catch(_){}
  return {verified:true,identity:{firstName:String(row.first_name||''),lastName:String(row.last_name||''),email:String(row.email||email)},deviceId,verifiedAt:Number(row.email_verified_at||0),subscription:sub?{ok:true,email:String(sub.recovery_email_mask||email),firstName:String(sub.account_first_name||row.first_name||''),lastName:String(sub.account_last_name||row.last_name||''),lifetime:!!sub.lifetime,expiresAt:sub.expires_at||null,trial,trialMode:trial?'seven_day':'',existingAccount:!trial}:null};
}
async function sendAppIdentityConfirmationEmail(env,email,confirmUrl,firstName){
  const safeFirst=String(firstName||'').replace(/[<>&"']/g,'');
  const subject='Confirmez votre adresse e-mail Couteau Suisse';
  const text=`Bonjour${safeFirst?' '+safeFirst:''}, confirmez votre adresse e-mail pour terminer votre inscription Couteau Suisse : ${confirmUrl}. Ce lien est valable 24 heures.`;
  const html=`<div style="margin:0;background:#07182d;padding:24px;font-family:Arial,sans-serif;color:#fff"><div style="max-width:620px;margin:auto;background:linear-gradient(180deg,#0d2f5a,#06172d);border:3px solid #3aa7ff;border-radius:24px;padding:28px;text-align:center"><div style="font-size:48px">✉️</div><h1 style="color:#7bc6ff;margin:8px 0">COUTEAU SUISSE</h1><p style="font-size:19px;line-height:1.5">Bonjour${safeFirst?' <b>'+safeFirst+'</b>':''},</p><p style="font-size:18px;line-height:1.5">Appuyez sur le bouton ci-dessous pour confirmer votre adresse e-mail et terminer votre inscription.</p><a href="${confirmUrl}" style="display:inline-block;margin:18px 0;padding:17px 28px;background:#1478d1;color:#fff;text-decoration:none;border-radius:14px;font-size:19px;font-weight:900">CONFIRMER MON ADRESSE E-MAIL</a><p style="font-size:13px;color:#b8c7d9;margin-top:18px">Lien personnel valable 24 heures. Après confirmation, vous serez redirigé automatiquement vers Couteau Suisse.</p></div></div>`;
  return brevoSendHtml(env,email,subject,text,html);
}
async function appIdentityStart(request,env){
  if(!env.DB)return json({ok:false,error:'DB_NON_CONFIGUREE'},503);
  await ensureAppIdentityTables(env);await ensureSubscriptionEmailColumns(env);
  const d=await body(request),firstName=cleanIdentityText(d.firstName,80),lastName=cleanIdentityText(d.lastName,80),email=normalizeEmail(d.email),deviceId=cleanIdentityText(d.deviceId,140),platform=appIdentityPlatform(d.platform),now=Date.now(),day=parisDay();
  if(firstName.length<2||lastName.length<2||!validEmail(email)||!validDevice(deviceId))return json({ok:false,error:'IDENTITE_INCOMPLETE'},400);
  const existing=await verifiedAppIdentityState(env,email,deviceId);if(existing.verified)return json({ok:true,alreadyVerified:true,...existing});
  const usage=await env.DB.prepare("SELECT sent_count FROM brevo_daily_usage WHERE day=?").bind(day).first();if(Number(usage&&usage.sent_count||0)>=200)return json({ok:false,error:'QUOTA_EMAIL_JOURNALIER'},429);
  const emailHash=await sha256Text(email),recent=await env.DB.prepare("SELECT created_at FROM app_identity_email_links WHERE device_id=? AND email_hash=? ORDER BY created_at DESC LIMIT 1").bind(deviceId,emailHash).first();
  if(recent&&now-Number(recent.created_at||0)<60000)return json({ok:false,error:'EMAIL_TROP_RAPIDE',emailMask:emailMask(email)},429);
  const id=crypto.randomUUID(),token=referralToken(),tokenHash=await appIdentityMagicHash(id,token,env),expires=now+24*60*60*1000;
  await env.DB.prepare("DELETE FROM app_identity_email_links WHERE expires_at<? AND handoff_expires_at<?").bind(now-86400000,now-86400000).run();
  await env.DB.prepare(`INSERT INTO app_identity_email_links(id,email,email_hash,first_name,last_name,device_id,platform,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id,email,emailHash,firstName,lastName,deviceId,platform,tokenHash,expires,now).run();
  const confirmUrl=new URL(request.url).origin+'/api/app-identity/confirm?id='+encodeURIComponent(id)+'&token='+encodeURIComponent(token);
  if(!(await sendAppIdentityConfirmationEmail(env,email,confirmUrl,firstName))){await env.DB.prepare("DELETE FROM app_identity_email_links WHERE id=?").bind(id).run();return json({ok:false,error:'EMAIL_ENVOI_INDISPONIBLE'},503)}
  await env.DB.prepare("INSERT INTO brevo_daily_usage(day,sent_count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET sent_count=sent_count+1").bind(day).run();
  return json({ok:true,emailMask:emailMask(email),expiresAt:expires,confirmationSent:true});
}
async function appIdentityConfirm(request,env){
  if(!env.DB)return new Response('Service indisponible',{status:503});await ensureAppIdentityTables(env);
  const url=new URL(request.url),id=String(url.searchParams.get('id')||'').trim(),token=String(url.searchParams.get('token')||'').trim(),origin=url.origin;
  const go=(state,handoff='')=>Response.redirect(origin+'/?installation=1&email_confirmed='+encodeURIComponent(state)+(handoff?'&email_handoff='+encodeURIComponent(handoff):''),302);
  if(!id||!token)return go('invalid');
  const row=await env.DB.prepare("SELECT * FROM app_identity_email_links WHERE id=? LIMIT 1").bind(id).first();if(!row)return go('invalid');
  if(Number(row.expires_at||0)<Date.now())return go('expired');
  if(await appIdentityMagicHash(id,token,env)!==String(row.token_hash||''))return go('invalid');
  const now=Date.now();
  try{
    if(Number(row.confirmed_at||0)<=0){
      await saveVerifiedAppIdentity(env,{firstName:row.first_name,lastName:row.last_name,email:row.email,deviceId:row.device_id,platform:row.platform},now);
      await env.DB.prepare("UPDATE app_identity_email_links SET confirmed_at=? WHERE id=?").bind(now,id).run();
      try{const ir=new Request(origin+'/api/contest/trial-identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:row.device_id,firstName:row.first_name,lastName:row.last_name,email:row.email})});await contestTrialIdentity(ir,env)}catch(_){}
    }
    const handoff=referralToken(),handoffHash=await appIdentityHandoffHash(handoff,env),handoffExpires=now+15*60*1000;
    await env.DB.prepare("UPDATE app_identity_email_links SET handoff_hash=?,handoff_expires_at=?,handoff_consumed=0 WHERE id=?").bind(handoffHash,handoffExpires,id).run();
    return go('ok',handoff);
  }catch(_){return go('invalid')}
}
async function appIdentityHandoff(request,env){
  if(!env.DB)return json({ok:false,error:'DB_NON_CONFIGUREE'},503);await ensureAppIdentityTables(env);
  const d=await body(request),token=String(d.token||'').trim();if(!token)return json({ok:false,error:'CONFIRMATION_INTROUVABLE'},404);
  const hash=await appIdentityHandoffHash(token,env),row=await env.DB.prepare("SELECT * FROM app_identity_email_links WHERE handoff_hash=? LIMIT 1").bind(hash).first(),now=Date.now();
  if(!row||Number(row.confirmed_at||0)<=0||Number(row.handoff_consumed||0)!==0)return json({ok:false,error:'CONFIRMATION_INTROUVABLE'},404);
  if(Number(row.handoff_expires_at||0)<now)return json({ok:false,error:'CONFIRMATION_EXPIREE'},410);
  const state=await verifiedAppIdentityState(env,row.email,row.device_id);if(!state.verified)return json({ok:false,error:'EMAIL_NON_CONFIRMEE'},403);
  await env.DB.prepare("UPDATE app_identity_email_links SET handoff_consumed=1 WHERE id=? AND handoff_consumed=0").bind(row.id).run();
  return json({ok:true,...state});
}
async function appIdentityStatus(request,env){
  if(!env.DB)return json({ok:false,verified:false,error:'DB_NON_CONFIGUREE'},503);const d=await body(request),state=await verifiedAppIdentityState(env,d.email,d.deviceId);return json({ok:true,...state});
}
async function appIdentity(request,env){
  if(!env.DB)return json({ok:false,error:'DB_NON_CONFIGUREE'},503);
  await ensureAppIdentityTables(env);const d=await body(request),firstName=cleanIdentityText(d.firstName,80),lastName=cleanIdentityText(d.lastName,80),email=normalizeEmail(d.email),deviceId=cleanIdentityText(d.deviceId,140),platform=appIdentityPlatform(d.platform);
  if(firstName.length<2||lastName.length<2||!validIdentityEmail(email)||!validDevice(deviceId))return json({ok:false,error:'IDENTITE_INCOMPLETE',message:'Nom, prénom et adresse e-mail valide sont obligatoires.'},400);
  const state=await verifiedAppIdentityState(env,email,deviceId);if(!state.verified)return json({ok:false,error:'EMAIL_NON_CONFIRMEE',message:'Confirmez d’abord votre adresse e-mail depuis le lien reçu.'},403);
  const identity=await saveVerifiedAppIdentity(env,{firstName,lastName,email,deviceId,platform},state.verifiedAt||Date.now());
  return json({ok:true,identity:{firstName:identity.firstName,lastName:identity.lastName,email:identity.email},identityUpdatedAt:Date.now(),emailVerified:true});
}

const MUSHROOM_PHOTO_MAX_BYTES=650000, MUSHROOM_ACCESS_DAYS=365, MUSHROOM_CONTEST_POINTS=50;
async function ensureMushroomTables(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mushroom_spots(
    id TEXT PRIMARY KEY,email TEXT NOT NULL,first_name TEXT NOT NULL,last_name TEXT NOT NULL,device_id TEXT NOT NULL,
    latitude REAL NOT NULL,longitude REAL NOT NULL,accuracy REAL NOT NULL,department TEXT NOT NULL,species TEXT NOT NULL,scientific_name TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',ai_confidence INTEGER NOT NULL DEFAULT 0,ai_reason TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',photo_key TEXT NOT NULL,mime_type TEXT NOT NULL DEFAULT 'image/jpeg',created_at INTEGER NOT NULL
  )`).run();
  try{await env.DB.prepare("ALTER TABLE mushroom_spots ADD COLUMN category TEXT NOT NULL DEFAULT ''").run()}catch(_){}
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS mushroom_spots_department_idx ON mushroom_spots(department,created_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS mushroom_spots_species_idx ON mushroom_spots(species,created_at DESC)").run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mushroom_photo_blobs(
    spot_id TEXT PRIMARY KEY,data_base64 TEXT NOT NULL,mime_type TEXT NOT NULL DEFAULT 'image/jpeg',updated_at INTEGER NOT NULL
  )`).run();
  for(const sql of [
    "ALTER TABLE mushroom_spots ADD COLUMN wood_name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE mushroom_spots ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE mushroom_spots ADD COLUMN source TEXT NOT NULL DEFAULT 'community'",
    "ALTER TABLE mushroom_spots ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE mushroom_spots ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0"
  ]){try{await env.DB.prepare(sql).run()}catch(_){}}
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mushroom_spot_delete_votes(
    spot_id TEXT NOT NULL,subscription_id INTEGER NOT NULL,created_at INTEGER NOT NULL,
    PRIMARY KEY(spot_id,subscription_id)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mushroom_seed_states(
    spot_id TEXT PRIMARY KEY,wood_name TEXT NOT NULL DEFAULT '',species TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',
    is_private INTEGER NOT NULL DEFAULT 0,hidden INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL
  )`).run();
}

const MUSHROOM_GOOGLE_WOODS=[
  {id:'google-idf-fontainebleau',wood_name:'Forêt de Fontainebleau',latitude:48.4096,longitude:2.6331,department:'77',species:'Cèpes, girolles et pieds-de-mouton',category:'Plusieurs champignons',note:'Secteur forestier de Fontainebleau.',is_private:0},
  {id:'google-idf-armainvilliers',wood_name:'Forêt d’Armainvilliers',latitude:48.8218,longitude:2.7272,department:'77',species:'Cèpes et bolets',category:'Cèpes / Bolets',note:'Bois mixtes de Seine-et-Marne.',is_private:0},
  {id:'google-idf-villefermoy',wood_name:'Forêt de Villefermoy',latitude:48.4872,longitude:2.9684,department:'77',species:'Cèpes et chanterelles',category:'Plusieurs champignons',note:'Feuillus et pinèdes au sud de la Seine-et-Marne.',is_private:0},
  {id:'google-idf-rambouillet',wood_name:'Forêt de Rambouillet',latitude:48.6769,longitude:1.7539,department:'78',species:'Cèpes, girolles, coulemelles, pieds-de-mouton et trompettes',category:'Plusieurs champignons',note:'Point situé dans un secteur domanial du massif.',is_private:0},
  {id:'google-idf-senart',wood_name:'Forêt de Sénart',latitude:48.6597,longitude:2.4881,department:'91',species:'Girolles et coulemelles',category:'Plusieurs champignons',note:'Massif forestier entre Essonne et Seine-et-Marne.',is_private:0},
  {id:'google-idf-dourdan',wood_name:'Forêt de Dourdan',latitude:48.5354,longitude:2.0124,department:'91',species:'Cèpes, girolles et pieds-de-mouton',category:'Plusieurs champignons',note:'Massif forestier du sud de l’Essonne.',is_private:0},
  {id:'google-idf-rougeau',wood_name:'Forêt de Rougeau',latitude:48.6068,longitude:2.5486,department:'91',species:'Cèpes et chanterelles',category:'Plusieurs champignons',note:'Massif forestier proche de Corbeil-Essonnes.',is_private:0},
  {id:'google-idf-meudon',wood_name:'Forêt de Meudon',latitude:48.8028,longitude:2.2265,department:'92',species:'Pieds-de-mouton et cèpes',category:'Plusieurs champignons',note:'Bois urbain des Hauts-de-Seine.',is_private:0},
  {id:'google-idf-notre-dame',wood_name:'Forêt Notre-Dame',latitude:48.7489,longitude:2.5489,department:'94',species:'Bolets, coulemelles et girolles',category:'Plusieurs champignons',note:'Massif forestier du Val-de-Marne.',is_private:0},
  {id:'google-idf-montmorency',wood_name:'Forêt de Montmorency',latitude:49.0216,longitude:2.2895,department:'95',species:'Cèpes, bolets et coulemelles',category:'Plusieurs champignons',note:'Massif forestier du Val-d’Oise.',is_private:0},
  {id:'google-bzh-huelgoat',wood_name:'Forêt de Huelgoat',latitude:48.3658,longitude:-3.7452,department:'29',species:'Cèpes, bolets, girolles et pieds-de-mouton',category:'Plusieurs champignons',note:'Forêt domaniale du Finistère.',is_private:0},
  {id:'google-bzh-cranou',wood_name:'Forêt du Cranou',latitude:48.3113,longitude:-4.0835,department:'29',species:'Cèpes, pleurotes et coprins',category:'Plusieurs champignons',note:'Forêt domaniale du Finistère.',is_private:0},
  {id:'google-bzh-coetquen',wood_name:'Forêt de Coëtquen',latitude:48.4695,longitude:-1.9567,department:'22',species:'Cèpes et girolles',category:'Plusieurs champignons',note:'Massif forestier des Côtes-d’Armor.',is_private:0},
  {id:'google-bzh-loudeac',wood_name:'Forêt de Loudéac',latitude:48.1834,longitude:-2.7472,department:'22',species:'Cèpes et bolets',category:'Cèpes / Bolets',note:'Massif forestier des Côtes-d’Armor.',is_private:0},
  {id:'google-bzh-paimpont',wood_name:'Forêt de Paimpont – Brocéliande',latitude:48.0186,longitude:-2.1719,department:'35',species:'Cèpes, girolles et pieds-de-mouton',category:'Plusieurs champignons',note:'De nombreuses parcelles du massif sont privées.',is_private:1},
  {id:'google-bzh-quenecan',wood_name:'Forêt de Quénécan',latitude:48.1986,longitude:-3.0264,department:'56',species:'Cèpes et bolets',category:'Cèpes / Bolets',note:'Massif majoritairement privé.',is_private:1},
  {id:'google-bzh-camors',wood_name:'Forêt de Camors',latitude:47.8498,longitude:-3.0027,department:'56',species:'Cèpes, bolets et lactaires',category:'Plusieurs champignons',note:'Forêt domaniale du Morbihan.',is_private:0},
  {id:'google-bzh-pontcallec',wood_name:'Forêt de Pont-Calleck',latitude:48.0703,longitude:-3.4191,department:'56',species:'Cèpes, bolets et lactaires',category:'Plusieurs champignons',note:'Forêt domaniale du Morbihan.',is_private:0}
].map(x=>({...x,accuracy:80,scientific_name:'',ai_confidence:0,ai_reason:'',source:'google',created_at:1799971200000,updated_at:0}));
async function ensureMushroomAccessTables(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mushroom_access_codes(
    id INTEGER PRIMARY KEY AUTOINCREMENT,code_hash TEXT NOT NULL UNIQUE,duration_days INTEGER NOT NULL DEFAULT 365,
    active INTEGER NOT NULL DEFAULT 1,used_by_subscription_id INTEGER,used_at INTEGER,created_at INTEGER NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mushroom_memberships(
    subscription_id INTEGER PRIMARY KEY,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
  )`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS mushroom_codes_used_idx ON mushroom_access_codes(used_by_subscription_id,used_at)").run();
}
async function createMushroomAdminCode(env,data){
  await ensureMushroomAccessTables(env);let code=normalizeCode(data.code);
  if(data.generate===true||!validCode(code)){
    code='';for(let i=0;i<40;i++){const c=randomSubscriptionCode(),h=await hashCode('MUSHROOM-'+c,env.CODE_PEPPER),e=await env.DB.prepare('SELECT id FROM mushroom_access_codes WHERE code_hash=? LIMIT 1').bind(h).first();if(!e){code=c;break}}
  }
  if(!validCode(code))return json({ok:false,error:'CODE_GENERATION_IMPOSSIBLE'},500);
  const h=await hashCode('MUSHROOM-'+code,env.CODE_PEPPER),existing=await env.DB.prepare('SELECT id,used_by_subscription_id FROM mushroom_access_codes WHERE code_hash=? LIMIT 1').bind(h).first();
  if(existing)return json({ok:false,error:'CODE_DEJA_UTILISE'},409);
  await env.DB.prepare('INSERT INTO mushroom_access_codes(code_hash,duration_days,active,created_at) VALUES(?,?,1,?)').bind(h,MUSHROOM_ACCESS_DAYS,Date.now()).run();
  return json({ok:true,kind:'mushroom',code,durationDays:MUSHROOM_ACCESS_DAYS,label:'Champignons — 1 an'});
}
function decodeMushroomPhoto(dataUrl){
  const m=String(dataUrl||'').match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);if(!m)return null;
  let bin;try{bin=atob(m[2])}catch(_){return null}if(!bin.length||bin.length>MUSHROOM_PHOTO_MAX_BYTES)return null;
  const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return {bytes,mime:m[1].toLowerCase()==='png'?'image/png':m[1].toLowerCase()==='webp'?'image/webp':'image/jpeg',base64:m[2]};
}
async function nearbyFungiCandidates(lat,lon){
  try{const u='https://api.inaturalist.org/v1/observations/species_counts?taxon_id=47170&lat='+encodeURIComponent(lat)+'&lng='+encodeURIComponent(lon)+'&radius=100&per_page=30&locale=fr';const r=await fetch(u,{headers:{accept:'application/json','user-agent':'Couteau-Suisse/244 mushroom-identification'},cf:{cacheTtl:1800,cacheEverything:true}});if(!r.ok)return [];const j=await r.json(),rows=Array.isArray(j.results)?j.results:[];return rows.map(x=>x&&x.taxon).filter(Boolean).map(t=>({name:String(t.name||''),common:String(t.preferred_common_name||'')})).filter(x=>x.name).slice(0,25)}catch(_){return []}
}
const MUSHROOM_VISION_MODEL='@cf/google/gemma-4-26b-a4b-it';
async function runMushroomVision(env,payload){const ai=workersAiBinding(env);if(!ai)throw new Error('AI_BINDING_MISSING');return ai.run(MUSHROOM_VISION_MODEL,payload)}
async function inspectMushroomPhoto(env,dataUrl,lat,lon){
  if(!workersAiBinding(env))return {ok:false,error:'IA_RECONNAISSANCE_NON_CONFIGUREE',message:"La liaison Workers AI « AI » n’est pas active sur cette version déployée. Ouvrez Liaisons et ajoutez Workers AI → AI."};
  const candidates=await nearbyFungiCandidates(lat,lon),prior=candidates.length?candidates.map(x=>(x.common?x.common+' / ':'')+x.name).join('; '):'aucune liste locale disponible';
  try{const response=await runMushroomVision(env,{messages:[{role:'system',content:'You are a careful mushroom-photo classifier. Return ONLY valid JSON. Never claim edibility or safety.'},{role:'user',content:'Analyse la photo prise en direct. Vérifie qu’un vrai champignon est clairement visible ET qu’il est encore naturellement en terre ou fixé à son support dans le bois. Rejette un champignon cueilli, tenu en main, posé dans un panier, sur une table, sur une photo imprimée ou affiché sur un écran. Si la scène est authentique, propose le nom français le plus probable et le nom scientifique si possible. Si incertain, donne un groupe prudent. Les espèces observées dans un rayon de 100 km peuvent aider sans constituer une preuve: '+prior+'. Réponds exactement avec {"mushroomDetected":boolean,"authenticScene":boolean,"commonName":"nom français ou groupe","scientificName":"nom latin ou vide","mushroomConfidence":integer,"speciesConfidence":integer,"reason":"raison courte en français"}. Aucune information de comestibilité.'}],image:dataUrl,max_tokens:240,temperature:0});
    const x=parseVisionJson(response);if(!x)return {ok:false,error:'ANALYSE_IA_INVALIDE',message:'La reconnaissance a répondu, mais le résultat est illisible. Reprenez une photo plus nette.'};const mushroomConfidence=Math.max(0,Math.min(100,Math.round(Number(x.mushroomConfidence)||0))),speciesConfidence=Math.max(0,Math.min(100,Math.round(Number(x.speciesConfidence)||0)));if(!(x.mushroomDetected===true&&x.authenticScene!==false&&mushroomConfidence>=50))return {ok:false,error:'AUCUN_CHAMPIGNON',message:String(x.reason||'Aucun champignon suffisamment visible sur la photo.').slice(0,220),mushroomConfidence};return {ok:true,commonName:cleanIdentityText(x.commonName,120)||'Champignon non identifié',scientificName:cleanIdentityText(x.scientificName,140),confidence:speciesConfidence,mushroomConfidence,reason:cleanIdentityText(x.reason,220)};
  }catch(e){const detail=String(e&&e.message||'').toLowerCase();if(detail.includes('ai_binding_missing'))return {ok:false,error:'IA_RECONNAISSANCE_NON_CONFIGUREE',message:'La liaison Workers AI « AI » n’est pas active.'};return {ok:false,error:'ANALYSE_IA_INDISPONIBLE',message:'La reconnaissance IA n’a pas répondu. Réessayez dans quelques secondes.'}}
}
function mushroomGuideInfo(v){const raw=String(v||'').trim(),parts=raw.split(/\s*(?:,|;|\+)\s*/).filter(Boolean);if(parts.length>1)return {category:'Plusieurs champignons',season:'Selon les variétés',habitat:'Plusieurs variétés ont été signalées dans ce bois. Consultez la liste de la fiche.'};const n=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/cepe|bolet/.test(n))return {category:'Cèpes / Bolets',season:'Juin à novembre',habitat:'Bois de chênes, hêtres, châtaigniers et conifères ; lisières et sols moussus après pluie.'};
  if(/girolle|chanterelle/.test(n))return {category:'Girolles / Chanterelles',season:'Juin à novembre',habitat:'Sous feuillus ou conifères, sols moussus et acides, souvent en groupes.'};
  if(/trompette/.test(n))return {category:'Trompettes',season:'Août à novembre',habitat:'Sous feuillus, surtout hêtres et chênes, sols frais, humides et ombragés.'};
  if(/morille/.test(n))return {category:'Morilles',season:'Mars à mai',habitat:'Lisières, frênes, vieux vergers, sols remués ou calcaires selon les espèces.'};
  if(/pied.*mouton|hydne/.test(n))return {category:'Pieds-de-mouton',season:'Août à décembre',habitat:'Bois de feuillus et conifères, sous litière de feuilles ou aiguilles.'};
  if(/coulemelle|lepiote/.test(n))return {category:'Coulemelles / Lépiotes',season:'Juillet à novembre',habitat:'Prairies, clairières, lisières et bords de chemins herbeux.'};
  if(/lactaire/.test(n))return {category:'Lactaires',season:'Juillet à novembre',habitat:'Selon l’espèce : pins, épicéas, bouleaux ou autres feuillus.'};
  if(/russule/.test(n))return {category:'Russules',season:'Juin à novembre',habitat:'Bois de feuillus et conifères ; habitat variable selon l’espèce.'};
  if(/amanite/.test(n))return {category:'Amanites',season:'Juin à novembre',habitat:'Bois et lisières sous divers arbres. Identification particulièrement délicate.'};
  if(/agaric/.test(n))return {category:'Agarics',season:'Mai à novembre',habitat:'Prairies, pelouses, lisières ou sous-bois selon l’espèce.'};
  if(/coprin/.test(n))return {category:'Coprins',season:'Printemps à automne',habitat:'Pelouses, bords de chemins, bois riches en matière organique.'};
  return {category:'Autres champignons',season:'Selon l’espèce et la météo',habitat:'Consultez la fiche de l’espèce ; recherchez dans son habitat naturel sans vous fier uniquement à la photo.'};
}
async function mushroomHmacKey(env){return crypto.subtle.importKey('raw',new TextEncoder().encode('mushroom-v244:'+String(env.CODE_PEPPER||'couteau-suisse')), {name:'HMAC',hash:'SHA-256'},false,['sign','verify'])}
async function signMushroomPayload(env,payload){const part=b64urlText(JSON.stringify(payload)),key=await mushroomHmacKey(env),sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(part));return part+'.'+b64urlBytes(new Uint8Array(sig))}
async function verifyMushroomPayload(env,token){try{const parts=String(token||'').split('.');if(parts.length!==2)return null;const key=await mushroomHmacKey(env),sig=b64urlDecode(parts[1]),ok=await crypto.subtle.verify('HMAC',key,sig,new TextEncoder().encode(parts[0]));if(!ok)return null;const j=JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));if(!j||Number(j.exp)<Date.now())return null;return j}catch(_){return null}}
async function signMushroomAnalysis(env,payload){return signMushroomPayload(env,{...payload,purpose:'analysis'})}
async function verifyMushroomAnalysis(env,token){const p=await verifyMushroomPayload(env,token);return p&&p.purpose==='analysis'?p:null}
async function mushroomMembershipFor(env,subId){await ensureMushroomAccessTables(env);return env.DB.prepare('SELECT * FROM mushroom_memberships WHERE subscription_id=? LIMIT 1').bind(subId).first()}
async function mushroomAccessToken(env,subId,expiresAt){return signMushroomPayload(env,{purpose:'access',subId:Number(subId),membershipExpires:Number(expiresAt),exp:Math.min(Date.now()+24*60*60*1000,Number(expiresAt))})}
async function mushroomTrialToken(env,subId,expiresAt,trialMode){return signMushroomPayload(env,{purpose:'access',trial:true,trialMode:String(trialMode||'personal'),subId:Number(subId),exp:Math.min(Date.now()+24*60*60*1000,Number(expiresAt))})}
async function mushroomRequireAccess(request,env){const token=request.headers.get('x-mushroom-access')||'',p=await verifyMushroomPayload(env,token);if(!p||p.purpose!=='access')return null;if(p.trial){if(String(p.trialMode||'personal')==='global'){const cfg=await ensureContestTables(env),until=Number(cfg.end_at)+CONTEST_APP_FREE_EXTRA_MS;if(Date.now()>=until)return null;return {subscriptionId:Number(p.subId),trial:true,trialMode:'global'}}const sub=await env.DB.prepare('SELECT id,active,expires_at FROM subscriptions WHERE id=? LIMIT 1').bind(Number(p.subId)).first();if(!sub||!Number(sub.active)||!sub.expires_at||Date.parse(sub.expires_at)<=Date.now())return null;return {subscriptionId:Number(p.subId),trial:true,trialMode:'personal'}}const m=await mushroomMembershipFor(env,Number(p.subId));if(!m||Number(m.expires_at)<=Date.now())return null;return {subscriptionId:Number(p.subId),membership:m}}
async function mushroomAccess(request,env){
  if(!env.DB)return json({ok:false,error:'DB_NON_CONFIGUREE'},503);await ensureMushroomAccessTables(env);const d=await body(request),sub=await contestSubscription(env,d);if(!sub)return json({ok:false,error:'ABONNEMENT_PRINCIPAL_REQUIS',message:'Récupérez d’abord votre abonnement Couteau Suisse.'},403);const now=Date.now();let membership=await mushroomMembershipFor(env,sub.id);
  // Tant que la période gratuite générale de Couteau Suisse est active, le coin Champignons
  // est gratuit pour TOUS les comptes principaux actifs (essai ou abonnement déjà activé).
  // On ne touche pas à un éventuel abonnement Champignons payant : il reste conservé pour après.
  const cfg=await ensureContestTables(env),globalTrialUntil=Number(cfg.end_at)+CONTEST_APP_FREE_EXTRA_MS,globalTrialActive=now<globalTrialUntil;
  if(globalTrialActive){const days=Math.max(0,Math.ceil((globalTrialUntil-now)/86400000));return json({ok:true,active:true,trial:true,trialMode:'global',expiresAt:globalTrialUntil,remainingDays:days,warningSoon:false,accessToken:await mushroomTrialToken(env,sub.id,globalTrialUntil,'global'),account:{firstName:String(sub.account_first_name||''),lastName:String(sub.account_last_name||''),email:String(sub.recovery_email_mask||'')}})}
  // Après la période gratuite générale, un nouvel utilisateur conserve son essai personnel de 7 jours.
  const device=cleanIdentityText(d.deviceId,140),trialHash=device?await sha256Text('contest-trial:'+device):'',trialActive=!!trialHash&&String(sub.code_hash||'')===trialHash&&!!sub.expires_at&&Date.parse(sub.expires_at)>now;
  if(trialActive){const expires=Date.parse(sub.expires_at),days=Math.max(0,Math.ceil((expires-now)/86400000));return json({ok:true,active:true,trial:true,trialMode:'personal',expiresAt:expires,remainingDays:days,warningSoon:false,accessToken:await mushroomTrialToken(env,sub.id,expires,'personal'),account:{firstName:String(sub.account_first_name||''),lastName:String(sub.account_last_name||''),email:String(sub.recovery_email_mask||'')}})}
  if(String(d.action||'status')==='redeem'){
    const code=normalizeCode(d.mushroomCode);if(!validCode(code))return json({ok:false,error:'CODE_CHAMPIGNON_INCORRECT'},400);const h=await hashCode('MUSHROOM-'+code,env.CODE_PEPPER),row=await env.DB.prepare('SELECT * FROM mushroom_access_codes WHERE code_hash=? AND active=1 LIMIT 1').bind(h).first();if(!row)return json({ok:false,error:'CODE_CHAMPIGNON_INCORRECT'},403);if(row.used_by_subscription_id||row.used_at)return json({ok:false,error:'CODE_DEJA_UTILISE'},409);
    const base=membership&&Number(membership.expires_at)>now?Number(membership.expires_at):now,expires=base+Number(row.duration_days||MUSHROOM_ACCESS_DAYS)*86400000;
    const used=await env.DB.prepare('UPDATE mushroom_access_codes SET used_by_subscription_id=?,used_at=? WHERE id=? AND used_by_subscription_id IS NULL AND used_at IS NULL').bind(sub.id,now,row.id).run();if(!used.meta||Number(used.meta.changes||0)<1)return json({ok:false,error:'CODE_DEJA_UTILISE'},409);
    await env.DB.prepare(`INSERT INTO mushroom_memberships(subscription_id,expires_at,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET expires_at=excluded.expires_at,updated_at=excluded.updated_at`).bind(sub.id,expires,membership?Number(membership.created_at||now):now,now).run();membership=await mushroomMembershipFor(env,sub.id);
  }
  if(!membership||Number(membership.expires_at)<=now)return json({ok:true,active:false,priceEuros:50,durationDays:MUSHROOM_ACCESS_DAYS});const days=Math.max(0,Math.ceil((Number(membership.expires_at)-now)/86400000));return json({ok:true,active:true,expiresAt:Number(membership.expires_at),remainingDays:days,warningSoon:days<=30,accessToken:await mushroomAccessToken(env,sub.id,membership.expires_at),account:{firstName:String(sub.account_first_name||''),lastName:String(sub.account_last_name||''),email:String(sub.recovery_email_mask||'')}});
}
async function mushroomAnalyze(request,env){
  if(!env.DB)return json({ok:false,error:'DB_NON_CONFIGUREE'},503);if(!(await mushroomRequireAccess(request,env)))return json({ok:false,error:'ACCES_CHAMPIGNONS_REQUIS'},403);const d=await body(request),lat=Number(d.latitude),lon=Number(d.longitude),accuracy=Number(d.accuracy),capturedAt=Number(d.capturedAt||Date.now());if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(accuracy)||accuracy<0||accuracy>35)return json({ok:false,error:'GPS_TROP_IMPRECIS',message:'Le GPS doit être précis à 35 m ou mieux.'},400);if(Math.abs(Date.now()-capturedAt)>20*60*1000)return json({ok:false,error:'PHOTO_TROP_ANCIENNE'},400);const photo=decodeMushroomPhoto(d.dataUrl);if(!photo)return json({ok:false,error:'PHOTO_INVALIDE',message:'Photo invalide ou trop lourde.'},400);const inspected=await inspectMushroomPhoto(env,d.dataUrl,lat,lon);if(!inspected.ok)return json(inspected,422);const imageHash=await sha256Text(d.dataUrl),payload={imageHash,lat:Number(lat.toFixed(6)),lon:Number(lon.toFixed(6)),commonName:inspected.commonName,scientificName:inspected.scientificName,confidence:inspected.confidence,mushroomConfidence:inspected.mushroomConfidence,reason:inspected.reason,exp:Date.now()+20*60*1000};return json({...inspected,analysisToken:await signMushroomAnalysis(env,payload)});
}
async function mushroomDepartment(lat,lon){try{const r=await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&lat='+encodeURIComponent(lat)+'&lon='+encodeURIComponent(lon),{headers:{'Accept-Language':'fr','User-Agent':'Couteau-Suisse/244'}});if(!r.ok)throw 0;const j=await r.json(),a=j.address||{},iso=String(a['ISO3166-2-lvl6']||a['ISO3166-2-lvl4']||'');let m=iso.match(/FR-(2A|2B|\d{2,3})/i);if(m)return m[1].toUpperCase();const pc=String(a.postcode||'').replace(/\D/g,'');if(/^97|^98/.test(pc))return pc.slice(0,3);if(pc.length>=2)return pc.slice(0,2)}catch(_){}return 'AUTRE'}
async function mushroomSignedPhotoUrl(env,id,created){const exp=Date.now()+60*60*1000,sig=await signMushroomPayload(env,{purpose:'photo',id:String(id),exp});return '/api/mushrooms/photo?id='+encodeURIComponent(id)+'&v='+encodeURIComponent(created||'')+'&token='+encodeURIComponent(sig)}
async function mushroomSpots(request,env){
  if(!env.DB)return json({ok:false,error:'DB_NON_CONFIGUREE'},503);await ensureMushroomTables(env);const access=await mushroomRequireAccess(request,env);if(!access)return json({ok:false,error:'ACCES_CHAMPIGNONS_REQUIS'},403);if(request.method==='GET')return json({ok:false,error:'UTILISEZ_RECHERCHE'},400);
  const d=await body(request),sub=await env.DB.prepare('SELECT * FROM subscriptions WHERE id=? AND active=1 LIMIT 1').bind(access.subscriptionId).first(),deviceId=cleanIdentityText(d.deviceId,140),lat=Number(d.latitude),lon=Number(d.longitude),accuracy=Number(d.accuracy),pLat=Number(d.photoLatitude),pLon=Number(d.photoLongitude),pAcc=Number(d.photoAccuracy);if(!sub)return json({ok:false,error:'COMPTE_INTROUVABLE'},403);const email=String(sub.recovery_email_mask||''),firstName=String(sub.account_first_name||''),lastName=String(sub.account_last_name||'');if(![lat,lon,accuracy,pLat,pLon,pAcc].every(Number.isFinite)||accuracy<0||accuracy>35||pAcc<0||pAcc>80)return json({ok:false,error:'GPS_TROP_IMPRECIS',message:'Le GPS du coin ou de la photo est trop imprécis.'},400);const dist=haversineMeters(lat,lon,pLat,pLon);if(dist>200)return json({ok:false,error:'PHOTO_HORS_DU_COIN',message:'Le GPS de la photo doit être à 200 m maximum du point enregistré.'},400);const photo=decodeMushroomPhoto(d.photoDataUrl);if(!photo)return json({ok:false,error:'PHOTO_INVALIDE'},400);const proof=await verifyMushroomAnalysis(env,d.analysisToken);if(!proof)return json({ok:false,error:'ANALYSE_EXPIREE',message:'L’analyse de la photo a expiré. Reprenez la photo.'},400);const imageHash=await sha256Text(d.photoDataUrl);if(imageHash!==proof.imageHash)return json({ok:false,error:'PHOTO_DIFFERENTE'},400);if(haversineMeters(pLat,pLon,Number(proof.lat),Number(proof.lon))>80)return json({ok:false,error:'POSITION_PHOTO_DIFFERENTE',message:'Le GPS utilisé pour analyser la photo ne correspond pas au GPS de la photo enregistrée.'},400);if(Number(proof.mushroomConfidence||0)<50)return json({ok:false,error:'AUCUN_CHAMPIGNON',message:'La photo doit montrer clairement un vrai champignon non cueilli.'},400);const species=cleanIdentityText(d.species,120);if(!species)return json({ok:false,error:'ESPECE_REQUISE'},400);const info=mushroomGuideInfo(species),note=cleanIdentityText(d.note,500),woodName=cleanIdentityText(d.woodName,140)||'Bois signalé',isPrivate=d.isPrivate?1:0,department=await mushroomDepartment(lat,lon),id=crypto.randomUUID(),created=Date.now(),photoKey=env.MARKET_PHOTOS?'mushroom-spots/'+id+'.jpg':'d1:'+id;if(env.MARKET_PHOTOS){await env.MARKET_PHOTOS.put(photoKey,photo.bytes,{httpMetadata:{contentType:photo.mime,cacheControl:'private, max-age=3600'}})}else{await env.DB.prepare('INSERT INTO mushroom_photo_blobs(spot_id,data_base64,mime_type,updated_at) VALUES(?,?,?,?)').bind(id,photo.base64,photo.mime,created).run()}
  await env.DB.prepare(`INSERT INTO mushroom_spots(id,email,first_name,last_name,device_id,latitude,longitude,accuracy,department,species,scientific_name,category,ai_confidence,ai_reason,note,photo_key,mime_type,created_at,wood_name,is_private,source,deleted,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,email,firstName,lastName,deviceId,lat,lon,accuracy,department,species,cleanIdentityText(proof.scientificName,140),info.category,Number(proof.confidence||0),cleanIdentityText(proof.reason,220),note,photoKey,photo.mime,created,woodName,isPrivate,'community',0,created).run();
  let contestPending=false,contestAutoAwarded=false,contestPoints=0,contestFuel=null;try{const cfg=await ensureContestTables(env),participant=await env.DB.prepare("SELECT * FROM contest_participants WHERE subscription_id=? LIMIT 1").bind(access.subscriptionId).first();if(participant&&!Number(participant.banned)&&Date.now()<Number(cfg.end_at)&&!cfg.finalized_at){const trip=contestTravelFuelForParticipant(participant,lat,lon),items=contestMushroomBreakdown(MUSHROOM_CONTEST_POINTS,trip.fuel,trip.hasStart),base=contestRound2(MUSHROOM_CONTEST_POINTS+(trip.hasStart?trip.fuel.points:0)),gain=await contestAddScoreWithActiveBonus(env,access.subscriptionId,'mushroom',id,'Fiche Champignons — '+String(woodName||species||'coin signalé'),base);await env.DB.prepare("INSERT OR IGNORE INTO contest_mushroom_reviews(id,subscription_id,spot_id,base_points,awarded_points,status,created_at,distance_km,multiplier,breakdown_json) VALUES(?,?,?,?,?,'pending',?,?,?,?)").bind(contestId(),access.subscriptionId,id,base,gain.awardedPoints,created,trip.fuel.usedKm,gain.multiplier,JSON.stringify(items)).run();contestPending=true;contestAutoAwarded=!!gain.added;contestPoints=Number(gain.awardedPoints||0);contestFuel=trip.hasStart?trip.fuel:null;if(gain.added)await contestPushMessage(env,access.subscriptionId,`🎉 Points ajoutés automatiquement pour votre fiche Champignons !\n${contestCongratsMessage({breakdown_json:JSON.stringify(items),multiplier:gain.multiplier,distance_km:trip.fuel.usedKm,base_points:base},gain.awardedPoints)}\n👀 La fiche reste visible par l’administrateur pour contrôle.`,`auto-awarded`);await notifyAdminPendingRequest(env)}}catch(_){}
  return json({ok:true,spot:{id,woodName,department,species,category:info.category,isPrivate:!!isPrivate,latitude:lat,longitude:lon,accuracy,createdAt:created},contestPending,contestAutoAwarded,contestPoints,contestFuel:contestFuel?{distanceKm:contestFuel.usedKm,liters:contestFuel.liters,costEuro:contestFuel.costEuro,points:contestFuel.points}:null});
}
function mushroomSpotJson(r,photoUrl,extra={}){const info=mushroomGuideInfo(r.species);return {id:r.id,woodName:r.wood_name||'Bois signalé',latitude:Number(r.latitude),longitude:Number(r.longitude),accuracy:Number(r.accuracy),department:r.department,species:r.species,category:r.category||info.category,scientificName:r.scientific_name||'',season:info.season,habitat:info.habitat,aiConfidence:Number(r.ai_confidence||0),note:r.note||'',isPrivate:!!Number(r.is_private),source:r.source||'community',createdAt:Number(r.created_at),photoUrl:photoUrl||'',...extra}}
async function mushroomRowsWithSeeds(env){
  const dbRows=(await env.DB.prepare("SELECT id,latitude,longitude,accuracy,department,species,scientific_name,category,ai_confidence,note,created_at,wood_name,is_private,source,updated_at FROM mushroom_spots WHERE COALESCE(deleted,0)=0 ORDER BY created_at DESC LIMIT 1000").all()).results||[];
  const states=(await env.DB.prepare('SELECT * FROM mushroom_seed_states').all()).results||[],byId=new Map(states.map(x=>[String(x.spot_id),x]));
  const seeds=MUSHROOM_GOOGLE_WOODS.filter(x=>!(byId.get(x.id)&&Number(byId.get(x.id).hidden))).map(x=>{const s=byId.get(x.id);return s?{...x,wood_name:s.wood_name||x.wood_name,species:s.species||x.species,note:s.note||x.note,is_private:Number(s.is_private),updated_at:Number(s.updated_at||0)}:x});
  return [...dbRows,...seeds];
}
async function mushroomManage(request,env){
  if(!env.DB)return json({ok:false,error:'DB_NON_CONFIGUREE'},503);await ensureMushroomTables(env);const access=await mushroomRequireAccess(request,env);if(!access)return json({ok:false,error:'ACCES_CHAMPIGNONS_REQUIS'},403);const d=await body(request),id=cleanIdentityText(d.id,100),action=String(d.action||'');if(!id)return json({ok:false,error:'FICHE_INVALIDE'},400);const seed=MUSHROOM_GOOGLE_WOODS.find(x=>x.id===id),row=seed?null:await env.DB.prepare('SELECT id FROM mushroom_spots WHERE id=? AND COALESCE(deleted,0)=0').bind(id).first();if(!seed&&!row)return json({ok:false,error:'FICHE_INTROUVABLE'},404);
  if(action==='update'){
    const woodName=cleanIdentityText(d.woodName,140)||'Bois signalé',species=cleanIdentityText(d.species,120),note=cleanIdentityText(d.note,500),isPrivate=d.isPrivate?1:0;if(!species)return json({ok:false,error:'ESPECE_REQUISE'},400);const now=Date.now();
    if(seed)await env.DB.prepare(`INSERT INTO mushroom_seed_states(spot_id,wood_name,species,note,is_private,hidden,updated_at) VALUES(?,?,?,?,?,0,?) ON CONFLICT(spot_id) DO UPDATE SET wood_name=excluded.wood_name,species=excluded.species,note=excluded.note,is_private=excluded.is_private,updated_at=excluded.updated_at`).bind(id,woodName,species,note,isPrivate,now).run();
    else await env.DB.prepare('UPDATE mushroom_spots SET wood_name=?,species=?,category=?,note=?,is_private=?,updated_at=? WHERE id=?').bind(woodName,species,mushroomGuideInfo(species).category,note,isPrivate,now,id).run();
    return json({ok:true,updated:true});
  }
  if(action==='vote_delete'){
    await env.DB.prepare('INSERT OR IGNORE INTO mushroom_spot_delete_votes(spot_id,subscription_id,created_at) VALUES(?,?,?)').bind(id,access.subscriptionId,Date.now()).run();const c=await env.DB.prepare('SELECT COUNT(*) AS n FROM mushroom_spot_delete_votes WHERE spot_id=?').bind(id).first(),votes=Number(c&&c.n||0),deleted=votes>=5;if(deleted){if(seed)await env.DB.prepare(`INSERT INTO mushroom_seed_states(spot_id,wood_name,species,note,is_private,hidden,updated_at) VALUES(?,?,?,?,?,1,?) ON CONFLICT(spot_id) DO UPDATE SET hidden=1,updated_at=excluded.updated_at`).bind(id,seed.wood_name,seed.species,seed.note,seed.is_private,Date.now()).run();else await env.DB.prepare('UPDATE mushroom_spots SET deleted=1,updated_at=? WHERE id=?').bind(Date.now(),id).run()}return json({ok:true,votes,deleted,remaining:Math.max(0,5-votes)});
  }
  return json({ok:false,error:'ACTION_INVALIDE'},400);
}
async function adminMushrooms(request,env){
  if(!(await adminAuthorized(request,env)))return json({ok:false,error:'SECRET_INCORRECT'},401);if(!env.DB)return json({ok:false,error:'DB_NON_CONFIGUREE'},503);await ensureMushroomTables(env);const d=request.method==='POST'?await body(request):{};
  if(request.method==='POST'&&String(d.action)==='delete'){const id=cleanIdentityText(d.id,100),seed=MUSHROOM_GOOGLE_WOODS.find(x=>x.id===id);if(seed)await env.DB.prepare(`INSERT INTO mushroom_seed_states(spot_id,wood_name,species,note,is_private,hidden,updated_at) VALUES(?,?,?,?,?,1,?) ON CONFLICT(spot_id) DO UPDATE SET hidden=1,updated_at=excluded.updated_at`).bind(id,seed.wood_name,seed.species,seed.note,seed.is_private,Date.now()).run();else await env.DB.prepare('UPDATE mushroom_spots SET deleted=1,updated_at=? WHERE id=?').bind(Date.now(),id).run();return json({ok:true,deleted:true})}
  const rows=await mushroomRowsWithSeeds(env),counts=(await env.DB.prepare('SELECT spot_id,COUNT(*) AS n FROM mushroom_spot_delete_votes GROUP BY spot_id').all()).results||[],votes=new Map(counts.map(x=>[String(x.spot_id),Number(x.n||0)]));return json({ok:true,spots:rows.map(r=>({id:r.id,woodName:r.wood_name||'Bois signalé',department:r.department,species:r.species,isPrivate:!!Number(r.is_private),source:r.source||'community',deleteVotes:votes.get(String(r.id))||0}))});
}
async function mushroomReturnPoint(env,subId){try{const p=await env.DB.prepare('SELECT return_place_lat,return_place_lon,home_lat,home_lon FROM contest_participants WHERE subscription_id=? LIMIT 1').bind(subId).first();if(!p)return null;const lat=Number.isFinite(Number(p.return_place_lat))?Number(p.return_place_lat):Number(p.home_lat),lon=Number.isFinite(Number(p.return_place_lon))?Number(p.return_place_lon):Number(p.home_lon);return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null}catch(_){return null}}
async function osrmDetours(start,end,spots){if(!spots.length)return null;try{const pts=[start,end,...spots.map(s=>({lat:Number(s.latitude),lon:Number(s.longitude)}))],coords=pts.map(p=>p.lon+','+p.lat).join(';'),r=await fetch('https://router.project-osrm.org/table/v1/driving/'+coords+'?annotations=distance',{headers:{'User-Agent':'Couteau-Suisse/244'}});if(!r.ok)return null;const j=await r.json(),m=j.distances;if(!Array.isArray(m)||!m[0])return null;const direct=Number(m[0][1]);if(!Number.isFinite(direct))return null;return spots.map((s,i)=>{const a=Number(m[0][i+2]),b=Number(m[i+2][1]);return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,(a+b-direct)/1000):null})}catch(_){return null}}
async function mushroomSearch(request,env){
  if(!env.DB)return json({ok:false,error:'DB_NON_CONFIGUREE'},503);await ensureMushroomTables(env);const access=await mushroomRequireAccess(request,env);if(!access)return json({ok:false,error:'ACCES_CHAMPIGNONS_REQUIS'},403);const d=await body(request),mode=String(d.mode||'nearby'),base=await mushroomReturnPoint(env,access.subscriptionId);if(!base)return json({ok:false,error:'POINT_RETOUR_MANQUANT',message:'Enregistrez d’abord votre point « Retourner sur la place ».'},409);const rows=await mushroomRowsWithSeeds(env),counts=(await env.DB.prepare('SELECT spot_id,COUNT(*) AS n FROM mushroom_spot_delete_votes GROUP BY spot_id').all()).results||[],votes=new Map(counts.map(x=>[String(x.spot_id),Number(x.n||0)]));let candidates=rows.map(r=>({row:r,distanceKm:haversineMeters(base.lat,base.lon,Number(r.latitude),Number(r.longitude))/1000})).filter(x=>x.distanceKm<=100.0001);
  if(mode==='route'){
    const start={lat:Number(d.currentLat),lon:Number(d.currentLon)};if(!Number.isFinite(start.lat)||!Number.isFinite(start.lon))return json({ok:false,error:'GPS_MARCHE_REQUIS'},400);candidates=candidates.map(x=>({...x,roughDetour:(haversineMeters(start.lat,start.lon,Number(x.row.latitude),Number(x.row.longitude))+haversineMeters(Number(x.row.latitude),Number(x.row.longitude),base.lat,base.lon)-haversineMeters(start.lat,start.lon,base.lat,base.lon))/1000})).filter(x=>x.roughDetour<=30).sort((a,b)=>a.roughDetour-b.roughDetour).slice(0,45);const detours=await osrmDetours(start,base,candidates.map(x=>x.row));candidates=candidates.map((x,i)=>({...x,detourKm:detours&&detours[i]!=null?detours[i]:Math.max(0,x.roughDetour)})).filter(x=>x.detourKm<=15.0001).sort((a,b)=>a.detourKm-b.detourKm);
  }else candidates.sort((a,b)=>a.distanceKm-b.distanceKm);
  const spots=[];for(const x of candidates.slice(0,120)){const photoUrl=String(x.row.source||'community')==='google'?'':await mushroomSignedPhotoUrl(env,x.row.id,x.row.created_at);spots.push(mushroomSpotJson(x.row,photoUrl,{deleteVotes:votes.get(String(x.row.id))||0,distanceKm:Number(x.distanceKm.toFixed(1)),detourKm:x.detourKm==null?null:Number(x.detourKm.toFixed(1))}))}return json({ok:true,mode,spots,returnRadiusKm:100,maxDetourKm:15});
}
async function mushroomPhoto(url,env){
  if(!env.DB)return new Response('Not found',{status:404});await ensureMushroomTables(env);const id=cleanIdentityText(url.searchParams.get('id'),80),proof=await verifyMushroomPayload(env,url.searchParams.get('token'));if(!id||!proof||proof.purpose!=='photo'||String(proof.id)!==id)return new Response('Accès refusé',{status:403});const row=await env.DB.prepare('SELECT photo_key,mime_type,created_at FROM mushroom_spots WHERE id=?').bind(id).first();if(!row)return new Response('Not found',{status:404});if(env.MARKET_PHOTOS&&row.photo_key&&!String(row.photo_key).startsWith('d1:')){const obj=await env.MARKET_PHOTOS.get(row.photo_key);if(!obj)return new Response('Not found',{status:404});const h=new Headers();obj.writeHttpMetadata(h);h.set('content-type',row.mime_type||'image/jpeg');h.set('cache-control','private, max-age=300');return new Response(obj.body,{headers:h})}const b=await env.DB.prepare('SELECT data_base64,mime_type FROM mushroom_photo_blobs WHERE spot_id=?').bind(id).first();if(!b)return new Response('Not found',{status:404});const bin=atob(b.data_base64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return new Response(bytes,{headers:{'content-type':b.mime_type||'image/jpeg','cache-control':'private, max-age=300'}})
}
// ===== FIN V244 ACCÈS GLOBAL + CHAMPIGNONS =====

class InjectAppFiles {
  element(element) {
    element.append('<script src="/phone-loading-v384.js?v=384-loader"></script><link rel="manifest" href="/manifest.webmanifest?v=283-icons"><script src="/persistent-user-data-v283.js?v=364-persist"></script><link rel="stylesheet" href="/mobile-overrides.css?v=62"><link rel="stylesheet" href="/subscription-locks.css?v=62"><link rel="stylesheet" href="/home-work.css?v=62"><script src="/weather-all-pages.js?v=68-notifications-globales" defer></script><script src="/subscription-web.js?v=377-abonnement-fix" defer></script><script src="/market-update-notifications-v281.js?v=282" defer></script><script src="/notification-detail-v282.js?v=282" defer></script><script src="/home-work.js?v=62" defer></script><script src="/market-presence-global.js?v=176" defer></script><script src="/market-auto-update-v319.js?v=319" defer></script><script src="/market-attendance-v317.js?v=317" defer></script><script src="/market-navigation-confirm-v189.js?v=317" defer></script><script src="/contest-v188.js?v=366-admin-fresh" defer></script><script src="/referral-v232.js?v=273-parrainage-marche-compte" defer></script><script src="/app-access-gate-v240.js?v=375-install-step" defer></script><script src="/sanction-guard-v161.js?v=242" defer></script>', { html: true });
  }
}

class InjectAutoradioFiles {
  element(element) {
    // Autoradio : accueil dédié léger + compte, notifications et navigation.
    // Les modules téléphone/pro et le concours ne sont pas chargés.
    element.append('<style id="autoradio-boot-hide-v386">html,body{margin:0!important;padding:0!important;background:#07111f!important}.wrap,#connectedUsersBadge,#weatherBubble,#unifiedTop,.subscription-home-status,.gear,#fuelStationsQuickBtn,#fuelStationsQuickStyle,#fuelStationsQuickPosition{display:none!important}</style><script src="/persistent-user-data-v283.js?v=364-persist"></script><link rel="stylesheet" href="/subscription-locks.css?v=62"><script src="/subscription-web.js?v=377-abonnement-fix" defer></script><script src="/autoradio-home-v386.js?v=386-responsive-images" defer></script><script src="/autoradio-subscription-v381.js?v=381" defer></script><script src="/autoradio-notifications-v376.js?v=376" defer></script><script src="/market-update-notifications-v281.js?v=376-shared-devices" defer></script><script src="/notification-detail-v282.js?v=376" defer></script><script src="/market-attendance-v317.js?v=317" defer></script><script src="/market-navigation-confirm-v189.js?v=317" defer></script><script src="/app-access-gate-v240.js?v=375-install-step" defer></script><script src="/sanction-guard-v161.js?v=242" defer></script>', { html: true });
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



const FUEL_STATION_DATASET = "prix-des-carburants-en-france-flux-instantane-v2";
const FUEL_STATION_FIELDS = {
  Gazole: { price: "gazole_prix", updated: "gazole_maj", rupture: "gazole_rupture_type" },
  SP95:   { price: "sp95_prix",   updated: "sp95_maj",   rupture: "sp95_rupture_type" },
  SP98:   { price: "sp98_prix",   updated: "sp98_maj",   rupture: "sp98_rupture_type" },
  E10:    { price: "e10_prix",    updated: "e10_maj",    rupture: "e10_rupture_type" },
  E85:    { price: "e85_prix",    updated: "e85_maj",    rupture: "e85_rupture_type" },
  GPLc:   { price: "gplc_prix",   updated: "gplc_maj",   rupture: "gplc_rupture_type" }
};

function fuelStationServices(fields) {
  const direct = fields && fields.services_service;
  if (Array.isArray(direct)) return direct.map(x => String(x || "")).filter(Boolean);
  if (direct != null && direct !== "") return String(direct).split(/\s*;\s*/).filter(Boolean);
  const raw = fields && fields.services;
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const value = parsed && parsed.service;
    if (Array.isArray(value)) return value.map(x => String(x || "")).filter(Boolean);
    if (value) return [String(value)];
  } catch (_) {}
  return [];
}

function fuelStationCoords(fields) {
  const g = fields && fields.geom;
  if (g && Number.isFinite(Number(g.lat)) && Number.isFinite(Number(g.lon))) {
    return { lat: Number(g.lat), lon: Number(g.lon) };
  }
  let lat = Number(fields && fields.latitude), lon = Number(fields && fields.longitude);
  // Le flux historique encode parfois les coordonnées en degrés * 100000.
  if (Number.isFinite(lat) && Math.abs(lat) > 90) lat /= 100000;
  if (Number.isFinite(lon) && Math.abs(lon) > 180) lon /= 100000;
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function fuelStationAutomate24(fields, services) {
  const v = String((fields && fields.horaires_automate_24_24) || "").toLowerCase();
  if (v === "oui" || v === "1" || v === "true") return true;
  return (services || []).some(x => /automate\s*cb\s*24\s*\/\s*24/i.test(String(x)));
}

async function fuelStationNamesFromOsm(lat, lon) {
  const q = `[out:json][timeout:8];nwr(around:15500,${lat},${lon})["amenity"="fuel"];out center tags;`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2600);
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": "Couteau-Suisse/351 (+fuel-stations)"
      },
      body: "data=" + encodeURIComponent(q),
      signal: controller.signal,
      cf: { cacheTtl: 3600, cacheEverything: true }
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (Array.isArray(j && j.elements) ? j.elements : []).map(e => {
      const tags = e.tags || {};
      const la = Number(e.lat ?? e.center?.lat), lo = Number(e.lon ?? e.center?.lon);
      if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
      const brand = String(tags.brand || "").trim();
      const operator = String(tags.operator || "").trim();
      const name = String(tags.name || brand || operator || "").trim();
      return name ? { lat:la, lon:lo, name, brand, operator } : null;
    }).filter(Boolean);
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function applyFuelStationNames(stations, osmStations) {
  if (!Array.isArray(stations) || !Array.isArray(osmStations) || !osmStations.length) return stations;
  for (const s of stations) {
    let best = null, bestM = Infinity;
    for (const o of osmStations) {
      const d = haversineMeters(Number(s.lat), Number(s.lon), Number(o.lat), Number(o.lon));
      if (d < bestM) { bestM = d; best = o; }
    }
    // 180 m laisse une petite marge aux coordonnées officielles sans risquer
    // d'attribuer l'enseigne d'une autre station voisine.
    if (best && bestM <= 260) {
      s.name = best.name || "";
      s.brand = best.brand || "";
      s.operator = best.operator || "";
      s.nameSource = "OpenStreetMap";
    }
  }
  return stations;
}

async function fuelStationsNearby(request) {
  const u = new URL(request.url);
  const lat = Number(u.searchParams.get("lat")), lon = Number(u.searchParams.get("lon"));
  const requestedFuel = String(u.searchParams.get("fuel") || "Gazole");
  const fuel = Object.prototype.hasOwnProperty.call(FUEL_STATION_FIELDS, requestedFuel) ? requestedFuel : "Gazole";
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return json({ ok:false, error:"GPS_INVALIDE", message:"Position GPS invalide." }, 400);
  }
  const cfg = FUEL_STATION_FIELDS[fuel];
  const point = `geom'POINT(${lon} ${lat})'`;
  const where = `within_distance(geom, ${point}, 15km) AND ${cfg.price} is not null`;
  const v2 = new URL(`https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/${FUEL_STATION_DATASET}/records`);
  v2.searchParams.set("where", where);
  v2.searchParams.set("order_by", `${cfg.price} ASC`);
  v2.searchParams.set("limit", "100");

  let rows = [], source = "v2.1";
  try {
    const r = await fetch(v2.toString(), { headers: { "User-Agent":"Couteau-Suisse/330 (+fuel-stations)" }, cf: { cacheTtl: 120, cacheEverything: true } });
    if (!r.ok) throw new Error(`HTTP_${r.status}`);
    const j = await r.json();
    rows = Array.isArray(j && j.results) ? j.results : [];
  } catch (_) {
    source = "v1";
    try {
      const v1 = new URL("https://data.economie.gouv.fr/api/records/1.0/search/");
      v1.searchParams.set("dataset", FUEL_STATION_DATASET);
      v1.searchParams.set("rows", "100");
      v1.searchParams.set("sort", cfg.price);
      v1.searchParams.set("geofilter.distance", `${lat},${lon},15000`);
      const r = await fetch(v1.toString(), { headers: { "User-Agent":"Couteau-Suisse/330 (+fuel-stations)" }, cf: { cacheTtl: 120, cacheEverything: true } });
      if (!r.ok) throw new Error(`HTTP_${r.status}`);
      const j = await r.json();
      rows = (Array.isArray(j && j.records) ? j.records : []).map(x => x && x.fields ? x.fields : x);
    } catch (e) {
      return json({ ok:false, error:"SOURCE_CARBURANT_INDISPONIBLE", message:"Les prix officiels des carburants sont momentanément indisponibles." }, 502);
    }
  }

  const stations = [];
  for (const f of rows) {
    if (!f) continue;
    const coords = fuelStationCoords(f);
    const price = Number(f[cfg.price]);
    if (!coords || !Number.isFinite(price) || price <= 0) continue;
    const distanceKm = haversineMeters(lat, lon, coords.lat, coords.lon) / 1000;
    if (!Number.isFinite(distanceKm) || distanceKm > 15.05) continue;
    const services = fuelStationServices(f);
    const automate24 = fuelStationAutomate24(f, services);
    stations.push({
      id: String(f.id || ""),
      fuel,
      price,
      updatedAt: f[cfg.updated] || null,
      available: !String(f[cfg.rupture] || "").trim(),
      ruptureType: f[cfg.rupture] || null,
      lat: coords.lat,
      lon: coords.lon,
      distanceKm: Number(distanceKm.toFixed(2)),
      address: String(f.adresse || ""),
      cp: String(f.cp || ""),
      city: String(f.ville || ""),
      roadType: String(f.pop || "").toUpperCase() === "A" ? "Station autoroutière" : "Station routière",
      automate24,
      services,
      gplAvailable: Number(f.gplc_prix) > 0 && !String(f.gplc_rupture_type || "").trim(),
      gplPrice: Number(f.gplc_prix) > 0 ? Number(f.gplc_prix) : null,
      hoursRaw: f.horaires || null,
      hoursText: f.horaires_jour || null
    });
  }
  try {
    const osmStations = await fuelStationNamesFromOsm(lat, lon);
    applyFuelStationNames(stations, osmStations);
  } catch (_) {}
  stations.sort((a,b) => a.price - b.price || a.distanceKm - b.distanceKm);
  return json({ ok:true, radiusKm:15, fuel, source, stations, count:stations.length, dataNotice:"Prix et informations issus du flux officiel français. Nom/enseigne complété depuis OpenStreetMap quand disponible." });
}

async function ensureFuelStationVerificationTable(env) {
  if (!env || !env.DB) return false;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS fuel_station_verifications (
    station_key TEXT PRIMARY KEY, payment TEXT NOT NULL DEFAULT '', boutique TEXT NOT NULL DEFAULT '',
    open24 TEXT NOT NULL DEFAULT '', gpl TEXT NOT NULL DEFAULT '', cigarettes TEXT NOT NULL DEFAULT '', opinion TEXT NOT NULL DEFAULT '', device_id TEXT NOT NULL DEFAULT '',
    manual_hours TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  try { await env.DB.prepare(`ALTER TABLE fuel_station_verifications ADD COLUMN cigarettes TEXT NOT NULL DEFAULT ''`).run(); } catch (_) {}
  try { await env.DB.prepare(`ALTER TABLE fuel_station_verifications ADD COLUMN opinion TEXT NOT NULL DEFAULT ''`).run(); } catch (_) {}
  try { await env.DB.prepare(`ALTER TABLE fuel_station_verifications ADD COLUMN manual_hours TEXT NOT NULL DEFAULT ''`).run(); } catch (_) {}
  return true;
}

function cleanFuelStationKey(value) {
  return String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 180);
}

function normalizeStationChoice(kind, value) {
  value = String(value || '').trim();
  if (kind === 'opinion') {
    const allowed = ['Gentil', 'Ça dépend, c’est lequel ?', 'Pas la peine d’y aller'];
    return allowed.includes(value) ? value : '';
  }
  if (kind === 'payment') {
    const allowed = ['Carte', 'Espèces', 'Carte + espèces', 'Je ne sais pas'];
    return allowed.includes(value) ? value : '';
  }
  const allowed = ['Oui', 'Non', 'Je ne sais pas'];
  return allowed.includes(value) ? value : '';
}

async function fuelStationVerificationBatch(request, env) {
  try {
    if (!await ensureFuelStationVerificationTable(env)) return json({ok:true,states:{}});
    const body = await request.json().catch(()=>({}));
    const keys = [...new Set((Array.isArray(body.keys)?body.keys:[]).map(cleanFuelStationKey).filter(Boolean))].slice(0,100);
    if (!keys.length) return json({ok:true,states:{}});
    const q = `SELECT station_key,payment,boutique,open24,gpl,cigarettes,opinion,manual_hours,updated_at FROM fuel_station_verifications WHERE station_key IN (${keys.map(()=>'?').join(',')})`;
    const rows = (await env.DB.prepare(q).bind(...keys).all()).results || [];
    const states = {};
    for (const r of rows) states[r.station_key] = {verified:!!r.cigarettes,opinion:r.opinion||'',manualHours:r.manual_hours||'',payment:r.payment||'',boutique:r.boutique||'',open24:r.open24||'',gpl:r.gpl||'',cigarettes:r.cigarettes||'',updatedAt:r.updated_at||''};
    return json({ok:true,states});
  } catch (e) {
    return json({ok:false,error:'STATION_VERIFICATION_BATCH',message:String(e&&e.message||e)},500);
  }
}

async function submitFuelStationVerification(request, env) {
  try {
    if (!await ensureFuelStationVerificationTable(env)) return json({ok:false,error:'DB_INDISPONIBLE'},503);
    const body = await request.json().catch(()=>({}));
    const stationKey = cleanFuelStationKey(body.stationKey);
    const deviceId = String(body.deviceId || '').trim().slice(0,180);
    const cigarettes = normalizeStationChoice('yesno', body.cigarettes);
    const gpl = normalizeStationChoice('yesno', body.gpl || 'Oui') || 'Oui';
    const opinion = gpl === 'Oui' ? normalizeStationChoice('opinion', body.opinion) : '';
    const manualHours = String(body.manualHours || '').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,120);
    if (!stationKey || !deviceId || !cigarettes) return json({ok:false,error:'CHOIX_INCOMPLETS',message:'Choisissez Cigarettes OUI ou NON.'},400);
    if (gpl === 'Oui' && !opinion) return json({ok:false,error:'AVIS_GPL_MANQUANT',message:'Choisissez l’avis GPL.'},400);
    await env.DB.prepare(`INSERT INTO fuel_station_verifications(station_key,payment,boutique,open24,gpl,cigarettes,opinion,device_id,manual_hours,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(station_key) DO UPDATE SET gpl=excluded.gpl,cigarettes=excluded.cigarettes,opinion=CASE WHEN excluded.opinion<>'' THEN excluded.opinion ELSE fuel_station_verifications.opinion END,manual_hours=CASE WHEN excluded.manual_hours<>'' THEN excluded.manual_hours ELSE fuel_station_verifications.manual_hours END,device_id=excluded.device_id,updated_at=CURRENT_TIMESTAMP`)
      .bind(stationKey,'','','',gpl,cigarettes,opinion,deviceId,manualHours).run();
    return json({ok:true,state:{verified:true,opinion,manualHours,payment:'',boutique:'',open24:'',gpl,cigarettes,updatedAt:new Date().toISOString()}});
  } catch (e) {
    return json({ok:false,error:'STATION_VERIFICATION',message:String(e&&e.message||e)},500);
  }
}

export default {
  async scheduled(controller, env, ctx) {
    // V343 : uniquement événements spéciaux. Les marchés hebdomadaires ne sont pas touchés.
    // Brocante / braderie / foire : 90 jours par zone. Voyageurs : 60 jours par zone.
    if (String(env.MARKET_AUTO_REFRESH || "1") === "0") return;
    ctx.waitUntil(runSpecialEventRefresh(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/api/activate" && request.method === "POST") return activate(request, env);
    if (url.pathname === "/api/status" && request.method === "POST") return subscriptionStatus(request, env);
    if (url.pathname === "/api/subscription-profile-v156" && request.method === "POST") return subscriptionProfileV156(request, env);
    if (url.pathname === "/api/recover-code" && request.method === "POST") return recoverSubscriptionCode(request, env);
    if (url.pathname === "/api/subscription-email" && request.method === "POST") return updateSubscriptionEmail(request, env);
    if (url.pathname === "/api/contest/trial-identity" && request.method === "POST") return contestTrialIdentity(request, env);
    if (url.pathname === "/api/referral/create" && request.method === "POST") return referralCreate(request, env);
    if (url.pathname === "/api/referral/start" && request.method === "POST") return referralStart(request, env);
    if (url.pathname === "/api/referral/confirm" && request.method === "GET") return referralConfirm(request, env);
    if (url.pathname === "/api/referral/verify" && request.method === "POST") return referralVerify(request, env);
    if (url.pathname === "/api/presence" && (request.method === "GET" || request.method === "POST")) return presence(request, env);
    if (url.pathname === "/api/installations" && request.method === "POST") return installations(request, env);
    if (url.pathname === "/api/user-stats" && request.method === "GET") return publicUserStats(env);
    if (url.pathname === "/api/fuel-stations" && request.method === "GET") return fuelStationsNearby(request);
    if (url.pathname === "/api/fuel-station-verifications/batch" && request.method === "POST") return fuelStationVerificationBatch(request, env);
    if (url.pathname === "/api/fuel-station-verifications" && request.method === "POST") return submitFuelStationVerification(request, env);
    if (url.pathname === "/api/app-identity/start" && request.method === "POST") return appIdentityStart(request, env);
    if (url.pathname === "/api/app-identity/confirm" && request.method === "GET") return appIdentityConfirm(request, env);
    if (url.pathname === "/api/app-identity/handoff" && request.method === "POST") return appIdentityHandoff(request, env);
    if (url.pathname === "/api/app-identity/status" && request.method === "POST") return appIdentityStatus(request, env);
    if (url.pathname === "/api/app-identity" && request.method === "POST") return appIdentity(request, env);
    if (url.pathname === "/api/mushrooms/access" && request.method === "POST") return mushroomAccess(request, env);
    if (url.pathname === "/api/mushrooms/search" && request.method === "POST") return mushroomSearch(request, env);
    if (url.pathname === "/api/mushrooms/analyze" && request.method === "POST") return mushroomAnalyze(request, env);
    if (url.pathname === "/api/mushrooms/spots" && (request.method === "GET" || request.method === "POST")) return mushroomSpots(request, env);
    if (url.pathname === "/api/mushrooms/manage" && request.method === "POST") return mushroomManage(request, env);
    if (url.pathname === "/api/mushrooms/photo" && request.method === "GET") return mushroomPhoto(url, env);
    if (url.pathname === "/api/admin/login/request" && request.method === "POST") return requestAdminEmailLogin(request, env);
    if (url.pathname === "/api/admin/login/verify" && request.method === "POST") return verifyAdminEmailLogin(request, env);
    if (url.pathname === "/api/admin/session" && request.method === "GET") return adminSessionStatus(request, env);
    if (url.pathname === "/api/admin/logout" && request.method === "POST") return adminLogout(request, env);
    if (url.pathname === "/api/admin/installations" && request.method === "GET") return adminInstallations(request, env);
    if (url.pathname === "/api/admin/presence" && request.method === "GET") return adminPresenceStatus(env);
    if (url.pathname === "/api/admin/presence" && request.method === "POST") return adminPresenceAction(request, env);
    if (url.pathname === "/api/admin/subscriptions" && request.method === "POST") return createSubscription(request, env);
    if (url.pathname === "/api/admin/subscriptions/action" && request.method === "POST") return subscriptionAction(request, env);
    if (url.pathname === "/api/admin/mushrooms" && (request.method === "GET" || request.method === "POST")) return adminMushrooms(request, env);
    if (url.pathname === "/api/mail-event" && request.method === "POST") return recordMailEvent(request, env);
    if (url.pathname === "/api/admin/mail-counters" && request.method === "GET") return adminMailCounters(request, env);
    if (url.pathname === "/api/admin/gps-push" && (request.method === "GET" || request.method === "POST")) return adminGpsPush(request, env);
    if (url.pathname === "/api/gps-unlock-request" && request.method === "POST") return requestGpsUnlock(request, env);
    if (url.pathname === "/api/gps-unlock-status" && request.method === "GET") return gpsUnlockStatus(url, env);
    if (url.pathname === "/api/admin/gps-unlock-requests" && (request.method === "GET" || request.method === "POST")) return adminGpsUnlockRequests(request, env);
    if (url.pathname === "/download-autoradio.apk" && request.method === "GET") return downloadAutoradioApk();
    if (url.pathname === "/api/rne-pdf" && request.method === "GET") return downloadRne(url);
    if (url.pathname === "/api/event-registration-info" && request.method === "GET") return eventRegistrationInfo(request);
    if (url.pathname === "/api/markets" && request.method === "GET") return listMarkets(env);
    if (url.pathname === "/api/markets/refresh-status" && request.method === "GET") return marketRefreshStatus(env);
    if (url.pathname === "/api/admin/markets/import" && request.method === "POST") return importMarkets(request, env);
    if (url.pathname === "/api/admin/market-verification-forms" && request.method === "GET") return adminMarketVerificationForms(request, env);
    if (url.pathname === "/api/market-verifications" && request.method === "GET") return getMarketVerification(url, env);
    if (url.pathname === "/api/market-verifications" && request.method === "POST") return submitMarketVerification(request, env);
    if (url.pathname === "/api/market-verifications/batch" && request.method === "POST") return batchMarketVerifications(request, env);
    if (url.pathname === "/api/market-update-announcements" && request.method === "GET") return marketUpdateAnnouncements(url, env);
    if (url.pathname === "/api/market-attendance" && (request.method === "GET" || request.method === "POST")) return marketAttendance(request, url, env);
    if (url.pathname === "/api/market-attendance/batch" && request.method === "POST") return marketAttendanceBatch(request, env);
    if (url.pathname === "/api/admin/market-attendance" && request.method === "GET") return adminMarketAttendance(request, url, env);
    if (url.pathname === "/api/market-presence/disabled" && request.method === "GET") return disabledMarketPresence(env);
    if (url.pathname === "/api/market-photo" && request.method === "GET") return marketPhoto(url, env);
    if (url.pathname === "/api/vigilance" && request.method === "GET") return vigilanceForPlace(url);
    if (url.pathname === "/api/place-address" && request.method === "GET") return reversePlaceAddress(url, env);
    if (url.pathname === "/api/place-context" && request.method === "GET") return reversePlaceContext(url, env);
    if (url.pathname === "/api/contest/status" && request.method === "POST") return contestStatus(request, env);
    if (url.pathname === "/api/contest/score" && request.method === "POST") return contestScoreStatus(request, env);
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
    if (url.pathname === "/api/admin/banned-users" && (request.method === "GET" || request.method === "POST")) return adminBannedUsersV242(request, env);
    if (url.pathname === "/api/admin/users" && request.method === "GET") return adminAllUsersV278(request, env);
    if (url.pathname === "/api/sanction/status" && request.method === "POST") return sanctionStatusV242(request, env);
    if (url.pathname === "/api/admin/direct-message" && (request.method === "GET" || request.method === "POST")) return adminDirectMessageV289(request, env);
    if (url.pathname === "/api/reactivation-request" && request.method === "POST") return reactivationV242(request, env);
    if (url.pathname === "/api/admin/contest" && request.method === "GET") return adminContest(request, env);
    if (url.pathname === "/api/admin/contest/action" && request.method === "POST") return adminContestAction(request, env);
    // Laisser Cloudflare Static Assets résoudre "/" vers index.html.
    // Ne pas réécrire "/" en "/index.html" ici : avec html_handling automatique,
    // cela peut créer une boucle / <-> /index.html.
    let response = await env.ASSETS.fetch(request);
    if (url.pathname === "/sw.js" || url.pathname === "/app-version.json" || url.pathname === "/autoradio-version.json") {
      const h = new Headers(response.headers);
      h.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
    }
    const type = response.headers.get("content-type") || "";
    if (type.includes("text/html") && url.pathname !== "/admin.html" && url.pathname !== "/admin" && url.pathname !== "/import-marches.html" && url.pathname !== "/installer.html" && url.pathname !== "/installer") {
      const autoradio = /CouteauSuisseAutoradio/i.test(request.headers.get("user-agent") || "");
      const transformed = new HTMLRewriter().on("head", autoradio ? new InjectAutoradioFiles() : new InjectAppFiles()).on("a", new FixAndroidLinks()).on("script", new InjectMarketLive()).transform(response);
      const headers = new Headers(transformed.headers);
      headers.set("cache-control", "no-store, no-cache, must-revalidate");
      return new Response(transformed.body, { status: transformed.status, statusText: transformed.statusText, headers });
    }
    return response;
  }
};
