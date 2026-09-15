(function(){
'use strict';
function btn(){return document.getElementById('locationPermissionBtn')}
function note(){return document.getElementById('locationPermissionNote')}
function paint(ok,text){var b=btn(),n=note();if(b){b.classList.toggle('location-enabled',!!ok);b.classList.toggle('location-disabled',!ok);b.textContent=ok?'✅ LOCALISATION ACTIVÉE':'📍 ACTIVER LA LOCALISATION'}if(n&&text)n.textContent=text}
function showHelp(e){var code=e&&e.code;if(code===1)return 'Autorisation refusée dans les réglages du téléphone. Activez la localisation pour Couteau Suisse puis réessayez.';if(code===2)return 'Position indisponible. Vérifiez le GPS et le réseau.';if(code===3)return 'La localisation a mis trop de temps. Réessayez dans un endroit dégagé.';return 'Activez la localisation dans les réglages du téléphone.'}
function success(){paint(true,'✓ Couteau Suisse peut utiliser votre position.')}
async function refresh(){try{if(navigator.permissions&&navigator.permissions.query){var p=await navigator.permissions.query({name:'geolocation'});if(p.state==='granted')paint(true,'✓ Localisation autorisée sur ce téléphone.');else if(p.state==='denied')paint(false,'Autorisation refusée dans les réglages du téléphone.');else paint(false,'Appuyez pour autoriser Couteau Suisse à utiliser votre position.');p.onchange=refresh;return}}catch(_){}paint(false,'Appuyez pour autoriser Couteau Suisse à utiliser votre position.')}
window.CarPlayLocation={success:success,showHelp:showHelp,refresh:refresh};
function wire(){var b=btn();if(!b)return;b.onclick=function(){if(!navigator.geolocation){paint(false,'GPS indisponible sur cet appareil.');return}b.disabled=true;navigator.geolocation.getCurrentPosition(function(p){b.disabled=false;success(p)},function(e){b.disabled=false;paint(false,showHelp(e))},{enableHighAccuracy:true,timeout:12000,maximumAge:0})};refresh()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
})();
