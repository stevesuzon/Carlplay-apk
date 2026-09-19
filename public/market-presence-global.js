(function(){
  'use strict';
  var disabled=new Set(),signature='',busy=false,timer=0;
  function apply(){
    var nodes=document.querySelectorAll('[data-market-key]');
    for(var i=0;i<nodes.length;i++){
      var card=nodes[i],key=String(card.getAttribute('data-market-key')||'');
      if(!key)continue;
      if(disabled.has(key)){
        card.dataset.serverPresenceHidden='1';
        card.style.setProperty('display','none','important');
        try{localStorage.setItem('marketPresenceV174:'+key,'non')}catch(e){}
      }else if(card.dataset.serverPresenceHidden==='1'){
        delete card.dataset.serverPresenceHidden;
        if(card.dataset.marketDisabled!=='1')card.style.removeProperty('display');
        try{if(localStorage.getItem('marketPresenceV174:'+key)==='non')localStorage.removeItem('marketPresenceV174:'+key)}catch(e){}
      }
    }
  }
  async function sync(){
    if(busy)return false;busy=true;
    try{
      var r=await fetch('/api/market-presence/disabled',{cache:'no-store'}),j=await r.json();
      if(!r.ok||!j||!Array.isArray(j.keys))throw 0;
      var keys=j.keys.map(String).filter(Boolean),nextSig=keys.slice().sort().join('\n'),changed=nextSig!==signature;
      signature=nextSig;disabled=new Set(keys);window.CARPLAY_DISABLED_MARKETS=disabled;apply();
      return changed;
    }catch(e){apply();return false}finally{busy=false}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(apply,30)}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('pageshow',sync);window.addEventListener('focus',sync);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)sync()});
  setInterval(function(){if(!document.hidden)sync()},30000);
  sync();
})();
