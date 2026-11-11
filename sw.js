const CACHE_NAME = 'stock-ai-cake-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './manifest.json?v=cake2',
  './stocks_index.json',
  './icons/cake-192.png',
  './icons/cake-192.png?v=cake2',
  './icons/cake-512.png',
  './icons/cake-512.png?v=cake2'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // API or GAS bridge requests always use network first without caching stale state
  if (url.pathname.startsWith('/api/') || url.hostname.includes('script.google.com')) {
    event.respondWith(
      fetch(req).catch(() => new Response(JSON.stringify({ ok: false, offline: true }), {
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // Network first for manifest and icons to prevent stale icon issues
  if (url.pathname.endsWith('manifest.json') || url.pathname.includes('/icons/')) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const toCache = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, toCache));
        return res;
      });
    })
  );
});
