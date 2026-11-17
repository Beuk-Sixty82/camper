// Landsgrenzen (Natural Earth 1:10m, publiek domein) en 'in welk land ligt dit punt' — voor de bouwscripts.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson';
const CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache', 'ne_10m_admin_0_countries.geojson');
const EXTRA = ['TR', 'CY', 'MA', 'TN'];                     // buiten 'Europe' maar wel campergebied
const MERGE = { VA: 'IT', SM: 'IT', MC: 'FR', AX: 'FI', JE: 'GB', GG: 'GB', IM: 'GB' };
const AREA = [-32, 20, 60, 75];                              // w, s, e, n: overzeese delen weglaten
const TOL = 0.0005;                                          // graden (~50 m): alleen om te versnellen

async function loadGeo() {
  try { return JSON.parse(await readFile(CACHE, 'utf8')); } catch { /* nog niet gedownload */ }
  const r = await fetch(SRC);
  if (!r.ok) throw new Error('Landsgrenzen downloaden mislukt: HTTP ' + r.status);
  const txt = await r.text();
  await mkdir(path.dirname(CACHE), { recursive: true });
  await writeFile(CACHE, txt);
  return JSON.parse(txt);
}

function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], dx = pts[b][0] - ax, dy = pts[b][1] - ay, len2 = dx * dx + dy * dy;
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      let t = len2 ? ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = pts[i][0] - (ax + t * dx), ey = pts[i][1] - (ay + t * dy), d = ex * ex + ey * ey;
      if (d > max) { max = d; idx = i; }
    }
    if (idx > 0 && max > tol * tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const bboxOf = rings => {
  let w = 180, s = 90, e = -180, n = -90;
  for (const r of rings) for (const [x, y] of r) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
};
const overlaps = (b, a) => b[0] <= a[2] && b[2] >= a[0] && b[1] <= a[3] && b[3] >= a[1];

/** [{c, n, b, polys: [{b, rings}]}], alfabetisch op Nederlandse naam. */
export async function loadCountries() {
  const geo = await loadGeo();
  const out = new Map();
  for (const f of geo.features) {
    const p = f.properties;
    const iso = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2;
    if (p.CONTINENT !== 'Europe' && !EXTRA.includes(iso)) continue;
    const cc = MERGE[iso] || iso;
    if (!out.has(cc)) out.set(cc, { c: cc, n: '', polys: [] });
    const entry = out.get(cc);
    if (!MERGE[iso]) entry.n = p.NAME_NL || p.NAME;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      const b = bboxOf(poly);
      if (!overlaps(b, AREA)) continue;
      const rings = poly.map(r => simplify(r, TOL)).filter(r => r.length >= 4);
      if (rings.length) entry.polys.push({ b, rings });
    }
  }
  return [...out.values()].filter(c => c.polys.length && c.n).map(c => {
    const b = c.polys.reduce((a, p) => [Math.min(a[0], p.b[0]), Math.min(a[1], p.b[1]), Math.max(a[2], p.b[2]), Math.max(a[3], p.b[3])], [180, 90, -180, -90]);
    return { ...c, b };
  }).sort((a, b) => a.n.localeCompare(b.n, 'nl'));
}

function inRing(r, x, y) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distToRing(r, x, y) {
  const k = Math.cos(y * Math.PI / 180);
  let best = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const ax = r[j][0] * k, ay = r[j][1], bx = r[i][0] * k, by = r[i][1], px = x * k;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = px - (ax + t * dx), ey = y - (ay + t * dy);
    best = Math.min(best, ex * ex + ey * ey);
  }
  return best;
}
const near = (b, x, y, m) => x >= b[0] - m && x <= b[2] + m && y >= b[1] - m && y <= b[3] + m;

// Landnummers en webadressen: geven vlak bij een grens de doorslag (de grenzen zijn op ±1 km nauwkeurig).
const PHONE = {
  31: 'NL', 32: 'BE', 33: 'FR', 34: 'ES', 30: 'GR', 36: 'HU', 39: 'IT', 40: 'RO', 41: 'CH', 43: 'AT', 44: 'GB', 45: 'DK', 46: 'SE', 47: 'NO', 48: 'PL', 49: 'DE',
  90: 'TR', 212: 'MA', 216: 'TN', 298: 'FO', 350: 'GI', 351: 'PT', 352: 'LU', 353: 'IE', 354: 'IS', 355: 'AL', 356: 'MT', 357: 'CY', 358: 'FI', 359: 'BG',
  370: 'LT', 371: 'LV', 372: 'EE', 373: 'MD', 375: 'BY', 376: 'AD', 377: 'FR', 378: 'IT', 380: 'UA', 381: 'RS', 382: 'ME', 383: 'XK', 385: 'HR', 386: 'SI',
  387: 'BA', 389: 'MK', 420: 'CZ', 421: 'SK', 423: 'LI', 7: 'RU',
};
const TLD = {
  nl: 'NL', be: 'BE', de: 'DE', fr: 'FR', lu: 'LU', ch: 'CH', at: 'AT', it: 'IT', es: 'ES', pt: 'PT', dk: 'DK', se: 'SE', no: 'NO', pl: 'PL', cz: 'CZ',
  sk: 'SK', hu: 'HU', si: 'SI', hr: 'HR', uk: 'GB', ie: 'IE', gr: 'GR', tr: 'TR', ro: 'RO', bg: 'BG', rs: 'RS', me: 'ME', ba: 'BA', mk: 'MK', al: 'AL',
  lt: 'LT', lv: 'LV', ee: 'EE', fi: 'FI', is: 'IS', li: 'LI', ad: 'AD', mc: 'FR', sm: 'IT', ma: 'MA', tn: 'TN', ua: 'UA', by: 'BY', md: 'MD', gi: 'GI',
};

/** Land volgens telefoonnummer of website van een plek, of ''. */
export function hintCountry(tags = {}) {
  const phone = String(tags.phone || tags['contact:phone'] || '').replace(/[\s()./-]/g, '').replace(/^00/, '+');
  if (phone.startsWith('+')) {
    for (const len of [3, 2, 1]) { const cc = PHONE[phone.slice(1, 1 + len)]; if (cc) return cc; }
  }
  const web = String(tags.website || tags['contact:website'] || '');
  const m = web.match(/^(?:https?:\/\/)?[^/?#]*\.([a-z]{2})(?:[:/?#]|$)/i);
  return (m && TLD[m[1].toLowerCase()]) || '';
}

const BORDER = 0.03;   // graden (~2–3 km): binnen deze afstand van een ander land telt de hint mee

/** Geeft countryAt(lat, lon, tags) → landcode of ''. Vlak buiten een grens (kust, eiland): dichtstbijzijnde land tot ±15 km. */
export function makeLocator(list) {
  const polys = list.flatMap(c => c.polys.map(p => ({ cc: c.c, ...p })))
    .sort((a, b) => (a.b[2] - a.b[0]) * (a.b[3] - a.b[1]) - (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]));
  const within = (cc, lat, lon) => polys.some(p => p.cc === cc && near(p.b, lon, lat, BORDER) && distToRing(p.rings[0], lon, lat) < BORDER ** 2);

  function geometric(lat, lon) {
    const cand = polys.filter(p => near(p.b, lon, lat, 0.15));
    for (const p of cand) {
      if (near(p.b, lon, lat, 0) && inRing(p.rings[0], lon, lat) && !p.rings.slice(1).some(h => inRing(h, lon, lat))) return p.cc;
    }
    let best = '', bd = 0.15 ** 2;
    for (const p of cand) {
      const d = distToRing(p.rings[0], lon, lat);
      if (d < bd) { bd = d; best = p.cc; }
    }
    return best;
  }

  return (lat, lon, tags) => {
    const cc = geometric(lat, lon);
    const hint = hintCountry(tags);
    return hint && hint !== cc && within(hint, lat, lon) ? hint : cc;
  };
}
