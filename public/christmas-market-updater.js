
(function(){
  const REMOTE_URL = '/marches-noel.json';
  const CACHE_KEY = 'carplay_marches_noel_cache_v1';
  const CACHE_DATE_KEY = 'carplay_marches_noel_cache_date_v1';

  async function loadChristmasMarkets(){
    let data = null;
    try{
      const r = await fetch(REMOTE_URL + '?t=' + Date.now(), {cache:'no-store'});
      if(r.ok){
        const fresh = await r.json();
        if(fresh && (Array.isArray(fresh.france) || Array.isArray(fresh.belgique))){
          data = fresh;
          localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
          localStorage.setItem(CACHE_DATE_KEY, new Date().toISOString());
        }
      }
    }catch(e){}

    if(!data){
      try{ data = JSON.parse(localStorage.getItem(CACHE_KEY)||'null'); }catch(e){}
    }
    if(!data){
      data = {france:[], belgique:[]};
    }
    window.CARPLAY_CHRISTMAS_MARKETS = data;
    window.dispatchEvent(new CustomEvent('carplay-christmas-markets-updated',{detail:data}));
    return data;
  }

  window.loadChristmasMarkets = loadChristmasMarkets;
  loadChristmasMarkets();

  // Vérifie une nouvelle version toutes les 6 h tant que l'application reste ouverte.
  setInterval(loadChristmasMarkets, 6*60*60*1000);
})();
