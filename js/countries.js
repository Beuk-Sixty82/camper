// Landen: de lijst (data/countries.json) en welke landen aan staan (Instellingen).
// In welk land een plek ligt, staat al in het plekkenbestand (bepaald bij het opbouwen).
let list = [];                 // [{c, n, b: [w, s, e, n]}]
let enabled = null;            // null = alle landen
const listeners = [];

try {
  const v = JSON.parse(localStorage.getItem('countries') || 'null');
  if (Array.isArray(v)) enabled = new Set(v);
} catch { /* standaard: alles aan */ }

export async function loadCountries() {
  try {
    const r = await fetch('data/countries.json');
    if (r.ok) list = (await r.json()).filter(c => c && typeof c.c === 'string' && c.n);
  } catch { /* zonder lijst: geen landfilter */ }
}

export const countries = () => list;
export const filtering = () => !!enabled;

/** Plekken zonder bekend land (bijv. live opgehaald) tellen als 'aan'. */
export const isEnabled = cc => !enabled || !cc || cc === '-' || enabled.has(cc);
export const enabledCount = () => (enabled ? list.filter(c => enabled.has(c.c)).length : list.length);
export function setEnabled(codes) {
  enabled = codes.length >= list.length && list.every(c => codes.includes(c.c)) ? null : new Set(codes);
  try { localStorage.setItem('countries', JSON.stringify(enabled ? [...enabled] : null)); } catch { /* niet erg */ }
  listeners.forEach(fn => fn());
}
export function toggle(cc, on) {
  const set = new Set(enabled || list.map(c => c.c));
  if (on) set.add(cc); else set.delete(cc);
  setEnabled([...set]);
}
export const onCountriesChange = fn => listeners.push(fn);

/** Raakt dit gebied het omhullende vak van een aangezet land? (voor tegels zonder landinformatie) */
export function enabledNear(s, w, n, e) {
  if (!enabled || !list.length) return true;
  return list.some(c => enabled.has(c.c) && c.b[0] <= e && c.b[2] >= w && c.b[1] <= n && c.b[3] >= s);
}
