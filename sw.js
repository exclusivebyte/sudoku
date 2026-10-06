// Offline support: cache the app shell, serve cache-first, refresh in the background.
const CACHE = 'sudoku-v3';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/sudoku.js',
  'js/levels.js',
  'js/cloud.js',
  'js/firebase-config.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The app's own files: network first (so updates arrive straight away), cache when offline.
// The Firebase SDK is versioned, so it's served from cache once fetched.
// Sign-in and database traffic isn't touched.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const own = url.origin === location.origin && !url.pathname.includes('/__/');
  const sdk = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (!own && !sdk) return;

  const fromNetwork = () => fetch(request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
    }
    return res;
  });

  event.respondWith(
    sdk
      ? caches.match(request).then((hit) => hit || fromNetwork())
      : fromNetwork().catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('./')))
  );
});
