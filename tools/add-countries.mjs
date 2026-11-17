// Zet bij elke plek in data/t_*.json de landcode, en in data/index.json per tegel het aantal plekken per land.
// Draait vanzelf mee in build-data.mjs; los nodig na het opbouwen met een oudere versie van dat script.
//
//   node tools/add-countries.mjs
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCountries, makeLocator } from './countries-lib.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const INDEX = path.join(DATA, 'index.json');

const countryAt = makeLocator(await loadCountries());
const index = JSON.parse(await readFile(INDEX, 'utf8'));
index.tc = {};
let n = 0, none = 0;
const t0 = Date.now();
for (const [key, count] of Object.entries(index.tiles)) {
  if (!count) continue;
  const file = path.join(DATA, `t_${key}.json`);
  const list = JSON.parse(await readFile(file, 'utf8'));
  const per = {};
  for (const a of list) {
    a[6] = countryAt(a[2], a[3], a[5]);
    if (!a[6]) none++;
    const k = a[6] || '-';
    per[k] = (per[k] || 0) + 1;
    n++;
  }
  index.tc[key] = per;
  await writeFile(file, JSON.stringify(list));
}
await writeFile(INDEX, JSON.stringify(index));
console.log(`${n} plekken van een land voorzien (${none} zonder land) in ${Math.round((Date.now() - t0) / 1000)} s`);
