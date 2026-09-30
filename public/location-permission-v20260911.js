(function(){'use strict';
var permissionState='prompt';
function btn(){return document.getElementById('locationPermissionBtn')}
function note(){return document.getElementById('locationPermissionNote')}
function isIOS(){return /iphone|ipad|ipod/i.test(navigator.userAgent)}
function isAndroid(){return /android/i.test(navigator.userAgent)}
function paint(ok,text){
  var b=btn(),n=note();
  if(b){
    b.classList.toggle('location-enabled',!!ok);
    b.classList.toggle('location-disabled',!ok);
    b.textContent=ok?'✅ LOCALISATION ACTIVÉE':(permissionState==='denied'?'⚙️ OUVRIR LES RÉGLAGES DU TÉLÉPHONE':'📍 ACTIVER LA LOCALISATION');
  }
  if(n&&text)n.textContent=text;
}
function showHelp(e){
  var code=e&&e.code;
  if(code===1)return 'La localisation est désactivée dans les réglages du téléphone. Appuyez sur le bouton pour ouvrir les réglages et l’activer.';
  if(code===2)return 'Position indisponible. Vérifiez que la localisation du téléphone est activée et que le réseau fonctionne.';
  if(code===3)return 'La localisation a mis trop de temps. Réessayez dans un endroit dégagé.';
  return 'Activez la localisation dans les réglages du téléphone.';
}
function success(){permissionState='granted';paint(true,'✓ Couteau Suisse peut utiliser votre position.')}
function settingsHelp(){
  var old=document.getElementById('carplayGpsSettingsHelp');if(old)old.remove();
  var d=document.createElement('div');d.id='carplayGpsSettingsHelp';
  d.style.cssText='position:fixed;z-index:2147483647;inset:0;background:#000d;display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif';
  var instructions=isIOS()
    ?'Dans Réglages, autorisez la localisation pour Couteau Suisse / Safari. Si la localisation générale est coupée : Confidentialité et sécurité → Service de localisation → activer.'
    :(isAndroid()?'Dans les réglages Android, activez Localisation puis autorisez la position pour Couteau Suisse / Chrome.':'Activez la localisation dans les réglages de votre appareil.');
  d.innerHTML='<div style="width:min(520px,95vw);background:#0c1725;color:#fff;border:4px solid #49a9ff;border-radius:24px;padding:22px;text-align:center;box-shadow:0 18px 60px #000"><div style="font-size:44px">📍⚙️</div><div style="font:1000 24px/1.15 Arial;margin:8px 0">ACTIVER LA LOCALISATION</div><div style="font:800 15px/1.45 Arial;color:#d8e7f5">'+instructions+'</div><button id="gpsOpenSettingsNow" type="button" style="width:100%;min-height:60px;margin-top:17px;border:0;border-radius:14px;background:#1684d8;color:#fff;font:1000 18px Arial">⚙️ OUVRIR LES RÉGLAGES DU TÉLÉPHONE</button><button id="gpsSettingsClose" type="button" style="width:100%;min-height:50px;margin-top:9px;border:2px solid #607084;border-radius:14px;background:#1a2738;color:#fff;font:900 16px Arial">RETOUR</button></div>';
  document.body.appendChild(d);
  d.querySelector('#gpsSettingsClose').onclick=function(){d.remove()};
  d.querySelector('#gpsOpenSettingsNow').onclick=function(){openSystemSettings()};
}
function openSystemSettings(){
  // Depuis une PWA, iOS/Android n'autorisent pas toujours un lien vers une sous-page
  // précise. On ouvre donc l'écran système le plus proche disponible.
  try{
    if(isIOS()){
      location.href='app-settings:';
      setTimeout(function(){if(!document.hidden)settingsHelp()},900);
      return;
    }
    if(isAndroid()){
      location.href='intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end';
      setTimeout(function(){if(!document.hidden)settingsHelp()},900);
      return;
    }
  }catch(_){}
  settingsHelp();
}
async function refresh(){
  try{
    if(navigator.permissions&&navigator.permissions.query){
      var p=await navigator.permissions.query({name:'geolocation'});
      permissionState=p.state||'prompt';
      if(p.state==='granted')paint(true,'✓ Localisation autorisée sur ce téléphone.');
      else if(p.state==='denied')paint(false,'Localisation refusée dans les réglages du téléphone. Appuyez ici pour ouvrir les réglages.');
      else paint(false,'Appuyez pour autoriser Couteau Suisse à utiliser votre position.');
      p.onchange=refresh;
      return;
    }
  }catch(_){}
  permissionState='prompt';
  paint(false,'Appuyez pour autoriser Couteau Suisse à utiliser votre position.');
}
window.CarPlayLocation={success:success,showHelp:showHelp,refresh:refresh,openSettings:openSystemSettings};
async function requestLocation(){
  var b=btn();if(!b)return;
  if(permissionState==='denied'){openSystemSettings();return}
  if(!navigator.geolocation){paint(false,'GPS indisponible sur cet appareil.');settingsHelp();return}
  b.disabled=true;
  navigator.geolocation.getCurrentPosition(function(p){
    b.disabled=false;success(p);
  },function(e){
    b.disabled=false;
    if(e&&e.code===1){
      permissionState='denied';
      paint(false,showHelp(e));
      openSystemSettings();
    }else paint(false,showHelp(e));
  },{enableHighAccuracy:true,timeout:12000,maximumAge:0});
}
function wire(){var b=btn();if(!b)return;b.onclick=requestLocation;refresh()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire,{once:true});else wire();
document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh()});
window.addEventListener('focus',refresh);
})();