(function(){
  'use strict';
  var V='20260912-server-sync-v150';
  var C='carplay-v5-20260912-server-sync-v150';
  var K='carplay_cache_cleanup_version';
  var UPDATE_KEY='carplay_update_notice_seen';
  var UPDATE_ID='2026-09-12-server-sync-v150';

  function applyPwaOnlyUi(){
    var body=document.getElementById('radioMenu');
    if(!body)return;
    var row=body.closest?body.closest('.settingRow'):null;
    var head=row&&row.querySelector?row.querySelector('.settingHead span:first-child'):null;
    if(head)head.textContent='📻 Bêta — en cours de construction';
    Array.prototype.slice.call(body.querySelectorAll('button')).forEach(function(btn){
      var action=String(btn.getAttribute('onclick')||'');
      if(action.indexOf('download-autoradio.apk')!==-1)btn.remove();
    });
    var guide=document.getElementById('usbGuide');
    if(guide){
      guide.innerHTML='<b>1️⃣ La bêta autoradio est en cours de construction.</b><br><b>2️⃣ Quand elle sera disponible, copie le fichier d’installation sur une clé USB.</b><br><b>3️⃣ Branche la clé USB sur l’autoradio.</b><br><b>4️⃣ Ouvre la clé dans le gestionnaire de fichiers.</b><br><b>5️⃣ Ouvre le fichier d’installation puis suis les instructions affichées.</b><br><b>6️⃣ Ouvre CarPlay.</b><br><br>🔑 Le guide USB est conservé pour la future bêta autoradio.';
    }
  }

  function showUpdateNotice(){
    try{if(localStorage.getItem(UPDATE_KEY)===UPDATE_ID)return;}catch(e){}
    if(document.getElementById('cpUpdateOverlayV150'))return;
    var overlay=document.createElement('div');
    overlay.id='cpUpdateOverlayV150';
    overlay.style.cssText='position:fixed;z-index:2147483647;inset:0;background:rgba(0,0,0,.84);display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif';
    overlay.innerHTML='<div style="width:min(560px,94vw);background:#0d1826;color:#fff;border:3px solid #ff9f1a;border-radius:22px;padding:22px;box-shadow:0 18px 55px #000;text-align:left">'
      +'<div style="font-size:27px;font-weight:950;text-align:center;color:#ffd166;margin-bottom:16px">✅ MISE À JOUR EFFECTUÉE</div>'
      +'<div style="font-size:17px;line-height:1.55;font-weight:750">'
      +'<div>📷 Photos des marchés : synchronisation depuis le serveur commun.</div>'
      +'<div style="margin-top:9px">📍 Coordonnées GPS validées : partagées avec tous les utilisateurs.</div>'
      +'<div style="margin-top:9px">🔄 La fiche se rafraîchit au retour dans l’application et automatiquement toutes les 15 secondes.</div>'
      +'</div>'
      +'<button id="cpUpdateCloseV150" type="button" style="width:100%;margin-top:19px;padding:14px;border:0;border-radius:13px;background:#ff9f1a;color:#111;font-size:18px;font-weight:950">OK — J’AI VU</button>'
      +'</div>';
    document.body.appendChild(overlay);
    var close=document.getElementById('cpUpdateCloseV150');
    if(close)close.onclick=function(){
      try{localStorage.setItem(UPDATE_KEY,UPDATE_ID);}catch(e){}
      if(overlay&&overlay.parentNode)overlay.parentNode.removeChild(overlay);
    };
  }

  function boot(){
    applyPwaOnlyUi();
    setTimeout(showUpdateNotice,450);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();

  if(localStorage.getItem(K)===V)return;
  function done(){try{localStorage.setItem(K,V)}catch(e){}}
  if('caches' in window){
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(name){return name!==C}).map(function(name){return caches.delete(name)}));
    }).then(done).catch(done);
  }else done();
})();
