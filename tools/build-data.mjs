// Bouwt het plekkenbestand voor heel Europa op uit OpenStreetMap (Overpass API).
//
//   node tools/build-data.mjs            gaat verder waar de vorige keer is gestopt
//   node tools/build-data.mjs --fresh    haalt alles opnieuw op (bijv. eens per paar maanden)
//
// Resultaat: data/index.json + data/t_<x>_<y>.json (tegels van 2,5° × 2,5°).
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ql, toPlace, pack, tileKey, ORIGIN, TILE } from '../js/osm.js';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const INDEX = path.join(DATA, 'index.json');
const UA = 'CamperApp-data-build/1.0';
const ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const CELL = 5;           // graden per verzoek (= 2 × 2 tegels)
const MAX_TRIES = 6;
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

async function fetchCell(endpoint, c) {
  const body = new URLSearchParams({ data: ql(c.lat, c.lon, c.lat + CELL, c.lon + CELL, 170) });
  const r = await fetch(endpoint, { method: 'POST', headers: { 'User-Agent': UA }, body, signal: AbortSignal.timeout(220000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (!Array.isArray(j.elements)) throw new Error('geen elementen');
  if (j.remark && /error|timed out|out of memory/i.test(j.remark)) throw new Error(j.remark.slice(0, 80));
  return j.elements;
}

async function storeCell(c, elements) {
  const buckets = new Map();
  for (let lat = c.lat; lat < c.lat + CELL; lat += TILE) for (let lon = c.lon; lon < c.lon + CELL; lon += TILE) buckets.set(tileKey(lat + .01, lon + .01), []);
  let n = 0;
  for (const el of elements) {
    const p = toPlace(el);
    if (!p) continue;
    const b = buckets.get(tileKey(p.lat, p.lon));
    if (b) { b.push(pack(p)); n++; }
  }
  for (const [key, list] of buckets) {
    index.tiles[key] = list.length;
    if (list.length) await writeFile(path.join(DATA, `t_${key}.json`), JSON.stringify(list));
  }
  index.cells[`${c.lat}_${c.lon}`] = new Date().toISOString();
  index.built = new Date().toISOString().slice(0, 10);
  await saveIndex();
  return n;
}

const queue = cells.filter(c => !index.cells[`${c.lat}_${c.lon}`]).map(c => ({ ...c, tries: 0 }));
const total = queue.length, failed = [];
let done = 0, places = 0;
console.log(`${total} van ${cells.length} gebieden op te halen (origin ${ORIGIN.lat}/${ORIGIN.lon})`);

async function worker(endpoint) {
  const host = new URL(endpoint).hostname;
  for (;;) {
    const c = queue.shift();
    if (!c) return;
    const label = `${c.lat}..${c.lat + CELL}N ${c.lon}..${c.lon + CELL}E`;
    const t0 = Date.now();
    try {
      const n = await storeCell(c, await fetchCell(endpoint, c));
      done++; places += n;
      console.log(`[${done}/${total}] ${label}: ${n} plekken (${Math.round((Date.now() - t0) / 1000)} s, ${host})`);
      await sleep(1500);
    } catch (e) {
      c.tries++;
      console.log(`  mislukt ${label} via ${host}: ${e.message} (poging ${c.tries})`);
      if (c.tries < MAX_TRIES) queue.push(c); else failed.push(label);
      await sleep(Math.min(60000, 8000 * c.tries));
    }
  }
}

await Promise.all(ENDPOINTS.map(worker));
await writing;
const all = Object.values(index.tiles).reduce((s, n) => s + n, 0);
console.log(`Klaar: ${places} plekken opgehaald, ${all} in totaal in ${Object.values(index.tiles).filter(Boolean).length} tegels.`);
if (failed.length) console.log(`Niet gelukt (start het script later nog eens): ${failed.join('; ')}`);
