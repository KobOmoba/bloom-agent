// EduBloom — Bloom Agent Service Worker
const CACHE_NAME   = 'edubloom-agent-v1';
const SHELL_ASSETS = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './icon-192x192.png',
  './icon-512x512.png',
  './manifest.json',
  'https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Cache partial fail:', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // Skip Firestore — it has its own offline persistence
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebase.googleapis.com')) {
    return;
  }

  // Cache-first for app shell
  if (url.origin === self.location.origin || url.hostname === 'www.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
          }
          return response;
        }).catch(() => {
          if (event.request.destination === 'document') return caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Network-first for everything else
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

console.log('[SW] EduBloom Bloom Agent Service Worker loaded ✅');
