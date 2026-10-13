/* HisabCraft — service worker. Cache-first, offline by default. */
var CACHE = 'hisabcraft-v1';
var ASSETS = [
  './',
  './index.html',
  './css/style.css',
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
  e.waitUntil(clients.claim());
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
