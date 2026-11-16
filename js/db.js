// Opslag op het toestel (IndexedDB): ritten, routepunten en bewaarde plekken.
const NAME = 'camper', VERSION = 1;
let dbp;

function open() {
  return dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('trips', { keyPath: 'id', autoIncrement: true });
      d.createObjectStore('points', { keyPath: 'id', autoIncrement: true }).createIndex('trip', 'tripId');
      d.createObjectStore('places', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const done = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const store = async (name, mode = 'readonly') => (await open()).transaction(name, mode).objectStore(name);

export async function addTrip(t) { return done((await store('trips', 'readwrite')).add(t)); }
export async function putTrip(t) { return done((await store('trips', 'readwrite')).put(t)); }
export async function getTrip(id) { return done((await store('trips')).get(id)); }
export async function allTrips() {
  const list = await done((await store('trips')).getAll());
  return list.sort((a, b) => b.startTime - a.startTime);
}
export async function tripPoints(id) { return done((await store('points')).index('trip').getAll(id)); }

export async function addPoints(pts) {
  if (!pts.length) return;
  const d = await open();
  return new Promise((res, rej) => {
    const tx = d.transaction('points', 'readwrite'), s = tx.objectStore('points');
    for (const p of pts) s.add(p);
    tx.oncomplete = () => res();
    tx.onerror = tx.onabort = () => rej(tx.error);
  });
}

export async function deleteTrip(id) {
  const d = await open();
  return new Promise((res, rej) => {
    const tx = d.transaction(['trips', 'points'], 'readwrite'), pts = tx.objectStore('points');
    tx.objectStore('trips').delete(id);
    const cur = pts.index('trip').openKeyCursor(IDBKeyRange.only(id));
    cur.onsuccess = () => { const c = cur.result; if (c) { pts.delete(c.primaryKey); c.continue(); } };
    tx.oncomplete = () => res();
    tx.onerror = tx.onabort = () => rej(tx.error);
  });
}

export async function allPlaces() { return done((await store('places')).getAll()); }
export async function putPlace(p) { return done((await store('places', 'readwrite')).put(p)); }
export async function deletePlace(id) { return done((await store('places', 'readwrite')).delete(id)); }

// ---------- Back-up ----------
export async function exportAll() {
  return {
    v: 1,
    exported: new Date().toISOString(),
    trips: (await allTrips()).filter(t => t.status === 'done'),
    points: await done((await store('points')).getAll()),
    places: await allPlaces(),
  };
}

const num = (v, d = 0) => Number.isFinite(+v) ? +v : d;
const okLL = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

export async function importAll(data) {
  if (!data || data.v !== 1 || !Array.isArray(data.trips)) throw new Error('Ongeldig back-upbestand');
  const have = new Set((await allTrips()).map(t => t.startTime));
  const byTrip = new Map();
  for (const p of Array.isArray(data.points) ? data.points : []) {
    if (!p || !okLL(+p.lat, +p.lon)) continue;
    if (!byTrip.has(p.tripId)) byTrip.set(p.tripId, []);
    byTrip.get(p.tripId).push(p);
  }
  let trips = 0;
  for (const t of data.trips) {
    const startTime = num(t?.startTime);
    if (!startTime || have.has(startTime)) continue;
    const id = await addTrip({
      startTime, endTime: num(t.endTime, startTime), status: 'done',
      name: String(t.name ?? '').slice(0, 120),
      distance: num(t.distance), gapDistance: num(t.gapDistance),
      movingTime: num(t.movingTime), maxSpeed: num(t.maxSpeed), points: num(t.points),
      preview: Array.isArray(t.preview) ? t.preview.filter(q => Array.isArray(q) && okLL(+q[0], +q[1])).map(q => [+q[0], +q[1]]) : [],
    });
    await addPoints((byTrip.get(t.id) || []).map(p => ({
      tripId: id, lat: +p.lat, lon: +p.lon, t: num(p.t),
      s: p.s == null ? null : num(p.s), a: p.a == null ? null : num(p.a), ...(p.g ? { g: 1 } : {}),
    })));
    trips++;
  }
  let places = 0;
  for (const p of Array.isArray(data.places) ? data.places : []) {
    if (!p || typeof p.id !== 'string' || !okLL(+p.lat, +p.lon)) continue;
    const tags = {};
    if (p.tags && typeof p.tags === 'object') for (const [k, v] of Object.entries(p.tags)) tags[String(k)] = String(v);
    await putPlace({ id: p.id, osm: typeof p.osm === 'string' ? p.osm : undefined, cat: String(p.cat), name: String(p.name ?? '').slice(0, 120), lat: +p.lat, lon: +p.lon, tags, savedAt: num(p.savedAt, Date.now()) });
    places++;
  }
  return { trips, places };
}
