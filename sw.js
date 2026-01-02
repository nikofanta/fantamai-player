/* =========================================================
   SERVICE WORKER — FantaMai Player (PWA)
   ========================================================= */

const CACHE_NAME = "fantamai-cache-v3.5.3";
const APP_VERSION = "3.5.3";
const NETWORK_TIMEOUT = 3000; // 3 seconds timeout for network requests

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
  "./icons/icon-512.png",
  "./covers/nosong.png"
];


/* =========================================================
   INSTALL — Precarica i file nella cache
   ========================================================= */
self.addEventListener("install", event => {
  console.log(`Service Worker v${APP_VERSION} installing...`);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    }).then(() => {
      // Force immediate activation to prevent blank pages
      return self.skipWaiting();
    })
  );
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
   FETCH — Network-first for HTML/CSS/JS, cache-first for assets
   ========================================================= */
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  
  // Skip caching for audio files
  if (event.request.url.endsWith(".mp3")) {
    return;
  }
  
  // Network-first for critical files (HTML, CSS, JS)
  const isCritical = event.request.mode === 'navigate' || 
                     url.pathname.endsWith('.html') || 
                     url.pathname.endsWith('.css') || 
                     url.pathname.endsWith('.js') || 
                     url.pathname === '/' || 
                     url.pathname.endsWith('/');
  
  if (isCritical) {
    event.respondWith(
      Promise.race([
        // Try network first
        fetch(event.request).then(response => {
          // Cache fresh version
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, response.clone());
            });
          }
          return response;
        }),
        // Timeout after NETWORK_TIMEOUT ms
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Network timeout')), NETWORK_TIMEOUT)
        )
      ])
      .catch(() => {
        // Fallback to cache if network fails or times out
        console.log('Network failed or timed out, using cache');
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Last resort for navigation
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
    );
    return;
  }
  
  // Cache-first for everything else (images, JSON, etc.)
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request).then(fetchResponse => {
        if (fetchResponse.ok) {
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, fetchResponse.clone());
          });
        }
        return fetchResponse;
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
