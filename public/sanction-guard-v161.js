(function(){'use strict';
  if(/^\/admin(?:\.html)?$/.test(location.pathname)||location.pathname==='/import-marches.html')return;
  function deviceId(){var v='';try{v=localStorage.getItem('carplay_device_id')||''}catch(e){}if(!v){v=crypto.randomUUID?crypto.randomUUID():'dev-'+Date.now()+'-'+Math.random().toString(36).slice(2);try{localStorage.setItem('carplay_device_id',v)}catch(e){}}return v}
  function subscription(){try{return JSON.parse(localStorage.getItem('carplay_shared_subscription')||'null')||{}}catch(e){return{}}}
  function email(){try{var e=localStorage.getItem('carplay_recovery_email');if(e)return String(e).trim().toLowerCase()}catch(e){}try{var s=subscription();if(s&&s.email)return String(s.email).trim().toLowerCase()}catch(e){}try{var m=document.cookie.match(/(?:^|; )carplay_recovery_email=([^;]*)/);if(m)return String(decodeURIComponent(m[1])||'').trim().toLowerCase()}catch(e){}return''}
  function code(){var s=subscription();return s&&s.code?String(s.code):''}
  var overlay=null,checking=false,last=null;
  function remember(k,v){try{if(v)localStorage.setItem(k,'1');else localStorage.removeItem(k)}catch(e){}}
  function makeOverlay(pending){
    if(!document.body){document.addEventListener('DOMContentLoaded',function(){makeOverlay(pending)},{once:true});return}
    if(!overlay){
      overlay=document.createElement('div');overlay.id='carplaySanctionOverlay';
      overlay.innerHTML='<div id="carplaySanctionCard"><button id="carplayReactivateBtn">DEMANDE DE RÉACTIVATION</button><div id="carplayReactivateState"></div></div>';
      var style=document.createElement('style');style.id='carplaySanctionStyle';style.textContent='#carplaySanctionOverlay{position:fixed;inset:0;z-index:2147483647;background:#000;display:flex;align-items:center;justify-content:center;padding:18px}#carplaySanctionCard{width:min(620px,94vw);min-height:min(520px,74vh);background:#000;border:5px solid #f39b19;border-radius:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;box-shadow:0 0 0 9999px #000}#carplayReactivateBtn{width:100%;min-height:92px;border:0;border-radius:18px;background:#f39b19;color:#111;font:1000 24px Arial,sans-serif;padding:16px}#carplayReactivateBtn:disabled{background:#555;color:#eee}#carplayReactivateState{min-height:28px;margin-top:18px;color:#fff;font:900 17px Arial,sans-serif;text-align:center;line-height:1.35}';
      document.head.appendChild(style);document.body.appendChild(overlay);
      document.getElementById('carplayReactivateBtn').onclick=sendRequest;
    }
    var b=document.getElementById('carplayReactivateBtn'),st=document.getElementById('carplayReactivateState');
    if(pending){b.disabled=true;b.textContent='DEMANDE ENVOYÉE À L’ADMINISTRATEUR';st.textContent='En attente de la décision de l’administrateur.'}
    else{b.disabled=false;b.textContent='DEMANDE DE RÉACTIVATION';st.textContent=''}
  }
  function removeOverlay(){if(overlay){overlay.remove();overlay=null}var st=document.getElementById('carplaySanctionStyle');if(st)st.remove()}
  async function sendRequest(){var b=document.getElementById('carplayReactivateBtn'),st=document.getElementById('carplayReactivateState');if(b)b.disabled=true;if(st)st.textContent='Envoi de la demande…';try{var r=await fetch('/api/reactivation-request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:deviceId(),email:email(),code:code()}),cache:'no-store'}),j=await r.json();if(!r.ok)throw new Error(j.error||'ERREUR');makeOverlay(true)}catch(e){if(b)b.disabled=false;if(st)st.textContent='Demande impossible. Vérifiez votre connexion et réessayez.'}}
  function contributionBlockedPage(){
    var p=location.pathname;
    if(p!=='/verification-v9.html'&&p!=='/modification-demande.html')return;
    if(!document.body){document.addEventListener('DOMContentLoaded',contributionBlockedPage,{once:true});return}
    document.body.innerHTML='<main style="min-height:100vh;background:#07101d;color:#fff;display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif"><div style="width:min(620px,94vw);padding:26px;border:4px solid #f39b19;border-radius:24px;background:#0c1119;text-align:center"><div style="font-size:25px;font-weight:1000;color:#f39b19;margin-bottom:15px">ACCÈS AUX FICHES DÉSACTIVÉ</div><div style="font-size:17px;font-weight:850;line-height:1.45">Vous pouvez utiliser votre abonnement, mais vous ne pouvez plus renseigner, vérifier ou modifier les fiches marché.</div><button onclick="location.href=\'/index.html\'" style="width:100%;min-height:60px;margin-top:20px;border:0;border-radius:14px;background:#087ee5;color:#fff;font-size:19px;font-weight:1000">RETOUR À L’APPLICATION</button></div></main>';
  }
  async function check(){
    if(checking)return;checking=true;
    try{
      var r=await fetch('/api/sanction/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:deviceId(),email:email(),code:code()}),cache:'no-store'}),j=await r.json();
      if(!r.ok||!j.ok)return;
      last=j;remember('carplay_app_banned_v161',!!j.appBanned);remember('carplay_contribution_blocked_v161',!!j.contributionBlocked);
      if(j.appBanned)makeOverlay(!!j.reactivationRequested);else{removeOverlay();if(j.contributionBlocked)contributionBlockedPage()}
    }catch(e){}finally{checking=false}
  }
  try{if(localStorage.getItem('carplay_app_banned_v161')==='1')makeOverlay(false);else if(localStorage.getItem('carplay_contribution_blocked_v161')==='1')contributionBlockedPage()}catch(e){}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',check,{once:true});else check();
  setInterval(check,10000);
})();
