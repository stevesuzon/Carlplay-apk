(function(){
'use strict';
if(window.__autoMarketCounterV204)return;window.__autoMarketCounterV204=1;
var COUNTER='https://carplay-metiers.appli-suzon.workers.dev',RADIUS_METERS=80;
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}
function trade(){return String(localStorage.getItem('market_trade')||'').trim()}
function device(){
  var id=localStorage.getItem('shared_trade_device');
  if(!id){id='d'+Date.now().toString(36)+Math.random().toString(36).slice(2);localStorage.setItem('shared_trade_device',id)}
  return id;
}
function creds(){
  var s=null,c='';try{s=JSON.parse(localStorage.getItem('carplay_shared_subscription')||'null')}catch(_){}
  if(s&&s.code)c=String(s.code||'');
  var d=localStorage.getItem('carplay_device_id')||'';
  if(d.length<16){d='phone-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);localStorage.setItem('carplay_device_id',d)}
  return{code:c,deviceId:d,deviceType:'phone'};
}
function dateKey(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+'-compteurs-reels-v6-20260824-zero-general'}
function dayKey(){return['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'][new Date().getDay()]}
function meters(a,b,c,d){var p=Math.PI/180,da=(c-a)*p,db=(d-b)*p,x=Math.sin(da/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(db/2)**2;return 12742000*Math.asin(Math.sqrt(x))}
function beProvince(v){v=norm(v);var m={'bruxelles':'bruxelles','antwerpen':'anvers','anvers':'anvers','limburg':'limbourg','limbourg':'limbourg','west vlaanderen':'flandre-occidentale','flandre occidentale':'flandre-occidentale','oost vlaanderen':'flandre-orientale','flandre orientale':'flandre-orientale','vlaams brabant':'brabant-flamand','brabant flamand':'brabant-flamand','brabant wallon':'brabant-wallon','hainaut':'hainaut','henegouwen':'hainaut','liege':'liege','luik':'liege','luxembourg':'luxembourg','namur':'namur','namen':'namur'};for(var k in m)if(v.indexOf(k)>=0)return m[k];return''}
async function zone(lat,lon){
  var rev=null;try{var rr=await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat='+encodeURIComponent(lat)+'&lon='+encodeURIComponent(lon),{headers:{'Accept-Language':'fr'},cache:'no-store'});if(rr.ok)rev=await rr.json()}catch(_){}
  var a=rev&&rev.address||{},cc=String(a.country_code||'').toUpperCase();
  if(cc==='BE')return{country:'BE',area:beProvince(a.province||a.state||a.region||'')};
  try{var r=await fetch('/api/vigilance?lat='+encodeURIComponent(lat)+'&lon='+encodeURIComponent(lon),{cache:'no-store'}),j=await r.json();if(r.ok&&j&&j.code)return{country:'FR',area:String(j.code)}}catch(_){}
  return{country:cc==='BE'?'BE':'FR',area:''};
}
async function markets(country,area){
  var a=creds(),r=await fetch('/api/markets/query',{method:'POST',headers:{'content-type':'application/json'},cache:'no-store',body:JSON.stringify({country:country,area:area,day:dayKey(),code:a.code,deviceId:a.deviceId,deviceType:'phone'})});
  var j=await r.json();if(!r.ok)throw j;return Array.isArray(j.markets)?j.markets:[];
}
async function geocode(m,country){
  var la=Number(m.latitude!=null?m.latitude:m.lat),lo=Number(m.longitude!=null?m.longitude:m.lon);
  if(Number.isFinite(la)&&Number.isFinite(lo))return{lat:la,lon:lo};
  var q=[m.address,m.city,country==='BE'?'Belgique':'France'].filter(Boolean).join(' ');
  if(!q)return null;var key='autoMarketGeoV204:'+country+':'+norm(q);
  try{var old=JSON.parse(localStorage.getItem(key)||'null');if(old&&Date.now()-old.at<2592000000)return old}catch(_){}
  try{var r=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes='+(country==='BE'?'be':'fr')+'&q='+encodeURIComponent(q),{headers:{'Accept-Language':'fr'}}),a=await r.json();if(!r.ok||!a||!a[0])return null;var g={lat:Number(a[0].lat),lon:Number(a[0].lon),at:Date.now()};localStorage.setItem(key,JSON.stringify(g));return g}catch(_){return null}
}
async function choose(m,country){
  var t=trade();if(!t)return false;
  var market=[String(country||'FR').toLowerCase(),m.area||'',m.name||'',m.city||'',m.day||dayKey(),m.address||''].join('|');
  var once='autoMarketPresenceV204:'+dateKey()+':'+market+':'+norm(t);
  function mirrorIdentity(){try{var who=JSON.parse(localStorage.getItem('carplay_app_identity_v240')||'{}')||{};return fetch('/api/market-attendance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:localStorage.getItem('carplay_device_id')||'',tradeDeviceId:device(),market:market,date:dateKey(),trade:t,firstName:who.firstName||who.first_name||'',lastName:who.lastName||who.last_name||'',email:who.email||''}),keepalive:true}).catch(function(){})}catch(_){return Promise.resolve()}}
  if(localStorage.getItem(once)==='1'){await mirrorIdentity();return false}
  var r=await fetch(COUNTER+'/api/choose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device:device(),market:market,date:dateKey(),trade:t}),keepalive:true});
  if(!r.ok)throw 0;
  await mirrorIdentity();
  localStorage.setItem(once,'1');window.dispatchEvent(new CustomEvent('carplay-market-auto-counted',{detail:{market:market,trade:t}}));return true;
}
async function scan(){
  if(!trade()||!navigator.geolocation)return;
  if(navigator.permissions){try{var p=await navigator.permissions.query({name:'geolocation'});if(p.state==='denied')return}catch(_){}}
  var pos=await new Promise(function(resolve,reject){navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:12000,maximumAge:60000})});
  var lat=Number(pos.coords.latitude),lon=Number(pos.coords.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
  var z=await zone(lat,lon);if(!z.area)return;
  var list=await markets(z.country,z.area),best=null;
  for(var i=0;i<list.length;i++){
    var m=list[i];if(norm(m.day||dayKey())!==norm(dayKey()))continue;
    var g=await geocode(m,z.country);if(!g)continue;
    var d=meters(lat,lon,Number(g.lat),Number(g.lon));
    if(d<=RADIUS_METERS&&(!best||d<best.distance))best={market:m,distance:d};
  }
  if(best)await choose(best.market,z.country);
}
function run(){var k='autoMarketScanV204:'+dateKey(),last=Number(sessionStorage.getItem(k)||0);if(Date.now()-last<300000)return;sessionStorage.setItem(k,String(Date.now()));scan().catch(function(){})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
window.addEventListener('focus',run);document.addEventListener('visibilitychange',function(){if(!document.hidden)run()});
})();