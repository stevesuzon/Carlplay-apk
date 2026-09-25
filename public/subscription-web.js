(function () {
  if (window.__carplaySubscriptionWebV471Loaded) return;
  window.__carplaySubscriptionWebV471Loaded = true;
  if ("serviceWorker" in navigator) {
    var swLastCheck = 0;
    var swReloading = false;
    var swHadController = !!navigator.serviceWorker.controller;
    var swReloadKey = "carplay_sw_controller_reload_v308";
    function activateWaiting(registration) {
      if (registration && registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    async function checkForAppUpdate() {
      if (Date.now() - swLastCheck < 30000) return;
      swLastCheck = Date.now();
      try {
        var registration = await navigator.serviceWorker.register("/sw.js?v=330-gpl-favori-verif", { updateViaCache: "none" });
        activateWaiting(registration);
        registration.addEventListener("updatefound", function () {
          var worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", function () {
            if (worker.state === "installed") activateWaiting(registration);
          });
        });
        await registration.update();
        activateWaiting(registration);
      } catch (_) {}
    }
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!swHadController || swReloading) return;
      try { if (sessionStorage.getItem(swReloadKey) === "1") return; } catch (_) {}
      swReloading = true;
      try { sessionStorage.setItem(swReloadKey, "1"); } catch (_) {}
      location.reload();
    });
    addEventListener("load", checkForAppUpdate);
    addEventListener("pageshow", checkForAppUpdate);
    addEventListener("focus", checkForAppUpdate);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) checkForAppUpdate(); });
  }
  var KEY = "carplay_shared_subscription";
  var PAID_KEY = "carplay_paid_activated";
  var EMAIL_KEY = "carplay_recovery_email";
  var IDENTITY_KEY = "carplay_app_identity_v240";
  var FREE_UNTIL_CACHE_KEY = "carplay_contest_app_free_until_ms";
  var FREE_UNTIL_MS = Number(localStorage.getItem(FREE_UNTIL_CACHE_KEY) || 0);
  var FREE_UNTIL_KNOWN = FREE_UNTIL_MS > 0;
  var SNAP_USERNAME = "steve_suzon";
  var SNAP_URL = "https://www.snapchat.com/add/" + SNAP_USERNAME;
  function cleanCode(v) {
    return String(v || "").toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .replace(/[OI]/g, function(c){ return ({O:"Q",I:"L"})[c]; })
      .slice(0, 6);
  }

  // Tant que la date serveur n'a jamais pu être récupérée, on ne coupe pas l'application
  // par erreur. Dès qu'elle a été reçue, elle reste mémorisée sur le téléphone.
  function personalTrialUntil() { return Number(localStorage.getItem('carplay_personal_trial_until_ms') || 0); }
  function trialUntil() { var personal=personalTrialUntil();if(personal>Date.now())return personal;if(!FREE_UNTIL_KNOWN)return 0;return FREE_UNTIL_MS; }
  function freeAccess() { return !FREE_UNTIL_KNOWN || trialUntil() > Date.now(); }
  function storedIdentity(fallback) {
    var identity = null;
    try { identity = JSON.parse(localStorage.getItem(IDENTITY_KEY) || "null"); } catch (_) {}
    identity = identity || fallback || {};
    return {
      firstName: String(identity.firstName || identity.first_name || fallback && (fallback.firstName || fallback.first_name) || "").trim(),
      lastName: String(identity.lastName || identity.last_name || fallback && (fallback.lastName || fallback.last_name) || "").trim(),
      email: String(identity.email || fallback && fallback.email || rememberedEmail() || "").trim().toLowerCase()
    };
  }
  function freeSubscription(real) {
    var identity = storedIdentity(real);
    return {
      ok: true,
      globalFree: true,
      lifetime: false,
      expiresAt: trialUntil() ? new Date(trialUntil()).toISOString() : null,
      firstName: identity.firstName,
      lastName: identity.lastName,
      email: identity.email
    };
  }

  function id() {
    var v = localStorage.getItem("carplay_device_id");
    if (!v) {
      v = crypto.randomUUID ? crypto.randomUUID() : "dev-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      localStorage.setItem("carplay_device_id", v);
    }
    return v;
  }
  function syncContestFreeUntil() {
    fetch("/api/contest/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: id() }),
      cache: "no-store"
    }).then(function (r) { return r.json(); }).then(function (j) {
      var ms = Number(j && j.appFreeUntil || 0);
      if (!ms) return;
      FREE_UNTIL_MS = ms;
      FREE_UNTIL_KNOWN = true;
      try { localStorage.setItem(FREE_UNTIL_CACHE_KEY, String(ms)); } catch (_) {}
      try { window.dispatchEvent(new Event("carplay-free-until-updated")); } catch (_) {}
    }).catch(function () {});
  }
  syncContestFreeUntil();

  function saved() {
    var real = null;
    try { real = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {}
    if (real && valid(real)) return real;
    if (localStorage.getItem(PAID_KEY) === "1") return real;
    if (freeAccess()) return freeSubscription(real);
    return real;
  }
  function valid(s) { return s && (s.lifetime || (s.expiresAt && Date.parse(s.expiresAt) > Date.now())); }
  function unlocked() { return valid(saved()); }
  function detectedType() { return "phone"; }
  function rememberEmail(value) {
    var email=String(value||"").trim().toLowerCase();
    if(!email)return "";
    try{localStorage.setItem(EMAIL_KEY,email)}catch(_){}
    try{document.cookie=EMAIL_KEY+"="+encodeURIComponent(email)+"; Max-Age=31536000; Path=/; SameSite=Lax; Secure"}catch(_){}
    try{var sub=JSON.parse(localStorage.getItem(KEY)||"null");if(sub&&!sub.globalFree){sub.email=email;localStorage.setItem(KEY,JSON.stringify(sub));}}catch(_){}
    return email;
  }
  function rememberedEmail() {
    var email="";
    try{email=localStorage.getItem(EMAIL_KEY)||""}catch(_){}
    if(!email){try{var m=document.cookie.match(new RegExp('(?:^|; )'+EMAIL_KEY+'=([^;]*)'));if(m)email=decodeURIComponent(m[1])}catch(_){}}
    return String(email||"").trim().toLowerCase();
  }
  function showRequestAnswer(approved) {
    var text=approved?"✅ Votre changement a été accepté par l’administrateur.":"❌ Votre changement a été refusé par l’administrateur.";
    var old=document.getElementById("marketRequestAnswer");if(old)old.remove();
    var box=document.createElement("div");box.id="marketRequestAnswer";box.style.cssText="position:fixed;z-index:2147483647;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.82)";box.innerHTML='<div style="width:min(560px,94vw);padding:26px 20px;border:4px solid '+(approved?'#55e58c':'#ff6b6b')+';border-radius:24px;background:#07101d;color:#fff;text-align:center;font:950 22px/1.4 Arial;box-shadow:0 18px 60px #000"><div>'+text+'</div><button type="button" style="width:100%;min-height:62px;margin-top:22px;border:0;border-radius:15px;background:'+(approved?'#168a4e':'#b52f38')+';color:#fff;font:950 21px Arial">OK</button></div>';box.querySelector("button").onclick=function(){box.remove()};document.body.appendChild(box);
    try{if(localStorage.getItem("carplay_notifications_enabled")==="1"&&"serviceWorker" in navigator&&"Notification" in window&&Notification.permission==="granted")navigator.serviceWorker.ready.then(function(r){return r.showNotification(approved?"Changement accepté":"Changement refusé",{body:text,icon:"/couteau-suisse-192.png",badge:"/couteau-suisse-192.png",tag:"market-change-answer"})})}catch(_){}
  }
  window.CarPlayShowRequestAnswer=showRequestAnswer;
  function checkPendingRequest() {
    var pending=null;try{pending=JSON.parse(localStorage.getItem("carplay_pending_market_request")||"null")}catch(_){}
    if(!pending||!pending.id)return;
    fetch("/api/gps-unlock-status?id="+encodeURIComponent(pending.id)+"&deviceId="+encodeURIComponent(id()),{cache:"no-store"}).then(function(r){return r.json()}).then(function(j){if(j.status==="completed"||j.status==="approved"||j.status==="denied"){localStorage.removeItem("carplay_pending_market_request");showRequestAnswer(j.status!=="denied")}else if(j.status==="expired"||j.status==="consumed")localStorage.removeItem("carplay_pending_market_request")}).catch(function(){});
  }
  function messageFor(e) {
    if (e && (e.error === "NOM_ET_PRENOM_OBLIGATOIRES" || e.error === "NOM_PRENOM_OBLIGATOIRES")) return "ÉCRIVEZ VOTRE NOM ET VOTRE PRÉNOM";
    if (e && e.error === "EMAIL_OBLIGATOIRE") return "METTEZ VOTRE ADRESSE E-MAIL AVANT LE CODE, POUR RÉCUPÉRER L’ABONNEMENT SI L’APPLICATION EST EFFACÉE";
    if (e && e.error === "EMAIL_NE_CORRESPOND_PAS") return "CETTE ADRESSE E-MAIL NE CORRESPOND PAS À CET ABONNEMENT";
    if (e && e.error === "IDENTITE_NE_CORRESPOND_PAS") return "LE NOM, LE PRÉNOM ET L’ADRESSE E-MAIL DOIVENT CORRESPONDRE À CET ABONNEMENT";
    if (e && e.error === "EMAIL_NON_CONFIRMEE") return "CONFIRMEZ D’ABORD VOTRE ADRESSE E-MAIL";
    if (e && (e.error === "EMAIL_DEJA_UTILISEE" || e.error === "EMAIL_DEJA_UTILISEE_AUTRE_TELEPHONE")) return "CETTE ADRESSE E-MAIL EST DÉJÀ UTILISÉE SUR UN AUTRE TÉLÉPHONE";
    if (e && e.error === "QUOTA_EMAIL_JOURNALIER") return "LA LIMITE DE 200 E-MAILS DU JOUR EST ATTEINTE. RÉESSAYEZ DEMAIN";
    if (e && e.error === "EMAIL_ENVOI_INDISPONIBLE") return "LE CODE E-MAIL N’A PAS PU ÊTRE ENVOYÉ. RÉESSAYEZ DANS QUELQUES INSTANTS";
    if (e && e.error === "EMAIL_INTROUVABLE") return "AUCUN ABONNEMENT ACTIF N’EST ASSOCIÉ À CETTE ADRESSE E-MAIL";
    if (e && e.error === "CODE_RECUPERATION_NON_INITIALISE") return "CE CODE D’ABONNEMENT NE PEUT PAS ENCORE ÊTRE RENVOYÉ. CONTACTEZ L’ADMINISTRATEUR";
    if (e && e.error === "CODE_EMAIL_TROP_RAPIDE") return "UN CODE VIENT DÉJÀ D’ÊTRE ENVOYÉ. ATTENDEZ UNE MINUTE";
    if (e && e.error === "CODE_EMAIL_EXPIRE") return "LE CODE E-MAIL A EXPIRÉ. RECOMMENCEZ L’ACTIVATION";
    if (e && (e.error === "CODE_EMAIL_INCORRECT" || e.error === "CODE_EMAIL_TROP_ESSAIS")) return "LE CODE REÇU PAR E-MAIL EST INCORRECT";
    if (e && e.error === "ABONNEMENT_EXISTANT_A_RECUPERER") return "UN ABONNEMENT EXISTE DÉJÀ AVEC CETTE ADRESSE — DANS RÉGLAGES > ABONNEMENT, APPUYEZ SUR « ME FAIRE RENVOYER MON CODE D’ABONNEMENT »";
    if (e && e.error === "ESSAI_DEJA_UTILISE") return "VOS 7 JOURS D’ESSAI GRATUIT ONT DÉJÀ ÉTÉ UTILISÉS — UN ABONNEMENT EST MAINTENANT NÉCESSAIRE";
    if (e && e.error === "ABONNEMENT_EXPIRE") return "ABONNEMENT EXPIRÉ — ENTREZ UN NOUVEAU CODE POUR LE RENOUVELER";
    if (e && e.error === "ABONNEMENT_DEJA_A_VIE") return "VOTRE COMPTE POSSÈDE DÉJÀ UN ABONNEMENT À VIE";
    if (e && e.error === "APPAREIL_DEJA_UTILISE") return "CE COMPTE A DÉJÀ UN APPAREIL DE CE TYPE. SI C’EST VOTRE NOUVEAU TÉLÉPHONE OU AUTORADIO, CONFIRMEZ D’ABORD VOTRE E-MAIL SUR CET APPAREIL PUIS RÉESSAYEZ.";
    if (e && e.error === "IDENTITE_INCOMPLETE") return "VÉRIFIEZ LE NOM, LE PRÉNOM ET L’ADRESSE E-MAIL.";
    if (e && e.error === "EMAIL_TROP_RAPIDE") return "UN E-MAIL DE CONFIRMATION VIENT DÉJÀ D’ÊTRE ENVOYÉ. REGARDEZ VOTRE BOÎTE MAIL.";
    if (e && e.error === "EMAIL_CONFIRMATION_ENVOYEE") return "✅ E-MAIL DE CONFIRMATION ENVOYÉ. OUVREZ LE LIEN REÇU, PUIS REVENEZ DANS L’APPLICATION.";
    if (e && e.error === "DB_NON_CONFIGUREE") return "LE SERVEUR DE COMPTE EST MOMENTANÉMENT INDISPONIBLE. RÉESSAYEZ.";
    if (e && e.error) return "ERREUR DU COMPTE : "+String(e.error).replace(/_/g," ");
    return navigator.onLine===false?"PAS DE CONNEXION INTERNET.":"LE SERVEUR N’A PAS RÉPONDU. RÉESSAYEZ.";
  }
  function confirmEmail(email, done, failed) {
    email=String(email||"").trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){failed({error:"EMAIL_OBLIGATOIRE"});return;}
    rememberEmail(email);
    done({ok:true,email:email,emailProof:"adresse-confirmee"});
  }
  function ensureServerIdentityV407(email,firstName,lastName,done,failed){
    email=String(email||"").trim().toLowerCase();
    firstName=String(firstName||"").trim().replace(/\s+/g," ");
    lastName=String(lastName||"").trim().replace(/\s+/g," ");
    var payload={email:email,firstName:firstName,lastName:lastName,deviceId:id(),platform:detectedType()};
    fetch("/api/app-identity/status",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:email,deviceId:id()})})
      .then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j;});})
      .then(function(st){
        if(st&&st.verified){done(st);return;}
        return fetch("/api/app-identity/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)})
          .then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j;});})
          .then(function(j){failed({error:"EMAIL_CONFIRMATION_ENVOYEE",emailMask:j&&j.emailMask||email});});
      }).catch(failed);
  }
  function updateActiveSubscriptionEmail(email, firstName, lastName, done, failed) {
    email=String(email||"").trim().toLowerCase();
    firstName=String(firstName||"").trim().replace(/\s+/g," ");
    lastName=String(lastName||"").trim().replace(/\s+/g," ");
    if(firstName.length<2||lastName.length<2){failed({error:"NOM_PRENOM_OBLIGATOIRES"});return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){failed({error:"EMAIL_OBLIGATOIRE"});return;}
    var real=null;try{real=JSON.parse(localStorage.getItem(KEY)||"null")}catch(_){}
    if(!real||real.globalFree||!valid(real)){real=real||{};ensureServerIdentityV407(email,firstName,lastName,function(){fetch("/api/contest/trial-identity",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:email,firstName:firstName,lastName:lastName,deviceId:id()})}).then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j;});}).then(function(j){real.globalFree=true;real.expiresAt=j.expiresAt||real.expiresAt;real.email=j.email||email;real.firstName=j.firstName||firstName;real.lastName=j.lastName||lastName;localStorage.setItem(KEY,JSON.stringify(real));rememberEmail(real.email);done(j);}).catch(failed);},failed);return;}
    fetch("/api/subscription-email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:email,firstName:firstName,lastName:lastName,deviceId:id(),code:real&&real.code||""})})
      .then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j;});})
      .then(function(j){if(j&&j.switchRequired){done(j);return;}real.email=j.email||email;real.firstName=j.firstName||firstName;real.lastName=j.lastName||lastName;localStorage.setItem(KEY,JSON.stringify(real));rememberEmail(real.email);done(j);})
      .catch(failed);
  }
  function sendRecoveryCode(email, firstName, lastName, button, done, failed) {
    email=String(email||"").trim().toLowerCase();
    firstName=String(firstName||"").trim().replace(/\s+/g," ");
    lastName=String(lastName||"").trim().replace(/\s+/g," ");
    if(firstName.length<2||lastName.length<2){failed({error:"NOM_ET_PRENOM_OBLIGATOIRES"});return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){failed({error:"EMAIL_OBLIGATOIRE"});return;}
    var oldText=button.textContent;
    button.disabled=true;
    button.textContent="ENVOI EN COURS…";
    fetch("/api/recover-code",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({email:email,firstName:firstName,lastName:lastName,deviceId:id()})
    }).then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j;});})
      .then(function(j){rememberEmail(email);done(j);})
      .catch(failed)
      .finally(function(){button.disabled=false;button.textContent=oldText;});
  }

  function sendSwitchRecoveryCode(email, done, failed) {
    email=String(email||"").trim().toLowerCase();
    fetch("/api/recover-code",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:email,deviceId:id()})})
      .then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j;});})
      .then(done).catch(failed);
  }
  function activate(code, email, emailProof, firstName, lastName, deviceType, done, failed) {
    fetch("/api/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code, email: email, emailProof:emailProof, firstName:firstName, lastName:lastName, deviceId: id(), deviceType: deviceType })
    }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw j; return j; });
    }).then(function (j) {
      j.code = code;
      j.email = email;
      rememberEmail(email);
      localStorage.setItem(KEY, JSON.stringify(j));
      localStorage.setItem(PAID_KEY, "1");
      done(j);
    }).catch(failed);
  }
  function verifySaved(done) {
    var s = saved();
    if (s && s.globalFree && freeAccess()) { done(); return; }
    if (!s || !s.code || !valid(s)) { done(); return; }
    fetch("/api/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: s.code, deviceId: id(), deviceType: "phone" })
    }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw j; return j; });
    }).then(function (j) {
      j.code = s.code;
      j.email = j.email || s.email || rememberedEmail();
      if (j.email) rememberEmail(j.email);
      localStorage.setItem(KEY, JSON.stringify(j));
      done();
    }).catch(function (e) {
      if (e && (e.error === "APPAREIL_REMPLACE" || e.error === "ABONNEMENT_EXPIRE" || e.error === "CODE_INCORRECT")) localStorage.removeItem(KEY);
      done();
    });
  }

  function lockModal(feature) {
    if (document.getElementById("subscriptionGate")) return;
    var box = document.createElement("div");
    box.id = "subscriptionGate";
    box.innerHTML = '<div class="sub-card"><button class="sub-close" aria-label="Fermer">×</button><h1>🔒 ABONNEMENT REQUIS</h1><p style="margin:8px 0 4px">Votre période d’essai est terminée.</p><div style="margin:14px 0;padding:14px;border:2px solid #f39b19;border-radius:16px;background:#15100a"><div style="font:950 28px Arial;color:#ffd166">ABONNEMENT : 30 €</div><div style="margin-top:7px;font:900 16px/1.35 Arial;color:#fff">Pour déverrouiller l’application, contactez Steve Suzon sur Snapchat.</div></div><div style="font:950 21px Arial;color:#59d4ff;margin:10px 0">👻 Snapchat : '+SNAP_USERNAME+'</div><a id="openSnapchatSubscription" href="'+SNAP_URL+'" target="_blank" rel="noopener" style="box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:100%;min-height:62px;margin-top:14px;border-radius:15px;background:#fffc00;color:#000;text-decoration:none;font:950 20px Arial">👻 OUVRIR SNAPCHAT</a><button id="closeSubscriptionGate" type="button" style="width:100%;min-height:54px;margin-top:10px;border:0;border-radius:14px;background:#293448;color:#fff;font:900 17px Arial">FERMER</button></div>';
    document.documentElement.appendChild(box);
    function closeGate(){box.remove();if(location.pathname!=="/"&&location.pathname!=="/index.html")history.back();}
    var close=box.querySelector(".sub-close"),close2=box.querySelector("#closeSubscriptionGate");
    if(close)close.onclick=closeGate;
    if(close2)close2.onclick=closeGate;
  }

  function addLock(target, text) {
    if (!target || target.querySelector(".feature-lock")) return;
    target.style.position = "relative";
    var badge = document.createElement("div");
    badge.className = "feature-lock";
    badge.textContent = "🔒 " + text;
    target.appendChild(badge);
  }

  function applyAddressReadOnly() {
    if (unlocked()) return;
    window.CarPlayAddressReadOnly = true;
    if (document.body) document.body.classList.add("subscription-address-readonly");
    if (!document.getElementById("subscriptionAddressReadOnlyStyle")) {
      var st=document.createElement("style");
      st.id="subscriptionAddressReadOnlyStyle";
      st.textContent='body.subscription-address-readonly #addressBookAdd,body.subscription-address-readonly #addressAddSection,body.subscription-address-readonly .savedAddressActions{display:none!important}body.subscription-address-readonly #addressCreatorModal:before{content:"🔒 CARNET EN LECTURE SEULE — vos anciennes adresses restent consultables";display:block;position:fixed;z-index:2147483647;left:50%;top:10px;transform:translateX(-50%);width:min(720px,92vw);box-sizing:border-box;padding:9px 12px;border:2px solid #61ddff;border-radius:12px;background:#07111dee;color:#fff;text-align:center;font:900 12px/1.25 Arial;pointer-events:none}';
      document.head.appendChild(st);
    }
  }

  function featureName(t) {
    if (!t) return "Cette fonction";
    if (t.id === "contactMailButton") return "Mail";
    if (t.id === "housePhotoButton") return "Mesurer une maison";
    if (t.id === "nearby80Button") return "Marchés à moins de 80 km";
    if (t.matches && t.matches(".card.blue")) return "Marchés";
    if (t.matches && t.matches(".directBtn.place")) return "Mes papiers";
    if (t.matches && t.matches(".directBtn.docs")) return "Démarches pro";
    if (t.matches && t.matches(".small.green")) return "Retourner sur la place";
    if (t.matches && t.matches(".small.red")) return "Effacer l’emplacement";
    return "Cette fonction";
  }

  function protectFeatures() {
    if (unlocked()) return;
    applyAddressReadOnly();
    var selectors="#contactMailButton,#housePhotoButton,#nearby80Button,.card.blue,.directBtn.place,.directBtn.docs,.small.green,.small.red";
    document.querySelectorAll(selectors).forEach(function (el) { addLock(el, "VERROUILLÉ"); });
    document.addEventListener("click", function (e) {
      if (unlocked()) return;
      var allowed=e.target.closest?e.target.closest("#settings,.gear,#directArticle,#directArticleModal,#homeAddressBookBtn,#addressCountryChooser,#addressCreatorModal,#subscriptionGate"):null;
      if (allowed) return;
      var p=location.pathname.toLowerCase();
      if (p!=="/"&&p!=="/index.html") return;
      var t=e.target.closest?e.target.closest("a,button,.card,.small,.directBtn,[onclick]"):null;
      if(!t)return;
      e.preventDefault();e.stopImmediatePropagation();lockModal(featureName(t));
    }, true);
  }

  function blockDirectMarketPage() {
    if (unlocked()) return;
    var p = location.pathname.toLowerCase();
    if (p === "/" || p === "/index.html" || p.indexOf("admin") !== -1) return;
    var blocked = ["march", "coin-de-chine", "documents-travail", "mes-papiers", "verification", "modification-demande", "special", "traveller", "ou-trouver-place", "nearby"];
    if (blocked.some(function(k){return p.indexOf(k)!==-1;})) lockModal("Cette fonction");
  }

  function cleanupOldSettingDuplicates(settings, keepPanel) {
    if (!settings) return;
    var rows = settings.querySelectorAll(".settingRow");
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row === keepPanel) continue;
      var head = row.querySelector(".settingHead");
      var label = String(head ? head.textContent : row.textContent || "").toUpperCase().replace(/\s+/g, " ").trim();
      var isOldInfo = label.indexOf("INFOS") !== -1 && label.indexOf("INFORMATIONS ET CONTACT") === -1;
      var isOldRenew = label.indexOf("RENOUVELER ABONNEMENT") !== -1 || label.indexOf("RENOUVELER L’ABONNEMENT") !== -1 || label.indexOf("RENOUVELER L'ABONNEMENT") !== -1;
      if (isOldInfo || isOldRenew) row.remove();
    }
  }

  function addAdminMessageCounter() {
    if(localStorage.getItem("carplay_admin_here")!=="1")return;
    var settings=document.getElementById("settings"),secret=localStorage.getItem("carplay_admin_secret")||"";
    if(!settings||!secret)return;

    if(!document.getElementById('adminPendingInlineStyleV312')){
      var st=document.createElement('style');st.id='adminPendingInlineStyleV312';st.textContent='\
#adminMessageCounter .settingBody{max-height:68vh;overflow:auto;padding:10px}\
.adminPendingStatus{padding:10px;border-radius:11px;background:#0a1422;color:#dbe7f6;font-weight:850;font-size:13px;text-align:center;margin-bottom:8px}\
.adminPersonMini{margin:8px 0;border:1px solid #ffffff2b;border-radius:13px;background:#121d2b;overflow:hidden}\
.adminPersonMiniHead{width:100%;min-height:58px;border:0!important;border-radius:0!important;background:#1d2b40!important;color:#fff!important;margin:0!important;padding:11px 12px!important;display:flex;align-items:center;justify-content:space-between;gap:9px;text-align:left}\
.adminPersonMiniName{display:block;font-size:16px;font-weight:950}.adminPersonMiniEmail{display:block;margin-top:3px;color:#adc1d9;font-size:11px;font-weight:800;word-break:break-all}\
.adminPersonMiniCount{flex:0 0 auto;background:#2f4260;color:#fff;border-radius:9px;padding:6px 8px;font-size:11px;font-weight:950}\
.adminPersonMiniItems{display:none;padding:8px}.adminPersonMiniItems.open{display:block}\
.adminReqMini{margin:7px 0;border:1px solid #4f6687;border-radius:11px;background:#0a111b;overflow:hidden}.adminReqMiniHead{width:100%;min-height:48px;border:0!important;border-radius:0!important;background:#132238!important;color:#fff!important;margin:0!important;padding:9px 10px!important;display:flex;justify-content:space-between;gap:8px;align-items:center;text-align:left;font-size:13px!important}.adminReqMiniPts{color:#74efa6;font-weight:950;white-space:nowrap}.adminReqMiniDetail{display:none;padding:10px;color:#dbe7f6;font-size:13px;line-height:1.45}.adminReqMiniDetail.open{display:block}.adminReqMiniDetail a{color:#71cfff;font-weight:900}.adminReqActions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:10px}.adminReqActions button{min-height:42px!important;margin:0!important;padding:8px!important;font-size:12px!important;color:#fff!important}.adminReqYes{background:#168447!important}.adminReqNo{background:#b4323b!important}.adminReqOne{grid-template-columns:1fr}.adminRecentTitle{margin:14px 2px 6px;color:#a9bed5;font-size:12px;font-weight:950}.adminRecentMini{margin:6px 0;padding:9px 10px;border:1px solid #35d06f;border-radius:11px;background:#0d1b15}.adminRecentMini b{display:block}.adminRecentMini small{display:block;color:#a9bed5;word-break:break-all;margin-top:2px}.adminRecentGain{display:block;margin-top:4px;color:#70efa4;font-weight:950;font-size:13px}\
';document.head.appendChild(st);
    }

    var row=document.getElementById("adminMessageCounter");
    if(!row){
      row=document.createElement("div");row.className="settingRow";row.id="adminMessageCounter";
      row.innerHTML='<button class="settingHead" type="button"><span>✅ VOUS AVEZ <b>0</b> DEMANDE À CONTRÔLER</span><span>⌄</span></button><div class="settingBody" id="adminPendingInline"><div class="adminPendingStatus">Chargement des demandes…</div></div>';
      var a=document.getElementById("adminSettingRow");if(a)a.parentNode.insertBefore(row,a.nextSibling);else settings.appendChild(row);
    }
    var head=row.querySelector('.settingHead'),bodyEl=row.querySelector('#adminPendingInline');

    function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
    function fmt(v){var n=Math.round(((Number(v)||0)+Number.EPSILON)*100)/100;return n.toFixed(2).replace(/0+$/,'').replace(/[.,]$/,'').replace('.',',')}
    function personName(x){return String(((x&&x.first_name)||'')+' '+((x&&x.last_name)||'')).trim()||String((x&&x.requester_name)||'').trim()||'Utilisateur'}
    function personEmail(x){return String((x&&x.email)||(x&&x.requester_email)||'').trim()}
    function pkey(x){var e=personEmail(x).toLowerCase();if(e)return 'e:'+e;var sid=Number(x&&x.subscription_id||0);if(sid)return 's:'+sid;var d=String(x&&x.device_id||'').trim();if(d)return 'd:'+d;return 'n:'+personName(x).toLowerCase()}
    function labelsGps(x){var z={time:'Horaire du marché',count:'Nombre de commerçants',draw:'Tirage au sort',welcome:'Humeur du placier',placer:'Responsable / placier',clientModel:'Modèle de clients',exists:'Existence du marché',photo:'Photo du marché',gps:'Position GPS'};return z[x.scope]||'Modification du marché'}
    function add(items,x,kind,detail,points,actionType){items.push({key:pkey(x),name:personName(x),email:personEmail(x),t:Number(x.created_at||x.requested_at||0),kind:kind,detail:detail,points:Number(points||0),actionType:actionType||'',id:String(x.id||'')})}

    function requestDetailHtml(it){
      return '<div>'+it.detail+'</div>'+(it.points>0?'<div style="margin-top:7px;color:#70efa4;font-weight:950">Points concernés : +'+fmt(it.points)+' pt</div>':'')+actionHtml(it);
    }
    function actionHtml(it){
      if(!it.actionType)return '';
      if(it.actionType==='app-message')return '<div class="adminReqActions adminReqOne"><button class="adminReqYes" data-admin-action="message-close" data-admin-id="'+esc(it.id)+'">VALIDER / FERMER</button></div>';
      if(it.actionType==='travel')return '<div class="adminReqActions"><button class="adminReqYes" data-admin-action="travel-question" data-admin-id="'+esc(it.id)+'">ENVOYER LA QUESTION</button><button class="adminReqNo" data-admin-action="travel-close" data-admin-id="'+esc(it.id)+'">FERMER</button></div>';
      var yesLabel='CONFIRMER',noLabel='REFUSER';
      if(it.actionType==='review'||it.actionType==='mushroom'){yesLabel='CONFIRMER LA FICHE';noLabel='REFUSER / RETIRER LES POINTS'}
      if(it.actionType==='report'){yesLabel='CONFIRMER LE BUG / IDÉE';noLabel='REFUSER'}
      if(it.actionType==='commune'){yesLabel='AUTORISER';noLabel='REFUSER'}
      if(it.actionType==='gps'){yesLabel='OUI — VALIDER';noLabel='NON — REFUSER'}
      return '<div class="adminReqActions"><button class="adminReqYes" data-admin-action="approve" data-admin-type="'+esc(it.actionType)+'" data-admin-id="'+esc(it.id)+'">'+yesLabel+'</button><button class="adminReqNo" data-admin-action="deny" data-admin-type="'+esc(it.actionType)+'" data-admin-id="'+esc(it.id)+'">'+noLabel+'</button></div>';
    }

    function render(items,recent){
      var groups={},order=[];
      items.sort(function(a,b){return b.t-a.t}).forEach(function(it){if(!groups[it.key]){groups[it.key]={name:it.name,email:it.email,items:[],t:it.t};order.push(it.key)}groups[it.key].items.push(it);if(!groups[it.key].email&&it.email)groups[it.key].email=it.email});
      var html='<div class="adminPendingStatus">Appuyez sur une personne, puis sur une demande pour vérifier la fiche ou le bug avant de confirmer.</div>';
      if(!order.length)html+='<div class="adminPendingStatus">✅ Aucune demande en attente.</div>';
      order.forEach(function(key,gi){var g=groups[key],gid='admgrp'+gi;html+='<div class="adminPersonMini"><button class="adminPersonMiniHead" data-admin-group="'+gid+'"><span><span class="adminPersonMiniName">'+esc(g.name)+'</span>'+(g.email?'<span class="adminPersonMiniEmail">'+esc(g.email)+'</span>':'')+'</span><span class="adminPersonMiniCount">'+g.items.length+' demande'+(g.items.length>1?'s':'')+'</span></button><div class="adminPersonMiniItems" id="'+gid+'">';g.items.forEach(function(it,ri){var rid=gid+'r'+ri;html+='<div class="adminReqMini"><button class="adminReqMiniHead" data-admin-request="'+rid+'"><span>'+esc(it.kind)+'</span>'+(it.points>0?'<span class="adminReqMiniPts">+'+fmt(it.points)+' pt</span>':'')+'</button><div class="adminReqMiniDetail" id="'+rid+'">'+requestDetailHtml(it)+'</div></div>'});html+='</div></div>'});
      var rv=(recent||[]).filter(function(x){return Number(x.points||0)>0}).slice(0,10);
      if(rv.length){html+='<div class="adminRecentTitle">DERNIÈRES FICHES CONFIRMÉES</div>';rv.forEach(function(x){var n=personName(x),e=personEmail(x);html+='<div class="adminRecentMini"><b>'+esc(n)+'</b>'+(e?'<small>'+esc(e)+'</small>':'')+'<span class="adminRecentGain">'+esc(n)+' a gagné '+fmt(x.points)+' pt — '+esc(x.kind||'Fiche confirmée')+'</span></div>'})}
      bodyEl.innerHTML=html;
      Array.prototype.forEach.call(bodyEl.querySelectorAll('[data-admin-group]'),function(b){b.onclick=function(){var x=document.getElementById(b.getAttribute('data-admin-group'));if(x)x.classList.toggle('open')}});
      Array.prototype.forEach.call(bodyEl.querySelectorAll('[data-admin-request]'),function(b){b.onclick=function(){var x=document.getElementById(b.getAttribute('data-admin-request'));if(x)x.classList.toggle('open')}});
      Array.prototype.forEach.call(bodyEl.querySelectorAll('[data-admin-action]'),function(b){b.onclick=function(ev){ev.stopPropagation();runAction(b)}});
    }

    function fullRefresh(){
      bodyEl.innerHTML='<div class="adminPendingStatus">Chargement des demandes…</div>';
      var h={authorization:'Bearer '+secret};
      Promise.all([
        fetch('/api/admin/gps-unlock-requests',{headers:h,cache:'no-store'}).then(function(r){return r.ok?r.json():{requests:[]}}),
        fetch('/api/admin/contest',{headers:h,cache:'no-store'}).then(function(r){return r.ok?r.json():{reviews:[],mushrooms:[],reports:[],communes:[],alerts:[],recentValidated:[]}}),
        fetch('/api/admin/app-messages',{headers:h,cache:'no-store'}).then(function(r){return r.ok?r.json():{messages:[]}})
      ]).then(function(x){
        var gps=x[0].requests||[],c=x[1]||{},msgs=x[2].messages||[],items=[];
        gps.forEach(function(v){add(items,v,'MODIFICATION MARCHÉ','E-mail : <b>'+esc(personEmail(v)||'—')+'</b><br>Demande : <b>'+esc(labelsGps(v))+'</b><br>Marché : <b>'+esc(v.market_name||'Marché')+'</b>'+(v.current_value?'<br>Valeur actuelle : <b>'+esc(v.current_value)+'</b>':'')+(v.proposed_value?'<br>Nouvelle valeur : <b>'+esc(v.proposed_value)+'</b>':''),0,'gps')});
        (c.reviews||[]).forEach(function(v){add(items,v,'FICHE CONCOURS — MARCHÉ','E-mail : <b>'+esc(personEmail(v)||'—')+'</b><br>Marché : <b>'+esc(v.market_name||'Marché')+'</b><br>Lieu : <b>'+esc(v.place_label||'—')+'</b><br>Distance : <b>'+fmt(v.distance_km)+' km</b>'+(v.market_key?'<br><a href="/api/market-photo?marketKey='+encodeURIComponent(v.market_key)+'" target="_blank" rel="noopener">📷 VOIR LA PHOTO AVANT DE CONFIRMER</a>':''),Number(v.points||0),'review')});
        (c.mushrooms||[]).forEach(function(v){add(items,v,'FICHE CHAMPIGNONS','E-mail : <b>'+esc(personEmail(v)||'—')+'</b><br>Bois : <b>'+esc(v.wood_name||'Bois signalé')+'</b><br>Champignon : <b>'+esc(v.species||'—')+'</b>'+(v.photo_url?'<br><a href="'+esc(v.photo_url)+'" target="_blank" rel="noopener">📷 VOIR LA PHOTO AVANT DE CONFIRMER</a>':''),Number(v.awarded_points||v.base_points||0),'mushroom')});
        (c.reports||[]).forEach(function(v){var idea=String(v.kind||'')==='idee';add(items,v,idea?'IDÉE CONCOURS':'BUG / PROBLÈME','E-mail : <b>'+esc(personEmail(v)||'—')+'</b><br>Type : <b>'+esc(idea?'IDÉE':'BUG / PROBLÈME')+'</b><br><br>'+esc(v.description||'').replace(/\n/g,'<br>'),idea?0:153,'report')});
        (c.communes||[]).forEach(function(v){add(items,v,'CHANGEMENT DE COMMUNE','E-mail : <b>'+esc(personEmail(v)||'—')+'</b><br>Commune actuelle : <b>'+esc((v.home_commune||'')+' '+(v.home_area||''))+'</b>',0,'commune')});
        (c.alerts||[]).forEach(function(v){add(items,v,'ALERTE DÉPLACEMENT','E-mail : <b>'+esc(personEmail(v)||'—')+'</b><br>Avant : <b>'+esc(v.previous_place||'—')+'</b><br>Nouveau lieu : <b>'+esc(v.new_place||'—')+'</b>',0,'travel')});
        msgs.forEach(function(v){add(items,v,String(v.kind||'MESSAGE').toUpperCase(),'E-mail : <b>'+esc(personEmail(v)||'—')+'</b><br>Adresse : <b>'+esc(v.address||'—')+'</b><br><br>'+esc(v.message||'').replace(/\n/g,'<br>'),0,'app-message')});
        render(items,c.recentValidated||[]);
      }).catch(function(){bodyEl.innerHTML='<div class="adminPendingStatus">⚠️ Chargement impossible. Réessayez.</div>'});
    }

    function runAction(btn){
      var action=btn.getAttribute('data-admin-action'),id=btn.getAttribute('data-admin-id')||'',type=btn.getAttribute('data-admin-type')||'',url='',payload={};
      if(action==='message-close'){url='/api/admin/app-messages';payload={id:id}}
      else if(action==='travel-question'||action==='travel-close'){url='/api/admin/contest/action';payload={type:action,id:id}}
      else if(type==='gps'){url='/api/admin/gps-unlock-requests';payload={id:id,approve:action==='approve'}}
      else{url='/api/admin/contest/action';payload={type:type,id:id,approve:action==='approve'}}
      if(!url)return;
      btn.disabled=true;bodyEl.querySelector('.adminPendingStatus').textContent='Enregistrement de votre décision…';
      fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:JSON.stringify(payload)}).then(function(r){return r.json().then(function(j){if(!r.ok||!j.ok)throw new Error(j.error||'Action impossible');return j})}).then(function(j){var pts=Number(j.awardedPoints||j.keptPoints||0),removed=Number(j.retractedPoints||0),total=Number(j.newTotalPoints);if(action==='approve'){bodyEl.querySelector('.adminPendingStatus').textContent=pts>0?'✅ Confirmé : '+fmt(pts)+' points. La personne reçoit la notification de confirmation.':'✅ Confirmé. La personne reçoit la notification correspondante.'}else if(removed>0){bodyEl.querySelector('.adminPendingStatus').textContent='❌ Demande refusée : '+fmt(removed)+' points retirés de cette fiche'+(Number.isFinite(total)?'. Total utilisateur : '+fmt(total)+' pt.':'.')+' La personne reçoit la notification de refus.'}else{bodyEl.querySelector('.adminPendingStatus').textContent='❌ Demande refusée. La personne reçoit la notification de refus.'}setTimeout(function(){fullRefresh();refresh()},700)}).catch(function(e){btn.disabled=false;bodyEl.querySelector('.adminPendingStatus').textContent='⚠️ '+(e.message||'Action impossible')});
    }

    head.onclick=function(){
      var open=bodyEl.classList.contains('open');
      Array.prototype.forEach.call(document.querySelectorAll('.settingBody'),function(x){x.classList.remove('open')});
      Array.prototype.forEach.call(document.querySelectorAll('.settingHead span:last-child'),function(x){x.textContent='⌄'});
      if(!open){bodyEl.classList.add('open');var a=head.querySelector('span:last-child');if(a)a.textContent='⌃';fullRefresh()}
    };

    function refresh(){
      Promise.all([
        fetch("/api/admin/app-messages",{headers:{authorization:"Bearer "+secret},cache:"no-store"}).then(function(r){return r.ok?r.json():{messages:[]}}),
        fetch("/api/admin/contest?mode=pending-summary",{headers:{authorization:"Bearer "+secret},cache:"no-store"}).then(function(r){return r.ok?r.json():{pendingCount:0,latest:null}}),
        fetch("/api/admin/gps-unlock-requests",{headers:{authorization:"Bearer "+secret},cache:"no-store"}).then(function(r){return r.ok?r.json():{requests:[]}})
      ]).then(function(x){
        var c=x[1]||{},items=[];
        (x[0].messages||[]).forEach(function(v){items.push({t:Number(v.created_at||0),name:personName(v),kind:String(v.kind||'Message')})});
        if(c.latest)items.push({t:Number(c.latest.created_at||0),name:personName(c.latest),kind:String(c.latest.kind||'Concours')});
        (x[2].requests||[]).forEach(function(v){items.push({t:Number(v.requested_at||v.created_at||0),name:personName(v),kind:'Modification marché'})});
        items.sort(function(a,b){return b.t-a.t});var n=(x[0].messages||[]).length+Number(c.pendingCount||0)+(x[2].requests||[]).length,latest=items[0]||null,span=row.querySelector("span");
        span.innerHTML='✅ VOUS AVEZ <b>'+n+'</b> DEMANDE'+(n>1?'S':'')+' À CONTRÔLER'+(latest?' — <small style="display:block;margin-top:4px">Dernière : '+esc(latest.name)+'</small>':'');
        if(latest&&latest.t){var key=latest.t+'|'+latest.name+'|'+latest.kind,oldKey=localStorage.getItem('carplay_admin_pending_latest_v312')||'';if(oldKey&&oldKey!==key&&localStorage.getItem('carplay_notifications_enabled')==='1'&&'Notification'in window&&Notification.permission==='granted'&&'serviceWorker'in navigator){navigator.serviceWorker.ready.then(function(reg){return reg.showNotification('✅ '+latest.name+' — nouvelle demande',{body:latest.kind+'. Ouvrez les réglages pour vérifier la fiche avant de confirmer.',icon:'/couteau-suisse-v283-192.png?v=283',badge:'/couteau-suisse-v283-192.png?v=283',tag:'admin-pending-'+latest.t,renotify:true,data:{url:'/#settings'}})}).catch(function(){})}localStorage.setItem('carplay_admin_pending_latest_v312',key)}
      }).catch(function(){});
    }
    refresh();
    if(!window.__carplayAdminCounterTimer)window.__carplayAdminCounterTimer=setInterval(function(){if(!document.hidden)refresh()},60000);
  }

  function settingsPanel() {
    var settings = document.getElementById("settings");
    if (!settings) return;
    var existingPanel = document.getElementById("subscriptionSettings");
    if (existingPanel) { cleanupOldSettingDuplicates(settings, existingPanel); return; }
    var panel = document.createElement("div");
    panel.className = "settingRow";
    panel.id = "subscriptionSettings";
    var s = saved();
    var isActive = valid(s);
    var remaining = isActive && !s.lifetime ? Math.max(0, Math.ceil((Date.parse(s.expiresAt) - Date.now()) / 86400000)) : 0;
    var state = isActive ? "ACTIF" : "DÉSACTIVÉ";
    var days = isActive ? (s.lifetime ? "ABONNEMENT À VIE" : remaining + " JOUR" + (remaining > 1 ? "S" : "") + " RESTANT" + (remaining > 1 ? "S" : "")) : "0 JOUR RESTANT";
    var end = isActive ? (s.lifetime ? "AUCUNE DATE DE FIN" : "FIN LE " + new Date(s.expiresAt).toLocaleDateString("fr-FR")) : "FONCTIONS VERROUILLÉES";
    panel.innerHTML = '<div class="settingHead"><span>🔐 ABONNEMENT</span><span>⌄</span></div><div class="settingBody"><div class="sub-current-status" style="margin:4px 0 12px;padding:12px;border:2px solid '+(isActive?'#44d17a':'#ff5a5a')+';border-radius:13px;background:#0b1522;text-align:center;font-weight:950"><div style="font-size:19px">'+state+'</div><div style="margin-top:4px">'+days+'</div><div style="margin-top:4px;font-size:13px;color:#d8e0eb">'+end+'</div></div><a href="https://www.snapchat.com/add/steve_suzon" target="_blank" rel="noopener" style="display:block;margin:0 0 12px;padding:11px;border:2px solid #fffc00;border-radius:12px;background:#272500;color:#fff;text-align:center;text-decoration:none;font:900 14px/1.35 Arial">Pour commander un code : contactez <b>steve_suzon</b> sur Snapchat.<br><strong style="color:#ffdc47">30 € — code valable un an</strong></a><div class="sub-settings"><label><b>1. NOM ET PRÉNOM OBLIGATOIRES</b></label><div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:6px 0 12px"><input class="sub-setting-last-name" type="text" autocomplete="family-name" maxlength="60" placeholder="Nom"><input class="sub-setting-first-name" type="text" autocomplete="given-name" maxlength="60" placeholder="Prénom"></div><label class="sub-setting-email-label"><b>2. ÉCRIVEZ VOTRE ADRESSE E-MAIL COMPLÈTE</b></label><input class="sub-setting-email sub-full-email" type="email" inputmode="email" autocomplete="email" placeholder="Exemple : prenom.nom@gmail.com"><div class="sub-setting-confirmed sub-email-complete" style="display:none;color:#55e58c;font-weight:900;margin:7px 0"></div><div class="sub-setting-warning" style="display:none;font-size:12px;color:#ffd166;margin:4px 0 9px">⚠️ Attention : si l’adresse e-mail est incorrecte, aucune récupération du compte ne sera possible.</div><button class="sub-setting-confirm-email" type="button">CONFIRMER LES INFORMATIONS</button><button class="sub-setting-change-email" type="button" style="display:none">MODIFIER MES INFORMATIONS</button><button class="sub-setting-recover-code" type="button">ME FAIRE RENVOYER MON CODE D’ABONNEMENT</button><small class="sub-recovery-help">Application effacée ou nouveau téléphone ? Renseignez le même nom, prénom et la même adresse e-mail : votre code d’abonnement actuel vous sera renvoyé par e-mail. En le saisissant, vous récupérez exactement l’abonnement déjà existant et le nombre de jours qu’il lui restait — aucune nouvelle période ne remplace l’ancienne.</small><label><b>3. ENTREZ VOTRE CODE D’ABONNEMENT</b></label><input class="sub-setting-code" inputmode="text" autocapitalize="characters" maxlength="6" placeholder="CODE 6 LETTRES / CHIFFRES"><button class="sub-setting-activate">ACTIVER / CHANGER MON CODE</button><div class="sub-settings-message"></div></div></div>'
    var emailField=panel.querySelector('.sub-setting-email'),firstNameField=panel.querySelector('.sub-setting-first-name'),lastNameField=panel.querySelector('.sub-setting-last-name'),emailProof='',identitySeed=storedIdentity(s||{});
    if(emailField&&!emailField.value){emailField.value=identitySeed.email||rememberedEmail()||(s&&s.email)||'';}
    if(firstNameField)firstNameField.value=identitySeed.firstName||(s&&s.firstName)||'';
    if(lastNameField)lastNameField.value=identitySeed.lastName||(s&&s.lastName)||'';
    function showConfirmed(email){emailProof='adresse-confirmee';emailField.value=email;if(firstNameField)firstNameField.disabled=true;if(lastNameField)lastNameField.disabled=true;emailField.style.display='none';panel.querySelector('.sub-setting-email-label').style.display='none';panel.querySelector('.sub-setting-confirmed').style.display='block';panel.querySelector('.sub-setting-confirmed').textContent='✅ ADRESSE E-MAIL VALIDÉE : '+email;panel.querySelector('.sub-setting-warning').style.display='block';panel.querySelector('.sub-setting-confirm-email').style.display='none';panel.querySelector('.sub-setting-change-email').style.display='block';panel.querySelector('.sub-setting-code').disabled=false;panel.querySelector('.sub-setting-activate').disabled=false;}
    window.CarPlaySyncIdentityToSubscriptionSettings=function(identity){
      var x=storedIdentity(identity||{});
      if(firstNameField&&x.firstName)firstNameField.value=x.firstName;
      if(lastNameField&&x.lastName)lastNameField.value=x.lastName;
      if(emailField&&x.email){emailField.value=x.email;rememberEmail(x.email);}
      if(x.firstName.length>=2&&x.lastName.length>=2&&/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x.email))showConfirmed(x.email);
    };
    if(emailField&&emailField.value&&firstNameField.value.trim().length>=2&&lastNameField.value.trim().length>=2&&s&&s.email&&s.firstName&&s.lastName){showConfirmed(emailField.value);}
    window.CarPlaySyncIdentityToSubscriptionSettings(s||{});
    var firstSetting = settings.querySelector(".settingRow");
    if (firstSetting) settings.insertBefore(panel, firstSetting); else settings.appendChild(panel);
    cleanupOldSettingDuplicates(settings, panel);
    panel.querySelector(".settingHead").onclick = function () { panel.querySelector(".settingBody").classList.toggle("open"); };
    var settingsCodeInput = panel.querySelector(".sub-setting-code");
    settingsCodeInput.addEventListener("input", function(){ settingsCodeInput.value = cleanCode(settingsCodeInput.value); });
    panel.querySelector('.sub-setting-confirm-email').onclick=function(){var msg=panel.querySelector('.sub-settings-message'),email=String(emailField.value||'').trim().toLowerCase(),firstName=String(firstNameField.value||'').trim().replace(/\s+/g,' '),lastName=String(lastNameField.value||'').trim().replace(/\s+/g,' ');if(firstName.length<2||lastName.length<2){msg.textContent='Écrivez votre nom et votre prénom.';return;}if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){msg.textContent='Écrivez une adresse e-mail complète.';return;}rememberEmail(email);msg.textContent='Vérification de votre adresse e-mail…';ensureServerIdentityV407(email,firstName,lastName,function(){emailProof='adresse-confirmee';showConfirmed(email);settingsCodeInput.disabled=false;panel.querySelector('.sub-setting-activate').disabled=false;msg.textContent='✅ Adresse e-mail confirmée sur le serveur. Vous pouvez continuer.';},function(e){emailProof='';msg.textContent=messageFor(e);});};
    panel.querySelector('.sub-setting-change-email').onclick=function(){emailProof='';if(firstNameField)firstNameField.disabled=false;if(lastNameField)lastNameField.disabled=false;emailField.style.display='block';panel.querySelector('.sub-setting-email-label').style.display='block';emailField.focus();panel.querySelector('.sub-setting-confirm-email').style.display='block';panel.querySelector('.sub-setting-confirmed').style.display='none';panel.querySelector('.sub-setting-warning').style.display='none';this.style.display='none';settingsCodeInput.disabled=false;panel.querySelector('.sub-setting-activate').disabled=false;};
    panel.querySelector('.sub-setting-recover-code').onclick=function(){var email=String(emailField.value||'').trim(),firstName=String(firstNameField.value||'').trim().replace(/\s+/g,' '),lastName=String(lastNameField.value||'').trim().replace(/\s+/g,' '),msg=panel.querySelector('.sub-settings-message'),button=this;msg.textContent='Recherche de votre abonnement…';sendRecoveryCode(email,firstName,lastName,button,function(j){emailProof='adresse-confirmee';rememberEmail(email);showConfirmed(email);settingsCodeInput.disabled=false;panel.querySelector('.sub-setting-activate').disabled=false;var info=j&&j.lifetime?'abonnement à vie':((j&&typeof j.remainingDays==='number')?j.remainingDays+' jour'+(j.remainingDays>1?'s':'')+' restant'+(j.remainingDays>1?'s':''):'abonnement retrouvé');msg.textContent='✅ Code renvoyé à '+email+' — '+info+'. Entrez ce code ci-dessous pour remettre exactement cet abonnement sur ce téléphone.';},function(e){msg.textContent=messageFor(e)});};
    panel.querySelector(".sub-setting-activate").onclick = function () {
      var code = cleanCode(settingsCodeInput.value),idFallback=storedIdentity(s||{}),email=String(emailField.value||idFallback.email||'').trim();
      var firstName=String(firstNameField&&firstNameField.value||idFallback.firstName||'').trim().replace(/\s+/g,' ');
      var lastName=String(lastNameField&&lastNameField.value||idFallback.lastName||'').trim().replace(/\s+/g,' ');
      if(firstNameField&&!firstNameField.value&&firstName)firstNameField.value=firstName;
      if(lastNameField&&!lastNameField.value&&lastName)lastNameField.value=lastName;
      if(emailField&&!emailField.value&&email)emailField.value=email;
      var msg = panel.querySelector(".sub-settings-message");
      if(firstName.length<2||lastName.length<2){msg.textContent='Écrivez votre nom et votre prénom.';return;}
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email||'').toLowerCase())){msg.textContent='Écrivez une adresse e-mail complète.';return;}
      if (code.length !== 6) { msg.textContent = "Entrez exactement 6 lettres/chiffres."; return; }
      emailProof=emailProof||'adresse-saisie';
      msg.textContent = "Vérification du compte…";
      activate(code,email,emailProof,firstName,lastName,detectedType(),function (j) { msg.textContent = j&&j.lifetime?"✅ Compte synchronisé — abonnement à vie chargé.":(j&&j.renewed&&j.addedDays?"✅ CUMUL EFFECTUÉ : +"+j.addedDays+" jours ajoutés — total : "+(j.remainingDays||0)+" jours restants.":"✅ Abonnement activé et lié à cette adresse e-mail — "+((j&&j.remainingDays)||0)+" jours restants."); localStorage.setItem('carplay_open_contest_after_identity','1'); setTimeout(function () { location.reload(); }, 900); }, function (e) { msg.textContent = messageFor(e); });
    };
  }

  window.addEventListener("carplay:identity-ready",function(event){
    if(window.CarPlaySyncIdentityToSubscriptionSettings)window.CarPlaySyncIdentityToSubscriptionSettings(event&&event.detail||{});
  });

  function adaptPhoneSettings() {
    if (detectedType() !== "phone") return;
    var mapsMenu = document.getElementById("mapsMenu");
    if (mapsMenu) {
      var row = mapsMenu.closest ? mapsMenu.closest(".settingRow") : mapsMenu.parentNode;
      if (row) row.style.display = "none";
    }
  }

  function homeStatus() {
    var p = location.pathname.toLowerCase();
    if (p !== "/" && p !== "/index.html") return;
    var s = saved();
    var trial = !!(s && s.globalFree && freeAccess());
    if (!trial) return;
    var remaining = Math.max(0, Math.ceil((Date.parse(s.expiresAt) - Date.now()) / 86400000));
    var style = document.createElement("style");
    style.textContent = ".subscription-home-status{position:fixed;top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));z-index:1800;min-width:145px;padding:8px 11px;border:2px solid #62b6ff;border-radius:14px;color:#62b6ff;text-align:center;box-shadow:0 5px 16px #0009;font:950 14px/1.18 Arial,sans-serif;background:#0b4f9c}.subscription-home-status strong,.subscription-home-status span{display:block}.subscription-home-status span{margin-top:3px;font-size:12px}body.settings-open .subscription-home-status{display:none!important}";
    document.head.appendChild(style);
    var box = document.createElement("div");
    box.id = "subscriptionHomeStatus";
    box.className = "subscription-home-status is-trial";
    box.innerHTML = '<strong>MODE ESSAI</strong><span>' + remaining + ' JOUR' + (remaining > 1 ? 'S' : '') + ' RESTANT' + (remaining > 1 ? 'S' : '') + '</span>';
    document.body.appendChild(box);
  }

  var SUBSCRIPTION_REMINDER_KEY = "carplay_subscription_expiry_reminder_v1";
  var SUBSCRIPTION_REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

  function subscriptionRemainingDays(s) {
    if (!s || s.globalFree || s.lifetime || !s.expiresAt) return null;
    var end = Date.parse(s.expiresAt);
    if (!isFinite(end)) return null;
    return Math.max(0, Math.ceil((end - Date.now()) / 86400000));
  }

  function showSubscriptionExpiryBubble(days) {
    var old = document.getElementById("subscriptionExpiryReminderBubble");
    if (old) old.remove();
    var box = document.createElement("div");
    box.id = "subscriptionExpiryReminderBubble";
    box.setAttribute("role", "status");
    box.style.cssText = "position:fixed;z-index:2147483646;left:50%;top:max(18px,env(safe-area-inset-top));transform:translateX(-50%);width:min(560px,92vw);box-sizing:border-box;padding:16px 18px;border:3px solid #ff9f1a;border-radius:18px;background:#171006f5;color:#fff;text-align:center;box-shadow:0 12px 36px #000b;font:900 16px/1.35 Arial,sans-serif;transition:opacity .25s ease,transform .25s ease";
    box.innerHTML = '<div style="font-size:21px;color:#ffd166;margin-bottom:5px">⚠️ ABONNEMENT : '+days+' JOUR'+(days>1?'S':'')+' RESTANT'+(days>1?'S':'')+'</div><div>Avant le blocage de l’application.</div><div style="margin-top:5px;color:#ffd8a8">Pensez à acheter votre nouveau code d’abonnement.</div>';
    document.body.appendChild(box);
    setTimeout(function(){box.style.opacity="0";box.style.transform="translate(-50%,-12px)";setTimeout(function(){if(box.parentNode)box.remove();},300);},9700);
  }

  function showSubscriptionSystemReminder(days) {
    try {
      if (localStorage.getItem("carplay_notifications_enabled") !== "1") return;
      if (!("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
      navigator.serviceWorker.ready.then(function(registration){
        var tag="subscription-expiry-reminder";
        return registration.showNotification("⚠️ Abonnement Couteau Suisse : "+days+" jour"+(days>1?"s":"")+" restant"+(days>1?"s":""),{
          body:"Il reste "+days+" jour"+(days>1?"s":"")+" avant le blocage de l’application. Pensez à renouveler votre code d’abonnement.",
          icon:"/couteau-suisse-192.png",
          badge:"/couteau-suisse-192.png",
          tag:tag,
          renotify:true,
          data:{url:"/index.html#subscriptionSettings"}
        }).then(function(){
          setTimeout(function(){
            try{registration.getNotifications({tag:tag}).then(function(list){list.forEach(function(n){n.close();});});}catch(_){}
          },10000);
        });
      }).catch(function(){});
    } catch (_) {}
  }

  function maybeShowSubscriptionExpiryReminder(force) {
    var s=saved(),days=subscriptionRemainingDays(s);
    if(days===null || days<=0 || days>30) return;
    var endKey=String(s.expiresAt||"");
    var now=Date.now(),state=null;
    try{state=JSON.parse(localStorage.getItem(SUBSCRIPTION_REMINDER_KEY)||"null");}catch(_){}
    var due=!!force || !state || state.expiresAt!==endKey || !Number(state.shownAt) || now-Number(state.shownAt)>=SUBSCRIPTION_REMINDER_INTERVAL_MS;
    if(!due)return;
    try{localStorage.setItem(SUBSCRIPTION_REMINDER_KEY,JSON.stringify({expiresAt:endKey,shownAt:now,days:days}));}catch(_){}
    showSubscriptionExpiryBubble(days);
    showSubscriptionSystemReminder(days);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var recoveryStyle=document.createElement("style");
    recoveryStyle.textContent=".sub-full-email{box-sizing:border-box!important;width:100%!important;min-width:0!important;font-size:16px!important}.sub-email-complete{max-width:100%!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:break-word!important}.sub-recovery-help{display:block!important;margin:6px 0 12px!important;line-height:1.35!important}.sub-setting-recover-code,#subRecoverCode{background:#0867d1!important;color:#fff!important;font-weight:950!important}body.autoradio-subscription-ui #subscriptionSettings .settingBody{font-size:20px!important;padding:18px!important}body.autoradio-subscription-ui #subscriptionSettings input{min-height:66px!important;font-size:25px!important;padding:12px 15px!important}body.autoradio-subscription-ui #subscriptionSettings .sub-setting-code{min-height:78px!important;font-size:34px!important;font-weight:950!important;letter-spacing:7px!important;text-align:center!important}body.autoradio-subscription-ui #subscriptionSettings button{min-height:66px!important;font-size:21px!important;font-weight:950!important}body.autoradio-subscription-ui #subscriptionSettings label{font-size:20px!important;line-height:1.3!important}body.autoradio-subscription-ui #subscriptionSettings .sub-settings-message{font-size:20px!important;line-height:1.35!important;font-weight:900!important;margin-top:10px!important}";
    document.head.appendChild(recoveryStyle);
    if(localStorage.getItem('carplay_device_type')==='autoradio'||window.__COUTEAU_AUTORADIO__===true)document.body.classList.add('autoradio-subscription-ui');
    // Afficher ABONNEMENT immédiatement dans Réglages, même si le contrôle serveur prend du temps.
    settingsPanel();
    verifySaved(function () {
      var oldSubscriptionPanel=document.getElementById("subscriptionSettings");
      if(oldSubscriptionPanel)oldSubscriptionPanel.remove();
      settingsPanel();
      homeStatus();
      maybeShowSubscriptionExpiryReminder(false);
      addAdminMessageCounter();
      adaptPhoneSettings();
      protectFeatures();
      blockDirectMarketPage();
      checkPendingRequest();
      setInterval(function(){if(!document.hidden)checkPendingRequest()},30000);
    });
  });
  document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")maybeShowSubscriptionExpiryReminder(false);});
  window.addEventListener("focus",function(){maybeShowSubscriptionExpiryReminder(false);});
})();
