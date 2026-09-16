(function(){
'use strict';
var V='20260916-modules-v283',K='carplay_cache_cleanup_version';
var KEEP={
  'couteau-suisse-module-icons-v283':1,
  'couteau-suisse-module-contest-v283':1,
  'couteau-suisse-module-data-v283':1,
  'couteau-suisse-module-install-v283':1,
  'carplay-notification-preference-v1':1
};
function obsoleteModule(name){return (/^couteau-suisse-module-icons-v/.test(name)||/^couteau-suisse-module-contest-v/.test(name)||/^couteau-suisse-module-data-v/.test(name)||/^couteau-suisse-module-install-v/.test(name))&&!KEEP[name]}
function done(){try{localStorage.setItem(K,V)}catch(_){}}
if(localStorage.getItem(K)===V)return;
if('caches' in window)caches.keys().then(function(keys){return Promise.all(keys.filter(obsoleteModule).map(function(n){return caches.delete(n)}))}).then(done).catch(done);else done();
})();