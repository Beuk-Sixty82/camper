// Zoeken tijdens het typen: camperplekken (uit het geladen plekkenbestand) en plaatsen in Europa (Photon, OpenStreetMap).
import { map, me } from './map.js';
import { findPlaces, showPlace, pinHtml, catLabel } from './places.js';
import { $, esc, haversine, fmtDist } from './util.js';
import { closeSheet } from './ui.js';

const PHOTON = 'https://photon.komoot.io/api/';
const EUROPE = '-31,27,45,72';   // minLon,minLat,maxLon,maxLat
const input = $('#q'), box = $('#results');
let timer = null, ctrl = null, seq = 0;
let local = [], remote = [];

const PIN_IC = '<span class="res-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg></span>';

function subtitle(f) {
  const p = f.properties;
  const town = p.city && p.city !== p.name ? p.city : '';
  return [town, p.state, p.country].filter(Boolean).join(', ');
}

function dedupe(features) {
  const seen = new Set(), out = [];
  for (const f of features) {
    const p = f.properties;
    const key = `${p.name}|${p.state}|${p.country}`;
    if (!p.name || seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function render(state) {
  const ref = me.pos;
  let html = '';
  if (local.length) {
    html += '<div class="res-h">Camperplekken</div>' + local.map((p, i) => `
      <button type="button" data-p="${i}">${pinHtml(p)}
        <span class="res-t"><b>${esc(p.name)}</b><small>${esc([catLabel(p), p.tags?.['addr:city'], ref && fmtDist(haversine(ref, [p.lat, p.lon]))].filter(Boolean).join(' · '))}</small></span>
      </button>`).join('');
  }
  if (state === 'busy' && !remote.length) html += '<div class="res-msg"><i class="spin"></i>Zoeken…</div>';
  else if (state === 'error') html += '<div class="res-msg">Zoeken lukt nu niet. Controleer je internetverbinding.</div>';
  else if (remote.length) {
    html += (local.length ? '<div class="res-h">Plaatsen</div>' : '') + remote.map((f, i) => `
      <button type="button" data-r="${i}">${PIN_IC}
        <span class="res-t"><b>${esc(f.properties.name)}</b><small>${esc(subtitle(f))}</small></span>
      </button>`).join('');
  } else if (state === 'done' && !local.length) html += '<div class="res-msg">Niets gevonden in Europa</div>';
  box.innerHTML = html;
  box.hidden = !html;
}

async function run(q) {
  const my = ++seq;
  ctrl?.abort();
  ctrl = new AbortController();
  render('busy');
  try {
    const c = map.getCenter();
    const u = new URL(PHOTON);
    u.search = new URLSearchParams({ q, limit: '10', bbox: EUROPE, lat: c.lat.toFixed(3), lon: c.lng.toFixed(3), location_bias_scale: '0.2' });
    const r = await fetch(u, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (my !== seq) return;
    remote = dedupe(j.features || []).slice(0, 6);
    render('done');
  } catch (e) {
    if (e.name === 'AbortError' || my !== seq) return;
    remote = [];
    render('error');
  }
}

function onInput() {
  clearTimeout(timer);
  closeSheet();
  const q = input.value.trim();
  if (q.length < 2) { ctrl?.abort(); seq++; local = []; remote = []; box.hidden = true; return; }
  local = findPlaces(q, 4);
  render('busy');
  timer = setTimeout(() => run(q), 280);
}

function choose(e) {
  const b = e.target.closest('button');
  if (!b) return;
  box.hidden = true;
  input.blur();
  if (b.dataset.p != null) {
    const p = local[+b.dataset.p];
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), 14));
    showPlace(p);
    return;
  }
  const f = remote[+b.dataset.r];
  if (!f) return;
  const [lon, lat] = f.geometry.coordinates;
  const ext = f.properties.extent;   // [westLon, noordLat, oostLon, zuidLat]
  if (Array.isArray(ext) && ext.length === 4) map.fitBounds([[ext[3], ext[0]], [ext[1], ext[2]]], { maxZoom: 13 });
  else map.setView([lat, lon], f.properties.osm_key === 'place' ? 12 : 15);
}

export function initSearch() {
  input.addEventListener('input', onInput);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2 && box.innerHTML) box.hidden = false; });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { box.hidden = true; input.blur(); } });
  $('#search').addEventListener('submit', e => {
    e.preventDefault();
    const q = input.value.trim();
    if (q.length < 2) return;
    clearTimeout(timer);
    input.blur();
    local = findPlaces(q, 4);
    run(q);
  });
  box.addEventListener('click', choose);
}
