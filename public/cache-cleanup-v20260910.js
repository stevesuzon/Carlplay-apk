(function(){
'use strict';
var V='20260924-v450-cache-stable',K='carplay_cache_cleanup_version';
var KEEP={
  'couteau-suisse-runtime-code-v1':1,
  'couteau-suisse-module-icons-v283':1,
  'couteau-suisse-module-contest-v439-direct':1,
  'couteau-suisse-module-admin-v439-market-list':1,
  'couteau-suisse-module-data-v426-current':1,
  'couteau-suisse-module-install-v426-current':1,
  'couteau-suisse-module-stats-v362':1,
  'couteau-suisse-module-mushroom-v300':1,
  'couteau-suisse-module-subscription-v441-syntax-fix':1,
  'couteau-suisse-module-autoradio-v386-responsive-images':1,
  'couteau-suisse-module-phone-ui-v432-home-clean':1,
  'carplay-notification-preference-v1':1
};
function owned(name){return name==='carplay-notification-preference-v1'||/^couteau-suisse-(?:module|runtime)-/.test(name)}
function done(){try{localStorage.setItem(K,V)}catch(_){}}
try{if(localStorage.getItem(K)===V)return}catch(_){}
if(!('caches'in window)){done();return}
caches.keys().then(function(keys){
  return Promise.all(keys.filter(function(name){return owned(name)&&!KEEP[name]}).map(function(name){return caches.delete(name)}));
}).then(done).catch(done);
})();