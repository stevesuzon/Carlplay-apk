(function () {
  if ("serviceWorker" in navigator) addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  var KEY = "carplay_shared_subscription";
  var PAID_KEY = "carplay_paid_activated";
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
  function messageFor(e) {
    if (e && e.error === "ABONNEMENT_EXPIRE") return "ABONNEMENT EXPIRÉ";
    if (e && e.error === "APPAREIL_DEJA_UTILISE") return "CE CODE EST DÉJÀ UTILISÉ SUR UN AUTRE APPAREIL";
    return "CODE INCORRECT OU INTERNET INDISPONIBLE";
  }
  function activate(code, deviceType, done, failed) {
    fetch("/api/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code, deviceId: id(), deviceType: deviceType })
    }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw j; return j; });
    }).then(function (j) {
      j.code = code;
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
    box.innerHTML = '<div class="sub-card"><button class="sub-close" aria-label="Fermer">×</button><h1>🔒 FONCTION BLOQUÉE</h1><p>' + feature + ' nécessite un abonnement.</p><input id="subCode" inputmode="text" autocapitalize="characters" maxlength="6" placeholder="K7R4M2"><div class="sub-types"><button data-type="autoradio">AUTORADIO / TABLETTE</button><button data-type="phone">TÉLÉPHONE</button></div><button id="subActivate">DÉBLOQUER AVEC MON CODE</button><div id="subMessage"></div><small>Le même code active 1 autoradio ou tablette + 1 téléphone Android ou iPhone. Le code peut aussi être saisi dans Réglages → Abonnement.</small></div>';
    document.documentElement.appendChild(box);
    var deviceType = detectedType();
    var codeInput = box.querySelector("#subCode");
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
    box.querySelector("#subActivate").onclick = function () {
      var code = cleanCode(box.querySelector("#subCode").value);
      var msg = box.querySelector("#subMessage");
      if (code.length !== 6) { msg.textContent = "ENTREZ EXACTEMENT 6 CARACTÈRES"; return; }
      msg.textContent = "VÉRIFICATION…";
      activate(code, deviceType, function () {
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
    panel.innerHTML = '<div class="settingHead"><span>🔐 ABONNEMENT</span><span>⌄</span></div><div class="settingBody"><div class="sub-current-status" style="margin:4px 0 12px;padding:12px;border:2px solid '+(isActive?'#44d17a':'#ff5a5a')+';border-radius:13px;background:#0b1522;text-align:center;font-weight:950"><div style="font-size:19px">'+state+'</div><div style="margin-top:4px">'+days+'</div><div style="margin-top:4px;font-size:13px;color:#d8e0eb">'+end+'</div></div><div class="sub-settings"><input inputmode="text" autocapitalize="characters" maxlength="6" placeholder="CODE 6 LETTRES / CHIFFRES"><button class="sub-setting-activate">RENOUVELER / CHANGER MON CODE</button><div class="sub-settings-message"></div></div></div>';
    var firstSetting = settings.querySelector(".settingRow");
    if (firstSetting) settings.insertBefore(panel, firstSetting); else settings.appendChild(panel);
    panel.querySelector(".settingHead").onclick = function () { panel.querySelector(".settingBody").classList.toggle("open"); };
    var settingsCodeInput = panel.querySelector("input");
    settingsCodeInput.addEventListener("input", function(){ settingsCodeInput.value = cleanCode(settingsCodeInput.value); });
    panel.querySelector(".sub-setting-activate").onclick = function () {
      var code = cleanCode(panel.querySelector("input").value);
      var msg = panel.querySelector(".sub-settings-message");
      if (code.length !== 6) { msg.textContent = "Entrez exactement 6 lettres/chiffres."; return; }
      msg.textContent = "Vérification…";
      activate(code, detectedType(), function () { msg.textContent = "Abonnement activé."; setTimeout(function () { location.reload(); }, 600); }, function (e) { msg.textContent = messageFor(e); });
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
    verifySaved(function () {
      homeStatus();
      settingsPanel();
      adaptPhoneSettings();
      protectFeatures();
      blockDirectMarketPage();
    });
  });
})();
