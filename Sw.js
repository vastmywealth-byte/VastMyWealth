// Bump this version number whenever you update cached files,
// so returning users get the fresh version instead of a stale cache.
const CACHE_NAME = 'vmw-cache-v6';

const urlsToCache = [
  './',
  './index.html',
  './banker.html',
  './apply.html',
  './partner.html',
  './partner-register.html',
  './partner-dashboard.html',
  './style.css',
  './manifest.json',
  './1000550390.png'
];

// On install, pre-cache the core files so the app can still open offline.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// Clean up old caches when a new service worker takes over.
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
    )
  );
  self.clients.claim();
});

// Serve from cache first, fall back to network.
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});
