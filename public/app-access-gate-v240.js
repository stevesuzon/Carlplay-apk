(function(){
'use strict';
var PATH=(location.pathname||'/').replace(/\/+$/,'')||'/';
if(PATH==='/installer.html'||PATH==='/installer')return;
var KEY='carplay_app_identity_v240',SUB='carplay_shared_subscription',PROFILE='carplay_account_profile',PAID='carplay_paid_activated',HANDOFF='carplay_install_browser_handoff_v282',COOKIE='carplay_identity_v282';

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
function installed(){try{if(window.AndroidStatus||window.CouteauSuisseNative)return true}catch(_){};try{if(navigator.standalone===true)return true}catch(_){};try{if(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)return true}catch(_){};try{if(window.matchMedia&&window.matchMedia('(display-mode: fullscreen)').matches)return true}catch(_){};return false}
function readJson(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch(_){return null}}
function normalize(x){x=x||{};return {firstName:clean(x.firstName||x.first_name),lastName:clean(x.lastName||x.last_name),email:email(x.email||x.recovery_email||x.recoveryEmail)}}
function complete(x){return !!(x&&clean(x.firstName).length>=2&&clean(x.lastName).length>=2&&validEmail(x.email))}
function cookieIdentity(){try{var m=document.cookie.match(new RegExp('(?:^|; )'+COOKIE+'=([^;]*)'));if(!m)return null;return normalize(JSON.parse(decodeURIComponent(m[1])))}catch(_){return null}}
function existing(){var a=normalize(readJson(KEY));if(complete(a))return a;var p=normalize(readJson(PROFILE));if(complete(p))return p;var s=normalize(readJson(SUB));if(complete(s))return s;var c=cookieIdentity();if(complete(c))return c;var re=email(localStorage.getItem('carplay_recovery_email')||'');if(validEmail(re))a.email=re;return a}
function persist(x){
  x=normalize(x);if(!complete(x))return x;
  localStorage.setItem(KEY,JSON.stringify(x));localStorage.setItem('carplay_recovery_email',x.email);
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
      else if(j.existingAccount){s.globalFree=false;s.personalTrial=false;s.trialMode='';localStorage.setItem(PAID,'1')}
      localStorage.setItem(SUB,JSON.stringify(s));
    }
  }catch(_){}
}
function css(){if(document.getElementById('appGateV240Style'))return;var s=document.createElement('style');s.id='appGateV240Style';s.textContent='#appGateV240{position:fixed;z-index:2147483647;inset:0;background:rgba(2,8,14,.985);color:#fff;display:flex;align-items:center;justify-content:center;padding:14px;font-family:Arial,sans-serif}#appGateV240 *{box-sizing:border-box}#appGateV240 .gcard{width:min(620px,96vw);max-height:95vh;overflow:auto;background:linear-gradient(180deg,#101e2d,#08121d);border:4px solid #35d06f;border-radius:25px;padding:18px;box-shadow:0 20px 70px #000}#appGateV240 h1{margin:2px 0 8px;text-align:center;font-size:29px}#appGateV240 .logo{display:block;width:86px;height:86px;object-fit:cover;border-radius:20px;margin:0 auto 8px}#appGateV240 .note{background:#142537;border-radius:15px;padding:13px;line-height:1.42;text-align:center;font-weight:800}#appGateV240 .gold{border:2px solid #ffd43b;background:#302900;color:#fff7b0}#appGateV240 label{display:block;margin-top:10px;font-weight:950}#appGateV240 input{width:100%;min-height:54px;margin-top:5px;padding:10px 12px;border:2px solid #647b90;border-radius:13px;background:#07111c;color:#fff;font:800 18px Arial}#appGateV240 button,#appGateV240 a.gbtn{display:flex;width:100%;min-height:56px;margin-top:12px;padding:10px;border:0;border-radius:14px;align-items:center;justify-content:center;text-decoration:none;text-align:center;background:#17a653;color:#fff;font:950 18px Arial}#appGateV240 button:disabled{background:#5a626d!important;color:#d9dde2!important;opacity:.92;cursor:not-allowed}#appGateV240 .blue{background:#1478d1!important}#appGateV240 .yellow{background:#ffd43b!important;color:#101820!important}#appGateV240 .err{min-height:24px;margin-top:9px;color:#ff8d8d;font-weight:900;text-align:center}#appGateV240 .small{font-size:12px;color:#b9c9d8;line-height:1.4;margin-top:9px;text-align:center}';document.head.appendChild(s)}
function shell(html){css();var old=document.getElementById('appGateV240');if(old)old.remove();var d=document.createElement('div');d.id='appGateV240';d.innerHTML='<div class="gcard"><img class="logo" src="/couteau-suisse-192.png?v=282" alt="Couteau Suisse">'+html+'</div>';document.body.appendChild(d);return d}
function showInstall(){
  var d=shell('<h1>COUTEAU SUISSE</h1><div class="note gold">📲 L’installation commence par une courte vidéo obligatoire.</div><div class="note" style="margin-top:10px">Regardez la vidéo jusqu’à la fin. Le même bouton <b>Regarder la vidéo</b> deviendra alors <b>Installer l’application</b>. Le formulaire ne s’ouvre qu’après votre appui sur ce bouton.</div><a class="gbtn blue" href="/installer.html">REGARDER LA VIDÉO</a>');
  return d;
}
async function postIdentity(x){
  // V288 : l'enregistrement de l'identité est la vérification obligatoire.
  // La synchronisation de l'essai/abonnement est secondaire : une panne temporaire
  // de ce second appel ne doit plus faire réapparaître le formulaire à chaque ouverture.
  var r=await fetch('/api/app-identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:deviceId(),platform:/iphone|ipad|ipod/i.test(navigator.userAgent)?'ios':(/android/i.test(navigator.userAgent)?'android':'pwa'),firstName:x.firstName,lastName:x.lastName,email:x.email}),cache:'no-store'}),j=await r.json().catch(function(){return {}});if(!r.ok)throw j;
  var tj={};
  try{
    var tr=await fetch('/api/contest/trial-identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:deviceId(),firstName:x.firstName,lastName:x.lastName,email:x.email}),cache:'no-store'});
    tj=await tr.json().catch(function(){return {}});
    if(!tr.ok)tj={};
  }catch(_){tj={}}
  if(tj.trial&&tj.expiresAt){var ms=Date.parse(tj.expiresAt);if(Number.isFinite(ms)&&ms>Date.now())localStorage.setItem('carplay_personal_trial_until_ms',String(ms));}
  j.subscription=tj;j.trial=!!tj.trial;j.existingSubscription=!!tj.existingAccount;return j
}
function finalSiteUrl(){var q='?installation=1';try{var u=new URL(location.href),ref=u.searchParams.get('ref')||localStorage.getItem('carplay_pending_referral')||'';if(ref)q+='&ref='+encodeURIComponent(ref)}catch(_){}return '/index.html'+q}
function showIdentity(seed){
  seed=seed||{};
  var d=shell('<h1>INSCRIPTION / RÉCUPÉRATION</h1><div class="note gold">Nom, prénom et adresse e-mail sont obligatoires.</div><div class="note" style="margin-top:10px;border:2px solid #ff6b6b;background:#2a1116">⛔ Sans adresse e-mail valide, l’accès à Couteau Suisse reste bloqué.</div><div class="note" style="margin-top:10px">Si cette adresse e-mail possède déjà un abonnement actif, ses <b>jours restants seront récupérés automatiquement</b>. Si c’est un nouveau compte, l’accès gratuit prévu pour la période actuelle sera activé ; après cette période, un nouvel utilisateur aura <b>7 jours d’essai</b>.</div><label>NOM *<input id="gateLast" autocomplete="family-name" maxlength="80" value=""></label><label>PRÉNOM *<input id="gateFirst" autocomplete="given-name" maxlength="80" value=""></label><label>ADRESSE E-MAIL *<input id="gateEmail" type="email" inputmode="email" autocomplete="email" maxlength="190" placeholder="exemple@domaine.fr" value=""></label><button id="gateSave" disabled>VALIDER ET OUVRIR COUTEAU SUISSE</button><div id="gateMsg" class="err"></div><div class="small">Le nom, le prénom et l’adresse e-mail seront enregistrés automatiquement dans <b>Réglages</b>. Après activation, vous arriverez sur le site pour l’ajouter à l’écran d’accueil.</div>');
  var last=d.querySelector('#gateLast'),first=d.querySelector('#gateFirst'),em=d.querySelector('#gateEmail'),b=d.querySelector('#gateSave'),m=d.querySelector('#gateMsg');last.value=clean(seed.lastName);first.value=clean(seed.firstName);em.value=email(seed.email);
  function ready(){var ok=clean(last.value).length>=2&&clean(first.value).length>=2&&validEmail(em.value);b.disabled=!ok;b.style.background=ok?'#17a653':'#5a626d';return ok}
  last.addEventListener('input',ready);first.addEventListener('input',ready);em.addEventListener('input',ready);ready();
  b.onclick=async function(){var x={lastName:clean(last.value),firstName:clean(first.value),email:email(em.value)};if(!ready()){m.textContent='Nom, prénom et adresse e-mail valide obligatoires.';return}b.disabled=true;b.textContent='VÉRIFICATION…';m.textContent='';try{var j=await postIdentity(x),identity=persist((j&&j.identity)||x);persistSubscription(j&&j.subscription,identity);var sj=j&&j.subscription||{};if(sj.existingAccount){m.style.color='#72eba5';m.textContent='✅ Abonnement récupéré avec ses jours restants.'}else if(sj.trialMode==='seven_day'){m.style.color='#72eba5';m.textContent='✅ Compte créé — essai de 7 jours activé.'}else{m.style.color='#72eba5';m.textContent='✅ Compte créé — accès gratuit activé pour la période actuelle.'}try{sessionStorage.setItem(HANDOFF,'1')}catch(_){}setTimeout(function(){location.replace(finalSiteUrl())},350)}catch(e){m.style.color='#ff8d8d';if(e&&e.error==='ABONNEMENT_EXISTANT_A_RECUPERER')m.textContent='Cet abonnement existe déjà mais ne peut pas être activé automatiquement avec ces informations. Vérifiez le nom, le prénom et l’adresse e-mail.';else if(e&&e.error==='ESSAI_DEJA_UTILISE')m.textContent='Cet essai gratuit a déjà été utilisé. Un abonnement est nécessaire.';else if(e&&e.error==='IDENTITE_INCOMPLETE')m.textContent='Nom, prénom et adresse e-mail valide obligatoires.';else m.textContent='Impossible d’activer pour le moment. Vérifiez votre connexion et réessayez.'}finally{b.textContent='VALIDER ET OUVRIR COUTEAU SUISSE';ready()}}
}
function clearIncompleteLegacyIdentity(){try{var a=normalize(readJson(KEY)),p=normalize(readJson(PROFILE)),s=normalize(readJson(SUB));if(!complete(a))localStorage.removeItem(KEY);if(!validEmail(p.email)){var rp=readJson(PROFILE)||{};delete rp.email;localStorage.setItem(PROFILE,JSON.stringify(rp))}if(!validEmail(s.email)){var rs=readJson(SUB)||{};delete rs.email;localStorage.setItem(SUB,JSON.stringify(rs))}var re=email(localStorage.getItem('carplay_recovery_email')||'');if(re&&!validEmail(re))localStorage.removeItem('carplay_recovery_email')}catch(_){}}
function boot(){clearIncompleteLegacyIdentity();var x=existing();if(onboardingIdentity()&&!complete(x)){showIdentity(x);return}if(!installed()){if(browserHandoff())return;showInstall();return}if(complete(x)){persist(x);postIdentity(x).then(function(j){persistSubscription(j&&j.subscription,x)}).catch(function(){/* V288 : identité locale valide, on garde l'accès et on resynchronisera plus tard. */});return}showIdentity(x)}
window.CouteauSuisseGetIdentity=function(){var x=existing();return complete(x)?persist(x):null};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
