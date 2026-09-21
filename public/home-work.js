(function(){
  var path=location.pathname.replace(/\/+$/,'')||'/';
  function removeBigArticleButton(){
    ['homeArticleBtn','homeArticleModal'].forEach(function(id){var el=document.getElementById(id);if(el)el.remove()});
    document.querySelectorAll('.articleTile').forEach(function(el){el.remove()});
    document.querySelectorAll('.grid a,.grid button,.grid .card,#homeWorkLinks a,#homeWorkLinks button').forEach(function(el){
      if(el.id==='directArticle')return;
      var t=(el.textContent||'').replace(/\s+/g,' ').trim().toUpperCase();
      if(t==='ARTICLE DE TRAVAIL'||t.indexOf('ARTICLE DE TRAVAIL')!==-1){el.remove()}
    });
  }
  function homeExtras(){
    removeBigArticleButton();
    var grid=document.querySelector('.grid');if(!grid)return;
    /* Le gros bouton Article de travail est volontairement supprimé. Le petit bouton flottant #directArticle reste le seul accès. */
  }
  function belgiqueLock(){
    /* La déclaration belge reste libre. Seuls les PDF et informations du dossier sont protégés dans documents-travail.html. */
    return;
  }
  function syncMarketsAutomatically(){
    if(path!=='/'&&path!=='/index.html')return;
    var menu=document.getElementById('updateMenu'),row=menu&&menu.closest('.settingRow');if(row)row.remove();
    if(!navigator.onLine)return;
    var previous=Date.parse(localStorage.getItem('markets_last_update')||'')||0;
    if(previous && Date.now()-previous < 10*60*1000)return;
    var stamp=Date.now();
    fetch('/api/markets?automatic_update='+stamp,{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('sync');return r.json()}).then(function(j){
      localStorage.setItem('server_markets',JSON.stringify(j.markets||[]));
      localStorage.setItem('markets_last_update',new Date().toISOString());
    }).catch(function(){});
  }
  if(path==='/'||path==='/index.html'){
    homeExtras();syncMarketsAutomatically();
    addEventListener('load',removeBigArticleButton);
    setTimeout(removeBigArticleButton,250);
    setTimeout(removeBigArticleButton,1200);
  }
  belgiqueLock();
})();


(function presenceCounter(){
  var path=(location.pathname||'').replace(/\/+$/,'')||'/';
  if(path!=='/'&&path!=='/index.html')return;
  function deviceId(){
    var v=localStorage.getItem('carplay_device_id');
    if(!v){v=(crypto.randomUUID?crypto.randomUUID():'dev-'+Date.now()+'-'+Math.random().toString(36).slice(2));localStorage.setItem('carplay_device_id',v);}
    return v;
  }
  function loadCount(){
    var el=document.getElementById('homeOnlineCount');if(!el)return;
    if(!navigator.onLine){el.textContent='—';return;}
    fetch('/api/presence',{cache:'no-store'}).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})}).then(function(x){el.textContent=(x.ok&&x.j&&x.j.ok)?Math.max(0,Number(x.j.count||0)):'—';}).catch(function(){el.textContent='—';});
  }
  function ping(){
    if(!navigator.onLine)return;
    fetch('/api/presence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:deviceId()}),cache:'no-store'}).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})}).then(function(x){var el=document.getElementById('homeOnlineCount');if(el)el.textContent=(x.ok&&x.j&&x.j.ok)?Math.max(0,Number(x.j.count||0)):'—';}).catch(function(){});
  }
  setTimeout(function(){ping();},250);
  setInterval(function(){if(!document.hidden){ping();loadCount();}},120000);
  addEventListener('online',function(){ping();loadCount();});
})();
