export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Afstand in meters tussen twee [lat, lon]-punten. */
export function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const nf = (n, d = 0) => n.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
export function fmtKm(m) { const km = m / 1000; return nf(km, km < 100 ? 1 : 0); }
export function fmtDist(m) { return m < 950 ? `${Math.round(m / 10) * 10} m` : `${fmtKm(m)} km`; }

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const hrs = Math.floor(sec / 3600), min = Math.floor((sec % 3600) / 60);
  return hrs ? `${hrs} u ${String(min).padStart(2, '0')}` : `${min} min`;
}
export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const hrs = Math.floor(sec / 3600), min = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(min).padStart(hrs ? 2 : 1, '0'), ss = String(s).padStart(2, '0');
  return hrs ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}
export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

/** Alleen http(s)-adressen doorlaten; al het andere wordt null. */
export function safeUrl(u) {
  try {
    const x = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u);
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null;
  } catch { return null; }
}

/** Punten {lat, lon, g} → lijnstukken; een punt met g=1 begint een nieuw stuk. */
export function toSegs(points) {
  const segs = [];
  for (const p of points) {
    if (p.g || !segs.length) segs.push([]);
    segs[segs.length - 1].push([p.lat, p.lon]);
  }
  return segs;
}

/** Douglas-Peucker: dunt een lijn van [lat, lon]-punten uit met tolerantie in meters. */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const kx = 111320 * Math.cos(pts[0][0] * Math.PI / 180), ky = 110540;
  const P = pts.map(p => [p[1] * kx, p[0] * ky]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = P[a][0], ay = P[a][1], dx = P[b][0] - ax, dy = P[b][1] - ay, len2 = dx * dx + dy * dy;
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      let t = len2 ? ((P[i][0] - ax) * dx + (P[i][1] - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = P[i][0] - (ax + t * dx), ey = P[i][1] - (ay + t * dy), d = ex * ex + ey * ey;
      if (d > max) { max = d; idx = i; }
    }
    if (idx > 0 && max > tol * tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Bestand aanbieden: deelvenster op telefoon, download op desktop. */
export async function saveFile(name, mime, text) {
  const file = new File([text], name, { type: mime });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
