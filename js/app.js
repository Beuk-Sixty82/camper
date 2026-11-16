import { map, locate } from './map.js';
import { initPlaces } from './places.js';
import { initTracker, trackerActive, recenter } from './tracker.js';
import { initTrips } from './trips.js';
import { initSearch } from './search.js';
import { setTab, closeSheet, currentTab } from './ui.js';
import { $, $$ } from './util.js';

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

// ---------- Start ----------
initSearch();
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
