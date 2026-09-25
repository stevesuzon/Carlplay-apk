(function(){
  const key='carplay_notifications_enabled';
  const introKey='carplay_notifications_intro_answered_v207';
  const pendingSettingsKey='carplay_notifications_waiting_settings_v239';
  function enabled(){return localStorage.getItem(key)==='1'}
  function permission(){try{return ('Notification' in window)?Notification.permission:'unsupported'}catch(e){return 'unsupported'}}
  function isIOS(){return /iPad|iPhone|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1)}
  function isAndroid(){return /Android/i.test(navigator.userAgent)}
  function update(){
    const on=enabled()&&permission()==='granted',box=document.getElementById('appNotificationToggle'),status=document.getElementById('appNotificationStatus');
    if(box)box.checked=on;
    if(status){
      if(on){status.textContent='✅ TOUTES LES NOTIFICATIONS SONT ACTIVÉES SUR CE TÉLÉPHONE.';status.className='settingNote notifications-on'}
      else if(permission()==='denied'){status.textContent='🔕 AUTORISATION BLOQUÉE DANS LES RÉGLAGES DU TÉLÉPHONE. APPUYEZ SUR LA CASE POUR ALLER L’ACTIVER.';status.className='settingNote notifications-off'}
      else{status.textContent='🔕 AUCUNE NOTIFICATION NE SERA REÇUE SUR CE TÉLÉPHONE.';status.className='settingNote notifications-off'}
    }
    renderSettingsShortcut();
  }
  function renderSettingsShortcut(){
    const status=document.getElementById('appNotificationStatus');
    if(!status)return;
    let b=document.getElementById('appNotificationSettingsBtn');
    if(permission()!=='denied'){
      if(b)b.remove();
      return;
    }
    if(!b){
      b=document.createElement('button');b.id='appNotificationSettingsBtn';b.type='button';
      b.textContent='⚙️ OUVRIR L’ENDROIT POUR ACTIVER LES NOTIFICATIONS';
      b.style.cssText='display:block;width:calc(100% - 16px);margin:12px 8px 4px;padding:15px 12px;border:0;border-radius:14px;background:#1976e9;color:#fff;font-size:17px;font-weight:950;line-height:1.18;box-shadow:0 5px 16px #0006';
      status.insertAdjacentElement('afterend',b);
      b.onclick=function(){showSettingsHelp(true)};
    }
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
    const registration=await navigator.serviceWorker.register('/sw.js?v=462-voix-globale-oise',{updateViaCache:'none'});
    await registration.update().catch(function(){});
    if(registration.waiting)registration.waiting.postMessage({type:'SKIP_WAITING'});
    await navigator.serviceWorker.ready;
    await tellWorker(registration,enabled()&&permission()==='granted');
    if(enabled()&&permission()==='granted')await syncAdminPush(registration);
  }
  function settingsInstructions(){
    if(isIOS())return '<b>iPhone / iPad :</b><br>Réglages → Notifications → <b>Couteau Suisse</b> → activez <b>Autoriser les notifications</b>.';
    if(isAndroid())return '<b>Android :</b><br>Réglages → Applications → <b>Couteau Suisse</b> (ou votre navigateur) → Notifications → <b>Autoriser</b>.';
    return '<b>Réglages du téléphone ou du navigateur :</b><br>ouvrez les autorisations de <b>Couteau Suisse</b> puis activez les notifications.';
  }
  function tryOpenSystemSettings(){
    localStorage.setItem(pendingSettingsKey,'1');
    try{
      if(isIOS()){
        // iOS ne fournit pas de lien Web officiel vers une page précise. Ce lien ouvre Réglages lorsqu’il est accepté par le système.
        window.location.href='app-settings:';
        return true;
      }
      if(isAndroid()){
        // Tentative d’ouverture des réglages Android ; selon le navigateur/PWA, Android peut demander de choisir l’écran approprié.
        window.location.href='intent:#Intent;action=android.settings.SETTINGS;end';
        return true;
      }
    }catch(e){}
    return false;
  }
  function showSettingsHelp(autoOpen){
    let old=document.getElementById('carplayNotificationSettingsVeil');if(old)old.remove();
    const veil=document.createElement('div');veil.id='carplayNotificationSettingsVeil';
    veil.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif';
    const box=document.createElement('div');box.style.cssText='width:min(540px,95vw);background:#101923;border:4px solid #ff9f13;border-radius:24px;padding:20px;color:#fff;text-align:center;box-shadow:0 18px 55px #000;font-size:18px;line-height:1.38';
    box.innerHTML='<div style="font-size:29px;font-weight:950;margin-bottom:8px">🔔 ACTIVER LES NOTIFICATIONS</div><div style="margin-bottom:16px">Vous les avez déjà refusées. L’application ne peut plus refaire apparaître la fenêtre d’autorisation toute seule.</div><div style="padding:13px;border-radius:14px;background:#18283b;text-align:left">'+settingsInstructions()+'</div><button id="carplayOpenPhoneSettings" type="button" style="width:100%;margin-top:16px;padding:15px;border:0;border-radius:14px;background:#1976e9;color:#fff;font-weight:950;font-size:18px">⚙️ OUVRIR LES RÉGLAGES DU TÉLÉPHONE</button><button id="carplayCheckNotificationPermission" type="button" style="width:100%;margin-top:10px;padding:14px;border:0;border-radius:14px;background:#1b9b58;color:#fff;font-weight:950;font-size:17px">✓ J’AI ACTIVÉ — VÉRIFIER</button><button id="carplayCloseNotificationHelp" type="button" style="width:100%;margin-top:10px;padding:12px;border:1px solid #ffffff55;border-radius:14px;background:#202b39;color:#fff;font-weight:850;font-size:16px">FERMER</button>';
    veil.appendChild(box);document.body.appendChild(veil);
    document.getElementById('carplayOpenPhoneSettings').onclick=function(){tryOpenSystemSettings()};
    document.getElementById('carplayCheckNotificationPermission').onclick=async function(){
      if(permission()==='granted'){
        localStorage.setItem(key,'1');localStorage.removeItem(pendingSettingsKey);await sync().catch(function(){});update();veil.remove();alert('✅ Notifications activées.');
      }else if(permission()==='default'){
        const p=await Notification.requestPermission();
        if(p==='granted'){localStorage.setItem(key,'1');localStorage.removeItem(pendingSettingsKey);await sync().catch(function(){});update();veil.remove();alert('✅ Notifications activées.')}else update();
      }else{
        alert('Les notifications sont encore bloquées. Activez « Autoriser les notifications » dans les réglages, puis revenez ici.');
      }
    };
    document.getElementById('carplayCloseNotificationHelp').onclick=function(){veil.remove();update()};
    if(autoOpen){setTimeout(function(){tryOpenSystemSettings()},120)}
  }
  async function enable(){
    if(!('Notification'in window)||!('serviceWorker'in navigator))throw new Error('Notifications indisponibles sur ce téléphone.');
    if(permission()==='denied'){
      localStorage.setItem(key,'0');update();showSettingsHelp(true);return false;
    }
    let p=permission();
    if(p==='default')p=await Notification.requestPermission();
    if(p!=='granted'){
      localStorage.setItem(key,'0');update();
      if(p==='denied')showSettingsHelp(true);
      return false;
    }
    localStorage.setItem(key,'1');localStorage.removeItem(pendingSettingsKey);
    await sync();update();dispatchEvent(new CustomEvent('carplay-notifications-changed',{detail:{enabled:true}}));return true;
  }
  async function disable(){
    localStorage.setItem(key,'0');localStorage.removeItem(pendingSettingsKey);
    try{const registration=await navigator.serviceWorker.getRegistration();if(registration){await tellWorker(registration,false);const sub=await registration.pushManager.getSubscription();if(sub)await sub.unsubscribe()}}catch(e){}
    update();dispatchEvent(new CustomEvent('carplay-notifications-changed',{detail:{enabled:false}}));
  }
  async function notify(title,options){
    if(!enabled()||permission()!=='granted'||!('serviceWorker'in navigator))return false;
    const registration=await navigator.serviceWorker.ready;await registration.showNotification(title,options||{});return true;
  }
  async function checkAfterSettings(){
    if(localStorage.getItem(pendingSettingsKey)!=='1')return;
    if(permission()==='granted'){
      localStorage.setItem(key,'1');localStorage.removeItem(pendingSettingsKey);await sync().catch(function(){});update();dispatchEvent(new CustomEvent('carplay-notifications-changed',{detail:{enabled:true}}));
    }else update();
  }
  window.CarPlayNotifications={enabled:enabled,enable:enable,disable:disable,sync:sync,notify:notify,openSettings:function(){showSettingsHelp(true)}};
  function showFirstNotificationIntro(){
    try{
      if(!('Notification' in window)||!('serviceWorker' in navigator))return;
      if(permission()==='granted'){
        localStorage.setItem(key,'1');localStorage.setItem(introKey,'1');update();sync().catch(function(){});return;
      }
      if(permission()==='denied'){
        localStorage.setItem(key,'0');localStorage.setItem(introKey,'1');update();return;
      }
      if(localStorage.getItem(introKey)==='1')return;
      if(localStorage.getItem(key)===null)localStorage.setItem(key,'1');
      const veil=document.createElement('div');
      veil.id='carplayNotificationIntroVeil';
      veil.style.cssText='position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif';
      const bubble=document.createElement('div');
      bubble.setAttribute('role','button');bubble.setAttribute('tabindex','0');bubble.setAttribute('aria-label','Continuer vers la demande de notifications du téléphone');
      bubble.style.cssText='width:min(520px,94vw);background:#101923;border:4px solid #ff9f13;border-radius:26px;padding:22px 20px;color:#fff;text-align:center;box-shadow:0 18px 55px #000;font-size:18px;font-weight:800;line-height:1.38;cursor:pointer';
      bubble.innerHTML='<div style="font-size:30px;margin-bottom:7px">🔔 NOTIFICATIONS</div><div>Activez-les pour recevoir les mises à jour des <b>marchés hebdomadaires</b>, <b>brocantes</b>, <b>marchés de Noël</b>, les changements d’horaires ou de lieu, les nouveautés importantes et les rappels avant la fin de votre abonnement.</div><div style="margin-top:13px;color:#ffd36a;font-size:16px">Touchez cette bulle : le téléphone vous demandera ensuite si vous voulez autoriser les notifications.</div>';
      veil.appendChild(bubble);document.body.appendChild(veil);
      let busy=false;
      async function ask(){
        if(busy)return;busy=true;
        try{await enable();}
        catch(e){localStorage.setItem(key,'0');update();}
        finally{localStorage.setItem(introKey,'1');if(document.body.contains(veil))veil.remove();busy=false;}
      }
      bubble.addEventListener('click',ask);
      bubble.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();ask();}});
    }catch(e){}
  }
  addEventListener('DOMContentLoaded',function(){
    if(enabled()&&permission()==='denied')localStorage.setItem(key,'0');
    const box=document.getElementById('appNotificationToggle');
    if(box)box.onchange=async function(){this.disabled=true;try{if(this.checked){const ok=await enable();if(!ok)this.checked=false}else await disable()}catch(e){localStorage.setItem(key,'0');alert(e.message||e)}finally{this.disabled=false;update()}};
    update();sync().catch(function(){});setTimeout(showFirstNotificationIntro,500);
  });
  addEventListener('focus',function(){checkAfterSettings().catch(function(){})});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)checkAfterSettings().catch(function(){})});
  addEventListener('pageshow',function(){checkAfterSettings().catch(function(){})});
})();
