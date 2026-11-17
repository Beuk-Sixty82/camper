// OpenStreetMap-logica die zowel de app (browser) als tools/build-data.mjs (Node) gebruikt.

/** Het plekkenbestand is opgedeeld in tegels van 2,5° × 2,5°, geteld vanaf dit punt. */
export const ORIGIN = { lat: 24, lon: -25 };
export const TILE = 2.5;

export const CAT_LIST = ['camper', 'camping', 'parking', 'service'];
const OSM_TYPE = { n: 'node', w: 'way', r: 'relation' };

export function ql(s, w, n, e, timeout = 25, limit = '') {
  const bb = [s, w, n, e].map(v => (+v).toFixed(4)).join(',');
  return `[out:json][timeout:${timeout}][bbox:${bb}];(`
    + 'nwr[tourism=caravan_site];'
    + 'nwr[tourism=camp_site];'
    + 'nwr[amenity=parking][motorhome~"^(yes|designated)$"];'
    + 'nwr[amenity=sanitary_dump_station];'
    + 'nwr[amenity=water_point];'
    + `);out tags center${limit ? ' ' + limit : ''};`;
}

// Alleen de gegevens die de app toont; de rest van de OSM-tags blijft achterwege.
const KEEP = [
  'amenity', 'fee', 'charge', 'capacity', 'capacity:motorhome', 'capacity:caravans',
  'power_supply', 'drinking_water', 'water_point', 'sanitary_dump_station', 'toilets', 'shower', 'internet_access', 'dog',
  'maxheight', 'maxlength', 'maxweight', 'maxwidth', 'maxstay', 'opening_hours', 'operator',
  'phone', 'contact:phone', 'website', 'contact:website',
  'description', 'description:nl', 'addr:street', 'addr:housenumber', 'addr:postcode', 'addr:city',
];
const LONG = { description: 300, 'description:nl': 300 };

function fallbackName(cat, tags) {
  if (cat === 'camper') return 'Camperplaats';
  if (cat === 'camping') return 'Camping';
  if (cat === 'parking') return 'Camperparkeerplaats';
  return tags.amenity === 'water_point' ? 'Watertappunt' : 'Loosplaats';
}

/** Overpass-element → plek, of null als het niet geschikt is voor een camper. */
export function toPlace(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  if (t.access === 'private' || t.access === 'no') return null;
  let cat;
  if (t.tourism === 'caravan_site') cat = 'camper';
  else if (t.tourism === 'camp_site') {
    if (t.backcountry === 'yes' || t.group_only === 'yes' || t.scout === 'yes' || t.tents === 'only') return null;
    if (t.motorhome === 'no' || (t.caravans === 'no' && t.motorhome !== 'yes')) return null;
    cat = 'camping';
  }
  else if (t.amenity === 'parking') cat = 'parking';
  else if (t.amenity === 'sanitary_dump_station' || t.amenity === 'water_point') cat = 'service';
  else return null;

  const tags = {};
  for (const k of KEEP) {
    const v = t[k];
    if (v == null || v === '') continue;
    if (k === 'amenity' && cat !== 'service') continue;
    if (k === 'website' && t['contact:website'] === v) continue;
    tags[k] = String(v).slice(0, LONG[k] || 140);
  }
  if (!tags.website && t.url) tags.website = String(t.url).slice(0, 140);
  const name = String(t.name || t['name:nl'] || t['name:en'] || '').slice(0, 100);
  return { id: el.type[0] + el.id, osm: `${el.type}/${el.id}`, cat, lat, lon, name: name || fallbackName(cat, tags), named: !!name, tags };
}

/** Compacte opslag in een tegelbestand: [id, categorie, lat, lon, naam, tags, landcode]. */
export const pack = p => [p.id, CAT_LIST.indexOf(p.cat), +p.lat.toFixed(5), +p.lon.toFixed(5), p.named ? p.name : '', p.tags, p.cc || ''];
export function unpack(a) {
  const cat = CAT_LIST[a[1]], tags = a[5] || {};
  return { id: a[0], osm: `${OSM_TYPE[a[0][0]]}/${a[0].slice(1)}`, cat, lat: a[2], lon: a[3], name: a[4] || fallbackName(cat, tags), tags, cc: a[6] || null };
}

/** [zuid, west, noord, oost] van een tegel. */
export function tileBounds(key) {
  const [x, y] = key.split('_').map(Number);
  const s = ORIGIN.lat + y * TILE, w = ORIGIN.lon + x * TILE;
  return [s, w, s + TILE, w + TILE];
}

export const tileKey = (lat, lon) => `${Math.floor((lon - ORIGIN.lon) / TILE)}_${Math.floor((lat - ORIGIN.lat) / TILE)}`;
export function tilesIn(s, w, n, e) {
  const keys = [];
  const x0 = Math.floor((w - ORIGIN.lon) / TILE), x1 = Math.floor((e - ORIGIN.lon) / TILE);
  const y0 = Math.floor((s - ORIGIN.lat) / TILE), y1 = Math.floor((n - ORIGIN.lat) / TILE);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x}_${y}`);
  return keys;
}
