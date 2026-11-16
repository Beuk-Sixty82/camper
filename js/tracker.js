// Ritregistratie: volgt de GPS-positie, tekent de route live en houdt afstand, rijtijd en snelheid bij.
import { map, setMe, trackLines, gapsOf } from './map.js';
import * as db from './db.js';
import { $, haversine, fmtKm, fmtClock, fmtDur, simplify, toSegs } from './util.js';
import { toast, setTab, onTab, currentTab } from './ui.js';
import { openTrip, nameTrip } from './trips.js';

const MAX_ACC = 40;      // m — slechtere fixes tellen niet mee
const MIN_DIST = 25;     // m tussen opgeslagen punten
const MIN_DT = 3;        // s tussen opgeslagen punten
const MAX_SPEED = 70;    // m/s — sneller is een GPS-sprong

const S = {
  trip: null, paused: false, live: false,
  watch: null, tick: null, wake: null,
  last: null, lastFix: null, speed: 0, speedAt: 0,
  segs: [], buf: [], lastFlush: 0, resumeGap: false,
  follow: true, first: false, lines: null,
};

export const trackerActive = () => !!S.trip && !S.paused;

// ---------- Kaart ----------
function center(ll, animate = true) {
  const z = map.getZoom();
  const pt = map.project(ll, z).add([0, ($('#hud').offsetHeight || 0) / 2]);
  map.panTo(map.unproject(pt, z), { animate, duration: .5 });
}
function setFollow(on) {
  S.follow = on;
  $('#btn-locate').classList.toggle('off', !!S.trip && !on);
}
export function recenter() {
  setFollow(true);
  if (S.lastFix) {
    if (map.getZoom() < 14) map.setZoom(15, { animate: false });
    center([S.lastFix.lat, S.lastFix.lon]);
  }
}
function makeLines() {
  dropLines();
  S.lines = trackLines(S.segs);
  Object.values(S.lines).forEach(l => l.addTo(map));
}
function dropLines() {
  if (S.lines) Object.values(S.lines).forEach(l => map.removeLayer(l));
  S.lines = null;
}
function redraw() {
  if (!S.lines) return;
  S.lines.casing.setLatLngs(S.segs);
  S.lines.line.setLatLngs(S.segs);
  S.lines.gaps.setLatLngs(gapsOf(S.segs));
}

// ---------- Scherm wakker houden ----------
async function wakeOn() {
  try {
    if ('wakeLock' in navigator && !S.wake && document.visibilityState === 'visible') {
      S.wake = await navigator.wakeLock.request('screen');
      S.wake.addEventListener('release', () => { S.wake = null; });
    }
  } catch { /* niet beschikbaar of geweigerd */ }
}
function wakeOff() { S.wake?.release().catch(() => {}); S.wake = null; }

// ---------- GPS ----------
function startWatch() {
  stopWatch();
  S.watch = navigator.geolocation.watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}
function stopWatch() {
  if (S.watch != null) navigator.geolocation.clearWatch(S.watch);
  S.watch = null;
}
function onErr(e) {
  if (e.code === 1 && S.trip && !S.paused) {
    toast('Geen toegang tot je locatie. Sta locatie toe in Instellingen.');
    pause();
  }
}

function onFix(pos) {
  const c = pos.coords, t = Date.now(), lat = c.latitude, lon = c.longitude;
  setMe(lat, lon, c.accuracy);

  let sp = typeof c.speed === 'number' && c.speed >= 0 ? c.speed : null;
  if (sp == null && S.lastFix) {
    const dt = (t - S.lastFix.t) / 1000;
    if (dt > .5 && dt < 15) sp = haversine([S.lastFix.lat, S.lastFix.lon], [lat, lon]) / dt;
  }
  S.lastFix = { lat, lon, t };
  if (sp != null) { S.speed = sp; S.speedAt = t; }

  if (S.first) { S.first = false; map.setView([lat, lon], Math.max(map.getZoom(), 15), { animate: false }); }
  if (S.follow && currentTab() === 'drive') center([lat, lon]);

  if (S.trip && !S.paused && c.accuracy <= MAX_ACC) record({ lat: +lat.toFixed(6), lon: +lon.toFixed(6), t, s: sp, a: c.altitude ?? null });
  update();
}

function record(p) {
  const T = S.trip, prev = S.last;
  if (!prev) return push(p);
  const d = haversine([prev.lat, prev.lon], [p.lat, p.lon]);
  const dt = (p.t - prev.t) / 1000;

  // Eerste punt na pauze of herstart: sluit aan met een onderbreking, zonder kilometers te tellen.
  if (S.resumeGap) {
    S.resumeGap = false;
    if (d >= MIN_DIST) { p.g = 1; push(p); } else S.last = { ...prev, t: p.t };
    return;
  }
  if (d < MIN_DIST || dt < MIN_DT) return;
  if (p.s != null && p.s < .7 && d < 60) return;          // stilstaan met GPS-ruis
  const gap = dt > 90 && d > 300;                          // app was weg, of tunnel
  if (!gap && d / dt > MAX_SPEED) return;

  T.distance += d;
  if (gap) { T.gapDistance += d; p.g = 1; }
  else {
    if (dt <= 30) T.movingTime += dt;
    T.maxSpeed = Math.max(T.maxSpeed, p.s ?? d / dt);
  }
  push(p);
}

function push(p) {
  S.last = p;
  S.trip.points++;
  if (p.g || !S.segs.length) S.segs.push([]);
  S.segs[S.segs.length - 1].push([p.lat, p.lon]);
  S.buf.push({ ...p, tripId: S.trip.id });
  redraw();
  if (S.buf.length >= 5 || Date.now() - S.lastFlush > 10000) flush();
}

async function flush() {
  if (!S.trip) return;
  const pts = S.buf;
  S.buf = [];
  S.lastFlush = Date.now();
  try {
    await db.addPoints(pts);
    await db.putTrip(S.trip);
  } catch {
    S.buf = pts.concat(S.buf);
  }
}

// ---------- Bediening ----------
async function start() {
  if (!('geolocation' in navigator)) return toast('Locatie wordt niet ondersteund op dit apparaat');
  const trip = { startTime: Date.now(), endTime: null, status: 'active', name: '', distance: 0, gapDistance: 0, movingTime: 0, maxSpeed: 0, points: 0 };
  trip.id = await db.addTrip(trip);
  Object.assign(S, { trip, paused: false, live: true, last: null, lastFix: null, speed: 0, segs: [], buf: [], resumeGap: false, first: true });
  navigator.storage?.persist?.().catch(() => {});
  makeLines();
  run();
  setFollow(true);
  build();
}
function run() {
  startWatch();
  wakeOn();
  clearInterval(S.tick);
  S.tick = setInterval(update, 1000);
}
function pause() {
  S.paused = true;
  S.speed = 0;
  stopWatch();
  wakeOff();
  clearInterval(S.tick);
  flush();
  build();
}
function resume() {
  S.paused = false;
  S.live = true;
  S.resumeGap = true;
  S.first = !S.lastFix;
  run();
  setFollow(true);
  build();
}
async function stop() {
  const T = S.trip;
  if (!T || !confirm('Rit beëindigen en opslaan?')) return;
  stopWatch();
  wakeOff();
  clearInterval(S.tick);
  await flush();
  const flat = S.segs.flat();
  const endTime = S.live ? Date.now() : (S.last?.t ?? Date.now());
  S.trip = null;
  S.paused = false;
  dropLines();
  setFollow(true);
  build();

  if (T.distance < 100 || flat.length < 2) {
    await db.deleteTrip(T.id);
    toast('Rit was te kort en is niet bewaard');
    return;
  }
  T.status = 'done';
  T.endTime = endTime;
  T.preview = simplify(flat, 30).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]);
  await db.putTrip(T);
  nameTrip(T);
  setTab('trips');
  openTrip(T.id);
}

// ---------- Dashboard ----------
function build() {
  const el = $('#hud'), T = S.trip;
  $('.tabs [data-tab="drive"]').classList.toggle('rec', !!T);
  if (!T) {
    el.innerHTML = `
      <div class="hud-idle">
        <div><h2>Klaar voor vertrek</h2><p>Leg je route, afstand en rijtijd vast terwijl je rijdt.</p></div>
        <button type="button" class="btn primary big" data-act="start"><i class="rec-dot"></i>Start rit</button>
      </div>`;
    return;
  }
  el.innerHTML = `
    <div class="hud-top">
      <span class="rec${S.paused ? ' paused' : ''}"><i></i>${S.paused ? 'Gepauzeerd' : 'Opname'}</span>
      <span class="hud-dur" id="h-dur"></span>
    </div>
    <div class="speed"><b id="h-speed">0</b><span>km/h</span></div>
    <div class="stat-grid">
      <div><b id="h-dist">0,0</b><span>km</span></div>
      <div><b id="h-move">0 min</b><span>rijtijd</span></div>
      <div><b id="h-avg">–</b><span>gem. km/h</span></div>
    </div>
    <div class="hud-actions">
      ${S.paused
        ? '<button type="button" class="btn primary" data-act="resume">Hervat</button>'
        : '<button type="button" class="btn" data-act="pause">Pauze</button>'}
      <button type="button" class="btn danger" data-act="stop">Stop</button>
    </div>
    ${S.paused ? '' : '<p class="hud-note">Houd de app open tijdens het rijden; het scherm blijft aan.</p>'}`;
  update();
}

function update() {
  const T = S.trip;
  if (!T || !$('#h-speed')) return;
  if (Date.now() - S.speedAt > 6000) S.speed = 0;
  const moving = T.distance - T.gapDistance;
  $('#h-speed').textContent = Math.round(S.speed * 3.6);
  $('#h-dist').textContent = fmtKm(T.distance);
  $('#h-move').textContent = fmtDur(T.movingTime);
  $('#h-avg').textContent = T.movingTime > 60 ? Math.round(moving / T.movingTime * 3.6) : '–';
  $('#h-dur').textContent = S.paused && !S.live ? '' : fmtClock((Date.now() - T.startTime) / 1000);
}

export async function initTracker() {
  $('#hud').addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'start') start();
    else if (act === 'pause') pause();
    else if (act === 'resume') resume();
    else if (act === 'stop') stop();
  });

  map.on('dragstart', () => { if (S.trip && !S.paused) setFollow(false); });
  onTab(name => { if (name === 'drive' && trackerActive()) recenter(); });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
    else if (trackerActive()) { wakeOn(); startWatch(); }   // iOS stopt de GPS-stroom op de achtergrond
  });
  window.addEventListener('pagehide', flush);

  build();

  // Liep er nog een rit toen de app werd gesloten? Zet hem gepauzeerd klaar.
  const open = (await db.allTrips()).find(t => t.status === 'active');
  if (open) {
    const pts = await db.tripPoints(open.id);
    open.points = pts.length;
    Object.assign(S, { trip: open, paused: true, live: false, segs: toSegs(pts), last: pts[pts.length - 1] || null, buf: [] });
    makeLines();
    build();
  }
}
