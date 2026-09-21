(function(){
  'use strict';
  if(window.__marketUpdateNotificationsV281)return;
  window.__marketUpdateNotificationsV281=true;
  var LAST_KEY='carplay_market_update_announcement_last_id';
  var checking=false,queue=[];
  function notificationsEnabled(){return localStorage.getItem('carplay_notifications_enabled')==='1'}
  function lastId(){return Math.max(0,Number(localStorage.getItem(LAST_KEY)||0))}
  function remember(id){try{localStorage.setItem(LAST_KEY,String(Math.max(lastId(),Number(id)||0)))}catch(e){}}
  function removeBubble(){var old=document.getElementById('marketUpdateBubbleV281');if(old)old.remove()}
  function notifyPhone(item,title,body){
    try{
      if(!notificationsEnabled()||!('Notification'in window)||Notification.permission!=='granted'||!('serviceWorker'in navigator))return;
      navigator.serviceWorker.ready.then(function(registration){return registration.showNotification(title,{body:body,icon:'/couteau-suisse-192.png?v=281',badge:'/couteau-suisse-192.png?v=281',tag:'market-update-'+item.id,renotify:true,data:{url:'/index.html'}})}).catch(function(){});
    }catch(e){}
  }
  function showNext(){
    removeBubble();
    if(!queue.length)return;
    var item=queue[0],first=String(item.first_name||'Une personne').trim()||'Une personne',market=String(item.market_name||'Marché').trim()||'Marché',kind=String(item.update_kind||'la fiche').trim()||'la fiche';
    var title=first+' a mis à jour le marché';
    var body='« '+market+' » : '+kind+'.';
    var veil=document.createElement('div');veil.id='marketUpdateBubbleV281';veil.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif';
    var box=document.createElement('div');box.style.cssText='width:min(560px,94vw);background:linear-gradient(155deg,#12283b,#08111c);border:4px solid #ff9f18;border-radius:28px;padding:24px 20px;color:#fff;text-align:center;box-shadow:0 20px 60px #000;font-weight:850';
    var who=document.createElement('div');who.style.cssText='font-size:clamp(27px,7vw,38px);font-weight:1000;color:#ffd25f;line-height:1.08;margin-bottom:15px';who.textContent=title;
    var text=document.createElement('div');text.style.cssText='font-size:clamp(18px,5vw,25px);font-weight:900;line-height:1.35';text.textContent=body;
    var button=document.createElement('button');button.type='button';button.textContent=queue.length>1?'VOIR LA SUIVANTE':'OK — J’AI VU';button.style.cssText='width:100%;margin-top:21px;padding:15px;border:0;border-radius:14px;background:#ff9f18;color:#111;font-size:18px;font-weight:1000';
    button.onclick=function(){remember(item.id);queue.shift();showNext()};
    box.appendChild(who);box.appendChild(text);box.appendChild(button);veil.appendChild(box);document.body.appendChild(veil);
    notifyPhone(item,title,body);
  }
  async function check(){
    if(checking)return;checking=true;
    try{
      var response=await fetch('/api/market-update-announcements?after='+encodeURIComponent(lastId())+'&_='+Date.now(),{cache:'no-store'}),data=await response.json();
      if(!response.ok||!data||!Array.isArray(data.announcements))return;
      var fresh=data.announcements.filter(function(x){return Number(x&&x.id)>lastId()});
      if(!fresh.length)return;
      if(!notificationsEnabled()){remember(fresh[fresh.length-1].id);return;}
      queue=fresh;
      if(!document.getElementById('marketUpdateBubbleV281'))showNext();
    }catch(e){}finally{checking=false}
  }
  addEventListener('DOMContentLoaded',function(){setTimeout(check,1100)});
  addEventListener('pageshow',check);
  addEventListener('focus',check);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)check()});
  setInterval(check,60000);
})();
