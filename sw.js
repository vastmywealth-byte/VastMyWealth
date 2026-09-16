const CACHE_NAME = 'vmw-cache-v9';

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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
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
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('script.google.com')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
  } else {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => cachedResponse || fetch(event.request))
    );
  }
});
