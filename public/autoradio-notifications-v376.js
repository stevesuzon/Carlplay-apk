(function(){
'use strict';
if(localStorage.getItem('carplay_device_type')!=='autoradio'&&!window.__COUTEAU_AUTORADIO__)return;
if(window.__autoradioNotificationsV376)return;
window.__autoradioNotificationsV376=true;

var KEY='carplay_notifications_enabled',queue=[],showing=false;
if(localStorage.getItem(KEY)===null)localStorage.setItem(KEY,'1');

function enabled(){return localStorage.getItem(KEY)!=='0'}
function updateSettings(){
  var box=document.getElementById('appNotificationToggle'),status=document.getElementById('appNotificationStatus');
  if(box){box.checked=enabled();box.onchange=function(){localStorage.setItem(KEY,this.checked?'1':'0');updateSettings()}}
  if(status){
    status.textContent=enabled()?'✅ NOTIFICATIONS ACTIVÉES SUR CET AUTORADIO.':'🔕 NOTIFICATIONS DÉSACTIVÉES SUR CET AUTORADIO.';
    status.className='settingNote '+(enabled()?'notifications-on':'notifications-off');
  }
}
function next(){
  if(showing||!queue.length||!enabled())return;
  showing=true;
  var n=queue.shift(),old=document.getElementById('autoradioNotificationV376');if(old)old.remove();
  var veil=document.createElement('div');veil.id='autoradioNotificationV376';
  veil.style.cssText='position:fixed;z-index:2147483646;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:18px;font-family:Arial,sans-serif';
  var box=document.createElement('div');
  box.style.cssText='width:min(650px,94vw);max-height:86vh;overflow:auto;background:linear-gradient(160deg,#10253a,#07111d);border:4px solid #ff9f18;border-radius:28px;padding:24px 20px;color:#fff;text-align:center;box-shadow:0 20px 65px #000';
  var title=document.createElement('div');title.style.cssText='font-size:clamp(25px,4vw,36px);font-weight:1000;line-height:1.15;color:#ffd35f;margin-bottom:14px';title.textContent=n.title||'Notification Couteau Suisse';
  var body=document.createElement('div');body.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:clamp(17px,2.5vw,23px);font-weight:850;line-height:1.45;background:#0d1b2a;border-radius:16px;padding:16px';body.textContent=n.body||'Une nouvelle information est disponible.';
  var close=document.createElement('button');close.type='button';close.textContent='OK — J’AI VU';close.style.cssText='width:100%;min-height:58px;margin-top:17px;border:0;border-radius:14px;background:#ff9f18;color:#111;font:950 18px Arial';
  close.onclick=function(){veil.remove();showing=false;setTimeout(next,80)};
  box.appendChild(title);box.appendChild(body);box.appendChild(close);veil.appendChild(box);document.body.appendChild(veil);
  setTimeout(function(){if(document.body.contains(veil)){veil.remove();showing=false;next()}},10000);
}
async function notify(title,options){
  if(!enabled())return false;
  options=options||{};
  queue.push({title:String(title||'Notification Couteau Suisse'),body:String(options.body||'')});
  next();return true;
}
window.CarPlayNotifications={
  enabled:enabled,
  enable:async function(){localStorage.setItem(KEY,'1');updateSettings();return true},
  disable:async function(){localStorage.setItem(KEY,'0');updateSettings();return true},
  sync:async function(){updateSettings();return true},
  notify:notify,
  openSettings:function(){try{if(typeof window.toggleSettings==='function')window.toggleSettings()}catch(_){}}
};
window.CarPlayAutoradioNotifications=window.CarPlayNotifications;
function init(){updateSettings();var pending=localStorage.getItem('autoradio_update_notice_v376');if(pending){localStorage.removeItem('autoradio_update_notice_v376');notify('✅ AUTORADIO MIS À JOUR',{body:pending})}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
