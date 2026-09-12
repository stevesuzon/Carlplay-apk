import baseWorker from "./v154.js";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization"
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

async function body(request) { try { return await request.json(); } catch (_) { return {}; } }
function normalizeEmail(v){ return String(v||"").trim().toLowerCase().slice(0,254); }
function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
function validDevice(v){ return /^[a-zA-Z0-9._:-]{8,128}$/.test(String(v||"").trim()); }
function cleanName(v){ return String(v||"").trim().replace(/\s+/g," ").slice(0,80); }

async function sha256Text(value){
  const bytes=new TextEncoder().encode(String(value||""));
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function randomHex(bytes=16){
  const b=crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function passwordHash(password,salt){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(password||"")),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:new TextEncoder().encode(String(salt||"")),iterations:100000},key,256);
  return [...new Uint8Array(bits)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function ensureAccountColumns(env){
  const cols=[
    ["account_password_hash","TEXT"],
    ["account_password_salt","TEXT"],
    ["account_first_name","TEXT"],
    ["account_last_name","TEXT"],
    ["account_updated_at","INTEGER"]
  ];
  for(const [name,type] of cols) try{ await env.DB.prepare(`ALTER TABLE subscriptions ADD COLUMN ${name} ${type}`).run(); }catch(_){}
}
function activeRow(row){ return !!row && !!row.active && (!!row.lifetime || (row.expires_at && Date.parse(row.expires_at)>Date.now())); }
async function rowByDevice(env,deviceId){
  return env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND (phone_device=? OR autoradio_device=?) LIMIT 1").bind(deviceId,deviceId).first();
}
async function rowByEmail(env,email){
  const hash=await sha256Text(email);
  let row=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND recovery_email_hash=? LIMIT 1").bind(hash).first();
  if(!row) row=await env.DB.prepare("SELECT * FROM subscriptions WHERE active=1 AND lower(recovery_email_mask)=? LIMIT 1").bind(email).first();
  return row;
}
function publicAccount(row,emailOverride){
  const email=emailOverride||String(row.recovery_email_mask||"").trim().toLowerCase();
  return {
    ok:true,
    email,
    firstName:String(row.account_first_name||""),
    lastName:String(row.account_last_name||""),
    accountReady:!!(row.account_password_hash&&row.account_password_salt),
    lifetime:!!row.lifetime,
    expiresAt:row.expires_at||null,
    subscriptionId:row.id
  };
}

async function accountSetup(request,env){
  await ensureAccountColumns(env);
  const data=await body(request),deviceId=String(data.deviceId||"").trim(),password=String(data.password||""),email=normalizeEmail(data.email);
  if(!validDevice(deviceId)) return json({ok:false,error:"DONNEES_INVALIDES"},400);
  if(password.length<6) return json({ok:false,error:"MOT_DE_PASSE_TROP_COURT"},400);
  const row=await rowByDevice(env,deviceId);
  if(!activeRow(row)) return json({ok:false,error:"COMPTE_ABONNEMENT_INTROUVABLE"},403);
  let accountEmail=String(row.recovery_email_mask||"").trim().toLowerCase();
  const supplied=email;
  if(supplied){
    if(!validEmail(supplied)) return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);
    const suppliedHash=await sha256Text(supplied);
    if(row.recovery_email_hash && String(row.recovery_email_hash)!==suppliedHash){
      return json({ok:false,error:"EMAIL_NE_CORRESPOND_PAS"},403);
    }
    const owner=await env.DB.prepare("SELECT id FROM subscriptions WHERE active=1 AND recovery_email_hash=? AND id<>? LIMIT 1").bind(suppliedHash,row.id).first();
    if(owner) return json({ok:false,error:"EMAIL_DEJA_UTILISEE"},409);
    accountEmail=supplied;
    await env.DB.prepare("UPDATE subscriptions SET recovery_email_hash=?,recovery_email_mask=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(suppliedHash,supplied,row.id).run();
  }
  if(!validEmail(accountEmail)) return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);
  const salt=randomHex(16),hash=await passwordHash(password,salt),now=Date.now();
  await env.DB.prepare("UPDATE subscriptions SET account_password_hash=?,account_password_salt=?,account_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(hash,salt,now,row.id).run();
  const fresh=await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(row.id).first();
  return json(publicAccount(fresh,accountEmail));
}

async function accountLogin(request,env){
  await ensureAccountColumns(env);
  const data=await body(request),email=normalizeEmail(data.email),password=String(data.password||""),deviceId=String(data.deviceId||"").trim();
  if(!validEmail(email)) return json({ok:false,error:"EMAIL_OBLIGATOIRE"},400);
  if(password.length<1) return json({ok:false,error:"MOT_DE_PASSE_OBLIGATOIRE"},400);
  if(!validDevice(deviceId)) return json({ok:false,error:"DONNEES_INVALIDES"},400);
  const row=await rowByEmail(env,email);
  if(!row) return json({ok:false,error:"EMAIL_INTROUVABLE"},404);
  if(!activeRow(row)) return json({ok:false,error:"ABONNEMENT_EXPIRE"},403);
  if(!row.account_password_hash||!row.account_password_salt) return json({ok:false,error:"MOT_DE_PASSE_NON_CREE"},409);
  const calc=await passwordHash(password,row.account_password_salt);
  if(calc!==String(row.account_password_hash)) return json({ok:false,error:"MOT_DE_PASSE_INCORRECT"},403);
  await env.DB.prepare("UPDATE subscriptions SET phone_device=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(deviceId,row.id).run();
  const fresh=await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(row.id).first();
  return json(publicAccount(fresh,email));
}

async function accountProfile(request,env){
  await ensureAccountColumns(env);
  const data=await body(request),deviceId=String(data.deviceId||"").trim();
  if(!validDevice(deviceId)) return json({ok:false,error:"DONNEES_INVALIDES"},400);
  let row=await rowByDevice(env,deviceId);
  if(!activeRow(row)) return json({ok:false,error:"COMPTE_ABONNEMENT_INTROUVABLE"},403);
  if(request.method==="POST" && (data.firstName!==undefined||data.lastName!==undefined)){
    const first=cleanName(data.firstName),last=cleanName(data.lastName);
    if(first.length<2||last.length<2) return json({ok:false,error:"NOM_ET_PRENOM_OBLIGATOIRES"},400);
    await env.DB.prepare("UPDATE subscriptions SET account_first_name=?,account_last_name=?,account_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(first,last,Date.now(),row.id).run();
    row=await env.DB.prepare("SELECT * FROM subscriptions WHERE id=?").bind(row.id).first();
  }
  return json(publicAccount(row));
}

async function accountDeviceStatus(request,env){
  await ensureAccountColumns(env);
  const data=await body(request),deviceId=String(data.deviceId||"").trim();
  if(!validDevice(deviceId)) return json({ok:false,error:"DONNEES_INVALIDES"},400);
  const row=await rowByDevice(env,deviceId);
  if(!activeRow(row)) return json({ok:false,error:"APPAREIL_REMPLACE"},403);
  return json(publicAccount(row));
}

async function marketRequestWithAccount(request,env,ctx){
  await ensureAccountColumns(env);
  const data=await body(request),deviceId=String(data.deviceId||"").trim();
  if(!validDevice(deviceId)) return baseWorker.fetch(new Request(request.url,{method:request.method,headers:request.headers,body:JSON.stringify(data)}),env,ctx);
  const row=await rowByDevice(env,deviceId);
  if(activeRow(row)){
    const email=String(row.recovery_email_mask||"").trim().toLowerCase();
    if(validEmail(email)) data.requesterEmail=email;
    let first=cleanName(row.account_first_name),last=cleanName(row.account_last_name);
    const postedFirst=cleanName(data.firstName),postedLast=cleanName(data.lastName);
    if((!first||!last) && postedFirst.length>=2 && postedLast.length>=2){
      first=postedFirst;last=postedLast;
      await env.DB.prepare("UPDATE subscriptions SET account_first_name=?,account_last_name=?,account_updated_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(first,last,Date.now(),row.id).run();
    }
    if(first&&last) data.requesterName=(last+" "+first).trim();
  }
  const headers=new Headers(request.headers);headers.set("content-type","application/json");
  return baseWorker.fetch(new Request(request.url,{method:"POST",headers,body:JSON.stringify(data)}),env,ctx);
}

async function injectScripts(response,url){
  const type=response.headers.get("content-type")||"";
  if(!type.includes("text/html")) return response;
  let text=await response.text();
  const tags=[];
  if(!text.includes("account-v155.js")) tags.push('<script src="/account-v155.js?v=155" defer></script>');
  if(url.pathname.includes("modification-demande")&&!text.includes("modification-account-v155.js")) tags.push('<script src="/modification-account-v155.js?v=155" defer></script>');
  if(tags.length){
    const joined=tags.join("");
    text=text.includes("</head>")?text.replace("</head>",joined+"</head>"):joined+text;
  }
  const headers=new Headers(response.headers);headers.set("cache-control","no-store, no-cache, must-revalidate");
  return new Response(text,{status:response.status,statusText:response.statusText,headers});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
    if(url.pathname==="/api/account/setup"&&request.method==="POST") return accountSetup(request,env);
    if(url.pathname==="/api/account/login"&&request.method==="POST") return accountLogin(request,env);
    if(url.pathname==="/api/account/profile"&&(request.method==="POST"||request.method==="GET")) return accountProfile(request,env);
    if(url.pathname==="/api/account/device-status"&&request.method==="POST") return accountDeviceStatus(request,env);
    if(url.pathname==="/api/gps-unlock-request"&&request.method==="POST") return marketRequestWithAccount(request,env,ctx);
    const response=await baseWorker.fetch(request,env,ctx);
    return injectScripts(response,url);
  }
};
