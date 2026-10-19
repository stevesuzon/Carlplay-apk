const DATASET='prix-des-carburants-en-france-flux-instantane-v2';
const fields={Gazole:'gazole',SP95:'sp95',E10:'e10',SP98:'sp98'};
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function normalizeStation(row){
  let lat=Number(row.geom?.lat??row.latitude),lon=Number(row.geom?.lon??row.longitude);
  if(Math.abs(lat)>90)lat/=100000;if(Math.abs(lon)>180)lon/=100000;
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<41||lat>51.6||lon<-5.6||lon>10)return null;
  const prices={},dates=[];
  for(const [fuel,key] of Object.entries(fields)){
    const price=Number(row[key+'_prix']);
    prices[fuel]=price>0&&!String(row[key+'_rupture_type']||'').trim()?price:null;
    if(prices[fuel]&&row[key+'_maj'])dates.push(row[key+'_maj']);
  }
  return {id:String(row.id||lat+','+lon),lat,lon,prices,city:String(row.ville||''),name:String(row.enseigne||row.nom||row.adresse||'Station-service'),updatedAt:dates.sort().at(-1)||null};
}
export async function routeFuel(request){
  const q=new URL(request.url).searchParams,lat=Number(q.get('lat')),lon=Number(q.get('lon'));
  if(!q.has('lat')||!q.has('lon')||!Number.isFinite(lat)||!Number.isFinite(lon)||lat<41||lat>51.6||lon<-5.6||lon>10)return reply({ok:false,error:'Position invalide'},400);
  const url=new URL('https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/'+DATASET+'/records');
  url.searchParams.set('where',`within_distance(geom, geom'POINT(${lon} ${lat})', 15km)`);
  url.searchParams.set('order_by','id');url.searchParams.set('limit','100');
  const stations=new Map();let count=Infinity,loaded=0;
  try{
    for(let offset=0;offset<1000&&offset<count;offset+=100){
      url.searchParams.set('offset',String(offset));
      const response=await fetch(url,{signal:AbortSignal.timeout(12000),cf:{cacheTtl:120,cacheEverything:true}});
      if(!response.ok)throw Error('Source indisponible');
      const data=await response.json();if(!Array.isArray(data.results))throw Error('Source invalide');
      count=Number.isFinite(data.total_count)?data.total_count:Infinity;loaded+=data.results.length;
      for(const row of data.results){const station=normalizeStation(row);if(station)stations.set(station.id,station);}
      if(data.results.length<100){count=loaded;break;}
    }
    return reply({ok:true,stations:[...stations.values()],partial:loaded<count,source:'Prix officiels des carburants',radiusKm:15});
  }catch{return reply({ok:false,error:'Prix des carburants momentanément indisponibles'},503);}
}
