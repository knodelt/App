const CACHE = 'frame-v111-cloud-reload-guard';
const ASSETS = ['/', '/index.html', '/about.html', '/styles.css', '/app-layout.css', '/frame-reboot.css', '/frame-loop.css', '/viewport-lock.js', '/app.js', '/mood-filter.js', '/tmdb-feed.js', '/card-details.js', '/watchlist-controls.js', '/taste-dna.js', '/personalized-recommendations.js', '/taste-learning.js', '/frame-watched.js', '/frame-log.js', '/streaming-availability.js', '/swipe-guidance.js', '/manifest.webmanifest', '/icon.svg', '/onboarding-tutorial.js', '/frame-loop.js', '/hidden-match.css', '/trailer-preview.js', '/trailer-preview.css', '/hidden-match-client.js', '/frame-account-client.js', '/vendor-qrcode.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).pathname.startsWith('/api/')) return;
  // Navigations must prefer the deployed version. Keeping old index.html
  // indefinitely can also keep an already-fixed login redirect loop alive.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const copy=response.clone();
          event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));
        }
        return response;
      }).catch(async()=>await caches.match(event.request)||await caches.match('/index.html'))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy=response.clone();
      event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));
      return response;
    }).catch(() => caches.match('/index.html')))
  );
});
