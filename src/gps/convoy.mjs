const endpoint='https://valhalla1.openstreetmap.de/route';
export function payload(input){
 const {from,to,profile:p={}}=input;const point=v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite)&&v[0]>=41&&v[0]<=51.6&&v[1]>=-5.6&&v[1]<=10;
 if(!point(from)||!point(to))throw Error('Choisissez un départ et une destination en France.');
 const truck=['small','large','trailer'].includes(p.trailer);
 const height=Number(p.height),length=Number(p.length),weight=Number(p.weight)/1000,width=p.width===''||p.width==null?2.6:Number(p.width);
 if(truck&&!(height>=1&&height<=5&&length>=2&&length<=25&&weight>=.5&&weight<=60&&width>=1&&width<=3.5))throw Error('Vérifiez les dimensions et le poids de votre attelage.');
 return {locations:[{lat:from[0],lon:from[1]},{lat:to[0],lon:to[1]}],costing:truck?'truck':'auto',costing_options:{[truck?'truck':'auto']:{...(truck?{height,length,weight,width,hgv_no_access_penalty:43200}:{}),ignore_restrictions:false,ignore_access:false,exclude_unpaved:true,shortest:false,use_highways:p.roadMode==='highway'?1:0,use_tolls:p.tolls===false?0:.5,low_class_penalty:p.roadMode==='direct'?0:120}},units:'kilometers',language:'fr-FR',shape_format:'geojson'};
}
export function decode(shape){
 if(typeof shape!=='string')return shape?.coordinates;
 const points=[];let i=0,lat=0,lon=0;
 const read=()=>{let value=0,shift=0,byte;do{if(i>=shape.length||shift>30)throw Error('Tracé invalide.');byte=shape.charCodeAt(i++)-63;if(byte<0||byte>63)throw Error('Tracé invalide.');value|=(byte&31)<<shift;shift+=5;}while(byte>=32);return value&1?~(value>>>1):value>>>1;};
 while(i<shape.length){lat+=read();lon+=read();points.push([lon/1e6,lat/1e6]);}return points;
}
export function convert(data,input){
 const trip=data.trip,truck=['small','large','trailer'].includes(input.profile?.trailer);
 if(trip?.status!==0||!trip.legs?.length||!Number.isFinite(trip.summary?.length)||!Number.isFinite(trip.summary?.time)||trip.units!=='kilometers')throw Error('Aucun itinéraire adapté disponible.');
 if(trip.warnings?.length||data.warnings?.length)throw Error('Le moteur ne peut pas appliquer tous les paramètres. Aucun guidage lancé.');
 if(input.profile?.tolls===false&&trip.summary.has_toll!==false)throw Error('Aucun trajet sans péage vérifié trouvé. Modifiez vos choix de route.');
 if(['main','direct'].includes(input.profile?.roadMode)&&trip.summary.has_highway!==false)throw Error('Aucun trajet hors autoroute vérifié trouvé pour ce véhicule. Modifiez vos choix de route.');
 if(input.profile?.roadMode==='highway'&&trip.summary.has_highway!==true)throw Error('Aucun trajet par autoroute disponible pour ces choix.');
 const points=[],instructions=[];let offset=0;
 for(const leg of trip.legs){
  const coords=decode(leg.shape);if(!Array.isArray(coords)||coords.length<2)throw Error('Géométrie du trajet indisponible.');
  const lengths=[0];for(let i=0;i<coords.length;i++){const c=coords[i];if(!Array.isArray(c)||!c.every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>90)throw Error('Trajet invalide.');if(i){const a=coords[i-1],r=Math.PI/180,d=(c[1]-a[1])*r,e=(c[0]-a[0])*r;lengths.push(lengths[i-1]+12742000*Math.asin(Math.min(1,Math.sqrt(Math.sin(d/2)**2+Math.cos(a[1]*r)*Math.cos(c[1]*r)*Math.sin(e/2)**2))));}}
  for(const m of leg.maneuvers||[]){if(truck&&m.travel_type&&m.travel_type!=='truck')throw Error('Profil grand véhicule non appliqué.');if(!Number.isInteger(m.begin_shape_index)||m.begin_shape_index<0||m.begin_shape_index>=coords.length)throw Error('Instructions invalides.');instructions.push({routeOffsetInMeters:offset+lengths[m.begin_shape_index],message:m.instruction||m.verbal_pre_transition_instruction||'Continuez'});}
  points.push(...coords.map(c=>[c[1],c[0]]));offset+=lengths.at(-1);
 }
 if(!instructions.length)throw Error('Instructions de guidage indisponibles.');
 return {mode:truck?'large-trailer':'classic',provider:'Valhalla / OpenStreetMap',traffic:false,roadMode:input.profile?.roadMode,hasHighway:trip.summary.has_highway,hasToll:trip.summary.has_toll,vehicleRestrictionsChecked:truck,vehicleDimensionsConfirmed:input.profile.confirmed===true,routingDimensions:truck?payload(input).costing_options.truck:undefined,summary:{lengthInMeters:trip.summary.length*1000,travelTimeInSeconds:trip.summary.time},points,instructions,notice:'Restrictions cartographiées prises en compte. Largeur de calcul '+(input.profile.width||'2.60')+' m'+(!input.profile.width?' provisoire, à confirmer':'')+'. Respectez la signalisation réelle.'};
}
