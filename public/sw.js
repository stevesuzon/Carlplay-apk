const CACHE = "carplay-v5-20260910-adresses-devis4";
const CORE = [
  "/index.html",
  "/cache-cleanup-v20260910.js?v=20260910-adresses-devis4",
  "/installer.html",
  "/tutoriel-comment-installer-iphone.mp4",
  "/manifest.webmanifest",
  "/carplay-noir-rouge-180.png",
  "/carplay-noir-rouge-192.png",
  "/carplay-noir-rouge-512.png",
  "/mobile-overrides.css?v=64",
  "/weather-all-pages.js?v=64",
  "/subscription-web.js?v=64",
  "/home-work.css?v=64",
  "/home-work.js?v=64",
  "/gps-apple-plans-v141.js?v=141",
  "/markets-final.css?v=126-favori-fluide",
  "/markets-final-picker.css",
  "/choix-marches-final.html?v=122",
  "/special-marches.html?v=122",
  "/nearby-markets.html?v=143",
  "/markets-44-complete.js?v=20260902-complet",
  "/market-data-fr.js?v=130",
  "/market-final.js?v=126-favori-fluide",
  "/market-data-be.js?v=130",
  "/market-consensus.js?v=113",
  "/verification-v9.html?v=113",
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
];
CORE.push(
  "/contact-mail-v99.css?v=99",
  "/contact-mail-v99.js?v=99",
  "/markets-france-national.js?v=20260902-national",
  "/markets-missing-v97.js?v=20260902",
  "/markets-missing-v100.js?v=20260902",
  "/markets-missing-v101.js?v=20260902",
  "/markets-missing-v102.js?v=20260902",
  "/markets-missing-v103.js?v=20260902",
  "/markets-missing-v104.js?v=20260902",
  "/markets-france-update-v139.js?v=139",
  "/markets-france-osm-v139.js?v=139",
  "/markets-35-corrections-v142.js?v=142",
  "/markets-35-missing-v143.js?v=143",
  "/market-weekly-filter.js?v=122-categories",
  "/market-consensus.js?v=98",
);
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)));
});
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  if (
    e.request.method !== "GET" ||
    new URL(e.request.url).pathname.startsWith("/api/")
  )
    return;
  e.respondWith(
    fetch(e.request, { cache: "no-store" })
      .then((r) => {
        let c = r.clone();
        caches.open(CACHE).then((x) => x.put(e.request, c));
        return r;
      })
      .catch(() => caches.match(e.request)),
  );
});
