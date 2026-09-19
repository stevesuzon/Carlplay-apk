(function(){
'use strict';
var PATH=(location.pathname||'/').replace(/\/+$/,'')||'/';
if(PATH==='/installer.html'||PATH==='/installer')return;
var KEY='carplay_app_identity_v240',SUB='carplay_shared_subscription',PROFILE='carplay_account_profile',PAID='carplay_paid_activated',HANDOFF='carplay_install_browser_handoff_v282',COOKIE='carplay_identity_v282',PENDING='carplay_pending_identity_v304',VERIFIED='carplay_identity_email_verified_v304';

function onboardingIdentity(){try{return (new URL(location.href)).searchParams.get('onboarding')==='identity'}catch(_){return false}}
function browserHandoff(){
  if(PATH!=='/'&&PATH!=='/index.html'&&PATH!=='/index')return false;
  try{if(sessionStorage.getItem(HANDOFF)==='1')return true}catch(_){}
  try{if((new URL(location.href)).searchParams.get('installation')==='1'){sessionStorage.setItem(HANDOFF,'1');return true}}catch(_){}
  return false;
}
function clean(v){return String(v||'').replace(/\s+/g,' ').trim()}
function email(v){return clean(v).toLowerCase()}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email(v))}
function deviceId(){var v=localStorage.getItem('carplay_device_id');if(!v){v=(crypto.randomUUID?crypto.randomUUID():'dev-'+Date.now()+'-'+Math.random().toString(36).slice(2));localStorage.setItem('carplay_device_id',v)}return v}
function platform(){return /iphone|ipad|ipod/i.test(navigator.userAgent)?'ios':(/android/i.test(navigator.userAgent)?'android':'pwa')}
function installed(){try{if(window.AndroidStatus||window.CouteauSuisseNative)return true}catch(_){};try{if(navigator.standalone===true)return true}catch(_){};try{if(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)return true}catch(_){};try{if(window.matchMedia&&window.matchMedia('(display-mode: fullscreen)').matches)return true}catch(_){};return false}
function readJson(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch(_){return null}}
function normalize(x){x=x||{};return {firstName:clean(x.firstName||x.first_name),lastName:clean(x.lastName||x.last_name),email:email(x.email||x.recovery_email||x.recoveryEmail)} }
function complete(x){return !!(x&&clean(x.firstName).length>=2&&clean(x.lastName).length>=2&&validEmail(x.email))}
function cookieIdentity(){try{var m=document.cookie.match(new RegExp('(?:^|; )'+COOKIE+'=([^;]*)'));if(!m)return null;return normalize(JSON.parse(decodeURIComponent(m[1])))}catch(_){return null}}
function savedIdentity(){var a=normalize(readJson(KEY));if(complete(a))return a;var p=normalize(readJson(PROFILE));if(complete(p))return p;var s=normalize(readJson(SUB));if(complete(s))return s;var c=cookieIdentity();if(complete(c))return c;var re=email(localStorage.getItem('carplay_recovery_email')||'');if(validEmail(re))a.email=re;return a}
function candidate(){var p=normalize(readJson(PENDING));if(complete(p))return p;return savedIdentity()}
function marker(){return readJson(VERIFIED)||{}}
function markerMatches(x){var m=marker();return !!(complete(x)&&email(m.email)===email(x.email)&&String(m.deviceId||'')===deviceId()&&Number(m.verifiedAt||0)>0)}
function markVerified(x,at){try{localStorage.setItem(VERIFIED,JSON.stringify({email:email(x.email),deviceId:deviceId(),verifiedAt:Number(at||Date.now())}))}catch(_){}}
function clearVerified(){try{localStorage.removeItem(VERIFIED)}catch(_){}}
function persist(x){
  x=normalize(x);if(!complete(x))return x;
  localStorage.setItem(KEY,JSON.stringify(x));localStorage.setItem('carplay_recovery_email',x.email);localStorage.removeItem(PENDING);
  try{var p=readJson(PROFILE)||{};p.firstName=x.firstName;p.lastName=x.lastName;p.email=x.email;localStorage.setItem(PROFILE,JSON.stringify(p))}catch(_){}
  try{var s=readJson(SUB)||{};s.firstName=x.firstName;s.lastName=x.lastName;s.email=x.email;localStorage.setItem(SUB,JSON.stringify(s))}catch(_){}
  try{document.cookie=COOKIE+'='+encodeURIComponent(JSON.stringify(x))+'; Max-Age=31536000; Path=/; SameSite=Lax; Secure'}catch(_){}
  try{document.cookie='carplay_recovery_email='+encodeURIComponent(x.email)+'; Max-Age=31536000; Path=/; SameSite=Lax; Secure'}catch(_){}
  window.CouteauSuisseIdentity=x;window.dispatchEvent(new CustomEvent('carplay:identity-ready',{detail:x}));return x
}
function persistSubscription(j,x){
  if(!j)return;
  try{
    var s=readJson(SUB)||{},expires=j.expiresAt||j.expires_at||null,lifetime=!!j.lifetime;
    if(j.existingAccount||j.trial||lifetime||expires){
      s.ok=true;s.firstName=clean(j.firstName||x.firstName);s.lastName=clean(j.lastName||x.lastName);s.email=email(j.email||x.email);s.lifetime=lifetime;s.expiresAt=expires;
      if(j.trial){s.globalFree=true;s.personalTrial=j.trialMode==='seven_day';s.trialMode=j.trialMode||'seven_day';localStorage.removeItem(PAID)}
      else if(j.existingAccount||lifetime){s.globalFree=false;s.personalTrial=false;s.trialMode='';localStorage.setItem(PAID,'1')}
      localStorage.setItem(SUB,JSON.stringify(s));
    }
  }catch(_){}
}
function css(){if(document.getElementById('appGateV240Style'))return;var s=document.createElement('style');s.id='appGateV240Style';s.textContent='#appGateV240{position:fixed;z-index:2147483647;inset:0;background:rgba(2,8,14,.985);color:#fff;display:flex;align-items:center;justify-content:center;padding:14px;font-family:Arial,sans-serif}#appGateV240 *{box-sizing:border-box}#appGateV240 .gcard{width:min(620px,96vw);max-height:95vh;overflow:auto;background:linear-gradient(180deg,#101e2d,#08121d);border:4px solid #35d06f;border-radius:25px;padding:18px;box-shadow:0 20px 70px #000}#appGateV240 h1{margin:2px 0 8px;text-align:center;font-size:29px}#appGateV240 .logo{display:block;width:86px;height:86px;object-fit:cover;border-radius:20px;margin:0 auto 8px}#appGateV240 .note{background:#142537;border-radius:15px;padding:13px;line-height:1.42;text-align:center;font-weight:800}#appGateV240 .gold{border:2px solid #ffd43b;background:#302900;color:#fff7b0}#appGateV240 label{display:block;margin-top:10px;font-weight:950}#appGateV240 input{width:100%;min-height:54px;margin-top:5px;padding:10px 12px;border:2px solid #647b90;border-radius:13px;background:#07111c;color:#fff;font:800 18px Arial}#appGateV240 button,#appGateV240 a.gbtn{display:flex;width:100%;min-height:56px;margin-top:12px;padding:10px;border:0;border-radius:14px;align-items:center;justify-content:center;text-decoration:none;text-align:center;background:#17a653;color:#fff;font:950 18px Arial}#appGateV240 button:disabled{background:#5a626d!important;color:#d9dde2!important;opacity:.92;cursor:not-allowed}#appGateV240 .blue{background:#1478d1!important}#appGateV240 .yellow{background:#ffd43b!important;color:#101820!important}#appGateV240 .err{min-height:24px;margin-top:9px;color:#ff8d8d;font-weight:900;text-align:center;line-height:1.35}#appGateV240 .ok{color:#72eba5!important}#appGateV240 .small{font-size:12px;color:#b9c9d8;line-height:1.4;margin-top:9px;text-align:center}#emailConfirmedToastV304{position:fixed;z-index:2147483647;left:50%;top:18px;transform:translateX(-50%);width:min(560px,92vw);padding:16px 18px;border-radius:16px;background:#08783f;color:#fff;border:3px solid #72eba5;box-shadow:0 10px 40px #000;font:900 17px Arial;text-align:center}';document.head.appendChild(s)}
function shell(html){css();var old=document.getElementById('appGateV240');if(old)old.remove();var d=document.createElement('div');d.id='appGateV240';d.innerHTML='<div class="gcard"><img class="logo" src="/couteau-suisse-192.png?v=282" alt="Couteau Suisse">'+html+'</div>';document.body.appendChild(d);return d}
function toast(text){css();var old=document.getElementById('emailConfirmedToastV304');if(old)old.remove();var d=document.createElement('div');d.id='emailConfirmedToastV304';d.textContent=text;document.body.appendChild(d);setTimeout(function(){if(d&&d.isConnected)d.remove()},5500)}
function showInstall(){return shell('<h1>COUTEAU SUISSE</h1><div class="note gold">📲 Avant d’aller sur le site, consultez les explications d’installation iPhone / Android.</div><div class="note" style="margin-top:10px">Aucune vidéo ne se lance. Appuyez sur <b>Installation iPhone / Android</b>, lisez les quelques étapes, fermez l’explication puis appuyez sur <b>Aller sur le site</b>.</div><a class="gbtn blue" href="/installer.html">INSTALLATION iPHONE / ANDROID</a>')}
async function api(path,data){var r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data||{}),cache:'no-store'}),j=await r.json().catch(function(){return {}});if(!r.ok)throw j;return j}
async function postIdentity(x){
  var j=await api('/api/app-identity',{deviceId:deviceId(),platform:platform(),firstName:x.firstName,lastName:x.lastName,email:x.email}),tj={};
  try{tj=await api('/api/contest/trial-identity',{deviceId:deviceId(),firstName:x.firstName,lastName:x.lastName,email:x.email})}catch(e){if(e&&e.error==='EMAIL_NON_CONFIRMEE')throw e;tj={}}
  if(tj.trial&&tj.expiresAt){var ms=Date.parse(tj.expiresAt);if(Number.isFinite(ms)&&ms>Date.now())localStorage.setItem('carplay_personal_trial_until_ms',String(ms))}
  j.subscription=tj;return j
}
async function verifiedStatus(x){
  if(markerMatches(x))return {verified:true,identity:x,verifiedAt:Number(marker().verifiedAt||Date.now())};
  try{return await api('/api/app-identity/status',{deviceId:deviceId(),email:x.email})}catch(_){return {verified:false,networkError:true}}
}
function finalSiteUrl(){var q='?installation=1';try{var u=new URL(location.href),ref=u.searchParams.get('ref')||localStorage.getItem('carplay_pending_referral')||'';if(ref)q+='&ref='+encodeURIComponent(ref)}catch(_){}return '/index.html'+q}
function errorText(e){var c=e&&e.error||'';if(c==='EMAIL_TROP_RAPIDE')return '📧 Un e-mail vient déjà d’être envoyé. Vérifiez votre boîte de réception et vos courriers indésirables.';if(c==='EMAIL_ENVOI_INDISPONIBLE')return 'L’e-mail n’a pas pu être envoyé pour le moment. Réessayez dans quelques instants.';if(c==='QUOTA_EMAIL_JOURNALIER')return 'Le quota d’e-mails du jour est atteint. Réessayez plus tard.';if(c==='IDENTITE_INCOMPLETE')return 'Nom, prénom et adresse e-mail valide obligatoires.';return 'Impossible d’envoyer la confirmation pour le moment. Vérifiez votre connexion et réessayez.'}
function showIdentity(seed,initialMessage){
  seed=normalize(seed||{});
  var d=shell('<h1>INSCRIPTION / RÉCUPÉRATION</h1><div class="note gold">Nom, prénom et adresse e-mail sont obligatoires.</div><div class="note" style="margin-top:10px;border:2px solid #3aa7ff;background:#0a2035">✉️ Votre adresse e-mail doit être confirmée. Après votre appui sur le bouton bleu, ouvrez l’e-mail reçu puis appuyez sur <b>Confirmer mon adresse e-mail</b>. Vous serez automatiquement redirigé vers Couteau Suisse.</div><label>NOM *<input id="gateLast" autocomplete="family-name" maxlength="80" value=""></label><label>PRÉNOM *<input id="gateFirst" autocomplete="given-name" maxlength="80" value=""></label><label>ADRESSE E-MAIL *<input id="gateEmail" type="email" inputmode="email" autocomplete="email" maxlength="190" placeholder="exemple@domaine.fr" value=""></label><button id="gateSave" class="blue" disabled>CONFIRMER MON ADRESSE E-MAIL</button><div id="gateMsg" class="err"></div><div class="small">Tant que l’adresse e-mail n’est pas confirmée, le compte n’est pas compté comme utilisateur valide et n’est pas ajouté au concours.</div>');
  var last=d.querySelector('#gateLast'),first=d.querySelector('#gateFirst'),em=d.querySelector('#gateEmail'),b=d.querySelector('#gateSave'),m=d.querySelector('#gateMsg'),cooldownUntil=0;
  last.value=clean(seed.lastName);first.value=clean(seed.firstName);em.value=email(seed.email);if(initialMessage){m.textContent=initialMessage}
  function ready(){var ok=clean(last.value).length>=2&&clean(first.value).length>=2&&validEmail(em.value)&&Date.now()>=cooldownUntil;b.disabled=!ok;return ok}
  function startCooldown(){cooldownUntil=Date.now()+60000;b.textContent='E-MAIL ENVOYÉ — VÉRIFIEZ VOTRE BOÎTE';ready();setTimeout(function(){cooldownUntil=0;b.textContent='RENVOYER L’E-MAIL DE CONFIRMATION';ready()},60200)}
  last.addEventListener('input',function(){m.textContent='';ready()});first.addEventListener('input',function(){m.textContent='';ready()});em.addEventListener('input',function(){m.textContent='';ready()});ready();
  b.onclick=async function(){
    var x={lastName:clean(last.value),firstName:clean(first.value),email:email(em.value)};if(!ready()){m.textContent='Nom, prénom et adresse e-mail valide obligatoires.';return}
    try{localStorage.setItem(PENDING,JSON.stringify(x))}catch(_){};if(!markerMatches(x))clearVerified();
    b.disabled=true;b.textContent='ENVOI DE L’E-MAIL…';m.classList.remove('ok');m.textContent='';
    try{
      var j=await api('/api/app-identity/start',{deviceId:deviceId(),platform:platform(),firstName:x.firstName,lastName:x.lastName,email:x.email});
      if(j.alreadyVerified){var id=persist(j.identity||x);markVerified(id,j.verifiedAt||Date.now());persistSubscription(j.subscription,id);m.classList.add('ok');m.textContent='✅ Adresse e-mail déjà confirmée. Ouverture de Couteau Suisse…';try{sessionStorage.setItem(HANDOFF,'1')}catch(_){};setTimeout(function(){location.replace(finalSiteUrl())},500);return}
      m.classList.add('ok');m.innerHTML='📧 E-mail envoyé à <b>'+String(j.emailMask||x.email).replace(/[<>&]/g,'')+'</b>.<br>Ouvrez votre boîte mail et appuyez sur <b>CONFIRMER MON ADRESSE E-MAIL</b>. Vous serez ensuite redirigé automatiquement vers Couteau Suisse.';startCooldown()
    }catch(e){m.classList.remove('ok');m.textContent=errorText(e);if(e&&e.error==='EMAIL_TROP_RAPIDE')startCooldown();else{b.textContent='CONFIRMER MON ADRESSE E-MAIL';cooldownUntil=0;ready()}}
  }
}
function cleanConfirmationUrl(){try{var u=new URL(location.href);u.searchParams.delete('email_confirmed');u.searchParams.delete('email_handoff');history.replaceState(null,'',u.pathname+(u.search?u.search:'')+(u.hash||''))}catch(_){}}
async function handleEmailConfirmation(){
  var u;try{u=new URL(location.href)}catch(_){return null}var state=u.searchParams.get('email_confirmed');if(!state)return null;
  if(state==='expired'){cleanConfirmationUrl();return {error:'⌛ Le lien de confirmation a expiré. Demandez un nouvel e-mail.'}}
  if(state!=='ok'){cleanConfirmationUrl();return {error:'⚠️ Le lien de confirmation est invalide. Demandez un nouvel e-mail.'}}
  var token=u.searchParams.get('email_handoff')||'';if(!token){cleanConfirmationUrl();return {error:'Adresse e-mail confirmée, mais la redirection n’a pas pu être terminée. Rouvrez l’application pour continuer.'}}
  try{
    var j=await api('/api/app-identity/handoff',{token:token});if(j.deviceId)localStorage.setItem('carplay_device_id',String(j.deviceId));var id=persist(j.identity||{});markVerified(id,j.verifiedAt||Date.now());persistSubscription(j.subscription,id);try{sessionStorage.setItem(HANDOFF,'1')}catch(_){};cleanConfirmationUrl();setTimeout(function(){toast('✅ Adresse e-mail confirmée. Bienvenue dans Couteau Suisse !')},50);return {ok:true,identity:id}
  }catch(_){cleanConfirmationUrl();return {error:'Votre adresse e-mail a peut-être bien été confirmée. Rouvrez Couteau Suisse depuis son icône pour terminer la synchronisation.'}}
}
function clearIncompleteLegacyIdentity(){try{var a=normalize(readJson(KEY)),p=normalize(readJson(PROFILE)),s=normalize(readJson(SUB));if(!complete(a))localStorage.removeItem(KEY);if(!validEmail(p.email)){var rp=readJson(PROFILE)||{};delete rp.email;localStorage.setItem(PROFILE,JSON.stringify(rp))}if(!validEmail(s.email)){var rs=readJson(SUB)||{};delete rs.email;localStorage.setItem(SUB,JSON.stringify(rs))}var re=email(localStorage.getItem('carplay_recovery_email')||'');if(re&&!validEmail(re))localStorage.removeItem('carplay_recovery_email')}catch(_){} }
async function boot(){
  clearIncompleteLegacyIdentity();var confirmation=await handleEmailConfirmation();if(confirmation&&confirmation.ok)return;var x=candidate();if(confirmation&&confirmation.error){showIdentity(x,confirmation.error);return}
  // Le passage depuis la page d'installation autorise seulement à passer l'aide d'installation.
  // Il ne permet jamais de contourner la confirmation de l'adresse e-mail.
  if(!installed()&&!browserHandoff()){showInstall();return}
  if(complete(x)){
    var st=await verifiedStatus(x);if(st&&st.verified){var id=persist(st.identity||x);markVerified(id,st.verifiedAt||Date.now());persistSubscription(st.subscription,id);return}
    if(st&&st.networkError&&markerMatches(x)){persist(x);return}
    showIdentity(x,onboardingIdentity()?'✉️ Confirmez votre adresse e-mail pour terminer votre inscription.':'✉️ Confirmez votre adresse e-mail pour continuer.');return
  }
  showIdentity(x)
}
window.CouteauSuisseGetIdentity=function(){var x=savedIdentity();return complete(x)&&markerMatches(x)?persist(x):null};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
