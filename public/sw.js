const CACHE="carplay-v35-server-only-markets-20260831";
const CORE=["/index.html","/installer.html","/tutoriel-comment-installer-iphone.mp4","/manifest.webmanifest","/carplay-noir-rouge-180.png","/carplay-noir-rouge-192.png","/carplay-noir-rouge-512.png","/mobile-overrides.css?v=64","/weather-all-pages.js?v=64","/subscription-web.js?v=64","/home-work.css?v=64","/home-work.js?v=72","/markets-final.css?v=64","/markets-final-picker.css","/choix-marches-final.html","/ou-trouver-place.html","/documents-travail.html","/mes-papiers.html","/master-front-transparent.png","/address-button.png","/tabbert.png","/retourner-place-trafic-2025.png","/mypos-go2.jpeg","/mypos-ultra.jpeg","/mypos-flex.jpeg"];
self.addEventListener("install",e=>{self.skipWaiting();
e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)))});
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{if(e.request.method!=="GET"||new URL(e.request.url).pathname.startsWith("/api/"))return;
e.respondWith(fetch(e.request,{cache:"no-store"}).then(r=>{let c=r.clone();
caches.open(CACHE).then(x=>x.put(e.request,c));
return r}).catch(()=>caches.match(e.request)))});
