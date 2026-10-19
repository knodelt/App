const CACHE = 'frame-v117-phase1-stability';
const ASSETS = ['/', '/index.html', '/about.html', '/styles.css', '/app-layout.css', '/frame-reboot.css', '/frame-loop.css', '/viewport-lock.js', '/app.js', '/mood-filter.js', '/tmdb-feed.js', '/card-details.js', '/watchlist-controls.js', '/taste-dna.js', '/personalized-recommendations.js', '/taste-learning.js', '/frame-watched.js', '/frame-log.js', '/streaming-availability.js', '/swipe-guidance.js', '/manifest.webmanifest', '/icon.svg', '/onboarding-tutorial.js', '/frame-loop.js', '/hidden-match.css', '/trailer-preview.js', '/trailer-preview.css', '/hidden-match-client.js', '/frame-account-client.js', '/vendor-qrcode.js'];

self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    // Offline shell is required; an optional poster/style failing must not
    // prevent installing an otherwise working security fix.
    const essential=['/','/index.html','/app.js','/styles.css'];
    await cache.addAll(essential);
    await Promise.all(ASSETS.filter(path=>!essential.includes(path)).map(path=>
      cache.add(path).catch(()=>{})
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url=new URL(event.request.url);
  // Never cache third-party TMDB images or requests: they fill mobile
  // storage quickly and can evict the user's local FRAME data.
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
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
    caches.match(event.request).then(async cached => {
      // Versioned JS/CSS URLs (e.g. ?v=117) can use the pre-cached unversioned
      // file when offline. Never serve HTML as a script or stylesheet.
      if(cached)return cached;
      const plain=await caches.match(url.pathname);
      try{
        const response=await fetch(event.request);
        if(response.ok){
          const copy=response.clone();
          event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));
        }
        return response;
      }catch{
        if(plain)return plain;
        return Response.error();
      }
    })
  );
});
