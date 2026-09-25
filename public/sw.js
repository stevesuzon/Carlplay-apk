const VERSION = "V479-MARKET-VOICE-ACTIONS";
const BASE_CACHE = "couteau-suisse-runtime-code-v479";
const ICON_CACHE = "couteau-suisse-module-icons-v283";
const CONTEST_CACHE = "couteau-suisse-module-contest-v439-direct";
const ADMIN_CACHE = "couteau-suisse-module-admin-v439-market-list";
const DATA_CACHE = "couteau-suisse-module-data-v426-current";
const INSTALL_CACHE = "couteau-suisse-module-install-v426-current";
const STATS_CACHE = "couteau-suisse-module-stats-v362";
const MUSHROOM_CACHE = "couteau-suisse-module-mushroom-v300";
const SUBSCRIPTION_CACHE = "couteau-suisse-module-subscription-v441-syntax-fix";
const AUTORADIO_CACHE = "couteau-suisse-module-autoradio-v386-responsive-images";
const PHONE_UI_CACHE = "couteau-suisse-module-phone-ui-v432-home-clean";
const NOTIFICATION_PREF_CACHE = "carplay-notification-preference-v1";
const NOTIFICATION_PREF_URL = "/__carplay_notifications_enabled__";
const NOTIFICATION_LAST_UPDATE_URL = "/__carplay_last_update_notification_version__";

const CURRENT_CACHES = new Set([
  BASE_CACHE, ICON_CACHE, CONTEST_CACHE, ADMIN_CACHE, DATA_CACHE, INSTALL_CACHE,
  STATS_CACHE, MUSHROOM_CACHE, SUBSCRIPTION_CACHE, AUTORADIO_CACHE,
  PHONE_UI_CACHE, NOTIFICATION_PREF_CACHE
]);

async function notificationsEnabled(){
  const cache=await caches.open(NOTIFICATION_PREF_CACHE),r=await cache.match(NOTIFICATION_PREF_URL);
  return !!r&&(await r.text())==="1";
}
async function saveNotificationPreference(enabled){
  const cache=await caches.open(NOTIFICATION_PREF_CACHE);
  await cache.put(NOTIFICATION_PREF_URL,new Response(enabled?"1":"0"));
}
function moduleCacheFor(path){
  if(path==="/phone-loading-v384.js")return PHONE_UI_CACHE;
  if(path.indexOf("/autoradio-assets-v386/")===0||path==="/autoradio-home-v386.js"||path==="/autoradio-subscription-v381.js"||path==="/autoradio-version.json")return AUTORADIO_CACHE;
  if(path==="/manifest.webmanifest"||/couteau-suisse-v283-/.test(path))return ICON_CACHE;
  if(path==="/contest-v188.js")return CONTEST_CACHE;
  if(path==="/contest-admin-v188.js"||path==="/admin.html")return ADMIN_CACHE;
  if(path==="/champignons.html"||path==="/champignons.js"||path==="/champignons.css")return MUSHROOM_CACHE;
  if(path==="/subscription-web.js")return SUBSCRIPTION_CACHE;
  if(path==="/persistent-user-data-v283.js")return DATA_CACHE;
  if(path==="/visitor-register-v361.js"||path==="/installer.html"||path==="/app-access-gate-v240.js"||path==="/cache-cleanup-v20260910.js")return INSTALL_CACHE;
  if(path==="/user-stats-v285.js")return STATS_CACHE;
  return BASE_CACHE;
}
function isOwnedCache(name){
  return name===NOTIFICATION_PREF_CACHE||name.indexOf("couteau-suisse-module-")===0||name.indexOf("couteau-suisse-runtime-")===0;
}
async function deleteObsoleteCaches(){
  const keys=await caches.keys();
  await Promise.all(keys.filter(name=>isOwnedCache(name)&&!CURRENT_CACHES.has(name)).map(name=>caches.delete(name)));
}
async function showUpdateNotification(){
  if(!(await notificationsEnabled()))return;
  let message="Mise à jour ciblée installée.",version=VERSION;
  try{
    const r=await fetch('/app-version.json?_='+Date.now(),{cache:'no-store'});
    if(r.ok){const d=await r.json();if(d&&d.message)message=String(d.message);if(d&&d.version)version=String(d.version)}
  }catch(_){}
  try{
    const cache=await caches.open(NOTIFICATION_PREF_CACHE),seen=await cache.match(NOTIFICATION_LAST_UPDATE_URL),last=seen?await seen.text():"";
    if(last===version)return;
    await cache.put(NOTIFICATION_LAST_UPDATE_URL,new Response(version));
  }catch(_){}
  await self.registration.showNotification('✅ Couteau Suisse mis à jour',{
    body:message,icon:'/couteau-suisse-v283-192.png?v=283',badge:'/couteau-suisse-v283-192.png?v=283',
    tag:'couteau-suisse-update',renotify:false,data:{url:'/index.html'}
  });
}

// Important: l'installation/activation ne précharge plus des dizaines de fichiers.
// C'était une source de lenteur et de concurrence avec l'ouverture de l'application.
self.addEventListener('install',e=>{e.waitUntil(self.skipWaiting())});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{
  await deleteObsoleteCaches();
  await self.clients.claim();
  await showUpdateNotification();
})())});

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.pathname.startsWith('/api/'))return;
  if(u.pathname==='/sw.js'||u.pathname==='/app-version.json'||u.pathname==='/autoradio-version.json'){
    e.respondWith(fetch(e.request,{cache:'no-store'}));return;
  }
  const cacheName=moduleCacheFor(u.pathname),isNav=e.request.mode==='navigate',isCode=/\.(?:js|json|css|html|webmanifest)$/i.test(u.pathname);
  if(isNav||isCode){
    e.respondWith((async()=>{
      try{
        const r=await fetch(e.request,{cache:'no-store'});
        if(r&&r.ok)(await caches.open(cacheName)).put(e.request,r.clone());
        return r;
      }catch(_){
        return (await caches.match(e.request))||
          (isNav?await caches.match('/'):undefined)||
          (isNav?await caches.match('/index.html'):undefined)||
          Response.error();
      }
    })());
    return;
  }
  if(/\.(?:png|jpe?g|webp|svg|mp4|woff2?)$/i.test(u.pathname)){
    e.respondWith((async()=>{
      const c=await caches.open(cacheName),cached=await c.match(e.request);
      const update=fetch(e.request,{cache:'no-cache'}).then(async r=>{if(r&&r.ok)await c.put(e.request,r.clone());return r}).catch(()=>null);
      if(cached){e.waitUntil(update);return cached}
      return (await update)||Response.error();
    })());
  }
});
self.addEventListener('push',e=>{e.waitUntil(notificationsEnabled().then(enabled=>{if(!enabled)return;let p={};if(e.data){try{p=e.data.json()||{}}catch(_){try{p={body:e.data.text()}}catch(_){}}}const hasPayload=!!(p&&Object.keys(p).length),title=String(p.title||(hasPayload?'Notification Couteau Suisse':'✅ Nouvelle fiche / demande à contrôler')),body=String(p.body||(hasPayload?'Une nouvelle information est disponible.':'Une personne a envoyé une fiche ou une demande. Ouvrez Administration pour voir son nom et contrôler le contenu.')),target=String(p.url||(hasPayload?'/index.html':'/admin.html'));return self.registration.showNotification(title,{body,icon:String(p.icon||'/couteau-suisse-v283-192.png?v=283'),badge:String(p.badge||'/couteau-suisse-v283-192.png?v=283'),tag:String(p.tag||(hasPayload?'couteau-suisse':'couteau-suisse-admin-pending')),renotify:p.renotify===true,data:{url:target}})}))});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='SKIP_WAITING'){e.waitUntil(self.skipWaiting());return}if(e.data&&e.data.type==='CARPLAY_NOTIFICATIONS_PREFERENCE')e.waitUntil(saveNotificationPreference(e.data.enabled===true))});
self.addEventListener('notificationclick',e=>{const n=e.notification||{},target=n.data&&n.data.url?String(n.data.url):'/index.html',detail=new URL('/index.html',self.location.origin);detail.searchParams.set('notification_open','1');detail.searchParams.set('notification_title',String(n.title||'Notification Couteau Suisse'));detail.searchParams.set('notification_body',String((n.options&&n.options.body)||n.body||''));detail.searchParams.set('notification_target',target);e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const client of list)if('focus'in client)return client.navigate(detail.href).then(()=>client.focus()).catch(()=>clients.openWindow(detail.href));return clients.openWindow(detail.href)}))});