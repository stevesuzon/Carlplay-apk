const CACHE='champignons-standalone-v1';
const SHELL=[
  '/champignons-app/',
  '/champignons-app/index.html',
  '/champignons-app/champignons.css?v=1',
  '/champignons-app/champignons.js?v=1',
  '/champignons-app/manifest.webmanifest?v=1',
  '/champignon-cepe.jpg?v=240',
  '/accessibility-zoom-v466.js?v=470-direct-load',
  '/voice-assist-v486.js?v=487-stable'
];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>{}).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('champignons-standalone-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  const u=new URL(event.request.url);
  if(u.origin!==location.origin)return;
  if(u.pathname.startsWith('/api/'))return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put('/champignons-app/',copy)).catch(()=>{});return r}).catch(()=>caches.match('/champignons-app/')));
    return;
  }
  if(u.pathname.startsWith('/champignons-app/')||u.pathname==='/champignon-cepe.jpg'||u.pathname==='/accessibility-zoom-v466.js'||u.pathname==='/voice-assist-v486.js'){
    event.respondWith(caches.match(event.request).then(cached=>{
      const fresh=fetch(event.request).then(r=>{if(r&&r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{})}return r}).catch(()=>cached);
      return cached||fresh;
    }));
  }
});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const c of list){if('focus'in c)return c.focus()}return clients.openWindow('/champignons-app/')}))});
