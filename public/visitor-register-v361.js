(function(){
  'use strict';
  try{
    var id=localStorage.getItem('carplay_device_id');
    if(!id){id=crypto.randomUUID?crypto.randomUUID():'dev-'+Date.now()+'-'+Math.random().toString(36).slice(2);localStorage.setItem('carplay_device_id',id)}
    var installed=!!((window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true);
    fetch('/api/installations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:id,platform:/iphone|ipad|ipod/i.test(navigator.userAgent)?'ios':(/android/i.test(navigator.userAgent)?'android':'web'),homeScreen:installed}),cache:'no-store',keepalive:true}).catch(function(){});
  }catch(_){}
})();
