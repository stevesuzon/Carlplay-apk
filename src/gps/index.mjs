import { routeFuel } from './fuel.mjs';
import { payload, convert } from './convoy.mjs';
import { search } from './commerce.mjs';
import { GPSRoadReports, GPSPanorama } from './services.mjs';

const json = (value, status = 200) => Response.json(value, {status, headers:{'Cache-Control':'no-store','X-Couteau-GPS':'integrated-3'}});
const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= 41 && p[0] <= 51.6 && p[1] >= -5.6 && p[1] <= 10;
async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw Error('Demande vide.');
  let size = 0, chunks = [];
  try { while (true) { const {done,value} = await reader.read(); if(done) break; size += value.byteLength; if(size > 32768) {await reader.cancel(); throw Error('Demande trop volumineuse.');} chunks.push(value); } }
  finally {reader.releaseLock();}
  const bytes = new Uint8Array(size); let offset = 0;
  for(const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function routeKind(profile = {}) {
  if(profile.travelMode === 'pedestrian') return 'pedestrian';
  return ['small','large','trailer'].includes(profile.trailer) ? 'truck' : 'car';
}
function instruction(step) {
  const m = step.instruction || {}, names = step.attributes?.name || {};
  const name = typeof names === 'string' ? names : names.nom_1_gauche || names.nom_1_droite || names.cpx_numero || '';
  const direction = {left:'à gauche',right:'à droite','slight left':'légèrement à gauche','slight right':'légèrement à droite','sharp left':'franchement à gauche','sharp right':'franchement à droite',straight:'tout droit'}[m.modifier] || 'tout droit';
  if(m.type === 'arrive') return 'Vous êtes arrivé à destination';
  if(m.modifier === 'uturn') return 'Faites demi-tour';
  if(/roundabout|rotary/.test(m.type || '')) return 'Au rond-point, prenez '+(m.exit ? 'la sortie '+m.exit : 'la direction indiquée');
  const action = {depart:'Démarrez',turn:'Tournez',fork:'Restez',merge:'Rejoignez la route','on ramp':'Prenez la bretelle','off ramp':'Prenez la sortie'}[m.type] || 'Continuez';
  return action+' '+direction+(name ? ' vers '+name : '');
}
export function convertIgn(data, kind) {
  const points = data.geometry?.coordinates?.map(p=>[p[1],p[0]]);
  if(!Array.isArray(points) || points.length < 2 || !points.every(point) || !Number.isFinite(data.distance) || !Number.isFinite(data.duration)) throw Error('Aucun itinéraire disponible.');
  let offset = 0;
  const instructions = (data.portions || []).flatMap(p=>p.steps || []).map(step=>{const value={routeOffsetInMeters:offset,message:instruction(step)}; offset += Number(step.distance)||0; return value;});
  if(!instructions.length) throw Error('Instructions de guidage indisponibles.');
  instructions.push({routeOffsetInMeters:data.distance,message:'Vous êtes arrivé à destination'});
  return {mode:kind === 'pedestrian' ? 'pedestrian' : 'classic',provider:'IGN',traffic:false,vehicleRestrictionsChecked:false,summary:{lengthInMeters:data.distance,travelTimeInSeconds:data.duration},points,instructions};
}
export async function route(request, env, ctx) {
  let input;
  try {input=await readBody(request); if(!point(input.from)||!point(input.to)) throw Error('Choisissez un départ et une destination en France.');}
  catch(e) {return json({error:e.message || 'Demande invalide.'},400);}
  const profile=input.profile || {}, kind=routeKind(profile);
  try {
    if(kind === 'truck' || kind === 'car') {
      if(kind === 'truck' && profile.confirmed !== true) return json({error:'Confirmez les dimensions de votre convoi.'},400);
      let body; try {body=payload(input);} catch(e) {return json({error:e.message},400);}
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body))))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const key=new Request('https://gps-cache.invalid/integrated-7/'+hash);
      const cache=await caches.default.match(key); if(cache) return json(await cache.json());
      const response=await fetch('https://valhalla1.openstreetmap.de/route',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'CouteauSuisseGPS/3.0 (https://carplay-telephone.appli-suzon.workers.dev)'},body:JSON.stringify(body),signal:AbortSignal.timeout(22000)});
      if(!response.ok) return json({error:response.status === 429 ? 'Calcul occupé. Réessayez dans un instant.' : 'Calcul indisponible. Réessayez.'},503);
      const result=convert(await response.json(),input);
      ctx.waitUntil(caches.default.put(key,Response.json(result,{headers:{'Cache-Control':'public,max-age=600'}})));
      return json(result);
    }
    const url=new URL('https://data.geopf.fr/navigation/itineraire');
    for(const [key,value] of Object.entries({resource:'bdtopo-osrm',start:[input.from[1],input.from[0]].join(','),end:[input.to[1],input.to[0]].join(','),profile:kind,optimization:profile.roadMode === 'direct' ? 'shortest':'fastest',geometryFormat:'geojson',getSteps:'true',distanceUnit:'meter',timeUnit:'second',crs:'EPSG:4326'})) url.searchParams.set(key,value);
    if(kind !== 'pedestrian' && (profile.tolls === false || profile.roadMode === 'direct')) url.searchParams.set('constraints',JSON.stringify({constraintType:'banned',key:'wayType',operator:'=',value:'autoroute'}));
    const response=await fetch(url,{signal:AbortSignal.timeout(22000)});
    if(!response.ok) return json({error:response.status===429 ? 'Calcul occupé. Réessayez dans quelques secondes.' : 'Aucun itinéraire disponible pour ce mode.'},response.status === 429 ? 429 : 503);
    return json(convertIgn(await response.json(),kind));
  } catch(e) {return json({error:e.name === 'TimeoutError' ? 'Le calcul prend trop de temps. Réessayez.' : e.message || 'Calcul indisponible.'},503);}
}
async function geocode(request) {
  const q=(new URL(request.url).searchParams.get('q')||'').trim().slice(0,180);
  if(q.length<3) return json({results:[]});
  try {
    const url=new URL('https://data.geopf.fr/geocodage/search');url.searchParams.set('q',q);url.searchParams.set('limit','7');
    const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok) throw Error();
    const data=await r.json();
    return json({results:(data.features||[]).map(f=>({name:f.properties?.label,lat:f.geometry?.coordinates?.[1],lon:f.geometry?.coordinates?.[0],precision:f.properties?.type})).filter(p=>p.name && point([p.lat,p.lon]))});
  } catch {return json({error:'Recherche momentanément indisponible.'},503);}
}
function place(row) {
  const kind=/no[eë]l/i.test(row.kind||'')?'noel':/voyageur/i.test(row.kind||'')?'voyageur':/foire/i.test(row.name||'')?'foire':/brocante|vide/i.test(row.kind||'')?'brocante':'marche';
  if(row.latitude==null || row.longitude==null || !point([Number(row.latitude),Number(row.longitude)])) return null;
  const id=['fr',row.area,row.name,row.city,row.day,row.address||''].join('|');
  return {id,key:id,kind,name:row.name||'Marché',city:row.city||'',address:row.address||row.city||'',day:row.date_label||row.day||'',hours:row.hours||'',merchants:String(row.merchants||''),phone:row.phone||'',start:row.start_date||'',end:row.end_date||'',lat:Number(row.latitude),lon:Number(row.longitude),approx:false,note:row.note||''};
}
async function places(request,env,internal) {
  const url=new URL(request.url),lat=Number(url.searchParams.get('lat')||48.11),lon=Number(url.searchParams.get('lon')||-1.68);
  const result=new Map();let live=false,loaded=0;
  try {
    const response=await internal('/api/markets'); const data=await response.json();
    if(response.ok && data.ok) {live=true;for(const row of data.markets||[]) {if(String(row.country).toUpperCase()!=='FR') continue;const p=place(row);if(p) result.set(p.id,p);}}
  } catch {}
  try {
    const index=await (await env.ASSETS.fetch(new URL('/nearby-shards/index.json',url))).json();
    const areas=index.areas.filter(a=>a.country==='fr').sort((a,b)=>Math.hypot((a.minLat+a.maxLat)/2-lat,((a.minLon+a.maxLon)/2-lon)*.67)-Math.hypot((b.minLat+b.maxLat)/2-lat,((b.minLon+b.maxLon)/2-lon)*.67)).slice(0,5);
    await Promise.all(areas.map(async a=>{try {const data=await (await env.ASSETS.fetch(new URL('/nearby-shards/'+a.file,url))).json();loaded++;for(const r of [...data.weekly||[],...data.special||[]]) {const p=place({area:r[0],kind:r[1],name:r[2],city:r[3],day:r[4],hours:r[5],note:r[6],merchants:r[7],address:r[8],latitude:r[10],longitude:r[11],phone:r[15]});if(p && !result.has(p.id)) result.set(p.id,p);}}catch {}}));
  } catch {}
  return json({places:[...result.values()],live,shardsLoaded:loaded,terrainAvailable:false});
}
async function photos(request,internal) {
  const data=await readBody(request),keys=[...new Set((data.keys||[]).filter(k=>typeof k==='string'&&k.length<=700))].slice(0,300),photos={};
  for(let i=0;i<keys.length;i+=60) {const response=await internal('/api/market-photos/batch',{keys:keys.slice(i,i+60)});if(!response.ok) continue;const data=await response.json();for(const [key,p] of Object.entries(data.photos||{})) photos[key]=p?.url||null;}
  return json({photos});
}
async function details(request,internal) {
  const {key}=await readBody(request);if(typeof key!=='string'||key.length>700) return json({},400);
  const response=await internal('/api/market-verifications/batch',{keys:[key]});if(!response.ok)return json({});
  const state=(await response.json()).states?.[key],values=state?.values||{},out={};
  if(values.time?.value)out.hours=values.time.value;if(values.count?.value)out.merchants=values.count.value;
  if(state?.location?.latitude!=null&&state.location.longitude!=null){out.lat=Number(state.location.latitude);out.lon=Number(state.location.longitude);out.approx=false;}
  if(state?.photo?.url)out.photo=state.photo.url;
  return json(out);
}
export async function handleGps(request,env,ctx,mainFetch) {
  const url=new URL(request.url),path=url.pathname;
  const internal=(path,data)=>mainFetch(new Request(new URL(path,url),data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{}));
  try {
    if(['/gps.html','/gps-integre-v2.html','/gps/index.html','/gps'].includes(path)) return new Response(null,{status:302,headers:{Location:'/gps/'+url.search,'Cache-Control':'no-store'}});
    if(path==='/gps/api/route'&&request.method==='POST')return route(request,env,ctx);
    if(path==='/gps/api/fuel'&&request.method==='GET')return routeFuel(request);
    if(path==='/gps/api/geocode'&&request.method==='GET')return geocode(request);
    if(path==='/gps/api/search'&&request.method==='GET')return search(request,env,ctx,{fetch:geocode});
    if(path==='/gps/api/places'&&request.method==='GET')return places(request,env,internal);
    if(path==='/gps/api/photos'&&request.method==='POST')return photos(request,internal);
    if(path==='/gps/api/place-details'&&request.method==='POST')return details(request,internal);
    if(path==='/gps/api/panorama'&&request.method==='GET')return GPSPanorama.GET(request);
    if(path==='/gps/panorama-viewer'&&request.method==='GET')return GPSPanorama.panoramaViewer(request);
    if(path==='/gps/api/road-reports')return GPSRoadReports.roadReports(request,env);
    if(path==='/gps/api/route-reports'&&request.method==='GET') {
      const bounds=(url.searchParams.get('bounds')||'').split(',').map(Number);
      if(bounds.length!==4||!bounds.every(Number.isFinite)||bounds[0]>bounds[2]||bounds[1]>bounds[3])return json({error:'Zone invalide.'},400);
      if(!env.ROAD_REPORTS) return json({reports:[],partial:true,unavailable:true});
      const r=await env.ROAD_REPORTS.prepare('SELECT r.* FROM reports r WHERE expires>? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND (SELECT COUNT(*) FROM votes WHERE report=r.id AND active=1)>=3 AND (SELECT COUNT(*) FROM votes WHERE report=r.id AND active=0)<3 LIMIT 300').bind(Date.now(),bounds[0]-.03,bounds[2]+.03,bounds[1]-.04,bounds[3]+.04).all();
      return json({reports:r.results,partial:r.results.length>=300});
    }
    if(path.startsWith('/gps/api/'))return json({error:'Service GPS inconnu.'},404);
    const response=await env.ASSETS.fetch(request);const headers=new Headers(response.headers);headers.set('X-Couteau-GPS','integrated-3');headers.set('Cache-Control','no-store');
    return new Response(response.body,{status:response.status,headers});
  } catch {return json({error:'Service GPS momentanément indisponible.'},503);}
}

