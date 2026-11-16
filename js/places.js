/* global L */
// Plekken om te parkeren en overnachten. Bron: het meegeleverde plekkenbestand (data/, opgebouwd uit
// OpenStreetMap met tools/build-data.mjs). Voor gebieden die daar niet in staan: live via de Overpass API.
import { map, me, locate } from './map.js';
import * as db from './db.js';
import { ql, toPlace, unpack, tilesIn } from './osm.js';
import { $, esc, h, haversine, fmtDist, safeUrl } from './util.js';
import { openSheet, closeSheet, setTab, onTab, currentTab, toast } from './ui.js';

const MIN_ZOOM = 8;
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const CATS = {
  camper: 'Camperplaats',
  camping: 'Camping',
  parking: 'Parkeren',
  service: 'Water & lozen',
  custom: 'Eigen plek',
};
const FILTERS = ['camper', 'camping', 'parking', 'service'];
const GLYPH = {
  camper: '<svg viewBox="0 0 24 24"><path d="M2 6.5h12.5l4.2 4.3 3.3.9v5.3h-2.1a2.6 2.6 0 0 1-5.2 0H9.6a2.6 2.6 0 0 1-5.2 0H2zm3 2.2v3h4.5v-3zm8.2 0v3h3.4l-2.6-3z"/></svg>',
  camping: '<svg viewBox="0 0 24 24"><path d="M12 3.2 2.2 20h19.6zm0 7.3 3.3 7.3H8.7z"/></svg>',
  parking: '<svg viewBox="0 0 24 24"><path d="M7 3.5h6.2a5.4 5.4 0 0 1 0 10.8h-2.6v6.2H7zm3.6 3.3v4.2H13a2.1 2.1 0 0 0 0-4.2z"/></svg>',
  service: '<svg viewBox="0 0 24 24"><path d="M12 2.5s6.5 7 6.5 11.8a6.5 6.5 0 0 1-13 0C5.5 9.5 12 2.5 12 2.5z"/></svg>',
  custom: '<svg viewBox="0 0 24 24"><path d="m12 2.8 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z"/></svg>',
};
const catOf = p => (CATS[p.cat] ? p.cat : 'custom');
export const pinHtml = p => `<span class="pin pin-${catOf(p)}">${GLYPH[catOf(p)]}</span>`;
export const catLabel = p => {
  const a = p.tags?.amenity;
  return a === 'water_point' ? 'Watertappunt' : a === 'sanitary_dump_station' ? 'Loosplaats' : CATS[catOf(p)];
};

const places = new Map();   // id → plek
const markers = new Map();  // id → Leaflet-marker
const favs = new Map();     // id → bewaarde plek
let index = null;           // inhoud van data/index.json
const tiles = new Map();    // tegel → Promise (geladen of bezig)
let liveDone = [];          // gebieden die live zijn opgehaald
let liveBusy = null, ctrl = null, timer = null, gen = 0;

let active;
try { active = new Set(JSON.parse(localStorage.getItem('cats'))); } catch { active = null; }
if (!active || !active.size) active = new Set(FILTERS);

const cluster = L.markerClusterGroup({
  maxClusterRadius: 48,
  showCoverageOnHover: false,
  disableClusteringAtZoom: 13,
  chunkedLoading: true,
  iconCreateFunction: c => L.divIcon({ className: 'pin-wrap', html: `<div class="cluster">${c.getChildCount()}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] }),
});
const favLayer = L.layerGroup();

const icons = {};
const icon = cat => icons[cat] ??= L.divIcon({ className: 'pin-wrap', html: `<div class="pin pin-${cat}">${GLYPH[cat]}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
const favIcon = cat => icons['fav-' + cat] ??= L.divIcon({ className: 'pin-wrap', html: `<div class="pin fav pin-${cat}">${GLYPH[cat]}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });

function setStatus(text, { spin = false, retry = null } = {}) {
  const el = $('#status');
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = (spin ? '<i class="spin"></i>' : '') + `<span>${esc(text)}</span>`;
  el.onclick = retry;
  el.classList.toggle('tap', !!retry);
}

function addPlaces(list) {
  if (places.size > 60000) { places.clear(); markers.clear(); cluster.clearLayers(); tiles.clear(); liveDone = []; }
  const fresh = [];
  for (const p of list) if (p && !places.has(p.id)) { places.set(p.id, p); fresh.push(p); }
  cluster.addLayers(fresh.filter(p => active.has(p.cat)).map(markerFor));
}

// ---------- Uit het plekkenbestand ----------
async function loadIndex() {
  try {
    const r = await fetch('data/index.json', { cache: 'no-cache' });
    if (r.ok) index = await r.json();
  } catch { /* geen bestand of offline zonder cache: dan alles live */ }
}

function loadTile(key) {
  if (!tiles.has(key)) {
    tiles.set(key, fetch(`data/t_${key}.json`)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(list => addPlaces(list.map(unpack)))
      .catch(e => { tiles.delete(key); throw e; }));
  }
  return tiles.get(key);
}

// ---------- Live via Overpass ----------
async function query(b, signal) {
  const body = new URLSearchParams({ data: ql(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), 25, 5000) });
  let lastErr;
  for (const url of ENDPOINTS) {
    const c = new AbortController();
    const abort = () => c.abort();
    signal.addEventListener('abort', abort);
    const to = setTimeout(abort, 25000);
    try {
      const r = await fetch(url, { method: 'POST', body, signal: c.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!Array.isArray(j.elements) || (j.remark && !j.elements.length)) throw new Error(j.remark || 'Leeg antwoord');
      return j.elements;
    } catch (e) {
      if (signal.aborted) throw new DOMException('Afgebroken', 'AbortError');
      lastErr = e;
    } finally {
      clearTimeout(to);
      signal.removeEventListener('abort', abort);
    }
  }
  throw lastErr;
}

/** Gebied om live op te halen: het kaartbeeld met marge, minimaal ±35 km, zodat rijden niet steeds opnieuw laadt. */
function liveBounds(view) {
  const b = view.pad(0.3), c = b.getCenter();
  const dLat = Math.max(b.getNorth() - b.getSouth(), 0.45) / 2;
  const dLon = Math.max(b.getEast() - b.getWest(), 0.7) / 2;
  return L.latLngBounds([c.lat - dLat, c.lng - dLon], [c.lat + dLat, c.lng + dLon]);
}

async function loadLive(view) {
  if (liveDone.some(b => b.contains(view))) return;
  if (liveBusy?.contains(view)) return liveBusy.promise;
  ctrl?.abort();
  const my = ctrl = new AbortController();
  const b = liveBounds(view);
  liveBusy = b;
  b.promise = (async () => {
    try {
      const els = await query(b, my.signal);
      addPlaces(els.map(toPlace));
      liveDone.push(b);
      if (liveDone.length > 30) liveDone.shift();
    } finally {
      if (ctrl === my) liveBusy = null;
    }
  })();
  return b.promise;
}

// ---------- Laden voor het huidige kaartbeeld ----------
async function load() {
  const my = ++gen;
  if (map.getZoom() < MIN_ZOOM) { setStatus('Zoom in om plekken te zien'); return; }
  const view = map.getBounds();
  const pad = view.pad(0.25);
  const keys = tilesIn(pad.getSouth(), pad.getWest(), pad.getNorth(), pad.getEast());
  const inView = tilesIn(view.getSouth(), view.getWest(), view.getNorth(), view.getEast());

  const fromFile = index ? keys.filter(k => index.tiles[k] > 0) : [];
  const needLive = !index || inView.some(k => !(k in index.tiles));
  const pending = fromFile.filter(k => !tiles.has(k)).length || (needLive && !liveDone.some(b => b.contains(view)));
  if (pending) setStatus('Plekken laden…', { spin: true });

  const jobs = fromFile.map(loadTile);
  if (needLive) jobs.push(loadLive(view));
  const res = await Promise.allSettled(jobs);
  if (my !== gen) return;

  const err = res.find(r => r.status === 'rejected' && r.reason?.name !== 'AbortError');
  if (err) setStatus(navigator.onLine === false ? 'Geen internet · tik om opnieuw te proberen' : 'Laden mislukt · tik om opnieuw te proberen', { retry: load });
  else setStatus('');
}

function markerFor(p) {
  let m = markers.get(p.id);
  if (!m) {
    m = L.marker([p.lat, p.lon], { icon: icon(p.cat), keyboard: false });
    m.on('click', () => showPlace(p));
    markers.set(p.id, m);
  }
  return m;
}

function refilter() {
  cluster.clearLayers();
  cluster.addLayers([...places.values()].filter(p => active.has(p.cat)).map(markerFor));
}

function renderChips() {
  $('#chips').innerHTML = FILTERS.map(c =>
    `<button type="button" class="chip${active.has(c) ? ' on' : ''}" data-cat="${c}" aria-pressed="${active.has(c)}" style="--c:var(--${c})"><i></i>${CATS[c]}</button>`).join('');
}

// ---------- Detailblad ----------
const yes = v => !!v && v !== 'no';
const withUnit = (v, u) => /^[\d.,]+$/.test(v) ? `${v.replace('.', ',')} ${u}` : v;

function facts(p) {
  const t = p.tags || {}, out = [];
  if (t.fee === 'no') out.push(['Gratis', 'good']);
  else if (yes(t.fee)) out.push([t.charge ? `Betaald · ${t.charge}` : 'Betaald', '']);
  const cap = t['capacity:motorhome'] || t['capacity:caravans'] || (p.cat !== 'camping' ? t.capacity : '');
  if (cap && /^\d+$/.test(cap)) out.push([`${cap} ${cap === '1' ? 'plaats' : 'plaatsen'}`, '']);
  if (yes(t.power_supply)) out.push(['Stroom', '']);
  if (t.drinking_water === 'yes' || yes(t.water_point) || t.amenity === 'water_point') out.push(['Water', '']);
  if (yes(t.sanitary_dump_station) || t.amenity === 'sanitary_dump_station') out.push(['Lozen', '']);
  if (t.toilets === 'yes') out.push(['Toilet', '']);
  if (yes(t.shower)) out.push(['Douche', '']);
  if (yes(t.internet_access)) out.push(['Wifi', '']);
  if (t.dog === 'yes' || t.dog === 'leashed') out.push(['Honden welkom', '']);
  if (t.dog === 'no') out.push(['Geen honden', 'warn']);
  if (t.maxheight) out.push([`Max. hoogte ${withUnit(t.maxheight, 'm')}`, 'warn']);
  if (t.maxlength) out.push([`Max. lengte ${withUnit(t.maxlength, 'm')}`, 'warn']);
  if (t.maxweight) out.push([`Max. gewicht ${withUnit(t.maxweight, 't')}`, 'warn']);
  if (t.maxwidth) out.push([`Max. breedte ${withUnit(t.maxwidth, 'm')}`, 'warn']);
  return out;
}

function addressOf(t) {
  const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  const town = [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ');
  return [street, town].filter(Boolean).join(', ');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Adres bij coördinaten opzoeken (OpenStreetMap Nominatim) voor plekken zonder adres. */
const addrCache = new Map();
function reverseAddress(lat, lon) {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  if (!addrCache.has(key)) {
    addrCache.set(key, fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=nl&lat=${lat}&lon=${lon}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        const a = j?.address;
        if (!a) return '';
        const street = [a.road || a.pedestrian || a.hamlet, a.house_number].filter(Boolean).join(' ');
        const town = [a.postcode, a.city || a.town || a.village || a.municipality].filter(Boolean).join(' ');
        return [street, town, a.country].filter(Boolean).join(', ');
      })
      .catch(() => { addrCache.delete(key); return ''; }));
  }
  return addrCache.get(key);
}

function infoRows(p) {
  const t = p.tags || {}, rows = [];
  const addr = addressOf(t);
  if (addr) rows.push(['Adres', esc(addr)]);
  if (t.opening_hours) rows.push(['Open', esc(t.opening_hours)]);
  if (t.maxstay) rows.push(['Max. verblijf', esc(t.maxstay)]);
  if (t.operator) rows.push(['Beheerder', esc(t.operator)]);
  const phone = t.phone || t['contact:phone'];
  if (phone) {
    const tel = phone.split(';')[0].replace(/[^\d+]/g, '');
    rows.push(['Telefoon', tel ? `<a href="tel:${esc(tel)}">${esc(phone)}</a>` : esc(phone)]);
  }
  const web = safeUrl(t.website || t['contact:website'] || t.url || '');
  if (web) rows.push(['Website', `<a href="${esc(web)}" target="_blank" rel="noopener noreferrer">${esc(new URL(web).hostname.replace(/^www\./, ''))}</a>`]);
  const desc = t['description:nl'] || t.description || p.note;
  if (desc) rows.push(['Omschrijving', esc(desc)]);
  return rows;
}

export function showPlace(p) {
  const cat = catOf(p), t = p.tags || {};
  const kind = catLabel(p);
  const dist = me.pos ? `${fmtDist(haversine(me.pos, [p.lat, p.lon]))} hiervandaan` : '';
  const sub = [kind, !t['addr:street'] && t['addr:city'], dist].filter(Boolean).join(' · ');
  const tags = facts(p), rows = infoRows(p);
  const ll = `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  const addr = addressOf(t);
  const appleUrl = `https://maps.apple.com/?ll=${ll}&q=${encodeURIComponent(p.name)}`;

  const node = h(`
    <div>
      <div class="sheet-head">
        <span class="pin pin-${cat}">${GLYPH[cat]}</span>
        <div class="sheet-title"><h2>${esc(p.name)}</h2><p>${esc(sub)}</p></div>
        <button type="button" class="icon-btn" data-close aria-label="Sluiten">×</button>
      </div>
      ${tags.length ? `<div class="tags">${tags.map(([l, k]) => `<span class="tag ${k}">${esc(l)}</span>`).join('')}</div>` : ''}
      ${rows.length ? `<dl class="info">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
      <div class="actions">
        <a class="btn primary" href="https://maps.apple.com/?daddr=${ll}&dirflg=d" target="_blank" rel="noopener">Route</a>
        <button type="button" class="btn" data-fav></button>
      </div>
      <div class="actions">
        <a class="btn" href="${esc(appleUrl)}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.6a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2z"/></svg>
          Open in Apple Kaarten
        </a>
      </div>
      <div class="actions">
        <button type="button" class="btn small" data-copy>${addr ? 'Kopieer adres' : 'Kopieer coördinaten'}</button>
      </div>
      <p class="src">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${ll}" target="_blank" rel="noopener">Route via Google Maps</a>
        ${p.osm ? ` · Bron: <a href="https://www.openstreetmap.org/${esc(p.osm)}" target="_blank" rel="noopener">OpenStreetMap</a>` : ''}
      </p>
    </div>`);

  let copyVal = addr ? `${p.name}, ${addr}` : ll;
  const copyBtn = node.querySelector('[data-copy]');
  copyBtn.addEventListener('click', async () => {
    toast(await copyText(copyVal) ? `Gekopieerd: ${copyVal}` : 'Kopiëren lukte niet');
  });
  if (!addr) {
    reverseAddress(p.lat, p.lon).then(a => {
      if (!a || !node.isConnected) return;
      copyVal = `${p.name}, ${a}`;
      copyBtn.textContent = 'Kopieer adres';
      let dl = node.querySelector('.info');
      if (!dl) { dl = h('<dl class="info"></dl>'); node.querySelector('.actions').before(dl); }
      dl.prepend(h(`<div><dt>Adres</dt><dd>${esc(a)}</dd></div>`));
    });
  }

  const favBtn = node.querySelector('[data-fav]');
  const paint = () => { favBtn.textContent = favs.has(p.id) ? '★ Bewaard' : '☆ Bewaar'; };
  paint();
  favBtn.addEventListener('click', async () => {
    if (favs.has(p.id)) {
      if (cat === 'custom' && !confirm('Deze eigen plek verwijderen?')) return;
      favs.delete(p.id);
      await db.deletePlace(p.id);
      if (cat === 'custom') closeSheet();
    } else {
      const fav = { ...p, savedAt: Date.now() };
      delete fav.named;
      favs.set(p.id, fav);
      await db.putPlace(fav);
    }
    paint();
    drawFavs();
  });

  const sheet = openSheet(node);
  map.panInside([p.lat, p.lon], { paddingTopLeft: [40, 150], paddingBottomRight: [40, sheet.offsetHeight + 40] });
}

// ---------- Zoeken in geladen en bewaarde plekken ----------
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Plekken waarvan de naam of plaats de zoektekst bevat, dichtstbijzijnde (t.o.v. de kaart) eerst. */
export function findPlaces(q, limit = 5) {
  const s = norm(q).trim();
  if (s.length < 2) return [];
  const c = map.getCenter(), ref = [c.lat, c.lng];
  const hits = [], seen = new Set();
  for (const p of [...favs.values(), ...places.values()]) {
    if (seen.has(p.id)) continue;
    if (norm(p.name).includes(s) || norm(p.tags?.['addr:city']).includes(s)) {
      seen.add(p.id);
      hits.push({ p, d: haversine(ref, [p.lat, p.lon]) - (favs.has(p.id) ? 1e7 : 0) });
    }
  }
  return hits.sort((a, b) => a.d - b.d).slice(0, limit).map(x => x.p);
}

// ---------- Bewaarde plekken ----------
function drawFavs() {
  favLayer.clearLayers();
  for (const p of favs.values()) {
    L.marker([p.lat, p.lon], { icon: favIcon(catOf(p)), zIndexOffset: 1000, keyboard: false })
      .on('click', () => showPlace(p))
      .addTo(favLayer);
  }
}

async function addCustom(lat, lon) {
  const name = prompt('Naam voor deze plek', 'Mijn plek');
  if (!name || !name.trim()) return;
  const p = { id: 'c' + Date.now(), cat: 'custom', name: name.trim().slice(0, 80), lat, lon, tags: {}, savedAt: Date.now() };
  favs.set(p.id, p);
  await db.putPlace(p);
  drawFavs();
  toast('Plek bewaard');
  if (currentTab() === 'saved') renderSaved();
  else showPlace(p);
}

function renderSaved() {
  const el = $('#panel-saved');
  const list = [...favs.values()].map(p => ({ p, d: me.pos ? haversine(me.pos, [p.lat, p.lon]) : null }));
  list.sort((a, b) => (a.d != null ? a.d - b.d : (b.p.savedAt || 0) - (a.p.savedAt || 0)));
  el.innerHTML = `
    <header class="p-head"><h1>Bewaard</h1><button type="button" class="btn small" id="add-here">＋ Huidige locatie</button></header>
    ${list.length ? `<ul class="list">${list.map(({ p, d }) => `
      <li><button type="button" data-id="${esc(p.id)}">
        <span class="pin pin-${catOf(p)}">${GLYPH[catOf(p)]}</span>
        <span class="li-main"><b>${esc(p.name)}</b><small>${esc(CATS[catOf(p)])}${d != null ? ' · ' + fmtDist(d) : ''}</small></span>
        <span class="chev">›</span>
      </button></li>`).join('')}</ul>`
    : `<div class="empty"><b>Nog niets bewaard</b>Tik op een plek op de kaart en kies ‘Bewaar’. Houd de kaart ingedrukt om zelf een plek toe te voegen.</div>`}`;
}

export async function initPlaces() {
  cluster.addTo(map);
  favLayer.addTo(map);
  renderChips();

  $('#chips').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const c = b.dataset.cat;
    if (active.has(c)) active.delete(c); else active.add(c);
    try { localStorage.setItem('cats', JSON.stringify([...active])); } catch { /* niet erg */ }
    renderChips();
    refilter();
  });

  $('#panel-saved').addEventListener('click', async e => {
    if (e.target.closest('#add-here')) {
      const pos = await locate(false);
      if (!pos) return toast('Je locatie is niet beschikbaar');
      return addCustom(pos[0], pos[1]);
    }
    const p = favs.get(e.target.closest('[data-id]')?.dataset.id);
    if (!p) return;
    setTab('places');
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), 14));
    showPlace(p);
  });

  // Kaart ingedrukt houden (of rechtsklikken) = eigen plek toevoegen.
  map.on('contextmenu', e => { if (currentTab() === 'places') addCustom(e.latlng.lat, e.latlng.lng); });

  // Op het rittenoverzicht horen alleen routes op de kaart te staan.
  onTab(name => {
    const show = name !== 'trips';
    for (const layer of [cluster, favLayer]) {
      if (show && !map.hasLayer(layer)) map.addLayer(layer);
      if (!show && map.hasLayer(layer)) map.removeLayer(layer);
    }
    if (name === 'saved') renderSaved();
  });

  map.on('moveend', () => { clearTimeout(timer); timer = setTimeout(load, 400); });

  for (const p of await db.allPlaces()) favs.set(p.id, p);
  drawFavs();
  await loadIndex();
  load();
}
