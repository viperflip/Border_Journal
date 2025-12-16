/* Simple offline cache for static assets */
const CACHE_VERSION = 'v1.4.0';
const CACHE_NAME = `shift-cache-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icon-180.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => (k.startsWith('shift-cache-') && k !== CACHE_NAME) ? caches.delete(k) : Promise.resolve()));
      await self.clients.claim();
    })()
  );
});

// Cache-first for same-origin GET, network fallback
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  if(url.origin !== location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if(cached) return cached;

      try{
        const fresh = await fetch(req);
        // Only cache successful basic responses
        if(fresh && fresh.ok && fresh.type === 'basic'){
          cache.put(req, fresh.clone());
        }
        return fresh;
      }catch{
        // As a last resort, return cached index for navigation
        if(req.mode === 'navigate'){
          const fallback = await cache.match('./index.html');
          if(fallback) return fallback;
        }
        throw new Error('Network error and no cache');
      }
    })()
  );
});
