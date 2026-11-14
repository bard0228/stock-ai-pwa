const CACHE_NAME = 'stock-ai-cake-v9';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/liquid-glass-kit.css',
  './js/android-overscroll.js',
  './overview.json',
  './leaderboard.json',
  './manifest.json',
  './manifest.json?v=cake7',
  './stocks_index.json',
  './icons/cake-192.png',
  './icons/cake-192.png?v=cake7',
  './icons/cake-512.png',
  './icons/cake-512.png?v=cake7'
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

  // API 或 GAS 請求一律走網路
  if (url.pathname.startsWith('/api/') || url.hostname.includes('script.google.com')) {
    event.respondWith(
      fetch(req).catch(() => new Response(JSON.stringify({ ok: false, offline: true }), {
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // HTML 文件導航：嚴格「網路優先（Network First）」，保證永遠載入最新程式碼
  if (req.mode === 'navigate' || req.destination === 'document' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // Manifest, JSON, CSS, JS, 圖示一律網路優先避免舊資源快取
  if (
    url.pathname.endsWith('manifest.json') ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.includes('/icons/')
  ) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 其餘靜態資源快取優先
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
