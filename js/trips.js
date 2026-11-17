/* global L */
// Rittenoverzicht: totalen, kilometers per maand, lijst met ritten, detail op de kaart, GPX en back-up.
import { map, trackLines, endDot } from './map.js';
import * as db from './db.js';
import { $, esc, h, nf, fmtKm, fmtDur, fmtDate, fmtTime, toSegs, saveFile, sleep } from './util.js';
import { openSheet, closeSheet, onTab, currentTab, toast } from './ui.js';

let layer = null;
function clearLayer() { if (layer) { map.removeLayer(layer); layer = null; } }

const tripName = t => t.name || `Rit van ${fmtDate(t.startTime)}`;
const avgKmh = t => t.movingTime > 60 ? Math.round((t.distance - (t.gapDistance || 0)) / t.movingTime * 3.6) : null;

function afterClose() {
  clearLayer();
  delete document.body.dataset.mode;
  if (currentTab() === 'trips') renderTrips();
}
function fit(sheet) {
  const b = layer.getBounds();
  if (b.isValid()) map.fitBounds(b, { paddingTopLeft: [36, 70], paddingBottomRight: [36, sheet.offsetHeight + 36], maxZoom: 15, animate: false });
}

// ---------- Overzicht ----------
export async function renderTrips() {
  const el = $('#panel-trips');
  const trips = (await db.allTrips()).filter(t => t.status === 'done');
  const dist = trips.reduce((s, t) => s + t.distance, 0);
  const time = trips.reduce((s, t) => s + t.movingTime, 0);
  const longest = trips.reduce((m, t) => Math.max(m, t.distance), 0);

  const now = new Date(), months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleDateString('nl-NL', { month: 'short' }).replace('.', ''), km: 0 });
  }
  for (const t of trips) {
    const d = new Date(t.startTime), slot = months.find(x => x.y === d.getFullYear() && x.m === d.getMonth());
    if (slot) slot.km += t.distance / 1000;
  }
  const max = Math.max(...months.map(x => x.km), 1);

  el.innerHTML = `
    <header class="hero"><div><h1>Ritten</h1><p>${trips.length ? `${fmtKm(dist)} km onderweg` : 'Klaar voor de eerste rit'}</p></div></header>
    <div class="stat-grid four">
      <div><b>${fmtKm(dist)}</b><span>km gereden</span></div>
      <div><b>${trips.length}</b><span>${trips.length === 1 ? 'rit' : 'ritten'}</span></div>
      <div><b>${fmtDur(time)}</b><span>rijtijd</span></div>
      <div><b>${fmtKm(longest)}</b><span>km langste rit</span></div>
    </div>
    <div class="card chart">
      <div class="chart-title">Kilometers per maand</div>
      <div class="bars">${months.map(x => `
        <div class="bar${x.km ? '' : ' zero'}"><span class="v">${x.km ? nf(Math.round(x.km)) : ''}</span><i style="height:${Math.round(x.km / max * 78)}px"></i><span class="m">${esc(x.label)}</span></div>`).join('')}
      </div>
    </div>
    ${trips.length ? `
      <button type="button" class="btn wide" id="all-map">Alle ritten op de kaart</button>
      <h2 class="sec">Gereden ritten</h2>
      <ul class="list">${trips.map(t => `
        <li><button type="button" data-id="${t.id}">
          <span class="li-main"><b>${esc(tripName(t))}</b><small>${esc(fmtDate(t.startTime))} · ${esc(fmtTime(t.startTime))}</small></span>
          <span class="li-num"><b>${fmtKm(t.distance)} km</b><small>${fmtDur(t.movingTime)}</small></span>
        </button></li>`).join('')}</ul>`
    : `<div class="empty"><b>Nog geen ritten</b>Start een rit op het tabblad ‘Rit’. Na afloop zie je hier je route, afstand en rijtijd.</div>`}
    <p class="fine">Ritten staan alleen op dit toestel. Een back-up maak je bij Instellingen.</p>`;
}

// ---------- Eén rit ----------
export async function openTrip(id) {
  const T = await db.getTrip(id);
  if (!T) return;
  const pts = await db.tripPoints(id);
  const segs = toSegs(pts);
  const avg = avgKmh(T);

  const node = h(`
    <div>
      <div class="sheet-head">
        <div class="sheet-title">
          <h2 data-trip-title="${T.id}">${esc(tripName(T))}</h2>
          <p>${esc(fmtDate(T.startTime))} · ${esc(fmtTime(T.startTime))} – ${esc(fmtTime(T.endTime || T.startTime))}</p>
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Sluiten">×</button>
      </div>
      <div class="stat-grid four">
        <div><b>${fmtKm(T.distance)}</b><span>km</span></div>
        <div><b>${fmtDur(T.movingTime)}</b><span>rijtijd</span></div>
        <div><b>${avg ?? '–'}</b><span>gem. km/h</span></div>
        <div><b>${T.maxSpeed ? Math.round(T.maxSpeed * 3.6) : '–'}</b><span>max. km/h</span></div>
      </div>
      <div class="actions">
        <button type="button" class="btn" data-act="gpx">GPX</button>
        <button type="button" class="btn" data-act="rename">Naam</button>
        <button type="button" class="btn danger" data-act="del">Verwijder</button>
      </div>
    </div>`);

  node.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'gpx') {
      const stamp = new Date(T.startTime).toISOString().slice(0, 10);
      saveFile(`rit-${stamp}.gpx`, 'application/gpx+xml', gpx(T, pts));
    } else if (act === 'rename') {
      const name = prompt('Naam van de rit', tripName(T));
      if (name == null) return;
      T.name = name.trim().slice(0, 120);
      await db.putTrip(T);
      node.querySelector('h2').textContent = tripName(T);
    } else if (act === 'del') {
      if (!confirm('Deze rit definitief verwijderen?')) return;
      await db.deleteTrip(T.id);
      closeSheet();
      toast('Rit verwijderd');
    }
  });

  const sheet = openSheet(node, afterClose);
  clearLayer();
  layer = L.featureGroup(Object.values(trackLines(segs)));
  const flat = segs.flat();
  if (flat.length) {
    endDot(flat[0], '#1f8a5f').addTo(layer);
    endDot(flat[flat.length - 1], '#c2412d').addTo(layer);
  }
  layer.addTo(map);
  document.body.dataset.mode = 'trip';
  fit(sheet);
  if (!T.name) nameTrip(T);
}

async function showAll() {
  const trips = (await db.allTrips()).filter(t => t.status === 'done' && t.preview?.length > 1);
  const dist = trips.reduce((s, t) => s + t.distance, 0);
  const node = h(`
    <div>
      <div class="sheet-head">
        <div class="sheet-title"><h2>Alle ritten</h2><p>${trips.length} ${trips.length === 1 ? 'rit' : 'ritten'} · ${fmtKm(dist)} km · tik op een lijn voor details</p></div>
        <button type="button" class="icon-btn" data-close aria-label="Sluiten">×</button>
      </div>
    </div>`);
  const sheet = openSheet(node, afterClose);
  clearLayer();
  layer = L.featureGroup();
  for (const t of trips) {
    L.polyline(t.preview, { color: '#fff', weight: 7, opacity: .85, interactive: false }).addTo(layer);
    L.polyline(t.preview, { className: 'track', color: '#3d4fd6', weight: 4, bubblingMouseEvents: false })
      .on('click', () => openTrip(t.id))
      .addTo(layer);
  }
  layer.addTo(map);
  document.body.dataset.mode = 'trip';
  fit(sheet);
}

// ---------- Plaatsnamen voor de ritnaam ----------
async function townAt([lat, lon]) {
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=nl&lat=${lat}&lon=${lon}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const a = (await r.json()).address || {};
  return a.city || a.town || a.village || a.municipality || a.county || a.state || '';
}
const naming = new Set();
export async function nameTrip(T) {
  if (T.name || !T.preview?.length || navigator.onLine === false || naming.has(T.id)) return;
  naming.add(T.id);
  try {
    const from = await townAt(T.preview[0]);
    await sleep(1100);
    const to = await townAt(T.preview[T.preview.length - 1]);
    const name = from && to ? (from === to ? `Rondje ${from}` : `${from} → ${to}`) : (from || to);
    const fresh = await db.getTrip(T.id);
    if (!name || !fresh || fresh.name) return;
    fresh.name = name;
    await db.putTrip(fresh);
    T.name = name;
    const title = document.querySelector(`[data-trip-title="${T.id}"]`);
    if (title) title.textContent = name;
  } catch { /* geen internet: de datum blijft de naam */ }
  finally { naming.delete(T.id); }
}

// ---------- GPX ----------
function gpx(T, pts) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Camper" xmlns="http://www.topografix.com/GPX/1/1">',
    `<trk><name>${esc(tripName(T))}</name><trkseg>`];
  pts.forEach((p, i) => {
    if (p.g && i) out.push('</trkseg><trkseg>');
    out.push(`<trkpt lat="${p.lat}" lon="${p.lon}">${p.a != null ? `<ele>${p.a.toFixed(1)}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time></trkpt>`);
  });
  out.push('</trkseg></trk></gpx>');
  return out.join('\n');
}

export function initTrips() {
  const el = $('#panel-trips');
  el.addEventListener('click', async e => {
    if (e.target.closest('#all-map')) return showAll();
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (id) openTrip(+id);
  });
  onTab(name => { if (name === 'trips') renderTrips(); });
}
