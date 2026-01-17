/* =========================================================
   SERVICE WORKER — FantaMai Player (PWA)
   ========================================================= */

const CACHE_NAME = "fantamai-cache-v5.3.12";
const APP_VERSION = "5.3.12";
const NETWORK_TIMEOUT = 3000; // 3 seconds timeout for network requests
const MAX_CACHED_SONGS = 15; // Maximum number of MP3 files to cache

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
   FETCH — Network-first for HTML/CSS/JS/JSON, cache-first for assets
   ========================================================= */
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const pathname = url.pathname;
  
  // Cache-after-play strategy for MP3 files (limit to MAX_CACHED_SONGS)
  if (pathname.endsWith(".mp3")) {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          console.log('Serving MP3 from cache:', pathname);
          return cachedResponse;
        }
        
        // Check if this is a Range request (partial content request)
        const hasRangeHeader = event.request.headers.get('Range');
        
        if (hasRangeHeader) {
          // For Range requests, just pass through to network without caching
          console.log('Range request detected, bypassing cache:', pathname);
          return fetch(event.request);
        }
        
        // Not in cache and no Range header, fetch full file and cache it
        return fetch(event.request).then(async response => {
          // Only cache full responses (status 200), not partial (206)
          if (response.ok && response.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            
            // Check how many MP3s are already cached
            const keys = await cache.keys();
            const mp3Keys = keys.filter(req => new URL(req.url).pathname.endsWith('.mp3'));
            
            // If at limit, remove oldest cached MP3
            if (mp3Keys.length >= MAX_CACHED_SONGS) {
              console.log('Cache limit reached, removing oldest MP3');
              await cache.delete(mp3Keys[0]);
            }
            
            // Cache this MP3
            console.log('Caching MP3:', pathname);
            cache.put(event.request, response.clone());
          }
          return response;
        });
      })
    );
    return;
  }
  
  // Skip caching completely for lyrics files - let browser handle it
  if (pathname.endsWith(".lrc")) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // Network-first for critical files (HTML, CSS, JS, JSON)
  const isCritical = event.request.mode === 'navigate' || 
                     pathname.endsWith('.html') || 
                     pathname.endsWith('.css') || 
                     pathname.endsWith('.js') || 
                     pathname.endsWith('.json') || 
                     pathname === '/' || 
                     pathname.endsWith('/');
  
  if (isCritical) {
    event.respondWith(
      Promise.race([
        // Try network first
        fetch(event.request).then(response => {
          // Clone BEFORE using the response
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
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
        console.log('Network failed or timed out, using cache for:', pathname);
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
  
  // Cache-first for other assets (images, icons, etc.)
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request).then(fetchResponse => {
        if (fetchResponse.ok) {
          const responseToCache = fetchResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
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
