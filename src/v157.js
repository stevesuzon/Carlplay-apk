import baseWorker from "./v156.js";

function withHeader(response,name,value){
  const h=new Headers(response.headers);h.set(name,value);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});
}

function removeScript(text,pattern){return text.replace(pattern,'')}

const cors={"access-control-allow-origin":"*","access-control-allow-methods":"GET, POST, OPTIONS","access-control-allow-headers":"content-type, authorization"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
async function readBody(request){try{return await request.json()}catch(_){return {}}}
function normalizeEmail(v){return String(v||"").trim().toLowerCase().slice(0,254)}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)}
function validDevice(v){return /^[a-zA-Z0-9._:-]{8,128}$/.test(String(v||"").trim())}
async function sha256Text(v){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(v||"")));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function activeSubscription(row){return !!row&&!!row.active&&(!!row.lifetime||(row.expires_at&&Date.parse(row.expires_at)>Date.now()))}
async function subscriptionEmailSwitchAware(request,env,ctx){
  const data=await readBody(request),email=normalizeEmail(data.email),deviceId=String(data.deviceId||"").trim();
  if(!validEmail(email))return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);
  if(!validDevice(deviceId))return json({ok:false,error:"DONNEES_INVALIDES"},400);
  const emailHash=await sha256Text(email);
  const current=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) LIMIT 1").bind(deviceId,deviceId).first();
  let target=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND recovery_email_hash=? LIMIT 1").bind(emailHash).first();
  if(!target)target=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND lower(recovery_email_mask)=? LIMIT 1").bind(email).first();
  if(activeSubscription(target)&&(!current||Number(target.id)!==Number(current.id))){
    return json({ok:true,switchRequired:true,email,lifetime:!!target.lifetime,expiresAt:target.expires_at||null});
  }
  const headers=new Headers(request.headers);headers.set("content-type","application/json");
  return baseWorker.fetch(new Request(request.url,{method:"POST",headers,body:JSON.stringify(data)}),env,ctx);
}


const ADMIN_FALLBACK_SHA256_V161="9bf84a9825fcf66c467a2a73d1369ab3ba5f4d5a86c146046dfe46881eed0e49";
function normalizeCodeV161(value){return String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"").replace(/[OI]/g,c=>({O:"Q",I:"L"}[c])).slice(0,6)}
function validCodeV161(value){return /^[A-HJ-NP-Z0-9]{6}$/.test(normalizeCodeV161(value))}
async function hashCodeV161(code,pepper){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${pepper}:${normalizeCodeV161(code)}`));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function adminAuthorizedV161(request,env){const auth=request.headers.get("authorization")||"",supplied=auth.startsWith("Bearer ")?auth.slice(7).trim():"";if(!supplied)return false;if(env.ADMIN_SECRET&&supplied===String(env.ADMIN_SECRET).trim())return true;return (await sha256Text(supplied))===ADMIN_FALLBACK_SHA256_V161}
async function ensureSanctionTablesV161(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS market_user_sanctions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER,
    email_hash TEXT,
    email TEXT,
    requester_name TEXT,
    last_device_id TEXT,
    refusal_count INTEGER NOT NULL DEFAULT 0,
    app_banned INTEGER NOT NULL DEFAULT 0,
    contribution_blocked INTEGER NOT NULL DEFAULT 0,
    reactivation_requested INTEGER NOT NULL DEFAULT 0,
    ban_at INTEGER,
    reactivation_requested_at INTEGER,
    reactivated_at INTEGER,
    updated_at INTEGER NOT NULL
  )`).run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_market_user_sanctions_subscription ON market_user_sanctions(subscription_id) WHERE subscription_id IS NOT NULL").run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_market_user_sanctions_email ON market_user_sanctions(email_hash) WHERE email_hash IS NOT NULL AND email_hash<>''").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_market_user_sanctions_device ON market_user_sanctions(last_device_id)").run();
}
async function findSubscriptionV161(env,{deviceId="",email="",code=""}={}){
  deviceId=String(deviceId||"").trim();email=normalizeEmail(email);code=normalizeCodeV161(code);
  let row=null;
  if(validDevice(deviceId))row=await env.DB.prepare("SELECT id,recovery_email_hash,recovery_email_mask,phone_device,autoradio_device,active,expires_at,lifetime FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) LIMIT 1").bind(deviceId,deviceId).first();
  if(!row&&validEmail(email)){
    const emailHash=await sha256Text(email);
    row=await env.DB.prepare("SELECT id,recovery_email_hash,recovery_email_mask,phone_device,autoradio_device,active,expires_at,lifetime FROM subscriptions WHERE active=1 AND (recovery_email_hash=? OR lower(recovery_email_mask)=?) LIMIT 1").bind(emailHash,email).first();
  }
  if(!row&&validCodeV161(code)){
    const codeHash=await hashCodeV161(code,env.CODE_PEPPER);
    row=await env.DB.prepare("SELECT id,recovery_email_hash,recovery_email_mask,phone_device,autoradio_device,active,expires_at,lifetime FROM subscriptions WHERE active=1 AND code_hash=? LIMIT 1").bind(codeHash).first();
  }
  return row||null;
}
async function findSanctionV161(env,{subscriptionId=null,emailHash="",deviceId=""}={}){
  await ensureSanctionTablesV161(env);
  let row=null;
  if(subscriptionId!=null)row=await env.DB.prepare("SELECT * FROM market_user_sanctions WHERE subscription_id=? LIMIT 1").bind(Number(subscriptionId)).first();
  if(!row&&emailHash)row=await env.DB.prepare("SELECT * FROM market_user_sanctions WHERE email_hash=? LIMIT 1").bind(String(emailHash)).first();
  if(!row&&deviceId)row=await env.DB.prepare("SELECT * FROM market_user_sanctions WHERE last_device_id=? ORDER BY updated_at DESC LIMIT 1").bind(String(deviceId)).first();
  return row||null;
}
async function sanctionStatusForV161(env,data={}){
  await ensureSanctionTablesV161(env);
  const deviceId=String(data.deviceId||"").trim(),email=normalizeEmail(data.email),code=normalizeCodeV161(data.code),emailHash=validEmail(email)?await sha256Text(email):"";
  const sub=await findSubscriptionV161(env,{deviceId,email,code});
  const row=await findSanctionV161(env,{subscriptionId:sub&&sub.id,emailHash:emailHash||(sub&&sub.recovery_email_hash)||"",deviceId});
  return {row,sub,emailHash};
}
async function registerAdminRefusalV161(env,requestId){
  await ensureSanctionTablesV161(env);
  const req=await env.DB.prepare("SELECT requester_name,requester_email,device_id FROM gps_unlock_requests WHERE id=? LIMIT 1").bind(String(requestId||"")).first();
  if(!req)return {count:0,banned:false};
  const email=normalizeEmail(req.requester_email),deviceId=String(req.device_id||"").trim(),emailHash=validEmail(email)?await sha256Text(email):"";
  const sub=await findSubscriptionV161(env,{deviceId,email});
  let row=await findSanctionV161(env,{subscriptionId:sub&&sub.id,emailHash,deviceId});
  const now=Date.now(),count=Math.max(0,Number(row&&row.refusal_count||0))+1,banned=count>=10||!!Number(row&&row.app_banned),blocked=count>=10||!!Number(row&&row.contribution_blocked);
  if(row){
    await env.DB.prepare(`UPDATE market_user_sanctions SET subscription_id=COALESCE(?,subscription_id),email_hash=CASE WHEN ?<>'' THEN ? ELSE email_hash END,email=CASE WHEN ?<>'' THEN ? ELSE email END,requester_name=CASE WHEN ?<>'' THEN ? ELSE requester_name END,last_device_id=CASE WHEN ?<>'' THEN ? ELSE last_device_id END,refusal_count=?,app_banned=?,contribution_blocked=?,reactivation_requested=CASE WHEN ?=1 THEN 0 ELSE reactivation_requested END,ban_at=CASE WHEN ?=1 AND COALESCE(ban_at,0)=0 THEN ? ELSE ban_at END,updated_at=? WHERE id=?`)
      .bind(sub&&sub.id||null,emailHash,emailHash,email,email,String(req.requester_name||"").trim(),String(req.requester_name||"").trim(),deviceId,deviceId,count,banned?1:0,blocked?1:0,banned?1:0,banned?1:0,now,now,row.id).run();
  }else{
    await env.DB.prepare(`INSERT INTO market_user_sanctions(subscription_id,email_hash,email,requester_name,last_device_id,refusal_count,app_banned,contribution_blocked,reactivation_requested,ban_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(sub&&sub.id||null,emailHash||null,email||null,String(req.requester_name||"").trim()||null,deviceId||null,count,banned?1:0,blocked?1:0,0,banned?now:null,now).run();
  }
  return {count,banned,contributionBlocked:blocked};
}
async function userSanctionStatusV161(request,env){
  const data=await readBody(request),state=await sanctionStatusForV161(env,data),row=state.row;
  return json({ok:true,appBanned:!!Number(row&&row.app_banned),contributionBlocked:!!Number(row&&row.contribution_blocked),refusalCount:Number(row&&row.refusal_count||0),reactivationRequested:!!Number(row&&row.reactivation_requested)});
}
async function requestReactivationV161(request,env){
  const data=await readBody(request),state=await sanctionStatusForV161(env,data),row=state.row;
  if(!row||!Number(row.app_banned))return json({ok:false,error:"COMPTE_NON_BANNI"},409);
  const now=Date.now();
  await env.DB.prepare("UPDATE market_user_sanctions SET reactivation_requested=1,reactivation_requested_at=?,updated_at=? WHERE id=?").bind(now,now,row.id).run();
  return json({ok:true,pending:true});
}
async function adminBannedUsersV161(request,env){
  if(!(await adminAuthorizedV161(request,env)))return json({ok:false,error:"SECRET_INCORRECT"},401);
  await ensureSanctionTablesV161(env);
  if(request.method==="GET"){
    const rows=await env.DB.prepare("SELECT id,subscription_id,email,requester_name,refusal_count,app_banned,contribution_blocked,reactivation_requested,ban_at,reactivation_requested_at,updated_at FROM market_user_sanctions WHERE app_banned=1 ORDER BY reactivation_requested DESC,COALESCE(reactivation_requested_at,ban_at,updated_at) DESC").all();
    return json({ok:true,users:rows.results||[]});
  }
  const data=await readBody(request),id=Number(data.id||0),action=String(data.action||"");
  if(!id||action!=="unban")return json({ok:false,error:"DONNEES_INVALIDES"},400);
  const row=await env.DB.prepare("SELECT id,app_banned,contribution_blocked FROM market_user_sanctions WHERE id=? LIMIT 1").bind(id).first();
  if(!row)return json({ok:false,error:"UTILISATEUR_INTROUVABLE"},404);
  const now=Date.now();
  await env.DB.prepare("UPDATE market_user_sanctions SET app_banned=0,contribution_blocked=1,reactivation_requested=0,reactivated_at=?,updated_at=? WHERE id=?").bind(now,now,id).run();
  return json({ok:true,appBanned:false,contributionBlocked:true});
}
async function contributionDeniedV161(env,data={}){
  const state=await sanctionStatusForV161(env,data),row=state.row;
  return row&&Number(row.contribution_blocked)?{blocked:true,appBanned:!!Number(row.app_banned),refusalCount:Number(row.refusal_count||0)}:{blocked:false};
}


function marketPart(v){return String(v||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\([^)]*\)/g,"").replace(/[^a-z0-9]+/g,"").trim()}
async function repairLegacyDeurnePhoto(env,marketKey){
  if(!env.DB||!/deurne/i.test(String(marketKey||"")))return false;
  const current=await env.DB.prepare("SELECT market_key FROM market_photo_metadata WHERE market_key=? LIMIT 1").bind(marketKey).first();
  if(current)return false;
  const p=String(marketKey||"").split("|");
  if(p.length<6)return false;
  const prefix=p[0]+"|"+p[1]+"|"+p[2]+"|%";
  const rows=await env.DB.prepare("SELECT market_key FROM market_photo_metadata WHERE market_key LIKE ? ORDER BY updated_at DESC LIMIT 30").bind(prefix).all();
  let legacy="";
  for(const row of rows.results||[]){
    const q=String(row.market_key||"").split("|");
    if(q.length<6)continue;
    const sameDay=marketPart(q[4])===marketPart(p[4]);
    const a=marketPart(q[3]),b=marketPart(p[3]);
    const sameCity=a===b||a.startsWith(b)||b.startsWith(a);
    if(sameDay&&sameCity){legacy=row.market_key;break;}
  }
  if(!legacy||legacy===marketKey)return false;
  await env.DB.prepare(`INSERT OR IGNORE INTO market_photo_metadata(
    market_key,object_key,mime_type,device_id,user_latitude,user_longitude,market_latitude,market_longitude,distance_meters,quality_score,stall_count,ai_reason,replacement_count,captured_at,updated_at
  ) SELECT ?,object_key,mime_type,device_id,user_latitude,user_longitude,market_latitude,market_longitude,distance_meters,quality_score,stall_count,ai_reason,replacement_count,captured_at,CURRENT_TIMESTAMP
    FROM market_photo_metadata WHERE market_key=?`).bind(marketKey,legacy).run();
  return true;
}
async function repairDeurneForRequest(request,env,url){
  try{
    if(url.pathname==="/api/market-verifications"&&request.method==="GET"){
      const key=url.searchParams.get("marketKey")||"";if(/deurne/i.test(key))await repairLegacyDeurnePhoto(env,key);
    }else if(url.pathname==="/api/market-verifications/batch"&&request.method==="POST"){
      const d=await readBody(request.clone());
      for(const key of (Array.isArray(d.keys)?d.keys:[]))if(/deurne/i.test(String(key)))await repairLegacyDeurnePhoto(env,String(key));
    }
  }catch(_){}
}

async function recoveredPhotoResponse(url,env){
  if(!env.MARKET_PHOTOS)return new Response("Photo indisponible",{status:404,headers:cors});
  const key=String(url.searchParams.get("marketKey")||"").slice(0,700);
  if(!key)return new Response("Photo indisponible",{status:404,headers:cors});
  const objectKey="market-photos/"+(await sha256Text(key))+".jpg";
  const object=await env.MARKET_PHOTOS.get(objectKey);
  if(!object)return new Response("Photo indisponible",{status:404,headers:cors});
  return new Response(object.body,{headers:{...cors,"content-type":"image/jpeg","cache-control":"public, max-age=3600"}});
}
async function r2PhotoAvailable(env,key){
  if(!env.MARKET_PHOTOS)return false;
  try{return !!(await env.MARKET_PHOTOS.head("market-photos/"+(await sha256Text(key))+".jpg"));}catch(_){return false}
}
function recoveredPhotoState(key){return {url:"/api/market-photo-recover-v159?marketKey="+encodeURIComponent(key),distanceMeters:0,qualityScore:0,stallCount:0,replacementsUsed:0,replacementsRemaining:2,locked:false,recovered:true,capturedAt:null}}
async function augmentRecoveredPhotos(response,request,env,url){
  if(!response||!response.ok||!env.MARKET_PHOTOS)return response;
  const isBatch=url.pathname==="/api/market-verifications/batch"&&request.method==="POST";
  const isOne=url.pathname==="/api/market-verifications"&&request.method==="GET";
  if(!isBatch&&!isOne)return response;
  let payload;try{payload=await response.clone().json()}catch(_){return response}
  let changed=false;
  if(isOne){
    const key=String(url.searchParams.get("marketKey")||"");
    if(/deurne/i.test(key)&&!payload.photo&&await r2PhotoAvailable(env,key)){payload.photo=recoveredPhotoState(key);changed=true}
  }else{
    const keys=[];try{const d=await readBody(request.clone());for(const k of (Array.isArray(d.keys)?d.keys:[]))if(/deurne/i.test(String(k)))keys.push(String(k))}catch(_){}
    for(const key of keys){const st=payload.states&&payload.states[key];if(st&&!st.photo&&await r2PhotoAvailable(env,key)){st.photo=recoveredPhotoState(key);changed=true}}
  }
  return changed?json(payload,200):response;
}

async function optimizeHtml(response,url){
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  let text=await response.text();
  if(url.pathname.endsWith('/special-marches.html')||url.pathname==='/special-marches.html'){
    const country=url.searchParams.get('country')==='be'?'be':'fr';
    if(country==='fr'){
      text=removeScript(text,/<script\s+src=["']market-data-be\.js[^"']*["']><\/script>\s*/i);
    }else{
      text=removeScript(text,/<script\s+src=["']market-data-fr\.js[^"']*["']><\/script>\s*/i);
      text=removeScript(text,/<script\s+src=["']markets-france-update-v139\.js[^"']*["']><\/script>\s*/i);
      text=removeScript(text,/<script\s+src=["']markets-france-osm-v139\.js[^"']*["']><\/script>\s*/i);
      text=removeScript(text,/<script\s+src=["']markets-35-corrections-v142\.js[^"']*["']><\/script>\s*/i);
      text=removeScript(text,/<script\s+src=["']markets-35-missing-v143\.js[^"']*["']><\/script>\s*/i);
      text=text.replace(/window\.__FR_DATA\s*=\s*Array\.isArray\(data\)\s*\?\s*data\.slice\(\)\s*:\s*\[\]\s*;/,'window.__FR_DATA = []; window.data = [];');
    }
    if(!text.includes('special-market-server-v157.js')){
      const tag='<script src="/special-market-server-v157.js?v=158" defer></script>';
      text=text.includes('</body>')?text.replace('</body>',tag+'</body>'):text+tag;
    }
  }
  if(url.pathname!=='/admin.html'&&url.pathname!=='/admin'&&url.pathname!=='/import-marches.html'&&!text.includes('sanction-guard-v161.js')){
    const tag='<script src="/sanction-guard-v161.js?v=161" defer></script>';
    text=text.includes('</head>')?text.replace('</head>',tag+'</head>'):(text.includes('</body>')?text.replace('</body>',tag+'</body>'):text+tag);
  }
  const h=new Headers(response.headers);
  h.set('cache-control','no-store, no-cache, must-revalidate');
  return new Response(text,{status:response.status,statusText:response.statusText,headers:h});
}

function fastAsset(response,url){
  if(!response||!response.ok)return response;
  const p=url.pathname.toLowerCase();
  if(/\.(png|jpe?g|webp|svg|mp4)$/.test(p))return withHeader(response,'cache-control','public, max-age=86400, stale-while-revalidate=604800');
  if(p.includes('/market-chunks/')&&p.endsWith('.json'))return withHeader(response,'cache-control','public, max-age=3600, stale-while-revalidate=86400');
  if(/\.(css|js)$/.test(p)){
    if(p.includes('market-data-')||p.includes('markets-france-')||p.includes('markets-35-')||p.includes('markets-44-')||p.includes('markets-missing-'))return withHeader(response,'cache-control','public, max-age=3600, stale-while-revalidate=86400');
    return withHeader(response,'cache-control','public, max-age=900, stale-while-revalidate=3600');
  }
  return response;
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
    if(url.pathname==="/api/sanction/status"&&request.method==="POST")return userSanctionStatusV161(request,env);
    if(url.pathname==="/api/reactivation-request"&&request.method==="POST")return requestReactivationV161(request,env);
    if(url.pathname==="/api/admin/banned-users"&&(request.method==="GET"||request.method==="POST"))return adminBannedUsersV161(request,env);
    if(url.pathname==="/api/admin/gps-unlock-requests"&&request.method==="POST"){
      const data=await readBody(request.clone()),denial=data.approve!==true,id=String(data.id||"");
      const response=await baseWorker.fetch(request,env,ctx);
      if(denial&&id&&response.ok)try{await registerAdminRefusalV161(env,id)}catch(_){}
      return response;
    }
    if(url.pathname==="/api/gps-unlock-request"&&request.method==="POST"){
      const data=await readBody(request.clone()),blocked=await contributionDeniedV161(env,{deviceId:data.deviceId,email:data.requesterEmail,code:data.subscriptionCode});
      if(blocked.blocked)return json({ok:false,error:blocked.appBanned?"APP_BANNED":"CONTRIBUTION_BANNED",refusalCount:blocked.refusalCount},403);
    }
    if(url.pathname==="/api/market-verifications"&&request.method==="POST"){
      const data=await readBody(request.clone()),blocked=await contributionDeniedV161(env,{deviceId:data.deviceId});
      if(blocked.blocked)return json({ok:false,error:blocked.appBanned?"APP_BANNED":"CONTRIBUTION_BANNED",refusalCount:blocked.refusalCount},403);
    }
    if(url.pathname==="/api/subscription-email"&&request.method==="POST")return subscriptionEmailSwitchAware(request,env,ctx);
    if(url.pathname==="/api/market-photo-recover-v159"&&request.method==="GET")return recoveredPhotoResponse(url,env);
    await repairDeurneForRequest(request,env,url);
    let response=await baseWorker.fetch(request,env,ctx);
    response=await augmentRecoveredPhotos(response,request,env,url);
    const type=response.headers.get('content-type')||'';
    if(type.includes('text/html'))return optimizeHtml(response,url);
    return fastAsset(response,url);
  }
};
