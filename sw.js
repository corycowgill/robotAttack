// Offline support: the game's own files are fetched network-first (so updates show up as soon as
// you're online) with the cache as fallback; web fonts are cache-first.
const CACHE = 'robot-attack-v31';
const CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'vendor/three.min.js', 'config.js', 'rules.js', 'ai.js', 'realtime.js', 'audio.js', 'models.js', 'fx.js', 'renderer.js', 'ui.js', 'main.js',
  'assets/icons/icon-180.png', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/audio/manifest.json'
];
const NETWORK_TIMEOUT = 3500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(CORE);
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function networkFirst(req) {
  return caches.open(CACHE).then(cache => new Promise(resolve => {
    let done = false;
    const fallback = () => cache.match(req, { ignoreSearch: true }).then(hit => {
      if (!done && hit) { done = true; resolve(hit); }
      return hit;
    });
    const timer = setTimeout(fallback, NETWORK_TIMEOUT);
    fetch(req).then(res => {
      clearTimeout(timer);
      if (res.ok) cache.put(req, res.clone());
      if (!done) { done = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      fallback().then(hit => { if (!done) { done = true; resolve(hit || Response.error()); } });
    });
  }));
}

function cacheFirst(req) {
  return caches.open(CACHE).then(cache => cache.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  })));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) e.respondWith(cacheFirst(req));
});
