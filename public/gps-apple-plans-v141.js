(function(){
  'use strict';
  var apple=document.getElementById('gpsApple');
  var currentCtx=null;
  var oldRefresh=window.refreshPrefs;
  window.refreshPrefs=function(){
    if(typeof oldRefresh==='function')oldRefresh();
    var selected=localStorage.getItem('gps_pref')||'';
    if(apple)apple.classList.toggle('selected',selected==='Plans Apple');
  };
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function installerUrl(){return (location.origin&&location.origin!=='null'?location.origin:'https://carplay-telephone.appli-suzon.workers.dev')+'/installer.html'}
  function gpsUrl(lat,lon){return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(lat+','+lon)}
  function distanceText(m){m=Math.max(0,Number(m)||0);return m<1000?Math.max(1,Math.round(m))+' m':(m/1000).toFixed(1).replace('.',',')+' km'}
  function isVagueAddress(a){return !a||a==='Emplacement enregistré'||a==='Recherche du nom exact…'||/^\s*\d{5}\s+[^,]+\s*$/i.test(a)}
  function photoUrl(name){return name?'/api/place-photo?name='+encodeURIComponent(name):''}
  async function placeContext(lat,lon){
    try{
      var r=await fetch('/api/place-context?lat='+encodeURIComponent(lat)+'&lon='+encodeURIComponent(lon),{cache:'no-store'}),j=await r.json();
      if(r.ok&&j&&j.ok)return j;
    }catch(_){ }
    try{
      var r2=await fetch('/api/place-address?lat='+encodeURIComponent(lat)+'&lon='+encodeURIComponent(lon),{cache:'no-store'}),j2=await r2.json();
      if(r2.ok&&j2&&j2.address)return {ok:true,address:j2.address,nearby:[],restaurants:[],fastFood:[],ratingsAvailable:false};
    }catch(_){ }
    return {ok:true,address:'Emplacement enregistré',nearby:[],restaurants:[],fastFood:[],ratingsAvailable:false};
  }
  function saveContext(lat,lon,ctx){
    ctx=ctx||{};ctx.lat=Number(lat);ctx.lon=Number(lon);ctx.updatedAt=Date.now();ctx._loaded=true;currentCtx=ctx;
    try{localStorage.setItem('return_context_v213',JSON.stringify(ctx));}catch(_){ }
    if(ctx.address)localStorage.setItem('return_address',String(ctx.address));
    try{localStorage.setItem('return_nearby',JSON.stringify(ctx.nearby||[]));}catch(_){ }
    localStorage.setItem('return_context_updated_at',String(Date.now()));
    if(typeof window.showStatuses==='function')window.showStatuses();
    return ctx;
  }
  function loadContext(lat,lon){
    var keys=['return_context_v213','return_context_v212','return_context_v211'];
    for(var i=0;i<keys.length;i++){
      try{
        var j=JSON.parse(localStorage.getItem(keys[i])||'null');
        if(j&&Math.abs(Number(j.lat)-Number(lat))<0.00001&&Math.abs(Number(j.lon)-Number(lon))<0.00001){j._loaded=true;currentCtx=j;return j;}
      }catch(_){ }
    }
    var near=[];try{near=JSON.parse(localStorage.getItem('return_nearby')||'[]');if(!Array.isArray(near))near=[]}catch(_){near=[]}
    var savedAddress=localStorage.getItem('return_address')||'Emplacement enregistré';
    currentCtx={ok:true,address:isVagueAddress(savedAddress)?'Recherche du nom exact…':savedAddress,nearby:near,restaurants:[],fastFood:[],ratingsAvailable:false,_loaded:false,updatedAt:0};
    return currentCtx;
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
    var old=document.getElementById('returnPlaceShareV212');if(old)old.remove();
    var d=document.createElement('div');d.id='returnPlaceShareV212';
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
  function closeLandmarks(items){return (items||[]).filter(function(x){return Number(x&&x.distanceMeters)>=0&&Number(x.distanceMeters)<=800}).slice(0,1)}
  function landmarkTypeLabel(type){
    type=String(type||'').toLowerCase();
    var labels={fuel:'Station-service',car_repair:'Garage',car:'Garage / automobile',supermarket:'Supermarché',mall:'Centre commercial',department_store:'Grand magasin',hotel:'Hôtel',restaurant:'Restaurant',hospital:'Hôpital',cinema:'Cinéma',bus_station:'Gare routière',station:'Gare',stadium:'Stade',sports_centre:'Centre sportif'};
    return labels[type]||'Repère';
  }
  function simpleRows(items){
    items=closeLandmarks(items);if(!items.length)return '';
    var x=items[0],kind=landmarkTypeLabel(x.type);
    return '<div style="margin-top:6px;font-size:14px"><b>'+esc(kind)+'</b> — '+esc(x.name)+' — <b>'+distanceText(x.distanceMeters)+'</b></div>';
  }
  function ratingsText(x){
    if(Number(x&&x.rating)>0)return '⭐ '+Number(x.rating).toFixed(1).replace('.',',')+(Number(x.ratingCount)>0?' ('+Math.round(Number(x.ratingCount))+' avis)':'');
    return 'Avis non disponibles';
  }
  function diningSummary(items,kind,hasRatings){
    var count=(items||[]).length;
    if(!count)return 'Recherche en cours…';
    if(kind==='restaurant')return count+' restaurant'+(count>1?'s':'')+(hasRatings?' • classés du mieux noté au moins bien noté':' • avis indisponibles');
    return count+' fast-food'+(count>1?'s':'')+' à moins de 10 km';
  }
  function showDiningPage(kind){
    var ctx=currentCtx||{},items=(kind==='restaurant'?ctx.restaurants:ctx.fastFood)||[],title=kind==='restaurant'?'⭐ Restaurants réputés':'🍔 Fast-food';
    var old=document.getElementById('rpDiningPageV212');if(old)old.remove();
    var d=document.createElement('div');d.id='rpDiningPageV212';
    d.style.cssText='position:fixed;z-index:2147483647;inset:0;background:#07111beF;overflow-y:auto;padding:12px;font-family:Arial,sans-serif';
    var cards=items.length?items.map(function(x,i){
      var img=x.photoName?'<img src="'+esc(photoUrl(x.photoName))+'" alt="Photo du restaurant" style="width:112px;height:92px;object-fit:cover;border-radius:13px;background:#0d1824" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">':'',fallback='<div style="'+(x.photoName?'display:none;':'display:flex;')+'width:112px;height:92px;border-radius:13px;background:#22364a;align-items:center;justify-content:center;font-size:38px">'+(kind==='restaurant'?'🍽️':'🍔')+'</div>';
      var rating=Number(x.rating)>0?'<div style="color:#ffd24a;font-weight:1000;margin-top:3px">'+esc(ratingsText(x))+'</div>':'<div style="color:#91a4b7;font-size:12px;margin-top:3px">Avis non disponibles</div>';
      return '<div style="background:#13283b;border:1px solid #29445d;border-radius:17px;padding:10px;margin-top:10px"><div style="display:flex;gap:11px;align-items:flex-start">'+img+fallback+'<div style="flex:1;min-width:0"><div style="font-size:18px;font-weight:1000;color:#fff">'+(i+1)+'. '+esc(x.name)+'</div>'+rating+'<div style="margin-top:5px;color:#dce8f3;font-size:13px"><b>Spécialité :</b> '+esc(x.specialty||'Non indiquée')+'</div><div style="margin-top:4px;color:#b9cad8;font-size:12px">📍 '+distanceText(x.distanceMeters)+(x.address?' • '+esc(x.address):'')+'</div></div></div><button data-lat="'+esc(x.lat)+'" data-lon="'+esc(x.lon)+'" class="rpGoDining" style="width:100%;min-height:48px;margin-top:9px;border:0;border-radius:12px;background:#168a4e;color:#fff;font:1000 15px Arial">🧭 ALLER AU '+(kind==='restaurant'?'RESTAURANT':'FAST-FOOD')+'</button></div>';
    }).join(''):'<div style="padding:20px;color:#b9cad8;text-align:center">Aucun résultat disponible pour le moment.</div>';
    d.innerHTML='<div style="width:min(640px,98vw);margin:0 auto;background:#0d1824;color:#fff;border:4px solid #4dc987;border-radius:24px;padding:14px;box-shadow:0 16px 50px #000"><div style="display:flex;align-items:center;gap:9px"><button id="rpDiningBack" style="min-width:76px;min-height:42px;border:0;border-radius:11px;background:#25394d;color:#fff;font:900 14px Arial">← RETOUR</button><div style="font-size:22px;font-weight:1000;flex:1">'+title+'</div></div><div style="margin-top:7px;color:#aebdcb;font-size:13px">À moins de 10 km de votre place enregistrée.</div>'+cards+'</div>';
    document.body.appendChild(d);
    d.querySelector('#rpDiningBack').onclick=function(){d.remove()};
    Array.from(d.querySelectorAll('.rpGoDining')).forEach(function(b){b.onclick=function(){navTo(Number(b.dataset.lat),Number(b.dataset.lon))}});
  }
  function updateBubbleContext(ctx){
    currentCtx=ctx||currentCtx;
    var a=document.getElementById('rpAddressText'),near=document.getElementById('rpNearbyRows'),nearBox=document.getElementById('rpNearbyBox'),rest=document.getElementById('rpRestaurantSummary'),fast=document.getElementById('rpFastFoodSummary'),note=document.getElementById('rpRatingNote');
    if(a)a.textContent=ctx.address||'Emplacement enregistré';
    var landmarks=closeLandmarks(ctx.nearby||[]);
    if(near)near.innerHTML=simpleRows(landmarks);
    if(nearBox)nearBox.style.display=landmarks.length?'block':'none';
    if(rest)rest.textContent=diningSummary(ctx.restaurants||[],'restaurant',!!ctx.ratingsAvailable);
    if(fast)fast.textContent=diningSummary(ctx.fastFood||[],'fastfood',!!ctx.ratingsAvailable);
    if(note)note.textContent=ctx.ratingsAvailable?'Notes et avis récupérés pour classer les restaurants.':'Si les notes ne sont pas disponibles, l’application n’en invente pas.';
  }
  function showReturnBubble(lat,lon,ctx){
    currentCtx=ctx;
    var old=document.getElementById('returnPlaceConfirmV212');if(old)old.remove();
    var d=document.createElement('div');d.id='returnPlaceConfirmV212';
    d.style.cssText='position:fixed;z-index:2147483647;inset:0;background:#000c;display:flex;align-items:center;justify-content:center;padding:12px;font-family:Arial,sans-serif';
    d.innerHTML='<div style="width:min(580px,97vw);max-height:94vh;overflow-y:auto;background:#0d1824;color:#fff;border:4px solid #4dc987;border-radius:24px;padding:16px;text-align:center;box-shadow:0 16px 50px #000"><div style="font-size:25px;font-weight:1000;margin-bottom:8px">🚐 Retourner sur la place</div><div style="font-size:18px;font-weight:900">Voulez-vous retourner à cet emplacement ?</div><div style="margin-top:10px;padding:10px;border-radius:13px;background:#13283b;font-size:16px"><b>Lieu enregistré :</b><br><span id="rpAddressText">'+esc(ctx.address||'Emplacement enregistré')+'</span></div><div id="rpNearbyBox" style="margin-top:9px;padding:10px;border-radius:13px;background:#172536;text-align:left;font-size:14px;display:'+(closeLandmarks(ctx.nearby||[]).length?'block':'none')+'"><b style="color:#ffd24a">🧭 REPÈRE DE LA PLACE</b><div id="rpNearbyRows">'+simpleRows(ctx.nearby||[])+'</div></div><button id="rpRestaurantTile" style="width:100%;margin-top:9px;padding:12px;border:2px solid #ffd24a;border-radius:14px;background:#172536;color:#fff;text-align:left"><div style="font:1000 17px Arial;color:#ffd24a">⭐ RESTAURANTS RÉPUTÉS</div><div id="rpRestaurantSummary" style="font:700 13px Arial;margin-top:4px;color:#dce8f3">'+esc(diningSummary(ctx.restaurants||[],'restaurant',!!ctx.ratingsAvailable))+'</div><div style="font:900 12px Arial;margin-top:5px;color:#74c5ff">VOIR LES RESTAURANTS →</div></button><button id="rpFastFoodTile" style="width:100%;margin-top:9px;padding:12px;border:2px solid #f59b23;border-radius:14px;background:#172536;color:#fff;text-align:left"><div style="font:1000 17px Arial;color:#f7ae45">🍔 FAST-FOOD</div><div id="rpFastFoodSummary" style="font:700 13px Arial;margin-top:4px;color:#dce8f3">'+esc(diningSummary(ctx.fastFood||[],'fastfood',!!ctx.ratingsAvailable))+'</div><div style="font:900 12px Arial;margin-top:5px;color:#74c5ff">VOIR LES FAST-FOOD →</div></button><div id="rpRatingNote" style="margin-top:6px;font-size:11px;color:#91a4b7"></div><button id="rpShare" style="width:100%;min-height:50px;margin-top:10px;border:0;border-radius:13px;background:#267bc5;color:#fff;font:1000 16px Arial">📤 ENVOYER L’EMPLACEMENT</button><div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px"><button id="rpYes" style="min-height:54px;border:0;border-radius:13px;background:#168a4e;color:#fff;font:900 18px Arial">OUI</button><button id="rpNo" style="min-height:54px;border:0;border-radius:13px;background:#b3343a;color:#fff;font:900 18px Arial">NON</button></div></div>';
    document.body.appendChild(d);updateBubbleContext(ctx);
    d.querySelector('#rpNo').onclick=function(){d.remove()};
    d.querySelector('#rpYes').onclick=function(){d.remove();navTo(lat,lon)};
    d.querySelector('#rpShare').onclick=function(){openShareMenu(lat,lon,localStorage.getItem('return_address')||ctx.address)};
    d.querySelector('#rpRestaurantTile').onclick=function(){showDiningPage('restaurant')};
    d.querySelector('#rpFastFoodTile').onclick=function(){showDiningPage('fastfood')};
  }
  var refreshPromise=null;
  function refreshContext(lat,lon){
    if(refreshPromise)return refreshPromise;
    refreshPromise=placeContext(lat,lon).then(function(ctx){ctx=saveContext(lat,lon,ctx);updateBubbleContext(ctx);return ctx}).catch(function(){return null}).finally(function(){refreshPromise=null});
    return refreshPromise;
  }
  window.returnPlace=async function(){
    var lat=localStorage.getItem('return_lat'),lon=localStorage.getItem('return_lon');
    if(!lat||!lon){
      if(!navigator.geolocation){alert('GPS indisponible');return;}
      navigator.geolocation.getCurrentPosition(async function(position){
        var la=position.coords.latitude,lo=position.coords.longitude;
        localStorage.setItem('return_lat',la);localStorage.setItem('return_lon',lo);localStorage.setItem('return_saved_at',String(Date.now()));localStorage.setItem('return_address','Recherche du nom exact…');
        ['return_context_v210','return_context_v211','return_context_v212','return_context_v213','return_context_updated_at','return_nearby'].forEach(function(k){localStorage.removeItem(k)});
        if(typeof window.showStatuses==='function')window.showStatuses();
        window.dispatchEvent(new CustomEvent('carplay-return-place-saved',{detail:{lat:la,lon:lo,address:'Recherche du nom exact…'}}));
        var ctx=await refreshContext(la,lo);
        var exact=ctx&&ctx.address&&!isVagueAddress(ctx.address)?ctx.address:'Point GPS exact enregistré';
        alert('✅ Emplacement enregistré\n\n'+exact+'\n\nLe GPS exact est maintenant gardé jusqu’à ce que vous appuyiez sur « Effacer l’emplacement ».');
        if(ctx)window.dispatchEvent(new CustomEvent('carplay-return-place-context-ready',{detail:ctx}));
      },function(e){var m=window.CarPlayLocation?window.CarPlayLocation.showHelp(e):'Impossible de récupérer votre position.';alert(m)},{enableHighAccuracy:true,timeout:15000,maximumAge:0});
      return;
    }
    var ctx=loadContext(lat,lon);showReturnBubble(lat,lon,ctx);
    var age=Date.now()-Number(ctx.updatedAt||localStorage.getItem('return_context_updated_at')||0);
    if(!ctx._loaded||age>86400000||isVagueAddress(ctx.address))refreshContext(lat,lon);
  };
  window.clearReturnPlace=function(){
    ['return_lat','return_lon','return_address','return_nearby','return_saved_at','return_context_v210','return_context_v211','return_context_v212','return_context_v213','return_context_updated_at'].forEach(function(k){localStorage.removeItem(k)});
    currentCtx=null;
    if(typeof window.showStatuses==='function')window.showStatuses();
    alert('Emplacement de retour effacé. Au prochain appui, un nouveau point GPS sera enregistré.');
  };
  window.refreshPrefs();
})();
