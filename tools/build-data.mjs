// Bouwt het plekkenbestand voor heel Europa op uit OpenStreetMap (Overpass API).
//
//   node tools/build-data.mjs            haalt alleen op wat nog ontbreekt (ook eerder mislukte gebieden)
//   node tools/build-data.mjs --fresh    haalt alles opnieuw op (bijv. eens per paar maanden)
//
// Resultaat: data/index.json + data/t_<x>_<y>.json (tegels van 2,5° × 2,5°).
// Per tegel één verzoek; loopt dat in een time-out (drukke gebieden), dan wordt de tegel in kleinere stukken opgehaald.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ql, toPlace, pack, tileKey, ORIGIN, TILE } from '../js/osm.js';
import { loadCountries, makeLocator } from './countries-lib.mjs';

const countryAt = makeLocator(await loadCountries());

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const INDEX = path.join(DATA, 'index.json');
const UA = 'CamperApp-data-build/1.2';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const CELL = 5;           // regio's in index.cells (= 2 × 2 tegels)
const MAX_TRIES = 8;      // per tegel, bij echte fouten (niet bij drukke/onbereikbare servers)
const MAX_SPLIT = 3;      // 2,5° → 1,25° → 0,625° → 0,3125°
const MAX_WAIT = 15 * 60000;                    // langste pauze als een server onbereikbaar is
const DEADLINE = Date.now() + 20 * 3600000;     // na 20 uur stoppen met wat er is
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Europa: 34°–74° N, 25° W – 45° O, plus de Canarische Eilanden en Madeira.
const cells = [];
for (let lat = 34; lat < 74; lat += CELL) for (let lon = -25; lon < 45; lon += CELL) cells.push({ lat, lon });
for (const lat of [24, 29]) for (const lon of [-20, -15]) cells.push({ lat, lon });
const far = c => Math.hypot(c.lat + CELL / 2 - 50, (c.lon + CELL / 2 - 8) * .65);
cells.sort((a, b) => far(a) - far(b));     // midden van Europa eerst

const fresh = process.argv.includes('--fresh');
let index = { built: null, cells: {}, tiles: {} };
if (!fresh) { try { index = JSON.parse(await readFile(INDEX, 'utf8')); } catch { /* eerste keer */ } }
await mkdir(DATA, { recursive: true });

let writing = Promise.resolve();
const saveIndex = () => (writing = writing.then(() => writeFile(INDEX, JSON.stringify(index))));
const cellKey = c => `${c.lat}_${c.lon}`;
const tilesOf = c => [[0, 0], [0, TILE], [TILE, 0], [TILE, TILE]].map(([a, b]) => ({ lat: c.lat + a, lon: c.lon + b, cell: c }));

class TooBig extends Error {}   // verzoek te zwaar: in kleinere stukken ophalen
class Busy extends Error {}     // server onbereikbaar of overbelast: wachten, niet als poging tellen

/** Reageert de server op een simpele statusvraag? */
async function healthy(endpoint) {
  try {
    const r = await fetch(endpoint.replace(/interpreter$/, 'status'), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    return r.ok;
  } catch { return false; }
}

async function fetchBox(endpoint, s, w, n, e) {
  const body = new URLSearchParams({ data: ql(s, w, n, e, 120) });
  let r;
  try {
    r = await fetch(endpoint, { method: 'POST', headers: { 'User-Agent': UA }, body, signal: AbortSignal.timeout(150000) });
  } catch (err) {
    if (err.name === 'TimeoutError' && await healthy(endpoint)) throw new TooBig('time-out');
    throw new Busy(err.name === 'TimeoutError' ? 'geen antwoord' : 'onbereikbaar');
  }
  if (r.status === 429 || r.status === 502 || r.status === 503) throw new Busy('HTTP ' + r.status);
  if (r.status === 504) throw (await healthy(endpoint)) ? new TooBig('HTTP 504') : new Busy('HTTP 504');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (j.remark && /timed out|out of memory/i.test(j.remark)) throw new TooBig(j.remark.slice(0, 60));
  if (j.remark && /error/i.test(j.remark)) throw new Error(j.remark.slice(0, 80));
  if (!Array.isArray(j.elements)) throw new Error('geen elementen');
  return j.elements;
}

/** Haalt een vierkant op; te zwaar? Dan in vier kleinere stukken. */
async function fetchArea(endpoint, s, w, size, depth = 0) {
  try {
    return await fetchBox(endpoint, s, w, s + size, w + size);
  } catch (e) {
    if (!(e instanceof TooBig) || depth >= MAX_SPLIT) throw e;
    const h = size / 2, out = [];
    for (const [a, b] of [[0, 0], [0, h], [h, 0], [h, h]]) {
      out.push(...await fetchArea(endpoint, s + a, w + b, h, depth + 1));
      await sleep(1000);
    }
    return out;
  }
}

async function storeTile(t, elements) {
  const key = tileKey(t.lat + .01, t.lon + .01), list = [], seen = new Set(), per = {};
  for (const el of elements) {
    const p = toPlace(el);
    if (!p || seen.has(p.id) || tileKey(p.lat, p.lon) !== key) continue;
    seen.add(p.id);
    p.cc = countryAt(p.lat, p.lon, p.tags);
    per[p.cc || '-'] = (per[p.cc || '-'] || 0) + 1;
    list.push(pack(p));
  }
  if (list.length) await writeFile(path.join(DATA, `t_${key}.json`), JSON.stringify(list));
  index.tiles[key] = list.length;
  (index.tc ??= {})[key] = per;
  if (tilesOf(t.cell).every(x => tileKey(x.lat + .01, x.lon + .01) in index.tiles)) index.cells[cellKey(t.cell)] = new Date().toISOString();
  index.built = new Date().toISOString().slice(0, 10);
  await saveIndex();
  return list.length;
}

const queue = [];
for (const c of cells) {
  if (index.cells[cellKey(c)]) continue;
  for (const t of tilesOf(c)) if (!(tileKey(t.lat + .01, t.lon + .01) in index.tiles)) queue.push({ ...t, tries: 0 });
}
const total = queue.length, failed = [];
let done = 0, places = 0;
console.log(`${total} tegels op te halen (origin ${ORIGIN.lat}/${ORIGIN.lon})`);

const stamp = () => new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

async function worker(endpoint) {
  const host = new URL(endpoint).hostname;
  let busy = 0;
  for (;;) {
    if (Date.now() > DEADLINE) return;
    const t = queue.shift();
    if (!t) return;
    const label = `${t.lat}..${t.lat + TILE}N ${t.lon}..${t.lon + TILE}E`;
    const t0 = Date.now();
    try {
      const n = await storeTile(t, await fetchArea(endpoint, t.lat, t.lon, TILE));
      done++; places += n; busy = 0;
      console.log(`[${done}/${total}] ${label}: ${n} plekken (${Math.round((Date.now() - t0) / 1000)} s, ${host})`);
      await sleep(1500);
    } catch (e) {
      if (e instanceof Busy) {
        queue.unshift(t);                                   // tegel terug vooraan; geen poging verbruikt
        const wait = Math.min(MAX_WAIT, 30000 * 2 ** busy++);
        console.log(`  ${stamp()} ${host} ${e.message}; wacht ${Math.round(wait / 60000) || 1} min`);
        await sleep(wait);
        continue;
      }
      t.tries++;
      console.log(`  mislukt ${label} via ${host}: ${e.message} (poging ${t.tries})`);
      if (t.tries < MAX_TRIES) queue.push(t); else failed.push(label);
      await sleep(Math.min(90000, 10000 * t.tries));
    }
  }
}

await Promise.all(ENDPOINTS.map(worker));
await writing;
const all = Object.values(index.tiles).reduce((s, n) => s + n, 0);
const missing = cells.filter(c => !index.cells[cellKey(c)]).length;
console.log(`Klaar: ${places} plekken opgehaald, ${all} in totaal. Regio's compleet: ${cells.length - missing} van ${cells.length}.`);
if (failed.length) console.log(`Niet gelukt (start het script later nog eens): ${failed.join('; ')}`);
if (queue.length) console.log(`Gestopt na 20 uur; nog ${queue.length} tegels over (start het script later nog eens).`);
