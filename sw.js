// Service worker: maakt de app offline bruikbaar en bewaart bekeken kaarttegels en plekken.
const SHELL = 'camper-shell-v4';
const DATA = 'camper-data-v1';
const TILES = 'camper-tiles-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest',
  'css/style.css',
  'js/app.js', 'js/db.js', 'js/map.js', 'js/osm.js', 'js/places.js', 'js/tracker.js', 'js/trips.js', 'js/ui.js', 'js/util.js',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/leaflet.markercluster.js', 'vendor/MarkerCluster.css',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'img/camper.jpg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => ![SHELL, DATA, TILES].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (/\/data\/t_[^/]+\.json$/.test(url.pathname)) e.respondWith(dataTile(req, e));
    else e.respondWith(networkFirst(req, url.pathname.endsWith('/data/index.json') ? DATA : SHELL));
  } else if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(mapTile(req));
  }
});

// Eigen bestanden: eerst het netwerk (zodat updates direct binnenkomen), anders de opgeslagen versie.
async function networkFirst(req, name) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

// Plekken per gebied: direct uit de opslag, op de achtergrond bijwerken.
async function dataTile(req, e) {
  const cache = await caches.open(DATA);
  const hit = await cache.match(req);
  const update = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
  if (hit) { e.waitUntil(update.catch(() => {})); return hit; }
  return update;
}

// Kaarttegels: eerst de opgeslagen versie, zodat eerder bekeken gebieden ook zonder bereik zichtbaar zijn.
let puts = 0;
async function mapTile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    cache.put(req, res.clone());
    if (++puts % 60 === 0) trim(cache);
  }
  return res;
}
async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > 2000) await Promise.all(keys.slice(0, keys.length - 1500).map(k => cache.delete(k)));
}
