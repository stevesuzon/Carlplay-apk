const VERSION = "V281";
const CACHE = "couteau-suisse-v281-notifications-prenom";
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
  "/brocante-fiche-achat-v1.js?v=238-compat",
  "/devis-personnalises-v2.js?v=238-admin-email-devis",
  "/index.html",
  "/cache-cleanup-v20260910.js?v=281-notifications-prenom",
  "/installer.html",
  "/tutoriel-comment-installer-iphone.mp4",
  "/manifest.webmanifest?v=couteau-suisse-v254",
  "/couteau-suisse-152.png?v=255",
  "/couteau-suisse-167.png?v=255",
  "/couteau-suisse-180.png?v=255",
  "/couteau-suisse-192.png?v=255",
  "/couteau-suisse-512.png?v=255",
  "/couteau-suisse-1024.png?v=255",
  "/couteau-suisse-maskable-192.png?v=255",
  "/couteau-suisse-maskable-512.png?v=255",
  "/mobile-overrides.css?v=64",
  "/weather-all-pages.js?v=68-notifications-globales",
  "/subscription-web.js?v=281-notifications-prenom",
  "/notification-settings.js?v=281-notifications-prenom",
  "/market-update-notifications-v281.js?v=281",
  "/referral-v232.js?v=273-parrainage-marche-compte",
  "/subscription-v154-patch.js?v=203",
  "/modification-profile-v156.js?v=173",
  "/sanction-guard-v161.js?v=243",
  "/special-market-server-v157.js?v=247-photo-miniature",
  "/home-work.css?v=64",
  "/home-work.js?v=64",
  "/gps-apple-plans-v141.js?v=248-champignon-visible",
  "/location-permission-v20260911.js?v=20260911",
  "/markets-final.css?v=126-favori-fluide",
  "/markets-final-picker.css",
  "/choix-marches-final.html?v=162",
  "/traveller-markets.html?v=247-photo-miniature",
  "/traveller-markets-data-v166.js?v=166",
  "/marches-final.html?v=159",
  "/belgique-marches-final.html?v=159",
  "/market-areas-fr-v159.js?v=159",
  "/market-areas-be-v159.js?v=159",
  "/market-final.js?v=189",
  "/market-navigation-confirm-v189.js?v=189",
  "/market-consensus.js?v=247-photo-miniature",
  "/special-marches.html?v=170",
  "/nearby-markets.html?v=247-photo-miniature",
  "/market-presence-global.js?v=177",
  "/verification-v9.html?v=275-admin-tout-modifier",
  "/modification-demande.html?v=184",
  "/ou-trouver-place.html",
  "/documents-travail.html",
  "/mes-papiers.html",
  "/master-front-transparent.png",
  "/address-button.png",
  "/tabbert.png",
  "/retourner-place-trafic-2025.png",
  "/mypos-go2.jpeg",
  "/mypos-ultra.jpeg",
  "/mypos-flex.jpeg",
  "/app-access-gate-v240.js?v=276-identite-active-essai",
  "/champignons.html?v=255-generateur-separe",
  "/champignons.css?v=267-bois-public-prive",
  "/champignons.js?v=267-bois-public-prive",
  "/champignon-cepe.jpg?v=240"
];
CORE.push(
  "/contact-mail-v99.css?v=99",
  "/contact-mail-v99.js?v=99"
);
async function cacheCoreIndividually() {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(CORE.map(async (path) => {
    const request = new Request(path, { cache: "reload" });
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response);
  }));
}
async function showUpdateNotification() {
  if (!(await notificationsEnabled())) return;
  let message = "Les dernières nouveautés et mises à jour des marchés sont installées.";
  try {
    const response = await fetch("/app-version.json?_=" + Date.now(), { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      if (data && data.message) message = String(data.message);
    }
  } catch (_) {}
  await self.registration.showNotification("✅ Couteau Suisse mis à jour", {
    body: message,
    icon: "/couteau-suisse-192.png?v=281",
    badge: "/couteau-suisse-192.png?v=281",
    tag: "couteau-suisse-update-" + VERSION,
    renotify: true,
    data: { url: "/index.html" }
  });
}
self.addEventListener("install", (event) => {
  event.waitUntil(cacheCoreIndividually().then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((name) => {
      if (name === CACHE || name === NOTIFICATION_PREF_CACHE) return false;
      return name.startsWith("couteau-suisse-") || name.startsWith("carplay-v5-");
    }).map((name) => caches.delete(name)));
    await self.clients.claim();
    await showUpdateNotification();
  })());
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/sw.js" || url.pathname === "/app-version.json") {
    e.respondWith(fetch(e.request, { cache: "no-store" }));
    return;
  }
  const isNavigation = e.request.mode === "navigate";
  const isCode = /\.(?:js|json|css|html|webmanifest)$/i.test(url.pathname);
  if (isNavigation || isCode) {
    e.respondWith((async () => {
      try {
        const response = await fetch(e.request, { cache: "no-store" });
        if (response && response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(e.request, response.clone());
        }
        return response;
      } catch (_) {
        return (await caches.match(e.request)) ||
          (isNavigation ? await caches.match("/index.html") : undefined) ||
          Response.error();
      }
    })());
    return;
  }
  const staticAsset = /\.(?:png|jpe?g|webp|svg|mp4|woff2?)$/i.test(url.pathname);
  if (staticAsset) {
    e.respondWith((async () => {
      const cached = await caches.match(e.request);
      const update = fetch(e.request).then(async (response) => {
        if (response && response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(e.request, response.clone());
        }
        return response;
      }).catch(() => null);
      if (cached) { e.waitUntil(update); return cached; }
      return (await update) || Response.error();
    })());
  }
});
self.addEventListener("push", (e) => {
  e.waitUntil(notificationsEnabled().then((enabled) => {
    if (!enabled) return;
    let payload = {};
    if (e.data) {
      try { payload = e.data.json() || {}; }
      catch (_) { try { payload = { body: e.data.text() }; } catch (_) {} }
    }
    const title = String(payload.title || "Modification de marché demandée");
    const body = String(payload.body || "Une demande de modification ou de présence d’un marché attend votre réponse OUI ou NON pendant 3 minutes.");
    const target = String(payload.url || "/admin.html#gps-requests");
    return self.registration.showNotification(title, {
      body,
      icon: String(payload.icon || "/couteau-suisse-192.png?v=281"),
      badge: String(payload.badge || "/couteau-suisse-192.png?v=281"),
      tag: String(payload.tag || "gps-unlock-request"),
      renotify: payload.renotify !== false,
      data: { url: target }
    });
  }));
});
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") {
    e.waitUntil(self.skipWaiting());
    return;
  }
  if (e.data && e.data.type === "CARPLAY_NOTIFICATIONS_PREFERENCE") {
    e.waitUntil(saveNotificationPreference(e.data.enabled === true));
  }
});
self.addEventListener("notificationclick", (e) => {
  const target = e.notification && e.notification.data && e.notification.data.url ? e.notification.data.url : "/admin.html#gps-requests";
  e.notification.close();
  e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const client of list) if("focus" in client){client.navigate(target);return client.focus();}
    return clients.openWindow(target);
  }));
});
