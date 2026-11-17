// Instellingen: landen aan/uit, offline downloaden, back-up en info.
import * as db from './db.js';
import { countries, isEnabled, setEnabled, toggle, enabledCount, onCountriesChange } from './countries.js';
import { enabledTiles, downloadTiles, dataDate } from './places.js';
import { $, esc, nf, saveFile } from './util.js';
import { onTab, toast } from './ui.js';

const el = () => $('#panel-settings');
let filter = '';
let busy = false;

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function estimate() {
  const t = enabledTiles();
  const n = t.reduce((s, [, c]) => s + c, 0);
  return { tiles: t.map(([k]) => k), places: n, mb: Math.max(0.1, n * 140 / 1e6) };
}

function countryRows() {
  const q = norm(filter);
  return countries().filter(c => !q || norm(c.n).includes(q)).map(c => `
    <li><label class="switch-row">
      <span class="flag">${esc(c.c)}</span>
      <span class="li-main"><b>${esc(c.n)}</b></span>
      <input type="checkbox" data-cc="${esc(c.c)}" ${isEnabled(c.c) ? 'checked' : ''}>
      <i class="switch" aria-hidden="true"></i>
    </label></li>`).join('') || '<li class="empty-row">Geen land gevonden</li>';
}

function summary() {
  const total = countries().length, on = enabledCount();
  return on === total ? `Alle ${total} landen staan aan` : `${on} van ${total} landen aan`;
}

function render() {
  const est = estimate();
  const built = dataDate();
  el().innerHTML = `
    <header class="p-head"><h1>Instellingen</h1></header>

    <h2 class="sec">Landen</h2>
    <p class="hint">Alleen plekken in aangevinkte landen worden op de kaart getoond en geladen. Bewaarde plekken zie je altijd.</p>
    <div class="row-btns">
      <span class="count" id="cc-count">${esc(summary())}</span>
      <button type="button" class="btn small" data-all="1">Alles aan</button>
      <button type="button" class="btn small" data-all="0">Alles uit</button>
    </div>
    <div class="search filter"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
      <input type="search" id="cc-filter" placeholder="Zoek land" autocomplete="off" value="${esc(filter)}" aria-label="Zoek land"></div>
    <ul class="list" id="cc-list">${countryRows()}</ul>

    <h2 class="sec">Zonder internet</h2>
    <div class="card box">
      <p>Download alle plekken van de aangevinkte landen naar je telefoon, zodat je ze ook zonder bereik kunt zien.</p>
      <p class="hint" id="dl-est">± ${nf(est.places)} plekken · ± ${nf(est.mb, 1)} MB</p>
      <button type="button" class="btn primary wide" id="dl-go" ${busy || !est.tiles.length ? 'disabled' : ''}>Download aangevinkte landen</button>
      <p class="hint" id="dl-state"></p>
    </div>

    <h2 class="sec">Back-up</h2>
    <div class="backup">
      <button type="button" class="btn small" id="bk-out">Back-up maken</button>
      <button type="button" class="btn small" id="bk-in">Back-up terugzetten</button>
    </div>
    <p class="fine">Ritten en bewaarde plekken staan alleen op dit toestel. Maak af en toe een back-up.</p>
    <input type="file" id="bk-file" accept="application/json,.json" hidden>

    <h2 class="sec">Over</h2>
    <div class="card box about">
      <p>Plekken: © OpenStreetMap-bijdragers${built ? ` · bijgewerkt ${esc(new Date(built).toLocaleDateString('nl-NL'))}` : ''}</p>
      <p>Landsgrenzen: Natural Earth · Zoeken: Photon (komoot)</p>
    </div>`;
}

function refreshCounts() {
  const c = $('#cc-count'), e = $('#dl-est'), go = $('#dl-go');
  if (c) c.textContent = summary();
  if (e) {
    const est = estimate();
    e.textContent = `± ${nf(est.places)} plekken · ± ${nf(est.mb, 1)} MB`;
    if (go) go.disabled = busy || !est.tiles.length;
  }
}

async function download() {
  const { tiles } = estimate();
  if (!tiles.length || busy) return;
  busy = true;
  const go = $('#dl-go'), state = $('#dl-state');
  go.disabled = true;
  const failed = await downloadTiles(tiles, (d, n) => { if (state.isConnected) state.textContent = `Downloaden… ${d} van ${n}`; });
  busy = false;
  if (state.isConnected) {
    state.textContent = failed ? `Klaar, maar ${failed} van ${tiles.length} delen mislukten. Probeer het later nog eens.` : 'Klaar: deze landen werken nu ook zonder internet.';
    go.disabled = false;
  }
  toast(failed ? 'Downloaden deels mislukt' : 'Plekken gedownload');
}

export function initSettings() {
  const panel = el();

  panel.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('input[data-cc]')) { toggle(t.dataset.cc, t.checked); refreshCounts(); return; }
    if (t.id === 'bk-file') {
      const file = t.files?.[0];
      if (!file) return;
      try {
        const res = await db.importAll(JSON.parse(await file.text()));
        toast(`${res.trips} ${res.trips === 1 ? 'rit' : 'ritten'} en ${res.places} ${res.places === 1 ? 'plek' : 'plekken'} teruggezet`);
      } catch {
        toast('Dit bestand is geen geldige back-up');
      }
      t.value = '';
    }
  });

  panel.addEventListener('input', e => {
    if (e.target.id !== 'cc-filter') return;
    filter = e.target.value;
    $('#cc-list').innerHTML = countryRows();
  });

  panel.addEventListener('click', async e => {
    const all = e.target.closest('[data-all]');
    if (all) {
      setEnabled(all.dataset.all === '1' ? countries().map(c => c.c) : []);
      $('#cc-list').innerHTML = countryRows();
      refreshCounts();
      return;
    }
    if (e.target.closest('#dl-go')) return download();
    if (e.target.closest('#bk-out')) {
      const data = await db.exportAll();
      return saveFile(`camper-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json', JSON.stringify(data));
    }
    if (e.target.closest('#bk-in')) $('#bk-file').click();
  });

  onTab(name => { if (name === 'settings') render(); });
  onCountriesChange(() => { if (document.body.dataset.tab === 'settings') refreshCounts(); });
}
