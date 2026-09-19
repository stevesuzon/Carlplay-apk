(function(){'use strict';
  if(/^\/admin(?:\.html)?$/.test(location.pathname)||location.pathname==='/import-marches.html')return;
  function deviceId(){var v='';try{v=localStorage.getItem('carplay_device_id')||''}catch(e){}if(!v){v=crypto.randomUUID?crypto.randomUUID():'dev-'+Date.now()+'-'+Math.random().toString(36).slice(2);try{localStorage.setItem('carplay_device_id',v)}catch(e){}}return v}
  function subscription(){try{return JSON.parse(localStorage.getItem('carplay_shared_subscription')||'null')||{}}catch(e){return{}}}
  function email(){try{var e=localStorage.getItem('carplay_recovery_email');if(e)return String(e).trim().toLowerCase()}catch(e){}try{var s=subscription();if(s&&s.email)return String(s.email).trim().toLowerCase()}catch(e){}try{var m=document.cookie.match(/(?:^|; )carplay_recovery_email=([^;]*)/);if(m)return String(decodeURIComponent(m[1])||'').trim().toLowerCase()}catch(e){}return''}
  function code(){var s=subscription();return s&&s.code?String(s.code):''}
  var overlay=null,checking=false,last=null;
  function directDeviceId(){return deviceId()}
  function showAdminBubble(m){
    if(!m||!m.id||!m.message)return;
    try{if(localStorage.getItem('carplay_admin_direct_seen_'+m.id)==='1')return}catch(e){}
    var old=document.getElementById('carplayAdminDirectBubbleV289');if(old)old.remove();
    var b=document.createElement('div');b.id='carplayAdminDirectBubbleV289';
    b.style.cssText='position:fixed;left:12px;top:12px;z-index:2147483646;width:min(420px,calc(100vw - 24px));background:linear-gradient(145deg,#7b4fd1,#4b2c8f);color:#fff;border:3px solid #fff;border-radius:18px;padding:14px 16px;box-shadow:0 10px 35px rgba(0,0,0,.55);font:900 16px Arial,sans-serif;line-height:1.35';
    var title=document.createElement('div');title.textContent='💬 MESSAGE DE L’ADMINISTRATEUR';title.style.cssText='font-size:13px;color:#ffe69a;margin-bottom:7px;font-weight:1000';
    var body=document.createElement('div');body.textContent=m.message;
    var days=document.createElement('div');days.id='carplayAdminBubbleDays';days.style.cssText='margin-top:8px;font-size:12px;color:#eee;font-weight:900';try{var sub=subscription();if(sub&&sub.lifetime)days.textContent='Abonnement à vie';else if(sub&&sub.expiresAt){var left=Math.max(0,Math.ceil((Date.parse(sub.expiresAt)-Date.now())/86400000));days.textContent=left+' JOUR'+(left>1?'S':'')+' RESTANT'+(left>1?'S':'')}else days.textContent='Aucun abonnement actif pour le moment';}catch(e){days.textContent='';}
    b.appendChild(title);b.appendChild(body);b.appendChild(days);document.body.appendChild(b);
    try{localStorage.setItem('carplay_admin_direct_seen_'+m.id,'1')}catch(e){}
    fetch('/api/admin/direct-message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'seen',id:m.id,deviceId:directDeviceId(),email:email()})}).catch(function(){});
    setTimeout(function(){if(b&&b.parentNode)b.remove()},15000);
  }
  async function pollAdminBubble(){
    try{var r=await fetch('/api/admin/direct-message?deviceId='+encodeURIComponent(directDeviceId())+'&email='+encodeURIComponent(email()),{cache:'no-store'});if(!r.ok)return;var j=await r.json(),m=(j.messages||[])[0];if(m)showAdminBubble(m)}catch(e){}
  }

  function remember(k,v){try{if(v)localStorage.setItem(k,'1');else localStorage.removeItem(k)}catch(e){}}
  function makeOverlay(pending){
    if(!document.body){document.addEventListener('DOMContentLoaded',function(){makeOverlay(pending)},{once:true});return}
    if(!overlay){
      overlay=document.createElement('div');overlay.id='carplaySanctionOverlay';
      overlay.innerHTML='<div id="carplaySanctionCard"><div class="banTitle">⛔ APPLICATION BANNIE</div><div class="banMessage">Veuillez enregistrer votre vrai prénom et votre vraie adresse e-mail dans la section Réglages de Couteau Suisse.</div><div class="banHelp">Pour être débanni, renseignez votre vrai <b>nom</b>, votre vrai <b>prénom</b> et votre vraie <b>adresse e-mail</b> dans <b>Réglages</b>.</div><div class="banYellow">POUR ÊTRE DÉBANNI</div><button id="carplayReactivateBtn">DEMANDE DE RÉACTIVATION</button><div id="carplayReactivateState"></div></div>';
      var style=document.createElement('style');style.id='carplaySanctionStyle';style.textContent='#carplaySanctionOverlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.98);display:flex;align-items:center;justify-content:center;padding:18px}#carplaySanctionCard{width:min(680px,94vw);min-height:min(560px,88vh);background:#07111c;border:5px solid #f39b19;border-radius:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px;box-shadow:0 0 0 9999px #000;text-align:center;font-family:Arial,sans-serif}.banTitle{font-size:30px;font-weight:1000;color:#ff5a5a;margin-bottom:18px}.banMessage{font-size:22px;line-height:1.35;font-weight:950;color:#fff}.banHelp{font-size:19px;line-height:1.4;font-weight:850;color:#dfe8f1;margin-top:20px}.banYellow{font-size:28px;font-weight:1000;color:#ffd43b;margin:24px 0 16px;text-transform:uppercase}#carplayReactivateBtn{width:100%;min-height:82px;border:0;border-radius:18px;background:#f39b19;color:#111;font:1000 22px Arial,sans-serif;padding:16px}#carplayReactivateBtn:disabled{background:#555;color:#eee}#carplayReactivateState{min-height:28px;margin-top:18px;color:#fff;font:900 17px Arial,sans-serif;text-align:center;line-height:1.35}';
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
  setInterval(function(){if(!document.hidden)check()},60000);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',pollAdminBubble,{once:true});else pollAdminBubble();
  setInterval(function(){if(!document.hidden)pollAdminBubble()},30000);
})();
