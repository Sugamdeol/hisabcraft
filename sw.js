/* HisabCraft — service worker. Cache-first, offline by default. */
var CACHE = 'hisabcraft-v2';
var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './fonts/mukta.css',
  './fonts/mukta-latin-400.woff2',
  './fonts/mukta-latin-500.woff2',
  './fonts/mukta-latin-700.woff2',
  './fonts/mukta-latin-800.woff2',
  './fonts/mukta-latin-ext-400.woff2',
  './fonts/mukta-latin-ext-500.woff2',
  './fonts/mukta-latin-ext-700.woff2',
  './fonts/mukta-latin-ext-800.woff2',
  './fonts/mukta-devanagari-400.woff2',
  './fonts/mukta-devanagari-500.woff2',
  './fonts/mukta-devanagari-700.woff2',
  './fonts/mukta-devanagari-800.woff2',
  './js/gst.js',
  './js/db.js',
  './js/i18n.js',
  './js/app.js',
  './icons/icon.svg',
  './manifest.webmanifest'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (resp) {
        var copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return resp;
      }).catch(function () { return caches.match('./index.html'); });
    })
  );
});
