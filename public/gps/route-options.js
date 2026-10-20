(() => {
'use strict';
const $=id=>document.getElementById(id), modes=['main','direct','highway'];
let generation=0,controller=null,timer=null,lastKey='',lastAt=0,results={},walking=false;
const buttons=[...document.querySelectorAll('[data-choice="roadMode"]')];
for(const button of buttons){const detail=document.createElement('span');detail.className='route-metrics';detail.textContent='Estimation en attente';button.appendChild(detail);}
const clock=t=>new Date(t).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
const duration=s=>{const m=Math.round(s/60);return (m>=60?Math.floor(m/60)+' h ':'')+(m%60)+' min';};
function cancel(){generation++;controller?.abort();clearTimeout(timer);}
function render(){
 if(walking){const r=results.walk;if(!r){$('walkRoutePreview').textContent='Calcul du trajet à pied…';return;}if(!r.route){$('walkRoutePreview').textContent=r.error||'Estimation indisponible';return;}const m=r.route.summary.lengthInMeters;$('walkRoutePreview').textContent='Arrivée estimée : '+clock(Date.now()+r.route.summary.travelTimeInSeconds*1000)+' · '+(m<1000?Math.round(m)+' m':(m/1000).toLocaleString('fr-FR',{maximumFractionDigits:1})+' km')+' restants';return;}

 for(const button of buttons){const result=results[button.dataset.value];const el=button.querySelector('.route-metrics');
 if(!result){el.textContent='Calcul en attente…';continue;}
 if(!result.route){el.textContent=result.error||'Calcul…';continue;}
 const r=result.route,stats=result.stats,prefix=stats?.partial?'au moins ':'';
 el.textContent='Arrivée '+clock(Date.now()+r.summary.travelTimeInSeconds*1000)+' · '+duration(r.summary.travelTimeInSeconds)+' · '+(r.summary.lengthInMeters/1000).toLocaleString('fr-FR',{maximumFractionDigits:1})+' km'
 +(r.vehicleRestrictionsChecked?'\nProfil poids lourd · gabarit appliqué':'')
 +'\n'+(!stats?'Signalements : chargement…':stats.unavailable?'Signalements indisponibles':'Radars signalés : '+prefix+stats.danger+' · Bouchons : '+prefix+stats.traffic+' · Travaux : '+prefix+stats.works);
 }
}
function onRoute(report,points){
 const lat=Number(report.lat),lon=Number(report.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))return false;
 const scale=111195,cos=Math.cos(lat*Math.PI/180),radius=Math.max(65,Math.min(500,Number(report.radius)||65));
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],x=(a[1]-lon)*cos*scale,y=(a[0]-lat)*scale,dx=(b[1]-a[1])*cos*scale,dy=(b[0]-a[0])*scale;const t=Math.max(0,Math.min(1,-(x*dx+y*dy)/(dx*dx+dy*dy||1)));if(Math.hypot(x+t*dx,y+t*dy)<=radius)return true;}return false;
}
async function stats(route,signal){
 try{const bounds=route.points.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[90,180,-90,-180]);
 const response=await fetch('/gps/api/route-reports?'+new URLSearchParams({bounds:bounds.join(',')}),{signal,cache:'no-store'});const data=await response.json();
 if(!response.ok||data.unavailable||!Array.isArray(data.reports))throw Error();
 const result={danger:0,traffic:0,works:0,partial:!!data.partial},seen=new Set();
 for(const report of data.reports){if(seen.has(report.id)||Number(report.expires)<=Date.now()||!onRoute(report,route.points))continue;seen.add(report.id);if(Object.hasOwn(result,report.kind))result[report.kind]++;}
 return result;
 }catch(e){if(signal.aborted)throw e;return {unavailable:true};}
}
async function calculate(force=false){
 const selection=window.couteauGpsPlanner.getSelection();if(!selection.destination||$('gpsPlanner').hidden)return;
 walking=selection.profile.travelMode==='pedestrian';$('walkRoutePreview').hidden=!walking;
 const {roadMode,...profile}=selection.profile,key=JSON.stringify([selection.destination.lat,selection.destination.lon,profile]);
 if(!force&&key===lastKey&&Date.now()-lastAt<60000){render();return;}
 cancel();const run=generation,abort=new AbortController();controller=abort;results={};lastKey=key;lastAt=0;render();$('routeComparisonStatus').textContent='Recherche de votre position et calcul des trois trajets…';
 try{
 const fix=await new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(Error('Autorisez la localisation pour comparer les trajets.'));navigator.geolocation.getCurrentPosition(resolve,()=>reject(Error('Position indisponible. Autorisez la localisation puis actualisez.')),{enableHighAccuracy:true,timeout:15000,maximumAge:10000});});
 if(run!==generation)return;if(fix.coords.accuracy>100)throw Error('Position trop imprécise. Réessayez à l’extérieur.');
 for(const id of (walking?['walk']:modes)){
 if(run!==generation)return;
 try{const timeout=setTimeout(()=>abort.abort(),28000);
 let response;try{response=await fetch('/gps/api/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:[fix.coords.latitude,fix.coords.longitude],to:[selection.destination.lat,selection.destination.lon],profile:{...profile,roadMode:id==='walk'?'direct':id}}),signal:abort.signal});}finally{clearTimeout(timeout);}
 const route=await response.json();if(run!==generation)return;
 if(!response.ok)throw Error(route.error||'Trajet indisponible.');
 if(!route.points?.length||!Number.isFinite(route.summary?.travelTimeInSeconds)||profile.trailer!=='none'&&!route.vehicleRestrictionsChecked)throw Error('Profil du trajet non vérifié.');
 results[id]={route};render();if(!walking)results[id].stats=await stats(route,abort.signal);
 }catch(e){if(run!==generation)return;results[id]={error:e.name==='AbortError'?'Calcul interrompu : actualisez.':e.message};}
 render();if(abort.signal.aborted)break;
 }
 if(run!==generation)return;lastAt=Date.now();
 const available=Object.values(results).filter(r=>r.route);const same=available.length>1&&available.every(r=>JSON.stringify(r.route.points)===JSON.stringify(available[0].route.points));
 $('routeComparisonStatus').textContent=same?'Les choix disponibles empruntent la même route pour ce trajet.':'Choisissez un trajet, puis confirmez. Estimations hors trafic en direct.';
 }catch(e){if(run===generation){$('routeComparisonStatus').textContent=e.message;for(const id of (walking?['walk']:modes))results[id]={error:e.message||'Estimation indisponible'};render();}}finally{if(run===generation)controller=null;}
}
function schedule(){clearTimeout(timer);let selection;try{selection=window.couteauGpsPlanner.getSelection();}catch{cancel();return;}walking=selection.profile.travelMode==='pedestrian';$('walkRoutePreview').hidden=!walking;if(!selection.destination){cancel();return;}const {roadMode,...profile}=selection.profile;const key=JSON.stringify([selection.destination.lat,selection.destination.lon,profile]);if(key===lastKey&&controller&&!controller.signal.aborted){render();return;}cancel();timer=setTimeout(()=>calculate().catch(e=>{$('routeComparisonStatus').textContent=e.message;}),450);}
window.couteauRouteOptions={cancel};
window.addEventListener('gps-route-options-change',schedule);
for(const id of ['length','width','height','weight'])$(id).addEventListener('input',schedule);
$('retryRouteComparison').onclick=()=>calculate(true).catch(e=>{$('routeComparisonStatus').textContent=e.message;});
window.addEventListener('pagehide',cancel);
setInterval(()=>{if(!$('gpsPlanner').hidden)render();},30000);
schedule();
})();
