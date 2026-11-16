/* global L */
import { toast } from './ui.js';

let saved = null;
try { saved = JSON.parse(localStorage.getItem('view') || 'null'); } catch { /* geen opgeslagen kaartbeeld */ }

export const map = L.map('map', { zoomControl: false, worldCopyJump: true, minZoom: 3, maxZoom: 19 });
map.attributionControl.setPrefix(false);
map.setView(saved ? [saved.lat, saved.lon] : [50.2, 9.5], saved ? saved.z : 5);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  crossOrigin: true,
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
}).addTo(map);

map.on('moveend', () => {
  const c = map.getCenter();
  try { localStorage.setItem('view', JSON.stringify({ lat: c.lat, lon: c.lng, z: map.getZoom() })); } catch { /* opslag vol of geblokkeerd */ }
});

// ---------- Eigen positie ----------
export const me = { pos: null, acc: null };
let dot, ring;

export function setMe(lat, lon, acc) {
  me.pos = [lat, lon];
  me.acc = acc;
  if (!dot) {
    ring = L.circle(me.pos, { radius: acc || 0, stroke: false, fillColor: '#1a8cff', fillOpacity: .12, interactive: false }).addTo(map);
    dot = L.marker(me.pos, {
      icon: L.divIcon({ className: 'pin-wrap', html: '<div class="me"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false, keyboard: false, zIndexOffset: 2000,
    }).addTo(map);
  } else {
    dot.setLatLng(me.pos);
    ring.setLatLng(me.pos);
    ring.setRadius(acc || 0);
  }
}

/** Vraagt de huidige positie op. Geeft [lat, lon] of null. */
export function locate(fly = true) {
  return new Promise(res => {
    if (!('geolocation' in navigator)) { if (fly) toast('Locatie wordt niet ondersteund'); return res(null); }
    navigator.geolocation.getCurrentPosition(
      p => {
        setMe(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
        if (fly) map.flyTo(me.pos, Math.max(map.getZoom(), 12), { duration: .8 });
        res(me.pos);
      },
      e => {
        if (fly) toast(e.code === 1 ? 'Geen toegang tot je locatie. Sta locatie toe in Instellingen.' : 'Locatie niet gevonden');
        res(null);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

// ---------- Gereden route tekenen ----------
const TRACK = '#3d4fd6';
export function gapsOf(segs) {
  const gaps = [];
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1][segs[i - 1].length - 1], b = segs[i][0];
    if (a && b) gaps.push([a, b]);
  }
  return gaps;
}
export function trackLines(segs) {
  return {
    casing: L.polyline(segs, { color: '#fff', weight: 8, opacity: .9, interactive: false, lineJoin: 'round' }),
    line: L.polyline(segs, { className: 'track', color: TRACK, weight: 4.5, interactive: false, lineJoin: 'round' }),
    gaps: L.polyline(gapsOf(segs), { className: 'track-gap', color: TRACK, weight: 3, dashArray: '3 9', interactive: false }),
  };
}
export function endDot(ll, fill) {
  return L.circleMarker(ll, { radius: 7, color: '#fff', weight: 3, fillColor: fill, fillOpacity: 1, interactive: false });
}
