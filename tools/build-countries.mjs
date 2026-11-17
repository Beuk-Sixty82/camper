// Maakt data/countries.json: de landenlijst voor Instellingen (code, Nederlandse naam, omhullend vak).
//
//   node tools/build-countries.mjs
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCountries } from './countries-lib.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'countries.json');
const r2 = v => Math.round(v * 100) / 100;

const list = await loadCountries();
await writeFile(OUT, JSON.stringify(list.map(c => ({ c: c.c, n: c.n, b: c.b.map(r2) }))));
console.log(`${list.length} landen → ${OUT}`);
