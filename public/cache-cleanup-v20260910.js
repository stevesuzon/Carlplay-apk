(function(){
  'use strict';
  var V='20260912-pwa-only-beta-autoradio1';
  var C='carplay-v5-20260912-pwa-only-beta-autoradio1';
  var K='carplay_cache_cleanup_version';

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
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyPwaOnlyUi);else applyPwaOnlyUi();

  if(localStorage.getItem(K)===V)return;
  function done(){try{localStorage.setItem(K,V)}catch(e){}}
  if('caches' in window){
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(name){return name!==C}).map(function(name){return caches.delete(name)}));
    }).then(done).catch(done);
  }else done();
})();
