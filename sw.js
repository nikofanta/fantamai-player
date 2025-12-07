/* =========================================================
   SERVICE WORKER — FantaMai Player (PWA)
   ========================================================= */

const CACHE_NAME = "fantamai-cache-v3.3.11b";
const APP_VERSION = "3.3.1";

/* 
   File che vogliamo tenere in cache
   (la UI della PWA funzionerà offline)
*/
const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];


/* =========================================================
   INSTALL — Precarica i file nella cache
   ========================================================= */
self.addEventListener("install", event => {
  console.log(`Service Worker v${APP_VERSION} installing...`);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  // Force new service worker to activate immediately
  self.skipWaiting();
});


/* =========================================================
   ACTIVATE — Rimuove cache vecchie
   ========================================================= */
self.addEventListener("activate", event => {
  console.log(`Service Worker v${APP_VERSION} activated`);
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log(`Deleting old cache: ${key}`);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      // Take control of all pages immediately
      return self.clients.claim();
    })
  );
});


/* =========================================================
   FETCH — Ritorna dalla cache o dalla rete
   ========================================================= */
self.addEventListener("fetch", event => {

  // non cacheiamo stream audio
  if (event.request.url.endsWith(".mp3")) {
    return; 
  }

  event.respondWith(
    caches.match(event.request).then(response => {
      // Se il file esiste in cache → usalo
      if (response) {
        return response;
      }

      // Altrimenti scaricalo dalla rete
      return fetch(event.request);
    })
  );
});

/* =========================================================
   MESSAGE — Gestisce skip waiting
   ========================================================= */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
