(function(){
  const key='carplay_notifications_enabled';
  const introKey='carplay_notifications_intro_answered_v207';
  function enabled(){return localStorage.getItem(key)==='1'}
  function update(){
    const on=enabled(),box=document.getElementById('appNotificationToggle'),status=document.getElementById('appNotificationStatus');
    if(box)box.checked=on;
    if(status){status.textContent=on?'✅ TOUTES LES NOTIFICATIONS SONT ACTIVÉES SUR CE TÉLÉPHONE.':'🔕 AUCUNE NOTIFICATION NE SERA REÇUE SUR CE TÉLÉPHONE.';status.className='settingNote '+(on?'notifications-on':'notifications-off')}
  }
  function pushKey(value){const pad='='.repeat((4-value.length%4)%4),raw=atob((value+pad).replace(/-/g,'+').replace(/_/g,'/')),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
  async function tellWorker(registration,on){try{if('caches'in window){const cache=await caches.open('carplay-notification-preference-v1');await cache.put('/__carplay_notifications_enabled__',new Response(on?'1':'0'))}const worker=registration.active||registration.waiting||registration.installing;if(worker)worker.postMessage({type:'CARPLAY_NOTIFICATIONS_PREFERENCE',enabled:!!on})}catch(e){}}
  async function syncAdminPush(registration){
    const secret=localStorage.getItem('carplay_admin_secret');
    if(!enabled()||localStorage.getItem('carplay_admin_here')!=='1'||!secret||!('PushManager'in window))return;
    let r=await fetch('/api/admin/gps-push',{headers:{authorization:'Bearer '+secret},cache:'no-store'}),j=await r.json();
    if(!r.ok)throw new Error(j.error||'Configuration des notifications impossible.');
    let sub=await registration.pushManager.getSubscription();
    if(!sub)sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushKey(j.publicKey)});
    r=await fetch('/api/admin/gps-push',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:JSON.stringify({subscription:sub.toJSON()})});
    if(!r.ok)throw new Error('Enregistrement des notifications impossible.');
  }
  async function sync(){
    if(!('serviceWorker'in navigator))return;
    const registration=await navigator.serviceWorker.register('/sw.js?v=20260912-notifications-globales2');
    await navigator.serviceWorker.ready;
    await tellWorker(registration,enabled());
    if(enabled()&&'Notification'in window&&Notification.permission==='granted')await syncAdminPush(registration);
  }
  async function enable(){
    if(!('Notification'in window)||!('serviceWorker'in navigator))throw new Error('Notifications indisponibles sur ce téléphone.');
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw new Error('Autorisation refusée dans les réglages du téléphone.');
    localStorage.setItem(key,'1');
    await sync();
    update();
    dispatchEvent(new CustomEvent('carplay-notifications-changed',{detail:{enabled:true}}));
  }
  async function disable(){
    localStorage.setItem(key,'0');
    try{const registration=await navigator.serviceWorker.getRegistration();if(registration){await tellWorker(registration,false);const sub=await registration.pushManager.getSubscription();if(sub)await sub.unsubscribe()}}catch(e){}
    update();
    dispatchEvent(new CustomEvent('carplay-notifications-changed',{detail:{enabled:false}}));
  }
  async function notify(title,options){
    if(!enabled()||!('Notification'in window)||Notification.permission!=='granted'||!('serviceWorker'in navigator))return false;
    const registration=await navigator.serviceWorker.ready;await registration.showNotification(title,options||{});return true;
  }
  window.CarPlayNotifications={enabled:enabled,enable:enable,disable:disable,sync:sync,notify:notify};
  function showFirstNotificationIntro(){
    try{
      if(!('Notification' in window)||!('serviceWorker' in navigator))return;
      if(Notification.permission==='granted'){
        localStorage.setItem(key,'1');localStorage.setItem(introKey,'1');update();sync().catch(function(){});return;
      }
      if(Notification.permission==='denied'){
        localStorage.setItem(key,'0');localStorage.setItem(introKey,'1');update();return;
      }
      if(localStorage.getItem(introKey)==='1')return;
      if(localStorage.getItem(key)===null)localStorage.setItem(key,'1');
      const veil=document.createElement('div');
      veil.id='carplayNotificationIntroVeil';
      veil.style.cssText='position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif';
      const bubble=document.createElement('div');
      bubble.setAttribute('role','button');bubble.setAttribute('tabindex','0');bubble.setAttribute('aria-label','Continuer vers la demande de notifications de l’iPhone');
      bubble.style.cssText='width:min(520px,94vw);background:#101923;border:4px solid #ff9f13;border-radius:26px;padding:22px 20px;color:#fff;text-align:center;box-shadow:0 18px 55px #000;font-size:18px;font-weight:800;line-height:1.38;cursor:pointer';
      bubble.innerHTML='<div style="font-size:30px;margin-bottom:7px">🔔 NOTIFICATIONS</div><div>Activez-les pour recevoir les mises à jour des <b>marchés hebdomadaires</b>, <b>brocantes</b>, <b>marchés de Noël</b>, les changements d’horaires ou de lieu, les nouveautés importantes et les rappels avant la fin de votre abonnement.</div><div style="margin-top:13px;color:#ffd36a;font-size:16px">Touchez cette bulle : l’iPhone vous demandera ensuite si vous voulez autoriser les notifications.</div>';
      veil.appendChild(bubble);document.body.appendChild(veil);
      let busy=false;
      async function ask(){
        if(busy)return;busy=true;
        try{await enable();}
        catch(e){localStorage.setItem(key,'0');update();}
        finally{localStorage.setItem(introKey,'1');veil.remove();busy=false;}
      }
      bubble.addEventListener('click',ask);
      bubble.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();ask();}});
    }catch(e){}
  }
  addEventListener('DOMContentLoaded',function(){
    if(enabled()&&'Notification'in window&&Notification.permission==='denied')localStorage.setItem(key,'0');
    const box=document.getElementById('appNotificationToggle');
    if(box)box.onchange=async function(){this.disabled=true;try{this.checked?await enable():await disable()}catch(e){localStorage.setItem(key,'0');alert(e.message||e)}finally{this.disabled=false;update()}};
    update();sync().catch(function(){});setTimeout(showFirstNotificationIntro,500);
  });
})();
