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
  function installerUrl(){return (location.origin&&location.origin!=='null'?location.origin:'https://carplay-telephone.appli-suzon.workers.dev')+'/installer.html'}
  function gpsUrl(lat,lon){return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(lat+','+lon)}
  async function placeAddress(lat,lon){
    try{
      var r=await fetch('/api/place-address?lat='+encodeURIComponent(lat)+'&lon='+encodeURIComponent(lon),{cache:'no-store'}),j=await r.json();
      if(r.ok&&j&&j.address)return String(j.address);
    }catch(_){ }
    return 'Emplacement enregistré';
  }
  function navTo(lat,lon){
    var point=lat+','+lon,pref=localStorage.getItem('gps_pref')||'Google Maps';
    if(pref==='Waze')location.href='https://waze.com/ul?ll='+encodeURIComponent(point)+'&navigate=yes';
    else if(pref==='Plans Apple')location.href='https://maps.apple.com/?daddr='+encodeURIComponent(point)+'&dirflg=d';
    else location.href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(point)+'&travelmode=driving&dir_action=navigate';
  }
  function shareText(lat,lon,address){
    return '📍 Emplacement partagé depuis CarPlay Marchés\n'+(address||'Emplacement enregistré')+'\n'+gpsUrl(lat,lon)+'\n\n📲 Télécharger cette application pour les marchés :\n'+installerUrl();
  }
  function openShareMenu(lat,lon,address){
    var old=document.getElementById('returnPlaceShareV209');if(old)old.remove();
    var d=document.createElement('div');d.id='returnPlaceShareV209';
    d.style.cssText='position:fixed;z-index:2147483647;inset:0;background:#000d;display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif';
    d.innerHTML='<div style="width:min(520px,96vw);background:#0d1824;color:#fff;border:4px solid #3aa7ff;border-radius:24px;padding:20px;text-align:center;box-shadow:0 16px 50px #000"><div style="font-size:24px;font-weight:1000;margin-bottom:8px">📤 Partager la place</div><div style="font-size:15px;color:#dce8f3;margin-bottom:14px">Le message contient le point GPS exact et le lien pour télécharger l’application pour les marchés.</div><div style="display:grid;grid-template-columns:1fr;gap:10px"><button id="rpSms" style="min-height:56px;border:0;border-radius:14px;background:#2f9c52;color:#fff;font:1000 19px Arial">💬 SMS</button><button id="rpWhatsapp" style="min-height:56px;border:0;border-radius:14px;background:#22a85a;color:#fff;font:1000 19px Arial">🟢 WHATSAPP</button><button id="rpSnap" style="min-height:56px;border:0;border-radius:14px;background:#fffc00;color:#111;font:1000 19px Arial">👻 SNAP</button><button id="rpShareClose" style="min-height:48px;border:2px solid #65788b;border-radius:14px;background:#172536;color:#fff;font:900 17px Arial">RETOUR</button></div></div>';
    document.body.appendChild(d);
    var text=shareText(lat,lon,address),encoded=encodeURIComponent(text);
    d.querySelector('#rpShareClose').onclick=function(){d.remove()};
    d.querySelector('#rpSms').onclick=function(){var ios=/iphone|ipad|ipod/i.test(navigator.userAgent);location.href=(ios?'sms:&body=':'sms:?body=')+encoded};
    d.querySelector('#rpWhatsapp').onclick=function(){location.href='https://wa.me/?text='+encoded};
    d.querySelector('#rpSnap').onclick=async function(){
      try{if(navigator.clipboard&&navigator.clipboard.writeText)await navigator.clipboard.writeText(text)}catch(_){ }
      alert('Le message avec le GPS et le lien de l’application est copié. Snapchat va s’ouvrir : colle simplement le message dans la conversation.');
      location.href='snapchat://';
      setTimeout(function(){if(!document.hidden)location.href='https://www.snapchat.com/'},900);
    };
  }
  function showReturnBubble(lat,lon,address){
    var old=document.getElementById('returnPlaceConfirmV192');if(old)old.remove();
    var d=document.createElement('div');d.id='returnPlaceConfirmV192';
    d.style.cssText='position:fixed;z-index:2147483647;inset:0;background:#000c;display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif';
    d.innerHTML='<div style="width:min(560px,96vw);background:#0d1824;color:#fff;border:4px solid #4dc987;border-radius:24px;padding:20px;text-align:center;box-shadow:0 16px 50px #000"><div style="font-size:26px;font-weight:1000;margin-bottom:10px">🚐 Retourner sur la place</div><div style="font-size:20px;font-weight:900">Voulez-vous retourner à cet emplacement ?</div><div style="margin-top:12px;padding:12px;border-radius:13px;background:#13283b;font-size:17px"><b>Lieu enregistré :</b><br><span id="rpAddressText">'+esc(address||'Emplacement enregistré')+'</span></div><button id="rpShare" style="width:100%;min-height:54px;margin-top:12px;border:0;border-radius:13px;background:#267bc5;color:#fff;font:1000 17px Arial">📤 PARTAGER LA PLACE À UN AMI</button><div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px"><button id="rpYes" style="min-height:56px;border:0;border-radius:13px;background:#168a4e;color:#fff;font:900 18px Arial">OUI</button><button id="rpNo" style="min-height:56px;border:0;border-radius:13px;background:#b3343a;color:#fff;font:900 18px Arial">NON</button></div></div>';
    document.body.appendChild(d);
    d.querySelector('#rpNo').onclick=function(){d.remove()};
    d.querySelector('#rpYes').onclick=function(){d.remove();navTo(lat,lon)};
    d.querySelector('#rpShare').onclick=function(){openShareMenu(lat,lon,localStorage.getItem('return_address')||address)};
  }
  function isVagueAddress(a){return !a||a==='Emplacement enregistré'||/^\s*\d{5}\s+[^,]+\s*$/i.test(a)}
  window.returnPlace=async function(){
    var lat=localStorage.getItem('return_lat'),lon=localStorage.getItem('return_lon');
    if(!lat||!lon){
      if(!navigator.geolocation){alert('GPS indisponible');return;}
      navigator.geolocation.getCurrentPosition(async function(position){
        var la=position.coords.latitude,lo=position.coords.longitude;
        /* Le GPS exact est enregistré immédiatement et ne sera plus recalculé tant que l'utilisateur ne l'efface pas. */
        localStorage.setItem('return_lat',la);localStorage.setItem('return_lon',lo);localStorage.setItem('return_saved_at',String(Date.now()));
        if(typeof window.showStatuses==='function')window.showStatuses();
        var address=await placeAddress(la,lo);
        localStorage.setItem('return_address',address);
        if(typeof window.showStatuses==='function')window.showStatuses();
        window.dispatchEvent(new CustomEvent('carplay-return-place-saved',{detail:{lat:la,lon:lo,address:address}}));
        alert('✅ Emplacement enregistré\n\n'+address+'\n\nLe point GPS exact est maintenant gardé. Les prochaines ouvertures seront immédiates.');
      },function(e){var m=window.CarPlayLocation?window.CarPlayLocation.showHelp(e):'Impossible de récupérer votre position.';alert(m)},{enableHighAccuracy:true,timeout:15000,maximumAge:0});
      return;
    }
    /* Après le premier enregistrement, on réutilise le GPS et le libellé locaux : aucune attente réseau. */
    var address=localStorage.getItem('return_address')||'Emplacement enregistré';
    showReturnBubble(lat,lon,address);
    /* Pour les anciens enregistrements trop vagues (ex. « 35000 Rennes »), amélioration en arrière-plan sans ralentir l'ouverture. */
    if(isVagueAddress(address))placeAddress(lat,lon).then(function(fresh){
      if(!fresh||fresh==='Emplacement enregistré')return;
      localStorage.setItem('return_address',fresh);
      var el=document.getElementById('rpAddressText');if(el)el.textContent=fresh;
      if(typeof window.showStatuses==='function')window.showStatuses();
    }).catch(function(){});
  };
  var oldClear=window.clearReturnPlace;
  window.clearReturnPlace=function(){
    localStorage.removeItem('return_lat');localStorage.removeItem('return_lon');localStorage.removeItem('return_address');localStorage.removeItem('return_nearby');localStorage.removeItem('return_saved_at');
    if(typeof window.showStatuses==='function')window.showStatuses();
    alert('Emplacement de retour effacé. Au prochain appui, un nouveau point GPS sera enregistré.');
  };
  window.refreshPrefs();
})();
