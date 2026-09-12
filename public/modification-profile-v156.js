(function(){'use strict';
function q(id){return document.getElementById(id)}
function deviceId(){var v=localStorage.getItem('carplay_device_id');if(!v){v=crypto.randomUUID?crypto.randomUUID():'dev-'+Date.now()+'-'+Math.random().toString(36).slice(2);localStorage.setItem('carplay_device_id',v)}return v}
function subCode(){try{var s=JSON.parse(localStorage.getItem('carplay_shared_subscription')||'null');return s&&s.code?String(s.code):''}catch(_){return ''}}
function data(){try{return JSON.parse(localStorage.getItem('market_modification_request')||'null')}catch(_){return null}}
function norm(v){return String(v||'').trim().toLowerCase()}
function show(t,c){var s=q('status');if(!s)return;s.className='status show '+(c||'');s.textContent=t}
function proposal(d){var scope=d.scope;if(scope==='gps')return 'Correction du point GPS';if(scope==='photo')return 'Remplacement de la photo';if(scope==='placer')return Array.from(document.querySelectorAll('input[name=placer]:checked')).map(function(x){return x.value}).join(', ');var v=q('value');if(v)return v.value;var r=document.querySelector('input[name=value]:checked');return r?r.value:''}
function validMail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v||''))}
function message(e){var c=e&&e.error||'';if(c==='COMPTE_ABONNEMENT_INTROUVABLE')return 'Aucun abonnement actif n’a été retrouvé sur ce téléphone.';if(c==='APPAREIL_REMPLACE')return 'Cet abonnement est actif sur un autre téléphone. Utilisez votre code d’abonnement pour récupérer l’abonnement sur ce téléphone.';if(c==='EMAIL_ABONNEMENT_INTROUVABLE')return 'L’adresse e-mail de cet abonnement n’a pas pu être retrouvée. Ouvrez Réglages > Abonnement puis réenregistrez votre adresse e-mail une seule fois.';if(c==='NOM_ET_PRENOM_OBLIGATOIRES')return 'Entrez votre nom et votre prénom une seule fois.';if(c==='ABONNEMENT_EXPIRE')return 'Votre abonnement est expiré.';if(c==='VALEUR_INVALIDE')return 'La modification choisie n’est pas valide.';return 'Demande impossible. Vérifiez votre connexion puis réessayez.'}
async function init(){
  var d=data();if(!d||!q('send'))return;
  var send=q('send'),identity=q('identity'),email=q('email'),last=q('lastName'),first=q('firstName');
  send.disabled=true;show('Récupération de votre compte abonnement…','pending');
  var profile;
  try{
    var r=await fetch('/api/subscription-profile-v156',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:deviceId(),subscriptionCode:subCode()})});
    profile=await r.json();if(!r.ok)throw profile;
  }catch(e){show(message(e),'err');return}
  if(email){email.value=profile.email||'';email.readOnly=true;email.setAttribute('aria-readonly','true');}
  if(first){first.value=profile.firstName||'';first.readOnly=!!profile.nameSaved;}
  if(last){last.value=profile.lastName||'';last.readOnly=!!profile.nameSaved;}
  if(identity){
    var labels=identity.querySelectorAll('.label');
    if(labels[2])labels[2].textContent='Adresse e-mail de votre abonnement';
    var w=identity.querySelector('.warning');if(w)w.textContent='✅ Cette adresse e-mail vient automatiquement de votre abonnement. Vous ne devez pas la retaper.';
  }
  var identityOpen=false;
  function complete(){
    var p=proposal(d),changed=!!p&&norm(p)!==norm(d.currentValue);
    if(!changed){send.disabled=true;return}
    if(profile.nameSaved){send.disabled=false;return}
    if(!identityOpen){send.disabled=false;return}
    send.disabled=!((last&&last.value.trim().length>=2)&&(first&&first.value.trim().length>=2)&&validMail(profile.email));
  }
  document.addEventListener('input',complete);document.addEventListener('change',complete);
  send.onclick=async function(){
    var p=proposal(d);if(!p||norm(p)===norm(d.currentValue)){complete();return}
    if(!profile.nameSaved&&!identityOpen){identityOpen=true;if(identity)identity.classList.add('open');show('Entrez seulement votre nom et votre prénom. Votre e-mail est déjà récupéré depuis votre abonnement.','pending');if(last)last.focus();complete();return}
    var firstName=(first&&first.value||profile.firstName||'').trim(),lastName=(last&&last.value||profile.lastName||'').trim();
    if(firstName.length<2||lastName.length<2){show('Entrez votre nom et votre prénom une seule fois.','err');complete();return}
    send.disabled=true;show('Envoi de la demande à l’administrateur…','pending');
    try{
      var rr=await fetch('/api/gps-unlock-request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({marketKey:d.marketKey,marketName:d.marketName,deviceId:deviceId(),subscriptionCode:subCode(),scope:d.scope,proposedValue:p,currentValue:d.currentValue||'',firstName:firstName,lastName:lastName})});
      var j=await rr.json();if(!rr.ok)throw j;
      profile.firstName=firstName;profile.lastName=lastName;profile.nameSaved=true;if(first)first.readOnly=true;if(last)last.readOnly=true;
      try{localStorage.setItem('carplay_modification_identity',JSON.stringify({lastName:lastName,firstName:firstName}))}catch(_){}
      localStorage.setItem('carplay_pending_market_request',JSON.stringify({id:j.id,marketName:d.marketName,scope:d.scope,createdAt:Date.now()}));
      show('✅ Demande envoyée — réponse généralement sous environ 3 minutes.','pending');
      var until=Date.now()+180000,timer=setInterval(async function(){
        try{var sr=await fetch('/api/gps-unlock-status?id='+encodeURIComponent(j.id)+'&deviceId='+encodeURIComponent(deviceId()),{cache:'no-store'}),sj=await sr.json();
          if(sj.status==='completed'){clearInterval(timer);localStorage.removeItem('carplay_pending_market_request');show('✅ Modification acceptée par l’administrateur et enregistrée.','ok');if(window.CarPlayShowRequestAnswer)window.CarPlayShowRequestAnswer(true)}
          else if(sj.status==='approved'){clearInterval(timer);localStorage.removeItem('carplay_pending_market_request');localStorage.setItem('carplay_approved_market_request',JSON.stringify({marketKey:d.marketKey,scope:d.scope,id:j.id,token:j.token,expiresAt:sj.expiresAt||Date.now()+180000}));show('✅ Autorisation acceptée. Retour à la fiche pour effectuer la modification.','ok');if(window.CarPlayShowRequestAnswer)window.CarPlayShowRequestAnswer(true);setTimeout(function(){location.href=d.returnUrl||'/verification-v9.html'},1600)}
          else if(sj.status==='denied'){clearInterval(timer);localStorage.removeItem('carplay_pending_market_request');show('❌ Demande refusée par l’administrateur.','err');if(window.CarPlayShowRequestAnswer)window.CarPlayShowRequestAnswer(false);send.disabled=false}
          else if(sj.status==='expired'||Date.now()>until){clearInterval(timer);localStorage.removeItem('carplay_pending_market_request');show('La demande a expiré. Vous pouvez la renvoyer.','err');send.disabled=false}
        }catch(_){}
      },2000);
    }catch(e){show(message(e),'err');complete()}
  };
  show(profile.nameSaved?'Votre e-mail, votre nom et votre prénom viennent de votre abonnement.':'Votre e-mail vient de votre abonnement. Votre nom et votre prénom seront enregistrés à votre première demande.','ok');
  complete();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
