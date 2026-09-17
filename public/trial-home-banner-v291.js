(function(){'use strict';
  if(/^\/admin(?:\.html)?$/.test(location.pathname)||location.pathname==='/import-marches.html')return;
  var ID='couteauTrialHomeBannerV291',timer=null;
  function read(k){try{return localStorage.getItem(k)||''}catch(e){return ''}}
  function sub(){try{return JSON.parse(read('carplay_shared_subscription')||'null')||{}}catch(e){return {}}}
  function trialUntil(){
    var s=sub(), vals=[Number(read('carplay_personal_trial_until_ms')||0)];
    if(s&&s.personalTrial&&s.expiresAt)vals.push(Date.parse(s.expiresAt));
    if(s&&s.trialMode==='seven_day'&&s.expiresAt)vals.push(Date.parse(s.expiresAt));
    var best=0; vals.forEach(function(v){if(Number.isFinite(v)&&v>best)best=v}); return best;
  }
  function hasPaid(){var s=sub();return !!(s&&(s.lifetime||(s.expiresAt&&!s.globalFree&&Date.parse(s.expiresAt)>Date.now())))}
  function render(){
    var old=document.getElementById(ID); if(old)old.remove(); if(timer){clearInterval(timer);timer=null}
    var end=trialUntil(); if(hasPaid()||!end||end<=Date.now())return;
    if(!document.body)return;
    var b=document.createElement('div');b.id=ID;
    b.style.cssText='position:fixed;left:10px;top:10px;z-index:2147483000;max-width:min(330px,calc(100vw - 20px));background:#fff7bf;color:#151515;border:3px solid #ffd43b;border-radius:14px;padding:9px 12px;box-shadow:0 8px 25px rgba(0,0,0,.35);font:1000 15px/1.25 Arial,sans-serif;text-align:left;pointer-events:none';
    b.innerHTML='<div style="font-size:12px;text-transform:uppercase">🕐 PÉRIODE D’ESSAI COUTEAU SUISSE</div><div id="'+ID+'Days" style="font-size:21px;margin-top:3px">—</div>';
    document.body.appendChild(b);
    function tick(){var ms=end-Date.now(),d=Math.max(0,Math.ceil(ms/86400000));var el=document.getElementById(ID+'Days');if(!el)return;if(ms<=0){render();return}el.textContent=d+' JOUR'+(d>1?'S':'')+' RESTANT'+(d>1?'S':'')+' DANS VOTRE ESSAI';}
    tick();timer=setInterval(tick,60000);
  }
  function boot(){render();setTimeout(render,1500)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.addEventListener('storage',render);
})();
