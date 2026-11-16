import { $, $$ } from './util.js';

const tabListeners = [];
export function onTab(fn) { tabListeners.push(fn); }
export function currentTab() { return document.body.dataset.tab; }

export function setTab(name) {
  const prev = document.body.dataset.tab;
  document.body.dataset.tab = name;
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  closeSheet();
  delete document.body.dataset.mode;
  tabListeners.forEach(fn => fn(name, prev));
}

let sheetClose = null;
export function openSheet(node, onClose) {
  closeSheet();
  const s = $('#sheet');
  s.replaceChildren(node);
  s.hidden = false;
  s.scrollTop = 0;
  sheetClose = onClose || null;
  node.querySelector('[data-close]')?.addEventListener('click', closeSheet);
  return s;
}
export function closeSheet() {
  const s = $('#sheet');
  if (s.hidden) return;
  s.hidden = true;
  s.replaceChildren();
  const fn = sheetClose;
  sheetClose = null;
  fn?.();
}

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3400);
}
