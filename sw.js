/* ============================================================
   VastMyWealth service worker
   WHY THIS CHANGED: the old worker served every page from cache FIRST and
   never re-checked the server, so phones kept showing old copies of the
   application page (that is how some people saw a pincode field and others
   did not). Now pages, scripts and styles are fetched from the network FIRST
   and the cache is only a fallback for when the phone is offline.
   ============================================================ */
const CACHE_NAME = 'vmw-cache-v11';

const CORE = [
  './', './index.html', './apply.html', './banker.html', './partner.html',
  './vl-el-application.html', './portal-unified-application.html',
  './style.css', './config.js', './common.js', './manifest.json', './1000550390.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // add one by one so a single missing file can never break the install
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
  // Backend calls, Google Fonts etc. are never touched by the worker
  if (url.origin !== self.location.origin) return;

  const isImage = /\.(png|jpe?g|svg|ico|webp|gif)$/i.test(url.pathname);

  if (isImage) {
    // images rarely change: cache first
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // pages / scripts / styles: network first (revalidated), cache only when offline
  event.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() =>
      caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    )
  );
});
