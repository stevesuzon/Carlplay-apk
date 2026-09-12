const CACHE = "carplay-v5-20260912-traveller-markets-v162";
const NOTIFICATION_PREF_CACHE = "carplay-notification-preference-v1";
const NOTIFICATION_PREF_URL = "/__carplay_notifications_enabled__";
async function notificationsEnabled() {
  const cache = await caches.open(NOTIFICATION_PREF_CACHE);
  const response = await cache.match(NOTIFICATION_PREF_URL);
  return !!response && (await response.text()) === "1";
}
async function saveNotificationPreference(enabled) {
  const cache = await caches.open(NOTIFICATION_PREF_CACHE);
  await cache.put(NOTIFICATION_PREF_URL, new Response(enabled ? "1" : "0"));
}
const CORE = [
  "/brocante-fiche-achat-v1.js?v=20260910-ficheachat-mobile-acompte-signatures1",
  "/devis-personnalises-v2.js?v=20260910-ficheachat-mobile-acompte-signatures1",
  "/index.html",
  "/cache-cleanup-v20260910.js?v=20260912-allmarkets-v149",
  "/installer.html",
  "/tutoriel-comment-installer-iphone.mp4",
  "/manifest.webmanifest",
  "/carplay-noir-rouge-180.png",
  "/carplay-noir-rouge-192.png",
  "/carplay-noir-rouge-512.png",
  "/mobile-overrides.css?v=64",
  "/weather-all-pages.js?v=68-notifications-globales",
  "/subscription-web.js?v=158",
  "/subscription-v154-patch.js?v=158",
  "/modification-profile-v156.js?v=158",
  "/sanction-guard-v161.js?v=161",
  "/special-market-server-v157.js?v=157",
  "/home-work.css?v=64",
  "/home-work.js?v=64",
  "/gps-apple-plans-v141.js?v=141",
  "/location-permission-v20260911.js?v=20260911",
  "/markets-final.css?v=126-favori-fluide",
  "/markets-final-picker.css",
  "/choix-marches-final.html?v=162",
  "/traveller-markets.html?v=162",
  "/traveller-markets-data-v162.js?v=162",
  "/marches-final.html?v=159",
  "/belgique-marches-final.html?v=159",
  "/market-areas-fr-v159.js?v=159",
  "/market-areas-be-v159.js?v=159",
  "/market-final.js?v=160",
  "/market-consensus.js?v=160",
  "/special-marches.html?v=157",
  "/nearby-markets.html?v=158",
  "/verification-v9.html?v=20260912-consulter-fiche9",
  "/modification-demande.html?v=161",
  "/ou-trouver-place.html",
  "/documents-travail.html",
  "/mes-papiers.html",
  "/master-front-transparent.png",
  "/address-button.png",
  "/tabbert.png",
  "/retourner-place-trafic-2025.png",
  "/mypos-go2.jpeg",
  "/mypos-ultra.jpeg",
  "/mypos-flex.jpeg"
];
CORE.push(
  "/contact-mail-v99.css?v=99",
  "/contact-mail-v99.js?v=99"
);
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)));
});
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE && k !== NOTIFICATION_PREF_CACHE).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  )
);
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return;
  const staticAsset = /\.(?:js|json|css|png|jpe?g|webp|svg|mp4|woff2?)$/i.test(url.pathname);
  if (staticAsset) {
    e.respondWith(caches.match(e.request).then((cached) => {
      const update = fetch(e.request).then((r) => {
        if (r && r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone()));
        return r;
      }).catch(() => null);
      if (cached) { e.waitUntil(update); return cached; }
      return update.then((r) => r || Response.error());
    }));
    return;
  }
  e.respondWith(
    fetch(e.request, { cache: "no-store" }).then((r) => {
      if (r && r.ok) caches.open(CACHE).then((x) => x.put(e.request, r.clone()));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
self.addEventListener("push", (e) => {
  e.waitUntil(notificationsEnabled().then((enabled) => {
    if (!enabled) return;
    return self.registration.showNotification("Modification de marché demandée", {
      body: "Une demande d’horaire, de GPS ou de photo attend votre réponse OUI ou NON pendant 3 minutes.",
      icon: "/carplay-noir-rouge-192.png",
      badge: "/carplay-noir-rouge-192.png",
      tag: "gps-unlock-request",
      renotify: true,
      data: { url: "/admin.html#gps-requests" }
    });
  }));
});
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "CARPLAY_NOTIFICATIONS_PREFERENCE") {
    e.waitUntil(saveNotificationPreference(e.data.enabled === true));
  }
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const client of list) if("focus" in client){client.navigate("/admin.html#gps-requests");return client.focus();}
    return clients.openWindow("/admin.html#gps-requests");
  }));
});
