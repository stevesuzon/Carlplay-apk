import baseWorker from "./v154.js";

const cors={
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET, POST, OPTIONS",
  "access-control-allow-headers":"content-type, authorization"
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
async function body(request){try{return await request.json()}catch(_){return {}}}
function normalizeCode(v){return String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"").replace(/[OI]/g,c=>({O:"Q",I:"L"})[c]).slice(0,6)}
function validCode(v){return /^[A-HJ-NP-Z0-9]{6}$/.test(normalizeCode(v))}
function validDevice(v){return /^[a-zA-Z0-9._:-]{8,128}$/.test(String(v||"").trim())}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v||"").trim())}
function cleanName(v){return String(v||"").trim().replace(/\s+/g," ").slice(0,80)}
async function sha256Text(v){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(v||"")));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function hashCode(code,pepper){return sha256Text(String(pepper||"")+":"+normalizeCode(code))}
async function ensureProfileColumns(env){
  for(const [n,t] of [["account_first_name","TEXT"],["account_last_name","TEXT"],["account_updated_at","INTEGER"]])try{await env.DB.prepare(`ALTER TABLE subscriptions ADD COLUMN ${n} ${t}`).run()}catch(_){}
}
function active(row){return !!row&&!!row.active&&(!!row.lifetime||(row.expires_at&&Date.parse(row.expires_at)>Date.now()))}
async function rowForRequest(env,deviceId,code){
  let row=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) LIMIT 1").bind(deviceId,deviceId).first();
  if(row)return row;
  if(validCode(code)){
    const h=await hashCode(code,env.CODE_PEPPER);
    row=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND code_hash=? LIMIT 1").bind(h).first();
    if(row&&row.phone_device&&row.phone_device!==deviceId&&row.autoradio_device!==deviceId)return {__error:"APPAREIL_REMPLACE"};
  }
  return row;
}
async function exactEmail(env,row){
  let email=String(row&&row.recovery_email_mask||"").trim().toLowerCase();
  if(validEmail(email)&&!email.includes("***"))return email;
  try{
    const c=await env.DB.prepare("SELECT email,email_hash FROM subscription_email_challenges WHERE subscription_id=? AND consumed=1 ORDER BY created_at DESC LIMIT 1").bind(row.id).first();
    if(c&&validEmail(c.email)){
      const normalized=String(c.email).trim().toLowerCase(),h=await sha256Text(normalized);
      if(!row.recovery_email_hash||String(row.recovery_email_hash)===h){
        await env.DB.prepare("UPDATE subscriptions SET recovery_email_hash=?,recovery_email_mask=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(h,normalized,row.id).run();
        return normalized;
      }
    }
  }catch(_){}
  return "";
}
async function subscriptionProfile(request,env){
  await ensureProfileColumns(env);
  const data=await body(request),deviceId=String(data.deviceId||"").trim(),code=normalizeCode(data.subscriptionCode||data.code);
  if(!validDevice(deviceId))return json({ok:false,error:"DONNEES_INVALIDES"},400);
  const row=await rowForRequest(env,deviceId,code);
  if(row&&row.__error)return json({ok:false,error:row.__error},409);
  if(!active(row))return json({ok:false,error:"COMPTE_ABONNEMENT_INTROUVABLE"},403);
  const email=await exactEmail(env,row);
  if(!email)return json({ok:false,error:"EMAIL_ABONNEMENT_INTROUVABLE"},409);
  return json({ok:true,email,firstName:String(row.account_first_name||""),lastName:String(row.account_last_name||""),nameSaved:!!(row.account_first_name&&row.account_last_name),lifetime:!!row.lifetime,expiresAt:row.expires_at||null});
}
async function marketRequest(request,env,ctx){
  await ensureProfileColumns(env);
  const data=await body(request),deviceId=String(data.deviceId||"").trim(),code=normalizeCode(data.subscriptionCode||data.code);
  if(!validDevice(deviceId))return json({ok:false,error:"DONNEES_INVALIDES"},400);
  let row=await rowForRequest(env,deviceId,code);
  if(row&&row.__error)return json({ok:false,error:row.__error},409);
  if(!active(row))return json({ok:false,error:"COMPTE_ABONNEMENT_INTROUVABLE"},403);
  const email=await exactEmail(env,row);
  if(!email)return json({ok:false,error:"EMAIL_ABONNEMENT_INTROUVABLE"},409);
  let first=cleanName(row.account_first_name),last=cleanName(row.account_last_name);
  const sentFirst=cleanName(data.firstName),sentLast=cleanName(data.lastName);
  if((!first||!last)&&sentFirst.length>=2&&sentLast.length>=2){
    first=sentFirst;last=sentLast;
    await env.DB.prepare("UPDATE subscriptions SET account_first_name=?,account_last_name=?,account_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(first,last,Date.now(),row.id).run();
  }
  if(first.length<2||last.length<2)return json({ok:false,error:"NOM_ET_PRENOM_OBLIGATOIRES"},400);
  data.requesterEmail=email;
  data.requesterName=(last+" "+first).trim();
  data.firstName=first;data.lastName=last;
  const headers=new Headers(request.headers);headers.set("content-type","application/json");
  return baseWorker.fetch(new Request(request.url,{method:"POST",headers,body:JSON.stringify(data)}),env,ctx);
}
async function inject(response,url){
  const type=response.headers.get("content-type")||"";
  if(!type.includes("text/html"))return response;
  let text=await response.text();
  if(url.pathname.includes("modification-demande")&&!text.includes("modification-profile-v156.js")){
    const tag='<script src="/modification-profile-v156.js?v=156" defer></script>';
    text=text.includes("</head>")?text.replace("</head>",tag+"</head>"):tag+text;
  }
  const h=new Headers(response.headers);h.set("cache-control","no-store, no-cache, must-revalidate");
  return new Response(text,{status:response.status,statusText:response.statusText,headers:h});
}
export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
    if(url.pathname==="/api/subscription-profile-v156"&&request.method==="POST")return subscriptionProfile(request,env);
    if(url.pathname==="/api/gps-unlock-request"&&request.method==="POST")return marketRequest(request,env,ctx);
    const response=await baseWorker.fetch(request,env,ctx);
    return inject(response,url);
  }
};
