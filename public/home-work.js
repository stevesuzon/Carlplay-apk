(function(){
  var path=location.pathname.replace(/\/+$/,'')||'/';
  function syncMarketsAutomatically(){
    if(path!=='/'&&path!=='/index.html')return;
    var menu=document.getElementById('updateMenu'),row=menu&&menu.closest('.settingRow');if(row)row.remove();
    if(!navigator.onLine)return;
    var stamp=Date.now();
    fetch('/api/markets?automatic_update='+stamp,{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('sync');return r.json()}).then(function(j){
      localStorage.setItem('server_markets',JSON.stringify(j.markets||[]));
      localStorage.setItem('markets_last_update',new Date().toISOString());
    }).catch(function(){});
  }
  if(path==='/'||path==='/index.html'){
    syncMarketsAutomatically();
  }
})();


(function presenceCounter(){
  var path=(location.pathname||'').replace(/\/+$/,'')||'/';
  if(path!=='/'&&path!=='/index.html')return;
  function deviceId(){
    var v=localStorage.getItem('carplay_device_id');
    if(!v){v=(crypto.randomUUID?crypto.randomUUID():'dev-'+Date.now()+'-'+Math.random().toString(36).slice(2));localStorage.setItem('carplay_device_id',v);}
    return v;
  }
  var box=document.getElementById('onlineUsers');
  if(!box){box=document.createElement('div');box.id='onlineUsers';box.textContent='🟢 Connexion…';document.body.appendChild(box);}
  function placeBox(){
    var trial=document.getElementById('subscriptionHomeStatus');
    box.style.top=trial?'58px':'max(7px, env(safe-area-inset-top))';
    box.style.left='8px';
  }
  function ping(){
    if(!navigator.onLine){box.textContent='🔴 0 personne connectée';placeBox();return;}
    fetch('/api/presence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:deviceId()}),cache:'no-store'})
      .then(function(r){return r.json()})
      .then(function(j){var n=Math.max(0,Number(j.count||0));box.textContent='🟢 '+n+' personne'+(n>1?'s':'')+' connectée'+(n>1?'s':'');placeBox();})
      .catch(function(){box.textContent='🟠 Compteur indisponible';placeBox();});
  }
  setTimeout(ping,250);
  setInterval(ping,45000);
  addEventListener('online',ping);
  addEventListener('offline',ping);
})();


(function installedHomeScreenPresence(){
  var path=(location.pathname||'').replace(/\/+$/,'')||'/';
  if(path!=='/'&&path!=='/index.html')return;
  var standalone=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone===true;
  if(!standalone)return;
  function id(){
    var v=localStorage.getItem('carplay_install_device_id')||localStorage.getItem('carplay_device_id');
    if(!v){v=(crypto.randomUUID?crypto.randomUUID():'dev-'+Date.now()+'-'+Math.random().toString(36).slice(2));}
    localStorage.setItem('carplay_install_device_id',v);
    return v;
  }
  function ping(){
    if(!navigator.onLine)return;
    fetch('/api/installed-presence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:id()}),cache:'no-store',keepalive:true}).catch(function(){});
  }
  setTimeout(ping,500);
  addEventListener('online',ping);
})();
