import { map, locate } from './map.js';
import { initPlaces } from './places.js';
import { initTracker, trackerActive, recenter } from './tracker.js';
import { initTrips } from './trips.js';
import { setTab, closeSheet, currentTab } from './ui.js';
import { $, $$, esc } from './util.js';

// ---------- Startscherm ----------
const splash = $('#splash');
function hideSplash() {
  if (!splash || splash.classList.contains('out')) return;
  splash.classList.add('out');
  setTimeout(() => splash.remove(), 500);
}
splash?.addEventListener('click', hideSplash);
setTimeout(hideSplash, 1800);

// ---------- Tabs ----------
$$('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

map.on('click', () => {
  $('#results').hidden = true;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (document.body.dataset.mode !== 'trip') closeSheet();
});

$('#btn-locate').addEventListener('click', () => {
  if (trackerActive() && currentTab() === 'drive') recenter();
  else locate(true);
});

// ---------- Zoeken op plaatsnaam (heel Europa) ----------
const results = $('#results');
$('#search').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return;
  $('#q').blur();
  results.hidden = false;
  results.innerHTML = '<div class="res-msg">Zoeken…</div>';
  try {
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.search = new URLSearchParams({ format: 'jsonv2', q, limit: '6', 'accept-language': 'nl', viewbox: '-31,72,45,27', bounded: '1' });
    const r = await fetch(u);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const list = await r.json();
    if (!list.length) { results.innerHTML = '<div class="res-msg">Niets gevonden in Europa</div>'; return; }
    results.innerHTML = list.map((it, i) => {
      const [first, ...rest] = String(it.display_name).split(', ');
      return `<button type="button" data-i="${i}"><b>${esc(first)}</b><small>${esc(rest.join(', '))}</small></button>`;
    }).join('');
    results.onclick = ev => {
      const it = list[ev.target.closest('[data-i]')?.dataset.i];
      if (!it) return;
      results.hidden = true;
      const bb = (it.boundingbox || []).map(Number);
      if (bb.length === 4 && bb.every(Number.isFinite)) map.fitBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { maxZoom: 13 });
      else map.setView([+it.lat, +it.lon], 12);
    };
  } catch {
    results.innerHTML = '<div class="res-msg">Zoeken lukt nu niet. Controleer je internetverbinding.</div>';
  }
});
$('#q').addEventListener('input', () => { if (!$('#q').value) results.hidden = true; });

// ---------- Start ----------
initTrips();
initPlaces();
initTracker();

// Al toestemming voor locatie? Toon dan direct waar je bent (de eerste keer ook inzoomen).
navigator.permissions?.query({ name: 'geolocation' })
  .then(p => { if (p.state === 'granted') locate(!localStorage.getItem('view')); })
  .catch(() => {});

// Tip om de app op het beginscherm te zetten (alleen in Safari op iPhone/iPad).
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
if (isIOS && !standalone && !localStorage.getItem('install-hint')) {
  $('#install').hidden = false;
  $('#install-close').addEventListener('click', () => {
    $('#install').hidden = true;
    try { localStorage.setItem('install-hint', '1'); } catch { /* niet erg */ }
  });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
