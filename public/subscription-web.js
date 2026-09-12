(function () {
  if ("serviceWorker" in navigator) addEventListener("load", function () { navigator.serviceWorker.register("/sw.js?v=20260912-consulter-fiche9").catch(function () {}); });
  var KEY = "carplay_shared_subscription";
  var PAID_KEY = "carplay_paid_activated";
  var EMAIL_KEY = "carplay_recovery_email";
  var FREE_UNTIL = "2026-11-25T23:59:59+01:00";
  function cleanCode(v) {
    return String(v || "").toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .replace(/[OI]/g, function(c){ return ({O:"Q",I:"L"})[c]; })
      .slice(0, 6);
  }

  function freeAccess() { return Date.now() <= Date.parse(FREE_UNTIL); }
  function freeSubscription() { return { ok: true, globalFree: true, lifetime: false, expiresAt: FREE_UNTIL }; }

  function id() {
    var v = localStorage.getItem("carplay_device_id");
    if (!v) {
      v = crypto.randomUUID ? crypto.randomUUID() : "dev-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      localStorage.setItem("carplay_device_id", v);
    }
    return v;
  }
  function saved() {
    var real = null;
    try { real = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {}
    if (real && !real.globalFree && valid(real)) return real;
    if (localStorage.getItem(PAID_KEY) === "1") return real;
    if (freeAccess()) return freeSubscription();
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
    try{if(localStorage.getItem("carplay_notifications_enabled")==="1"&&"serviceWorker" in navigator&&"Notification" in window&&Notification.permission==="granted")navigator.serviceWorker.ready.then(function(r){return r.showNotification(approved?"Changement accepté":"Changement refusé",{body:text,icon:"/carplay-noir-rouge-192.png",badge:"/carplay-noir-rouge-192.png",tag:"market-change-answer"})})}catch(_){}
  }
  window.CarPlayShowRequestAnswer=showRequestAnswer;
  function checkPendingRequest() {
    var pending=null;try{pending=JSON.parse(localStorage.getItem("carplay_pending_market_request")||"null")}catch(_){}
    if(!pending||!pending.id)return;
    fetch("/api/gps-unlock-status?id="+encodeURIComponent(pending.id)+"&deviceId="+encodeURIComponent(id()),{cache:"no-store"}).then(function(r){return r.json()}).then(function(j){if(j.status==="completed"||j.status==="approved"||j.status==="denied"){localStorage.removeItem("carplay_pending_market_request");showRequestAnswer(j.status!=="denied")}else if(j.status==="expired"||j.status==="consumed")localStorage.removeItem("carplay_pending_market_request")}).catch(function(){});
  }
  function messageFor(e) {
    if (e && e.error === "EMAIL_OBLIGATOIRE") return "METTEZ VOTRE ADRESSE E-MAIL AVANT LE CODE, POUR RÉCUPÉRER L’ABONNEMENT SI L’APPLICATION EST EFFACÉE";
    if (e && e.error === "EMAIL_NE_CORRESPOND_PAS") return "CETTE ADRESSE E-MAIL NE CORRESPOND PAS À CET ABONNEMENT";
    if (e && e.error === "EMAIL_NON_CONFIRMEE") return "CONFIRMEZ D’ABORD VOTRE ADRESSE E-MAIL";
    if (e && (e.error === "EMAIL_DEJA_UTILISEE" || e.error === "EMAIL_DEJA_UTILISEE_AUTRE_TELEPHONE")) return "CETTE ADRESSE E-MAIL EST DÉJÀ UTILISÉE SUR UN AUTRE TÉLÉPHONE";
    if (e && e.error === "QUOTA_EMAIL_JOURNALIER") return "LA LIMITE DE 200 E-MAILS DU JOUR EST ATTEINTE. RÉESSAYEZ DEMAIN";
    if (e && e.error === "EMAIL_ENVOI_INDISPONIBLE") return "LE CODE E-MAIL N’A PAS PU ÊTRE ENVOYÉ. RÉESSAYEZ DANS QUELQUES INSTANTS";
    if (e && e.error === "EMAIL_INTROUVABLE") return "AUCUN ABONNEMENT ACTIF N’EST ASSOCIÉ À CETTE ADRESSE E-MAIL";
    if (e && e.error === "CODE_RECUPERATION_NON_INITIALISE") return "CE CODE D’ABONNEMENT NE PEUT PAS ENCORE ÊTRE RENVOYÉ. CONTACTEZ L’ADMINISTRATEUR";
    if (e && e.error === "CODE_EMAIL_TROP_RAPIDE") return "UN CODE VIENT DÉJÀ D’ÊTRE ENVOYÉ. ATTENDEZ UNE MINUTE";
    if (e && e.error === "CODE_EMAIL_EXPIRE") return "LE CODE E-MAIL A EXPIRÉ. RECOMMENCEZ L’ACTIVATION";
    if (e && (e.error === "CODE_EMAIL_INCORRECT" || e.error === "CODE_EMAIL_TROP_ESSAIS")) return "LE CODE REÇU PAR E-MAIL EST INCORRECT";
    if (e && e.error === "ABONNEMENT_EXPIRE") return "ABONNEMENT EXPIRÉ";
    if (e && e.error === "APPAREIL_DEJA_UTILISE") return "CE CODE EST DÉJÀ UTILISÉ SUR UN AUTRE APPAREIL";
    return "CODE INCORRECT OU INTERNET INDISPONIBLE";
  }
  function confirmEmail(email, done, failed) {
    email=String(email||"").trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){failed({error:"EMAIL_OBLIGATOIRE"});return;}
    rememberEmail(email);
    done({ok:true,email:email,emailProof:"adresse-confirmee"});
  }
  function sendRecoveryCode(email, button, done, failed) {
    email=String(email||"").trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){failed({error:"EMAIL_OBLIGATOIRE"});return;}
    rememberEmail(email);
    var oldText=button.textContent;
    button.disabled=true;
    button.textContent="ENVOI EN COURS…";
    fetch("/api/recover-code",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({email:email,deviceId:id()})
    }).then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j;});})
      .then(function(j){done(j);})
      .catch(failed)
      .finally(function(){button.disabled=false;button.textContent=oldText;});
  }
  function activate(code, email, emailProof, deviceType, done, failed) {
    fetch("/api/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code, email: email, emailProof:emailProof, deviceId: id(), deviceType: deviceType })
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
      j.email = s.email;
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
    box.innerHTML = '<div class="sub-card"><button class="sub-close" aria-label="Fermer">×</button><h1>🔒 FONCTION BLOQUÉE</h1><p>' + feature + ' nécessite un abonnement.</p><label id="subEmailLabel" for="subEmail"><b>1. ÉCRIVEZ VOTRE ADRESSE E-MAIL COMPLÈTE</b></label><input id="subEmail" class="sub-full-email" type="email" inputmode="email" autocomplete="email" placeholder="Exemple : prenom.nom@gmail.com"><button id="subConfirmEmail" type="button">CONFIRMER MON ADRESSE E-MAIL</button><div id="subEmailConfirmed" class="sub-email-complete" style="display:none;color:#55e58c;font-weight:900;margin:8px 0"></div><small id="subEmailWarning" style="display:none;color:#ffd166">⚠️ Attention : si l’adresse e-mail est incorrecte, aucune récupération du compte ne sera possible.</small><button id="subChangeEmail" type="button" style="display:none">MODIFIER L’ADRESSE E-MAIL</button><button id="subRecoverCode" type="button">ENVOYER MON CODE D’ABONNEMENT</button><small class="sub-recovery-help">Application effacée ou nouveau téléphone ? Entrez la même adresse e-mail, puis appuyez ici pour recevoir votre code actuel.</small><label for="subCode"><b>2. ENTREZ VOTRE CODE D’ABONNEMENT</b></label><input id="subCode" disabled inputmode="text" autocapitalize="characters" maxlength="6" placeholder="CODE 6 LETTRES / CHIFFRES"><div class="sub-types"><button data-type="autoradio">AUTORADIO / TABLETTE</button><button data-type="phone">TÉLÉPHONE</button></div><button id="subActivate" disabled>DÉBLOQUER AVEC MON CODE</button><div id="subMessage"></div><small>Le même code active 1 autoradio ou tablette + 1 téléphone Android ou iPhone.</small></div>';
    document.documentElement.appendChild(box);
    var deviceType = detectedType();
    var emailProof="";
    var codeInput = box.querySelector("#subCode");
    var restoredEmail=rememberedEmail();
    if(restoredEmail){
      box.querySelector("#subEmail").value=restoredEmail;
      emailProof="adresse-confirmee";
      box.querySelector("#subEmail").style.display="none";
      box.querySelector("#subEmailLabel").style.display="none";
      box.querySelector("#subConfirmEmail").style.display="none";
      box.querySelector("#subEmailConfirmed").style.display="block";
      box.querySelector("#subEmailConfirmed").textContent="✅ ADRESSE E-MAIL VALIDÉE : "+restoredEmail;
      box.querySelector("#subEmailWarning").style.display="block";
      box.querySelector("#subChangeEmail").style.display="block";
      codeInput.disabled=false;
      box.querySelector("#subActivate").disabled=false;
    }
    codeInput.addEventListener("input", function(){ codeInput.value = cleanCode(codeInput.value); });
    box.querySelector(".sub-close").onclick = function () { box.remove(); if (location.pathname !== "/" && location.pathname !== "/index.html") history.back(); };
    box.querySelectorAll("[data-type]").forEach(function (b) {
      b.onclick = function () {
        deviceType = "phone";
        box.querySelectorAll("[data-type]").forEach(function (x) { x.classList.toggle("chosen", x === b); });
      };
      if (b.dataset.type === "autoradio") b.style.display = "none";
      if (b.dataset.type === deviceType) b.classList.add("chosen");
    });
    box.querySelector("#subConfirmEmail").onclick=function(){var email=String(box.querySelector("#subEmail").value||"").trim(),msg=box.querySelector("#subMessage");if(!email||email.indexOf("@")<1){msg.textContent="ÉCRIVEZ VOTRE ADRESSE E-MAIL COMPLÈTE";return}confirmEmail(email,function(result){emailProof=result.emailProof;box.querySelector("#subEmail").style.display="none";box.querySelector("#subEmailLabel").style.display="none";box.querySelector("#subConfirmEmail").style.display="none";box.querySelector("#subEmailConfirmed").style.display="block";box.querySelector("#subEmailConfirmed").textContent="✅ ADRESSE E-MAIL VALIDÉE : "+result.email;box.querySelector("#subEmailWarning").style.display="block";box.querySelector("#subChangeEmail").style.display="block";box.querySelector("#subCode").disabled=false;box.querySelector("#subActivate").disabled=false;msg.textContent="VOUS POUVEZ MAINTENANT ENTRER LE CODE D’ABONNEMENT.";},function(e){msg.textContent=messageFor(e)});};
    box.querySelector("#subChangeEmail").onclick=function(){emailProof="";box.querySelector("#subEmail").style.display="block";box.querySelector("#subEmailLabel").style.display="block";box.querySelector("#subEmail").focus();box.querySelector("#subConfirmEmail").style.display="block";box.querySelector("#subEmailConfirmed").style.display="none";box.querySelector("#subEmailWarning").style.display="none";this.style.display="none";box.querySelector("#subCode").disabled=true;box.querySelector("#subActivate").disabled=true;};
    box.querySelector("#subRecoverCode").onclick=function(){var email=String(box.querySelector("#subEmail").value||"").trim(),msg=box.querySelector("#subMessage"),button=this;msg.textContent="VÉRIFICATION DE L’ADRESSE…";sendRecoveryCode(email,button,function(){emailProof="adresse-confirmee";rememberEmail(email);box.querySelector("#subEmailConfirmed").style.display="block";box.querySelector("#subEmailConfirmed").textContent="✅ ADRESSE E-MAIL : "+email;box.querySelector("#subCode").disabled=false;box.querySelector("#subActivate").disabled=false;msg.textContent="✅ VOTRE CODE D’ABONNEMENT A ÉTÉ ENVOYÉ À "+email+". ENTREZ-LE CI-DESSOUS.";},function(e){msg.textContent=messageFor(e)});};
    box.querySelector("#subActivate").onclick = function () {
      var code = cleanCode(box.querySelector("#subCode").value);
      var email = String(box.querySelector("#subEmail").value || "").trim();
      var msg = box.querySelector("#subMessage");
      if (!email) { msg.textContent = "METTEZ VOTRE ADRESSE E-MAIL AVANT LE CODE"; return; }
      if (code.length !== 6) { msg.textContent = "ENTREZ EXACTEMENT 6 CARACTÈRES"; return; }
      msg.textContent = "VÉRIFICATION…";
      if(!emailProof){msg.textContent="CONFIRMEZ D’ABORD VOTRE ADRESSE E-MAIL";return;}
      activate(code,email,emailProof, deviceType, function () {
        msg.textContent = "ABONNEMENT ACTIVÉ — FONCTIONS DÉBLOQUÉES";
        setTimeout(function () { location.reload(); }, 650);
      }, function (e) { msg.textContent = messageFor(e); });
    };
  }

  function addLock(target, text) {
    if (!target || target.querySelector(".feature-lock")) return;
    target.style.position = "relative";
    var badge = document.createElement("div");
    badge.className = "feature-lock";
    badge.textContent = "🔒 " + text;
    target.appendChild(badge);
  }

  function protectFeatures() {
    if (unlocked()) return;
    var market = document.querySelector(".card.blue");
    var china = document.querySelector(".card.orange");
    var returning = document.querySelector(".small.green");
    var pro = document.querySelector(".directBtn.docs");
    addLock(market, "ABONNEMENT");
    addLock(china, "ABONNEMENT");
    addLock(returning, "ABONNEMENT");
    addLock(pro, "ABONNEMENT");
    document.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest(".card.blue,.card.orange,.small.green,.directBtn.docs,button") : null;
      if (!t || unlocked()) return;
      if (t.matches(".card.blue")) {
        e.preventDefault(); e.stopImmediatePropagation(); lockModal("Les marchés France et Belgique");
      } else if (t.matches(".card.orange")) {
        e.preventDefault(); e.stopImmediatePropagation(); lockModal("Retrouver son Coin de Chine");
      } else if (t.matches(".small.green")) {
        e.preventDefault(); e.stopImmediatePropagation(); lockModal("Retourner sur la place enregistrée");
      } else if (t.matches(".directBtn.docs")) {
        e.preventDefault(); e.stopImmediatePropagation(); lockModal("Démarches pro");
      } else if ((t.getAttribute("onclick") || "").indexOf("savePlace") !== -1) {
        e.preventDefault(); e.stopImmediatePropagation(); lockModal("Créer une nouvelle fiche Coin de Chine");
      }
    }, true);
    document.querySelectorAll('button[onclick*="savePlace"]').forEach(function (b) { addLock(b, "ABONNEMENT"); });
  }

  function blockDirectMarketPage() {
    if (unlocked()) return;
    var p = location.pathname.toLowerCase();
    if (p.indexOf("marches") !== -1 && p.indexOf("admin") === -1 && p !== "/index.html") lockModal("Les marchés France et Belgique");
    if (p.indexOf("coin-de-chine") !== -1) lockModal("Retrouver son Coin de Chine");
    if (p.indexOf("documents-travail") !== -1) lockModal("Démarches pro");
  }

  function settingsPanel() {
    var settings = document.getElementById("settings");
    if (!settings || document.getElementById("subscriptionSettings")) return;
    var panel = document.createElement("div");
    panel.className = "settingRow";
    panel.id = "subscriptionSettings";
    var s = saved();
    var isActive = valid(s);
    var remaining = isActive && !s.lifetime ? Math.max(0, Math.ceil((Date.parse(s.expiresAt) - Date.now()) / 86400000)) : 0;
    var state = isActive ? "ACTIF" : "DÉSACTIVÉ";
    var days = isActive ? (s.lifetime ? "ABONNEMENT À VIE" : remaining + " JOUR" + (remaining > 1 ? "S" : "") + " RESTANT" + (remaining > 1 ? "S" : "")) : "0 JOUR RESTANT";
    var end = isActive ? (s.lifetime ? "AUCUNE DATE DE FIN" : "FIN LE " + new Date(s.expiresAt).toLocaleDateString("fr-FR")) : "FONCTIONS VERROUILLÉES";
    panel.innerHTML = '<div class="settingHead"><span>🔐 ABONNEMENT</span><span>⌄</span></div><div class="settingBody"><div class="sub-current-status" style="margin:4px 0 12px;padding:12px;border:2px solid '+(isActive?'#44d17a':'#ff5a5a')+';border-radius:13px;background:#0b1522;text-align:center;font-weight:950"><div style="font-size:19px">'+state+'</div><div style="margin-top:4px">'+days+'</div><div style="margin-top:4px;font-size:13px;color:#d8e0eb">'+end+'</div></div><div class="sub-settings"><label class="sub-setting-email-label"><b>1. ÉCRIVEZ VOTRE ADRESSE E-MAIL COMPLÈTE</b></label><input class="sub-setting-email sub-full-email" type="email" inputmode="email" autocomplete="email" placeholder="Exemple : prenom.nom@gmail.com"><div class="sub-setting-confirmed sub-email-complete" style="display:none;color:#55e58c;font-weight:900;margin:7px 0"></div><div class="sub-setting-warning" style="display:none;font-size:12px;color:#ffd166;margin:4px 0 9px">⚠️ Attention : si l’adresse e-mail est incorrecte, aucune récupération du compte ne sera possible.</div><button class="sub-setting-confirm-email" type="button">CONFIRMER MON ADRESSE E-MAIL</button><button class="sub-setting-change-email" type="button" style="display:none">MODIFIER L’ADRESSE E-MAIL</button><button class="sub-setting-recover-code" type="button">ENVOYER MON CODE D’ABONNEMENT</button><small class="sub-recovery-help">Application effacée ou nouveau téléphone ? Entrez la même adresse e-mail pour recevoir votre code actuel.</small><label><b>2. ENTREZ VOTRE CODE D’ABONNEMENT</b></label><input class="sub-setting-code" disabled inputmode="text" autocapitalize="characters" maxlength="6" placeholder="CODE 6 LETTRES / CHIFFRES"><button class="sub-setting-activate" disabled>RENOUVELER / CHANGER MON CODE</button><div class="sub-settings-message"></div></div></div>';
    var emailField=panel.querySelector('.sub-setting-email'),emailProof='';if(emailField&&!emailField.value){emailField.value=(s&&s.email)||rememberedEmail()||'';}
    function showConfirmed(email){emailProof='adresse-confirmee';emailField.value=email;emailField.style.display='none';panel.querySelector('.sub-setting-email-label').style.display='none';panel.querySelector('.sub-setting-confirmed').style.display='block';panel.querySelector('.sub-setting-confirmed').textContent='✅ ADRESSE E-MAIL VALIDÉE : '+email;panel.querySelector('.sub-setting-warning').style.display='block';panel.querySelector('.sub-setting-confirm-email').style.display='none';panel.querySelector('.sub-setting-change-email').style.display='block';panel.querySelector('.sub-setting-code').disabled=false;panel.querySelector('.sub-setting-activate').disabled=false;}
    if(emailField&&emailField.value)showConfirmed(emailField.value);
    var firstSetting = settings.querySelector(".settingRow");
    if (firstSetting) settings.insertBefore(panel, firstSetting); else settings.appendChild(panel);
    panel.querySelector(".settingHead").onclick = function () { panel.querySelector(".settingBody").classList.toggle("open"); };
    var settingsCodeInput = panel.querySelector(".sub-setting-code");
    settingsCodeInput.addEventListener("input", function(){ settingsCodeInput.value = cleanCode(settingsCodeInput.value); });
    panel.querySelector('.sub-setting-confirm-email').onclick=function(){var msg=panel.querySelector('.sub-settings-message');confirmEmail(emailField.value,function(r){showConfirmed(r.email);msg.textContent='Adresse enregistrée. Vous pouvez maintenant entrer votre code d’abonnement.';},function(e){msg.textContent=messageFor(e)});};
    panel.querySelector('.sub-setting-change-email').onclick=function(){emailProof='';emailField.style.display='block';panel.querySelector('.sub-setting-email-label').style.display='block';emailField.focus();panel.querySelector('.sub-setting-confirm-email').style.display='block';panel.querySelector('.sub-setting-confirmed').style.display='none';panel.querySelector('.sub-setting-warning').style.display='none';this.style.display='none';settingsCodeInput.disabled=true;panel.querySelector('.sub-setting-activate').disabled=true;};
    panel.querySelector('.sub-setting-recover-code').onclick=function(){var email=String(emailField.value||'').trim(),msg=panel.querySelector('.sub-settings-message'),button=this;msg.textContent='Vérification de l’adresse…';sendRecoveryCode(email,button,function(){emailProof='adresse-confirmee';rememberEmail(email);showConfirmed(email);settingsCodeInput.disabled=false;panel.querySelector('.sub-setting-activate').disabled=false;msg.textContent='✅ Votre code d’abonnement a été envoyé à '+email+'. Entrez-le ci-dessous pour continuer votre abonnement.';},function(e){msg.textContent=messageFor(e)});};
    panel.querySelector(".sub-setting-activate").onclick = function () {
      var code = cleanCode(settingsCodeInput.value),email=String(emailField.value||'').trim();
      var msg = panel.querySelector(".sub-settings-message");
      if(!emailProof){msg.textContent='Confirmez d’abord votre adresse e-mail.';return;}
      if (code.length !== 6) { msg.textContent = "Entrez exactement 6 lettres/chiffres."; return; }
      msg.textContent = "Vérification…";
      activate(code,email,emailProof, detectedType(), function () { msg.textContent = "Abonnement activé."; setTimeout(function () { location.reload(); }, 600); }, function (e) { msg.textContent = messageFor(e); });
    };
  }

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

  document.addEventListener("DOMContentLoaded", function () {
    var recoveryStyle=document.createElement("style");
    recoveryStyle.textContent=".sub-full-email{box-sizing:border-box!important;width:100%!important;min-width:0!important;font-size:16px!important}.sub-email-complete{max-width:100%!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:break-word!important}.sub-recovery-help{display:block!important;margin:6px 0 12px!important;line-height:1.35!important}.sub-setting-recover-code,#subRecoverCode{background:#0867d1!important;color:#fff!important;font-weight:950!important}";
    document.head.appendChild(recoveryStyle);
    verifySaved(function () {
      homeStatus();
      settingsPanel();
      adaptPhoneSettings();
      protectFeatures();
      blockDirectMarketPage();
      checkPendingRequest();
      setInterval(checkPendingRequest,8000);
    });
  });
})();
