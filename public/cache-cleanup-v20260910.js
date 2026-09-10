(function(){
  'use strict';
  var V='20260910-v5-devis-zoom-toiture-marge15-cachefix1';
  var C='carplay-v5-20260910-adresses-devis2';
  var K='carplay_cache_cleanup_version';
  if(localStorage.getItem(K)===V)return;
  function done(){try{localStorage.setItem(K,V)}catch(e){}}
  if('caches' in window){
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(name){return name!==C}).map(function(name){return caches.delete(name)}));
    }).then(done).catch(done);
  }else done();
})();
