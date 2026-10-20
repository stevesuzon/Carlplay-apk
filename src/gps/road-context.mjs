import fixedSnapshot from './fixed-radars.mjs';
const origin='https://www.bison-fute.gouv.fr';
let memory=null,inFlight=null;
export function lambert93(x,y){
 const n=.725607765053267,c=11754255.426096,xs=700000,ys=12655612.049876,e=.0818191910428158;
 const r=Math.hypot(x-xs,y-ys),gamma=Math.atan2(x-xs,ys-y),iso=-Math.log(r/c)/n;
 let lat=2*Math.atan(Math.exp(iso))-Math.PI/2;
 for(let i=0;i<10;i++)lat=2*Math.atan(Math.exp(iso)*Math.pow((1+e*Math.sin(lat))/(1-e*Math.sin(lat)),e/2))-Math.PI/2;
 return [lat*180/Math.PI,3+gamma/n*180/Math.PI];
}
export function normalizeEvents(data,updatedAt){
 if(!Array.isArray(data?.features))throw Error('Invalid traffic feed');
 return data.features.flatMap(f=>{
 const p=f.properties||{},kind={BOUCHON:'traffic',TRAVAUX:'works'}[p.type],coords=f.geometry?.coordinates;
 if(!kind||['TERMINE','PREVISIONNEL','ANNULE'].includes(p.etat_evenement)||Number(p.timestampCreation)>updatedAt||f.geometry?.type!=='Point'||!Array.isArray(coords)||!coords.every(Number.isFinite))return [];
 const [lat,lon]=lambert93(...coords);
 if(!(lat>=41&&lat<=51.6&&lon>=-5.6&&lon<=10))return [];
 return [{id:String(f.id).replace(/-\d+$/,''),kind,lat,lon,radius:100,source:'Bison Futé',detailPath:typeof p.urlcpc==='string'&&/^\/data\/data-\d{8}-\d{6}\/evenementsOL6\/maintenant\/cpc\/\d+\.json$/.test(p.urlcpc)?p.urlcpc:null,updatedAt}];
 });
}
async function getJson(url){
 const response=await fetch(url,{signal:AbortSignal.timeout(10000),headers:{accept:'application/json'}});if(!response.ok)throw Error('Traffic source unavailable');
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes[0]===31&&bytes[1]===139)return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
 return JSON.parse(new TextDecoder().decode(bytes));
}
export function congestionLength(data){
 let found=null;
 function visit(value){
 if(!Array.isArray(value))return;
 for(let i=0;i<value.length;i++){
 if(typeof value[i]==='string'&&/^(ralentissement|bouchon)$/i.test(value[i].trim())&&typeof value[i+1]==='string'){
 const match=value[i+1].replace(/<[^>]*>/g,' ').match(/^\s*de\s+(\d+(?:[.,]\d+)?)\s*km\b/i);
 if(match){const km=Number(match[1].replace(',','.'));if(km>0&&km<200)found=Math.max(found||0,km);}
 }
 visit(value[i]);
 }
 }
 visit(data);return found;
}
async function getTraffic(now){
 const stamps=await getJson(origin+'/data/iteration/date.json'),stamp=Number(stamps[0]);
 if(!Number.isFinite(stamp)||now-stamp>20*60000||stamp>now+120000)throw Error('Traffic source stale');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(stamp).map(x=>[x.type,x.value]));
 const folder='data-'+parts.year+parts.month+parts.day+'-'+parts.hour+parts.minute+parts.second;
 const data=await getJson(origin+'/data/'+folder+'/evenementsOL6/maintenant/tfs/evenements/evenementsOL6.json');
 const events=normalizeEvents(data,stamp);
 const paths=[...new Set(events.filter(e=>e.kind==='traffic'&&e.detailPath).map(e=>e.detailPath))].slice(0,30),lengths=new Map();
 await Promise.all(paths.map(async path=>{try{lengths.set(path,congestionLength(await getJson(origin+path)));}catch{}}));
 return {available:true,updatedAt:stamp,events:events.map(({detailPath,...e})=>({...e,lengthKm:lengths.get(detailPath)||null})),coverage:'Réseau couvert par Bison Futé'};
}
export async function roadContext(request,ctx){
 const url=new URL(request.url),bounds=(url.searchParams.get('bounds')||'').split(',').map(Number);
 if(bounds.length!==4||!bounds.every(Number.isFinite)||bounds[0]<41||bounds[2]>51.6||bounds[1]<-5.6||bounds[3]>10||bounds[0]>bounds[2]||bounds[1]>bounds[3])return Response.json({error:'Zone invalide'},{status:400});
 const now=Date.now(),cacheKey=new Request('https://gps-cache.invalid/road-live-v1');
 let data=memory&&now-memory.at<120000?memory:null;
 if(!data){const cached=await caches.default.match(cacheKey);if(cached){data=await cached.json();if(now-data.at>120000)data=null;}}
 if(!data){
 if(!inFlight)inFlight=getTraffic(now).catch(()=>({available:false,events:[],delayMinutes:null})).then(traffic=>({at:Date.now(),traffic})).finally(()=>{inFlight=null;});
 data=await inFlight;memory=data;
 ctx.waitUntil(caches.default.put(cacheKey,Response.json(data,{headers:{'Cache-Control':'public,max-age=120'}})));
 }
 const inside=p=>p.lat>=bounds[0]-.003&&p.lat<=bounds[2]+.003&&p.lon>=bounds[1]-.004&&p.lon<=bounds[3]+.004;
 return Response.json({fixed:{available:true,publishedAt:'2025-12-30',source:'Ministère de l’intérieur',url:'https://www.data.gouv.fr/datasets/liste-des-radars-fixes-en-france',items:fixedSnapshot.map(([id,lat,lon,type])=>({id,lat,lon,type,radius:50})).filter(inside)},traffic:{...data.traffic,events:data.traffic.events.filter(inside)}},{headers:{'Cache-Control':'no-store'}});
}
