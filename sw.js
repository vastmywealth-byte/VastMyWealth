/* ============================================================
   VastMyWealth service worker
   Network-first for HTML/JS/CSS, cache fallback for offline,
   cache-first for images.
   ============================================================ */
const CACHE_NAME = 'vmw-cache-v13';
const CORE = [
  './',
  './index.html',
  './apply.html',
  './banker.html',
  './partner.html',
  './biztool.html',
  './vl-el-application.html',
  './portal-unified-application.html',
  './privacy-policy.html',
  './refund-policy.html',
  './style.css',
  './config.js',
  './common.js',
  './manifest.json',
  './1000550390.png',
  './festival-offer.png',
  './partner.png',
  './el.png',
  './vl.png',
  './lap.png',
  './hl.png',
  './pl.png',
  './bl.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(CORE.map((url) => cache.add(url).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Backend API calls and external services are never intercepted
  if (url.origin !== self.location.origin) return;

  const isImage = /\.(png|jpe?g|svg|ico|webp|gif)$/i.test(url.pathname);
  if (isImage) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // Network first, cache fallback for pages, scripts, and stylesheets
  event.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() =>
      caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    )
  );
});
