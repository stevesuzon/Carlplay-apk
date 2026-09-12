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
