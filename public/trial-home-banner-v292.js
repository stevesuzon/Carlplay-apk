(function(){'use strict';
  // V292 : affichage uniforme de la période d'essai pour les nouveaux ET anciens comptes.
  // Le serveur est consulté afin de récupérer l'échéance d'essai déjà enregistrée.
  if(/^\/admin(?:\.html)?$/.test(location.pathname)||location.pathname==='/import-marches.html')return;
  var ID='couteauTrialHomeBannerV292',timer=null;
  function read(k){try{return localStorage.getItem(k)||''}catch(e){return ''}}
  function write(k,v){try{localStorage.setItem(k,String(v))}catch(e){}}
  function sub(){try{return JSON.parse(read('carplay_shared_subscription')||'null')||{}}catch(e){return {}}}
  function deviceId(){var v=read('carplay_device_id');if(!v){v=(crypto.randomUUID?crypto.randomUUID():'dev-'+Date.now()+'-'+Math.random().toString(36).slice(2));write('carplay_device_id',v)}return v}
  function localTrialUntil(){
    var s=sub(), vals=[Number(read('carplay_personal_trial_until_ms')||0)];
    if(s&&s.personalTrial&&s.expiresAt)vals.push(Date.parse(s.expiresAt));
    if(s&&s.trialMode==='seven_day'&&s.expiresAt)vals.push(Date.parse(s.expiresAt));
    var best=0; vals.forEach(function(v){if(Number.isFinite(v)&&v>best)best=v}); return best;
  }
  function hasPaid(){var s=sub();return !!(s&&(s.lifetime||(s.expiresAt&&!s.globalFree&&Date.parse(s.expiresAt)>Date.now())))}
  function remove(){var old=document.getElementById(ID);if(old)old.remove();if(timer){clearInterval(timer);timer=null}}
  function render(end){
    remove();
    if(hasPaid()||!end||end<=Date.now()||!document.body)return;
    var b=document.createElement('div');b.id=ID;
    b.style.cssText='position:fixed;left:10px;top:max(10px,env(safe-area-inset-top));z-index:2147483000;min-width:165px;max-width:min(340px,calc(100vw - 20px));background:#126fc2;color:#fff;border:3px solid #62b6ff;border-radius:14px;padding:9px 12px;box-shadow:0 8px 25px rgba(0,0,0,.35);font:1000 15px/1.25 Arial,sans-serif;text-align:center;pointer-events:none';
    b.innerHTML='<div style="font-size:12px;text-transform:uppercase">🕐 MOIS D’ESSAI COUTEAU SUISSE</div><div id="'+ID+'Days" style="font-size:20px;margin-top:3px">—</div>';
    document.body.appendChild(b);
    function tick(){var ms=end-Date.now(),d=Math.max(0,Math.ceil(ms/86400000)),el=document.getElementById(ID+'Days');if(!el)return;if(ms<=0){remove();return}if(hasPaid()){remove();return}el.textContent=d+' JOUR'+(d>1?'S':'')+' RESTANT'+(d>1?'S':'')}
    tick();timer=setInterval(tick,60000);
  }
  function syncServerThenRender(){
    var local=localTrialUntil();
    if(local>Date.now()&&!hasPaid()){render(local);return;}
    fetch('/api/contest/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:deviceId()}),cache:'no-store'})
      .then(function(r){return r.json().catch(function(){return {}})})
      .then(function(j){
        if(hasPaid()){remove();return}
        var ms=Number(j&&j.appFreeUntil||0);
        if(ms>Date.now()){
          write('carplay_personal_trial_until_ms',ms);
          var s=sub();s.globalFree=true;s.personalTrial=true;s.trialMode=s.trialMode||'seven_day';s.expiresAt=new Date(ms).toISOString();write('carplay_shared_subscription',JSON.stringify(s));
          render(ms);
        }else{remove()}
      }).catch(function(){if(local>Date.now()&&!hasPaid())render(local);});
  }
  function boot(){syncServerThenRender();setTimeout(syncServerThenRender,1500)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.addEventListener('storage',syncServerThenRender);
  window.addEventListener('carplay-free-until-updated',syncServerThenRender);
  window.addEventListener('pageshow',syncServerThenRender);
})();
