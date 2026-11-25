// Offline cache: the game keeps working with no internet once it has loaded once.
const CACHE = 'canopy-v3';
const FILES = ['./', './index.html', './game.js', './monster.js', './gore.js', './talk.js', './manifest.webmanifest',
  './lib/three.module.js', './lib/VRButton.js', './lib/addons/loaders/GLTFLoader.js', './lib/addons/utils/BufferGeometryUtils.js',
  './lib/addons/objects/Reflector.js', './models/ape.glb', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // network first (so updates arrive), cache as fallback (so it works offline)
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
