const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,'').replace(/\s+/g,' ').trim();
const categories=[
 ['tabac|tabacs|bureau de tabac|bureaux de tabac|bar tabac',['["shop"="tobacco"]','["tobacco"="yes"]','["name"~"tabac",i]']],
 ['boulangerie|boulangeries',['["shop"="bakery"]']],['pharmacie|pharmacies',['["amenity"="pharmacy"]']],
 ['restaurant|restaurants',['["amenity"~"^(restaurant|fast_food)$"]']],['supermarche|supermarches',['["shop"="supermarket"]']],
 ['epicerie|epiceries',['["shop"~"^(convenience|grocery)$"]']],['coiffeur|coiffeurs|coiffure',['["shop"="hairdresser"]']],
 ['boucherie|boucheries',['["shop"="butcher"]']],['garage|garages',['["shop"="car_repair"]']],
 ['banque|banques',['["amenity"="bank"]']],['distributeur|distributeur de billets',['["amenity"="atm"]']],
 ['cafe|cafes',['["amenity"="cafe"]']],['hotel|hotels',['["tourism"="hotel"]']],
 ['fleuriste|fleuristes',['["shop"="florist"]']],['magasin|magasins|commerce|commerces',['["shop"]']]
];
const brands=[['burger king','Burger[ -]*King'],['mcdonalds|mc donalds|mcdonald|mcdo|macdo',"Mc[ -]*Donald"],['kfc','KFC'],['lidl','Lidl'],['aldi','Aldi'],['carrefour','Carrefour'],['leclerc|e leclerc','Leclerc'],['intermarche','Intermarch'],['auchan','Auchan']];
export function classify(text){
 let value=normalize(text).replace(/^(cherche|chercher|trouve|trouver|je cherche|je veux)\s+(un |une |des |le |la |les )?/,'').replace(/\s+(autour de moi|pres de moi|a proximite)$/,'');
 for(const [pattern,filters] of categories){const m=value.match(new RegExp('^(?:'+pattern+')(?:$| (?:a |vers |pres de )?(.+)$)'));if(m)return {filters,town:m[1]||'',known:true};}
 for(const [pattern,brand] of brands){const m=value.match(new RegExp('^(?:'+pattern+')(?:$| (?:a |vers |pres de )?(.+)$)'));if(m)return {filters:['["name"~'+JSON.stringify(brand)+',i]','["brand"~'+JSON.stringify(brand)+',i]'],town:m[1]||'',known:true};}
 const m=text.match(/^(.+?)\s+(?:à|a|près de|pres de)\s+(.+)$/i);const term=(m?m[1]:text).trim();
 // User input is a literal regex, never executable Overpass syntax.
 const regex=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return {filters:['["name"~'+JSON.stringify(regex)+',i][~"^(shop|amenity|craft|tourism|healthcare)$"~"."]','["brand"~'+JSON.stringify(regex)+',i]'],town:m?.[2]||'',known:false};
}
export const distance=(a,b)=>{const r=Math.PI/180,d=(b[0]-a[0])*r,e=(b[1]-a[1])*r;return 12742*Math.asin(Math.min(1,Math.sqrt(Math.sin(d/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(e/2)**2)));};
export function rows(data,origin){
 const out=[];
 for(const e of data.elements||[]){const t=e.tags||{},lat=e.lat??e.center?.lat,lon=e.lon??e.center?.lon;if(!Number.isFinite(lat)||!Number.isFinite(lon)||t.disused==='yes'||t.abandoned==='yes')continue;
 const km=distance(origin,[lat,lon]);if(km>25)continue;
 const name=t.name||t.brand||t.shop||t.amenity||'Commerce',city=t['addr:city']||t['addr:town']||'',address=[t['addr:housenumber'],t['addr:street']||t['addr:place'],t['addr:postcode'],city].filter(Boolean).join(' ');
 if(out.some(p=>normalize(p.name)===normalize(name)&&distance([p.lat,p.lon],[lat,lon])<.035))continue;
 out.push({id:'osm-'+e.type+'-'+e.id,name,city,address,lat,lon,distance:km,precision:'poi',hours:t.opening_hours||'',label:name+' — '+(km<1?Math.round(km*1000)+' m':km.toFixed(1).replace('.',',')+' km')+' à vol d’oiseau'+(address?' · '+address:'')});
 }
 return out.sort((a,b)=>a.distance-b.distance).slice(0,60);
}
export async function search(request,env,ctx,previous){
 const url=new URL(request.url),text=(url.searchParams.get('q')||'').trim();
 if(text.length<3||text.length>120)return Response.json({error:'Saisissez entre 3 et 120 caractères.'},{status:400});
 const c=classify(text);let origin=null;
 if(url.searchParams.has('lat')&&url.searchParams.has('lon')){const lat=Number(url.searchParams.get('lat')),lon=Number(url.searchParams.get('lon'));if(Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180)origin=[lat,lon];}
 const geocode=async q=>{const u=new URL('/gps/api/geocode',url);u.searchParams.set('q',q);const r=await previous.fetch(new Request(u),env,ctx);if(!r.ok)throw Error('Recherche d’adresse indisponible.');return (await r.json()).results||[];};
 let addresses=[];if(!c.known)try{addresses=await geocode(text);}catch{}
 // An address result must not wait for the slower optional commerce lookup.
 if(!c.known && addresses.length && !c.town)return Response.json({results:addresses,note:''},{headers:{'Cache-Control':'no-store'}});
 if(c.town){try{const town=(await geocode(c.town))[0];if(!town)throw Error();origin=[town.lat,town.lon];}catch{return Response.json({results:addresses,note:'Ville introuvable. Précisez son nom et son code postal.'});}}
 if(!origin)return Response.json({results:addresses,note:'Pour les commerces, activez la localisation ou indiquez une ville, par exemple « tabac à Paris ».'});
 if(/^\d+\s/.test(text))return Response.json({results:addresses,note:''});
 const query='[out:json][timeout:18];('+c.filters.map(f=>'nwr'+f+'(around:25000,'+origin.join(',')+');').join('')+');out center tags;';
 const key=new Request('https://gps-cache.invalid/commerce-v42?query='+encodeURIComponent(query));let data;
 try{
  const cache=await caches.default.match(key);if(cache)data=await cache.json();
  else{const r=await fetch('https://overpass.private.coffee/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'CouteauSuisseGPS/1.0'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(22000)});if(!r.ok)throw Error();data=await r.json();if(data.remark||!Array.isArray(data.elements))throw Error();ctx.waitUntil(caches.default.put(key,Response.json(data,{headers:{'Cache-Control':'public,max-age=900'}})));}
  const pois=rows(data,origin);return Response.json({results:[...pois,...(c.known?[]:addresses)],note:(pois.length?pois.length+' commerce(s) trouvé(s)':'Aucun commerce trouvé')+' dans un rayon de 25 km'+(c.town?' autour de '+c.town:' autour de votre position')+'. Distances à vol d’oiseau. Données © OpenStreetMap, liste non exhaustive.',source:'https://www.openstreetmap.org/copyright'},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({results:c.known?[]:addresses,note:'La recherche des commerces est momentanément indisponible. Réessayez dans un instant.',unavailable:true},{headers:{'Cache-Control':'no-store'}});}
}

