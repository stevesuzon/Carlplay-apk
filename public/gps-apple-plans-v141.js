(function(){
  'use strict';
  var apple=document.getElementById('gpsApple');
  var oldRefresh=window.refreshPrefs;
  window.refreshPrefs=function(){
    if(typeof oldRefresh==='function')oldRefresh();
    var selected=localStorage.getItem('gps_pref')||'';
    if(apple)apple.classList.toggle('selected',selected==='Plans Apple');
  };
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  async function placeContext(lat,lon){
    try{
      var r=await fetch('/api/place-context?lat='+encodeURIComponent(lat)+'&lon='+encodeURIComponent(lon),{cache:'no-store'}),j=await r.json();
      if(r.ok&&j&&j.ok)return j;
    }catch(_){ }
    try{
      var r2=await fetch('/api/place-address?lat='+encodeURIComponent(lat)+'&lon='+encodeURIComponent(lon),{cache:'no-store'}),j2=await r2.json();
      if(r2.ok&&j2&&j2.address)return {ok:true,address:j2.address,nearby:[]};
    }catch(_){ }
    return {ok:true,address:'Emplacement enregistré',nearby:[]};
  }
  function navTo(lat,lon){
    var point=lat+','+lon,pref=localStorage.getItem('gps_pref')||'Google Maps';
    if(pref==='Waze')location.href='https://waze.com/ul?ll='+encodeURIComponent(point)+'&navigate=yes';
    else if(pref==='Plans Apple')location.href='https://maps.apple.com/?daddr='+encodeURIComponent(point)+'&dirflg=d';
    else location.href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(point)+'&travelmode=driving&dir_action=navigate';
  }
  function showReturnBubble(lat,lon,ctx){
    var old=document.getElementById('returnPlaceConfirmV192');if(old)old.remove();
    var d=document.createElement('div');d.id='returnPlaceConfirmV192';
    d.style.cssText='position:fixed;z-index:2147483647;inset:0;background:#000c;display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif';
    var near=(ctx.nearby||[]).slice(0,3);
    var nearHtml=near.length?'<div style="margin-top:12px;padding:10px;border-radius:13px;background:#172536;text-align:left"><b style="color:#ffd24a">📍 Repères à moins de 3 km :</b><br>'+near.map(function(x){var km=Number(x.distanceMeters||0)/1000;return '• '+esc(x.name)+' — environ '+(km<1?Math.max(1,Math.round(Number(x.distanceMeters||0)))+' m':km.toFixed(1).replace('.',',')+' km')}).join('<br>')+'</div>':'<div style="margin-top:10px;font-size:13px;color:#cad6e3">Aucun grand repère nommé trouvé à moins de 3 km.</div>';
    d.innerHTML='<div style="width:min(560px,96vw);background:#0d1824;color:#fff;border:4px solid #4dc987;border-radius:24px;padding:20px;text-align:center;box-shadow:0 16px 50px #000"><div style="font-size:26px;font-weight:1000;margin-bottom:10px">🚐 Retourner sur la place</div><div style="font-size:20px;font-weight:900">Voulez-vous retourner au camping ?</div><div style="margin-top:12px;padding:12px;border-radius:13px;background:#13283b;font-size:17px"><b>Adresse :</b><br>'+esc(ctx.address||'Emplacement enregistré')+'</div>'+nearHtml+'<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:16px"><button id="rpYes" style="min-height:56px;border:0;border-radius:13px;background:#168a4e;color:#fff;font:900 18px Arial">OUI</button><button id="rpNo" style="min-height:56px;border:0;border-radius:13px;background:#b3343a;color:#fff;font:900 18px Arial">NON</button></div></div>';
    document.body.appendChild(d);
    d.querySelector('#rpNo').onclick=function(){d.remove()};
    d.querySelector('#rpYes').onclick=function(){d.remove();navTo(lat,lon)};
  }
  window.returnPlace=async function(){
    var lat=localStorage.getItem('return_lat'),lon=localStorage.getItem('return_lon');
    if(!lat||!lon){
      if(!navigator.geolocation){alert('GPS indisponible');return;}
      navigator.geolocation.getCurrentPosition(async function(position){
        var la=position.coords.latitude,lo=position.coords.longitude,ctx=await placeContext(la,lo),address=ctx.address||'Emplacement enregistré';
        localStorage.setItem('return_lat',la);localStorage.setItem('return_lon',lo);localStorage.setItem('return_address',address);
        try{localStorage.setItem('return_nearby',JSON.stringify(ctx.nearby||[]))}catch(_){ }
        if(typeof window.showStatuses==='function')window.showStatuses();
        window.dispatchEvent(new CustomEvent('carplay-return-place-saved',{detail:{lat:la,lon:lo,address:address}}));
        alert('✅ Emplacement enregistré\n\n'+address+'\n\nAppuyez à nouveau sur « Retourner sur la place » pour lancer le GPS.');
      },function(e){var m=window.CarPlayLocation?window.CarPlayLocation.showHelp(e):'Impossible de récupérer votre position.';alert(m)},{enableHighAccuracy:true,timeout:15000,maximumAge:0});
      return;
    }
    var ctx=await placeContext(lat,lon);if(ctx.address){localStorage.setItem('return_address',ctx.address)}try{localStorage.setItem('return_nearby',JSON.stringify(ctx.nearby||[]))}catch(_){ }
    showReturnBubble(lat,lon,ctx);
  };
  window.refreshPrefs();
})();
