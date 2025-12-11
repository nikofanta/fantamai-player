/* =========================================================
   SERVICE WORKER — FantaMai Player (PWA)
   ========================================================= */

const CACHE_NAME = "fantamai-cache-v3.3.18";
const APP_VERSION = "3.3.18";

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
  // Don't skip waiting - let user control update via banner
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
   FETCH — Network-first for HTML, cache-first for assets
   ========================================================= */
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  
  // Skip caching for audio files
  if (event.request.url.endsWith(".mp3")) {
    return;
  }
  
  // Network-first for HTML pages (always get fresh to avoid blank page)
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache the fresh version
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, response.clone());
            return response;
          });
        })
        .catch(() => {
          // Fallback to cache if offline
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // Cache-first for everything else (CSS, JS, images, JSON)
  event.respondWith(
    caches.match(event.request).then(response => {
      if (response) {
        return response;
      }
      
      // If not in cache, fetch and cache it
      return fetch(event.request).then(fetchResponse => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, fetchResponse.clone());
          return fetchResponse;
        });
      });
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
