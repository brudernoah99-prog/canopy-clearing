// Offline cache: the game keeps working with no internet once it has loaded once.
const CACHE = 'canopy-v20';
const FILES = ['./', './index.html', './game.js', './monster.js', './gore.js', './talk.js', './manifest.webmanifest',
  './lib/three.module.js', './lib/VRButton.js', './lib/addons/loaders/GLTFLoader.js', './lib/addons/utils/BufferGeometryUtils.js',
  './lib/addons/objects/Reflector.js', './gorilla.js', './emotes.js', './hall.js', './progress.js', './owner.js', './cyber.js', './slicer.js', './facility.js', './npc.js', './monster_weapons.js', './lib/addons/utils/SkeletonUtils.js', './models/gorilla.glb', './models/ape_player.glb', './models/gorilla_parts.glb', './models/monster.glb', './icons/icon-192.png', './icons/icon-512.png', './sfx/ape_chestbeat.mp3', './sfx/ape_hoot_1.mp3', './sfx/ape_hoot_2.mp3', './sfx/crunch.mp3', './sfx/dye.mp3', './sfx/land_1.mp3', './sfx/land_2.mp3', './sfx/pick.mp3', './sfx/record.mp3', './sfx/roar_brute.mp3', './sfx/roar_crawler.mp3', './sfx/roar_stalker.mp3', './sfx/slap_floor_1.mp3', './sfx/slap_floor_2.mp3', './sfx/slap_glass_1.mp3', './sfx/slap_glass_2.mp3', './sfx/slap_metal_1.mp3', './sfx/slap_metal_2.mp3', './sfx/slap_soft_1.mp3', './sfx/slap_soft_2.mp3', './sfx/squelch.mp3', './sfx/tear_1.mp3', './sfx/tear_2.mp3'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // network first (so updates arrive), cache as fallback (so it works offline)
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
