'use strict';

const DATA_KEY = 'budgetPlanner.data';
const SYNC_KEY = 'budgetPlanner.sync';
const GIST_FILE = 'budget-planner.json';
const GITHUB_API = 'https://api.github.com';
const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const PALETTE = ['#ff6200', '#00845a', '#8250df', '#bf8700', '#0969da', '#cf222e', '#1b7c83', '#9a6700'];
const DEFAULT_ACCOUNTS = ['ING', 'Intesa', 'Buoni pasto', 'Contanti'];
const FUND_PALETTE = ['#d4a72c', '#57606a', '#2da44e', '#bc4c00', '#6639ba', '#0550ae'];
const DEFAULT_FUNDS = ['Bollette', 'Macchina', 'Risparmi'];
const FLOW_COLS = [
  { key: 'entrate', label: 'Entrate' },
  { key: 'uscite', label: 'Uscite' },
  { key: 'saldo', label: 'Saldo', signed: true },
];

const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });

/* ===================== Utilità ===================== */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function parseAmount(text) {
  let s = String(text).replace(/[€\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "1.500" = 1500
  return num(parseFloat(s));
}

function formatInput(n) {
  return n ? n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }) : '';
}

function signClass(v) {
  return v > 0.004 ? 'pos' : v < -0.004 ? 'neg' : '';
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function formatDateTime(ts) {
  return ts ? new Date(ts).toLocaleString('it-IT') : '—';
}

/** Crea un elemento DOM. Il testo viene sempre inserito come testo (mai come HTML). */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter(c => c != null && c !== false)
    .map(c => (c instanceof Node ? c : String(c))));
  if (value !== undefined) el.value = value;
  return el;
}

/* ===================== Dati ===================== */

function defaultData() {
  return {
    version: 1,
    updatedAt: 0,
    accounts: DEFAULT_ACCOUNTS.map((name, i) => ({ id: uid(), name, color: PALETTE[i], initial: 0 })),
    funds: defaultFunds(),
    template: { incomes: [], expenses: [], contributions: [] },
    months: {},
  };
}

function defaultFunds() {
  return DEFAULT_FUNDS.map((name, i) => ({ id: uid(), name, color: FUND_PALETTE[i], initial: 0 }));
}

function emptyMonth() {
  return { incomes: [], fixed: [], variable: [], contributions: [], fundExpenses: [], transfers: [] };
}

function normalizeDue(x) {
  const every = Math.trunc(Number(x.every));
  const dueMonth = Math.trunc(Number(x.dueMonth));
  return {
    every: every >= 1 && every <= 12 ? every : 0,
    dueMonth: dueMonth >= 1 && dueMonth <= 12 ? dueMonth : 1,
  };
}

/** True se la voce del modello scade nel mese `key` (YYYY-MM). */
function isDue(item, key) {
  if (!item.every) return false;
  const month = Number(key.slice(5, 7));
  return (((month - item.dueMonth) % item.every) + item.every) % item.every === 0;
}

/** Mesi dell'anno (1-12) in cui scade la voce. */
function dueMonths(item) {
  if (!item.every) return [];
  return Array.from({ length: 12 }, (_, i) => i + 1).filter(m => isDue(item, `0000-${String(m).padStart(2, '0')}`));
}

function dueItems(key) {
  return data.template.contributions.filter(x => isDue(x, key));
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.accounts)) {
    throw new Error('Formato dati non valido');
  }
  const wallets = (list, palette, fallbackName) => list.filter(a => a && a.id).map((a, i) => ({
    id: String(a.id),
    name: String(a.name ?? fallbackName),
    color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : palette[i % palette.length],
    initial: num(a.initial),
  }));
  const accounts = wallets(raw.accounts, PALETTE, 'Conto');
  if (!accounts.length) throw new Error('Nessun conto presente nei dati');
  // I dati salvati prima dell'introduzione dei fondi ricevono i fondi predefiniti.
  const funds = Array.isArray(raw.funds) ? wallets(raw.funds, FUND_PALETTE, 'Fondo') : defaultFunds();

  const accountIds = new Set(accounts.map(a => a.id));
  const fundIds = new Set(funds.map(f => f.id));
  const base = x => ({ id: String(x.id || uid()), name: String(x.name ?? ''), amount: num(x.amount) });
  const list = v => (Array.isArray(v) ? v : []).filter(x => x && typeof x === 'object');
  const items = v => list(v).filter(x => accountIds.has(String(x.accountId)))
    .map(x => ({ ...base(x), accountId: String(x.accountId) }));
  // Nel modello le voci dei fondi possono avere una scadenza ricorrente (every = ogni N mesi, 0 = nessuna).
  const contributions = (v, withDue = false) => list(v)
    .filter(x => accountIds.has(String(x.accountId)) && fundIds.has(String(x.fundId)))
    .map(x => ({
      ...base(x), accountId: String(x.accountId), fundId: String(x.fundId),
      ...(withDue ? normalizeDue(x) : {}),
    }));
  const fundExpenses = v => list(v).filter(x => fundIds.has(String(x.fundId)))
    .map(x => ({ ...base(x), fundId: String(x.fundId) }));
  const transfers = v => list(v).filter(x => accountIds.has(String(x.fromId)) && accountIds.has(String(x.toId)))
    .map(x => ({ ...base(x), fromId: String(x.fromId), toId: String(x.toId) }));

  const months = {};
  for (const [key, m] of Object.entries(raw.months || {})) {
    if (!/^\d{4}-\d{2}$/.test(key) || !m || typeof m !== 'object') continue;
    months[key] = {
      incomes: items(m.incomes),
      fixed: items(m.fixed),
      variable: items(m.variable),
      contributions: contributions(m.contributions),
      fundExpenses: fundExpenses(m.fundExpenses),
      transfers: transfers(m.transfers),
    };
  }
  return {
    version: 1,
    updatedAt: Number(raw.updatedAt) || 0,
    accounts,
    funds,
    template: {
      incomes: items(raw.template?.incomes),
      expenses: items(raw.template?.expenses),
      contributions: contributions(raw.template?.contributions, true),
    },
    months,
  };
}

function hasContent(d) {
  const t = d.template;
  return Object.keys(d.months).length > 0 || t.incomes.length + t.expenses.length + t.contributions.length > 0;
}

function loadData() {
  try {
    const saved = localStorage.getItem(DATA_KEY);
    return saved ? normalize(JSON.parse(saved)) : defaultData();
  } catch {
    return defaultData();
  }
}

function persist() {
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
}

/** Da chiamare dopo ogni modifica dei dati. */
function commit() {
  data.updatedAt = Date.now();
  persist();
  scheduleSync();
}

function cloneItems(list) {
  return list.map(x => ({ ...x, id: uid() }));
}

/** Nel modello le quote ai fondi sono importi annui: nel mese diventano un dodicesimo. */
function monthlyQuota(annual) {
  return num(annual / 12);
}

function monthlyContributions() {
  return cloneItems(data.template.contributions)
    .map(({ every, dueMonth, ...x }) => ({ ...x, amount: monthlyQuota(x.amount) }));
}

function createMonth(key) {
  data.months[key] = {
    ...emptyMonth(),
    incomes: cloneItems(data.template.incomes),
    fixed: cloneItems(data.template.expenses),
    contributions: monthlyContributions(),
  };
  commit();
}

function sumBy(list, value, field = 'accountId') {
  return list.reduce((s, x) => (value == null || x[field] === value ? s + x.amount : s), 0);
}

/**
 * Entrate/uscite/trasferimenti/saldo per ogni conto su un insieme di mesi.
 * Le quote ai fondi sono uscite del conto; i trasferimenti spostano soldi tra conti (netto per conto).
 */
function aggregate(months) {
  return data.accounts.map(account => {
    let entrate = 0;
    let uscite = 0;
    let trasf = 0;
    for (const m of months) {
      entrate += sumBy(m.incomes, account.id);
      uscite += sumBy(m.fixed, account.id) + sumBy(m.variable, account.id) + sumBy(m.contributions, account.id);
      trasf += sumBy(m.transfers, account.id, 'toId') - sumBy(m.transfers, account.id, 'fromId');
    }
    return { account, entrate, uscite, trasf, saldo: entrate - uscite + trasf };
  });
}

/** Colonne della tabella conti: "Trasf." compare solo se nel periodo ci sono trasferimenti. */
function flowCols(months) {
  if (!months.some(m => m.transfers.length)) return FLOW_COLS;
  return [FLOW_COLS[0], FLOW_COLS[1], { key: 'trasf', label: 'Trasf.', signed: true }, FLOW_COLS[2]];
}

/** Versato/speso/netto per ogni fondo su un insieme di mesi. */
function aggregateFunds(months) {
  return data.funds.map(fund => {
    let versato = 0;
    let speso = 0;
    for (const m of months) {
      versato += sumBy(m.contributions, fund.id, 'fundId');
      speso += sumBy(m.fundExpenses, fund.id, 'fundId');
    }
    return { account: fund, versato, speso, netto: versato - speso };
  });
}

/** Saldo dei fondi a fine mese indicato (o complessivo se key è null): iniziale + tutti i mesi fino a key. */
function fundBalances(key = null) {
  const months = Object.keys(data.months).filter(k => key == null || k <= key).map(k => data.months[k]);
  return aggregateFunds(months).map(r => ({ ...r, saldo: r.account.initial + r.netto }));
}

function totalOf(rows, keys = ['entrate', 'uscite', 'saldo']) {
  return Object.fromEntries(keys.map(k => [k, rows.reduce((s, r) => s + r[k], 0)]));
}

function allItemLists() {
  const t = data.template;
  const lists = [t.incomes, t.expenses, t.contributions];
  for (const m of Object.values(data.months)) {
    lists.push(m.incomes, m.fixed, m.variable, m.contributions, m.fundExpenses, m.transfers);
  }
  return lists;
}

function usage(field, id) {
  const uses = x => x[field] === id || (field === 'accountId' && (x.fromId === id || x.toId === id));
  return allItemLists().reduce((n, list) => n + list.filter(uses).length, 0);
}

/* ===================== Stato ===================== */

let data = loadData();
let sync = loadSync();
const ui = { tab: 'mese', month: monthKey(new Date()), year: 'all', open: {} };
let refreshers = [];

/* ===================== Componenti ===================== */

function refresh() {
  refreshers.forEach(fn => fn());
}

/** Blocco che viene ricostruito ad ogni modifica dei dati (senza toccare gli input). */
function liveBlock(build) {
  const el = h('div');
  const update = () => el.replaceChildren(build());
  update();
  refreshers.push(update);
  return el;
}

function liveMoney(getValue, cls = '') {
  const el = h('span', { class: cls });
  const update = () => { el.textContent = eur.format(getValue()); };
  update();
  refreshers.push(update);
  return el;
}

function liveText(getText) {
  const el = h('span');
  const update = () => { el.textContent = getText(); };
  update();
  refreshers.push(update);
  return el;
}

/* ===================== Grafica ===================== */

const ICONS = {
  calendar: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4',
  chart: 'M3 3v18h18M8 16v-5M13 16V7M18 16v-8',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  sliders: 'M4 7h3M12 7h8M4 17h9M18 17h2M9.5 7a2.5 2.5 0 1 0-5 0a2.5 2.5 0 1 0 5 0M17.5 17a2.5 2.5 0 1 0-5 0a2.5 2.5 0 1 0 5 0',
  income: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  receipt: 'M6 2h12v20l-3-2-3 2-3-2-3 2V2zM9 7h6M9 11h6M9 15h4',
  cart: 'M3 4h2l2.5 11h11L21 7H6.2M8 19.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M16 19.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  swap: 'M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7',
  vault: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M7 20v1.5M17 20v1.5',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  wallet: 'M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4M21 13v5a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6M21 13h-4a2 2 0 0 0 0 4h4',
  cloud: 'M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 9H7z',
  download: 'M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M12 3v12M7 10l5 5 5-5',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  chevron: 'M6 9l6 6 6-6',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
};
const TINTS = {
  income: 'green', receipt: 'rose', cart: 'orange', swap: 'blue', vault: 'violet', bolt: 'amber',
  chart: 'violet', wallet: 'blue', cloud: 'sky', download: 'slate', layers: 'violet', calendar: 'violet', sliders: 'slate', bell: 'amber',
};

/** Icona SVG (tracciato statico definito in ICONS). */
function icon(name, cls = 'icon') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

/** Titolo di card con icona colorata. */
function heading(text, iconName) {
  return h('h2', {}, iconName ? h('span', { class: `badge tint-${TINTS[iconName] ?? 'violet'}` }, icon(iconName)) : null, text);
}

/** Card grande in evidenza: saldo, entrate/uscite e barra di quanto delle entrate è stato usato. */
function heroCard({ label, getTotals, note }) {
  const amount = h('div', { class: 'hero-amount' });
  const income = h('b');
  const out = h('b');
  const fill = h('i', { class: 'meter-fill' });
  const noteEl = h('div', { class: 'hero-note' });
  const el = h('section', { class: 'hero' },
    h('div', { class: 'hero-label' }, icon('sparkle'), label),
    amount,
    h('div', { class: 'hero-chips' },
      h('span', { class: 'chip' }, icon('up'), 'Entrate ', income),
      h('span', { class: 'chip' }, icon('down'), 'Uscite ', out)),
    h('div', { class: 'meter' }, fill),
    noteEl);
  const update = () => {
    const t = getTotals();
    const pct = t.entrate > 0 ? (t.uscite / t.entrate) * 100 : (t.uscite > 0 ? 101 : 0);
    amount.textContent = eur.format(t.saldo);
    income.textContent = eur.format(t.entrate);
    out.textContent = eur.format(t.uscite);
    fill.style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
    fill.classList.toggle('over', pct > 100);
    el.classList.toggle('negative', t.saldo < -0.004);
    noteEl.textContent = note(t, pct);
  };
  update();
  refreshers.push(update);
  return el;
}

function usedNote(t, pct) {
  if (t.entrate <= 0) return t.uscite > 0 ? 'Nessuna entrata: stai usando i risparmi.' : 'Inserisci entrate e spese per vedere quanto ti resta.';
  return pct > 100 ? `Stai spendendo il ${Math.round(pct)}% delle entrate.` : `Hai usato il ${Math.round(pct)}% delle entrate.`;
}

function chartLegend() {
  return h('div', { class: 'legend' },
    h('span', {}, h('i', { class: 'bar-in' }), 'Entrate'), h('span', {}, h('i', { class: 'bar-out' }), 'Uscite'));
}

/** Barre entrate/uscite per conto, aggiornate in place (con transizione) ad ogni modifica. */
function flowBars(getRows) {
  const items = data.accounts.map(account => {
    const inc = h('i', { class: 'bar bar-in' });
    const out = h('i', { class: 'bar bar-out' });
    const val = h('span', { class: 'bars-value' });
    const row = h('div', { class: 'bars-row' },
      h('div', { class: 'bars-label' }, accountLabel(account), val),
      h('div', { class: 'bars-track', title: 'Entrate' }, inc),
      h('div', { class: 'bars-track', title: 'Uscite' }, out));
    return { row, inc, out, val };
  });
  const empty = h('p', { class: 'muted small' }, 'Ancora nessun movimento.');
  const legend = chartLegend();
  const update = () => {
    const rows = getRows();
    const max = Math.max(1, ...rows.flatMap(r => [r.entrate, r.uscite]));
    let any = false;
    rows.forEach((r, i) => {
      const it = items[i];
      const active = Math.abs(r.entrate) + Math.abs(r.uscite) + Math.abs(r.trasf || 0) > 0.004;
      any ||= active;
      it.row.hidden = !active;
      it.inc.style.width = `${(Math.max(r.entrate, 0) / max) * 100}%`;
      it.out.style.width = `${(Math.max(r.uscite, 0) / max) * 100}%`;
      it.val.textContent = eur.format(r.saldo);
      it.val.className = `bars-value ${signClass(r.saldo)}`;
    });
    empty.hidden = any;
    legend.hidden = !any;
  };
  update();
  refreshers.push(update);
  return h('div', { class: 'bars' }, items.map(x => x.row), empty, legend);
}

/** Istogramma entrate/uscite per mese (ultimi 12 mesi del periodo); ogni colonna apre il mese. */
function trendChart(keys) {
  const last = keys.slice(-12);
  const totals = last.map(k => totalOf(aggregate([data.months[k]])));
  const max = Math.max(1, ...totals.flatMap(t => [t.entrate, t.uscite]));
  const pct = v => `${(Math.max(v, 0) / max) * 100}%`;
  return h('div', { class: 'trend' }, last.map((k, i) => {
    const t = totals[i];
    const [y, m] = k.split('-');
    return h('button', {
      type: 'button', class: 'trend-col', onclick: () => openMonth(k),
      'aria-label': `${monthLabel(k)}: entrate ${eur.format(t.entrate)}, uscite ${eur.format(t.uscite)}`,
      title: `${monthLabel(k)} · saldo ${eur.format(t.saldo)}`,
    },
    h('span', { class: 'trend-bars' },
      h('i', { class: 'bar-in', style: `height:${pct(t.entrate)}` }),
      h('i', { class: 'bar-out', style: `height:${pct(t.uscite)}` })),
    h('span', { class: 'trend-label' }, `${MONTHS[Number(m) - 1].slice(0, 3)} ${y.slice(2)}`));
  }));
}

/** Riquadri dei fondi con saldo e barra proporzionale al fondo più grande. */
function fundTiles(rows) {
  const max = Math.max(1, ...rows.map(r => r.saldo));
  return h('div', { class: 'fund-tiles' }, rows.map(r => h('div', { class: 'fund-tile', style: `--c:${r.account.color}` },
    accountLabel(r.account),
    h('strong', { class: signClass(r.saldo) }, eur.format(r.saldo)),
    h('small', { class: 'muted' }, `+${eur.format(r.versato)} · −${eur.format(r.speso)}`),
    h('div', { class: 'fund-meter' }, h('i', { style: `width:${(Math.max(r.saldo, 0) / max) * 100}%` })))));
}

function moneyCell(v, signed) {
  return h('td', { class: signed ? signClass(v) : null }, eur.format(v));
}

function accountLabel(account) {
  return h('span', { class: 'acc' }, h('i', { class: 'dot', style: `background:${account.color}` }), account.name);
}

function accountsTable(rows, cols, firstLabel = 'Conto') {
  const total = totalOf(rows, cols.map(c => c.key));
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, firstLabel), cols.map(c => h('th', {}, c.label)))),
    h('tbody', {},
      rows.map(r => h('tr', {}, h('td', {}, accountLabel(r.account)), cols.map(c => moneyCell(r[c.key], c.signed)))),
      h('tr', { class: 'total' }, h('td', {}, 'Totale'), cols.map(c => moneyCell(total[c.key], c.signed))))));
}

function amountInput(get, set, label) {
  const input = h('input', {
    type: 'text', inputmode: 'decimal', class: 'amount-input', placeholder: '0,00',
    autocomplete: 'off', 'aria-label': label, value: formatInput(get()),
  });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', () => { set(parseAmount(input.value)); commit(); refresh(); });
  input.addEventListener('blur', () => { input.value = formatInput(get()); });
  return input;
}

function removeButton(list, item, redraw) {
  return h('button', {
    type: 'button', class: 'btn-icon del', title: 'Rimuovi', 'aria-label': 'Rimuovi voce',
    onclick: () => {
      if ((item.name || item.amount) && !confirm(`Rimuovere "${item.name || 'voce senza nome'}"?`)) return;
      list.splice(list.indexOf(item), 1);
      commit();
      redraw();
      refresh();
    },
  }, icon('x'));
}

function nameInput(item, placeholder) {
  const name = h('input', {
    type: 'text', class: 'name-input', placeholder, autocomplete: 'off', 'aria-label': 'Descrizione', value: item.name,
  });
  name.addEventListener('input', () => { item.name = name.value; commit(); });
  return name;
}

function walletSelect(item, field, options, label, cls = 'account-select', onChange = () => {}) {
  const select = h('select', { class: cls, 'aria-label': label, value: item[field] },
    options.map(a => h('option', { value: a.id }, a.name)));
  select.addEventListener('change', () => { item[field] = select.value; commit(); onChange(); refresh(); });
  return select;
}

/**
 * field: 'accountId' (la voce è legata a un conto) oppure 'fundId' (a un fondo).
 * hint: testo opzionale calcolato sotto la riga (es. quota mensile).
 */
function itemRow(list, item, redraw, { placeholder, field = 'accountId', hint, extra }) {
  const isFund = field === 'fundId';
  const select = walletSelect(item, field, isFund ? data.funds : data.accounts, isFund ? 'Fondo' : 'Conto');
  const row = h('div', { class: 'item-row', 'data-id': item.id },
    nameInput(item, placeholder), select,
    amountInput(() => item.amount, v => { item.amount = v; }, 'Importo'),
    removeButton(list, item, redraw));
  if (hint) {
    const hintEl = h('span', { class: 'row-hint' });
    const update = () => { hintEl.textContent = hint(item); };
    update();
    refreshers.push(update);
    row.append(hintEl);
  }
  if (extra) row.append(extra(item));
  return row;
}

const DUE_EVERY = [1, 2, 3, 4, 6, 12];

const shortMonth = m => MONTHS[m - 1].slice(0, 3).toLowerCase();

/** Scadenza ricorrente di una voce del modello: ogni N mesi, a partire da un mese dell'anno. */
function dueEditor(item) {
  const every = h('select', { class: 'due-every', 'aria-label': 'Frequenza della scadenza', value: String(item.every) },
    h('option', { value: '0' }, 'Nessuna scadenza'),
    DUE_EVERY.map(n => h('option', { value: String(n) },
      n === 1 ? 'Ogni mese' : n === 12 ? 'Una volta l\'anno' : `Ogni ${n} mesi`)));
  const prefix = h('span', { class: 'due-prefix muted' });
  const month = h('select', { class: 'due-month', 'aria-label': 'Mese della scadenza', value: String(item.dueMonth) },
    MONTHS.map((name, i) => h('option', { value: String(i + 1) }, name)));
  const list = h('span', { class: 'due-list' });
  const update = () => {
    const withMonth = item.every > 1;
    prefix.hidden = !withMonth;
    month.hidden = !withMonth;
    prefix.textContent = item.every === 12 ? 'a' : 'da';
    list.textContent = item.every ? `Scade: ${dueMonths(item).map(shortMonth).join(', ')}` : '';
  };
  every.addEventListener('change', () => { item.every = Number(every.value); commit(); update(); });
  month.addEventListener('change', () => { item.dueMonth = Number(month.value); commit(); update(); });
  update();
  return h('div', { class: 'due-row' }, h('span', { class: 'due-icon' }, icon('bell')), every, prefix, month, list);
}

/** <details> apribile; lo stato aperto/chiuso resta memorizzato finché l'app è aperta. */
function collapsible(id, summary, body, cls = 'card collapsible') {
  const el = h('details', { class: cls, 'data-collapse': id, open: Boolean(ui.open[id]) },
    h('summary', { class: 'card-head' }, summary, h('span', { class: 'chevron' }, icon('chevron'))),
    h('div', { class: 'collapse-body' }, body));
  el.addEventListener('toggle', () => { ui.open[id] = el.open; });
  return el;
}

function addWallet(kind) {
  const list = data[kind];
  const palette = kind === 'funds' ? FUND_PALETTE : PALETTE;
  const used = new Set(list.map(a => a.color));
  const wallet = {
    id: uid(), name: kind === 'funds' ? 'Nuovo fondo' : 'Nuovo conto',
    color: palette.find(c => !used.has(c)) ?? palette[0], initial: 0,
  };
  list.push(wallet);
  commit();
  return wallet;
}

/** Elimina un fondo dal Modello insieme alle sue voci, se non è già usato nei mesi. */
function deleteFund(fund) {
  const inMonths = Object.values(data.months)
    .reduce((n, m) => n + [...m.contributions, ...m.fundExpenses].filter(x => x.fundId === fund.id).length, 0);
  if (inMonths) {
    return alert(`Il fondo "${fund.name}" è già usato in ${inMonths === 1 ? '1 voce' : `${inMonths} voci`} dei mesi: rimuovile dai mesi prima di eliminarlo.`);
  }
  const tpl = data.template.contributions;
  const own = tpl.filter(x => x.fundId === fund.id).length;
  const msg = own ? `Eliminare il fondo "${fund.name}" e le sue ${own} voci del modello?` : `Eliminare il fondo "${fund.name}"?`;
  if (!confirm(msg)) return;
  for (let i = tpl.length - 1; i >= 0; i--) if (tpl[i].fundId === fund.id) tpl.splice(i, 1);
  data.funds.splice(data.funds.indexOf(fund), 1);
  commit();
  render();
}

/** Trasferimento tra due conti: esce da "Da" ed entra in "A" (es. ING → Contanti per un prelievo). */
function transferRow(list, item, redraw, { placeholder }) {
  const row = h('div', { class: 'item-row transfer-row', 'data-id': item.id });
  const validate = () => row.classList.toggle('invalid', item.fromId === item.toId);
  row.append(
    nameInput(item, placeholder),
    walletSelect(item, 'fromId', data.accounts, 'Da conto', 'from-select', validate),
    h('span', { class: 'arrow' }, icon('right')),
    walletSelect(item, 'toId', data.accounts, 'A conto', 'to-select', validate),
    amountInput(() => item.amount, v => { item.amount = v; }, 'Importo'),
    removeButton(list, item, redraw),
    h('span', { class: 'row-hint invalid-hint' }, 'Scegli due conti diversi'));
  validate();
  return row;
}

/**
 * Elenco modificabile di voci. Con `filter` mostra solo una parte di `list`
 * (es. le quote di un singolo fondo); `newItem` crea la voce da aggiungere.
 */
function itemsEditor(list, { filter = () => true, newItem, addLabel, row = itemRow, ...rowOptions }) {
  const rows = h('div', { class: 'rows' });
  const redraw = focusId => {
    const visible = list.filter(filter);
    rows.replaceChildren(...(visible.length
      ? visible.map(item => row(list, item, redraw, rowOptions))
      : [h('p', { class: 'muted small' }, 'Nessuna voce')]));
    if (focusId) rows.querySelector(`[data-id="${focusId}"] .name-input`)?.focus();
  };
  redraw();

  const add = () => {
    const item = { id: uid(), name: '', amount: 0, ...newItem(list.filter(filter).at(-1) ?? list.at(-1)) };
    list.push(item);
    commit();
    redraw(item.id);
    refresh();
  };

  return [rows, h('button', { type: 'button', class: 'btn-add', onclick: add }, icon('plus'), addLabel)];
}

function listCard(title, list, addLabel, placeholder, iconName) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, heading(title, iconName), liveMoney(() => sumBy(list), 'card-total')),
    itemsEditor(list, {
      placeholder, addLabel,
      newItem: last => ({ accountId: last?.accountId ?? data.accounts[0].id }),
    }));
}

/**
 * Quote ai fondi, raggruppate per fondo; ogni voce indica il conto da cui si preleva.
 * annual = true nel Modello: gli importi sono annui e nel mese diventano un dodicesimo.
 */
function contributionsCard(list, { annual = false } = {}) {
  const perMonth = v => `${eur.format(monthlyQuota(v))}/mese`;
  const total = (fundId = null) => h('span', { class: 'group-total' },
    liveMoney(() => sumBy(list, fundId, 'fundId')),
    annual ? h('small', { class: 'muted' }, liveText(() => perMonth(sumBy(list, fundId, 'fundId')))) : null);

  const fundHead = fund => {
    if (!annual) return accountLabel(fund);
    const name = h('input', { type: 'text', class: 'name-input fund-name', 'aria-label': 'Nome del fondo', value: fund.name });
    name.addEventListener('input', () => { fund.name = name.value; commit(); refresh(); });
    return h('span', { class: 'fund-edit' },
      h('i', { class: 'dot', style: `background:${fund.color}` }), name,
      h('button', {
        type: 'button', class: 'btn-icon del', title: 'Elimina fondo', 'aria-label': `Elimina fondo ${fund.name}`,
        onclick: () => deleteFund(fund),
      }, icon('trash')));
  };

  const groups = data.funds.map(fund => h('div', { class: 'fund-group', 'data-fund': fund.id },
    h('div', { class: 'group-head' }, fundHead(fund), total(fund.id)),
    itemsEditor(list, {
      placeholder: 'Es. Luce',
      addLabel: liveText(() => `Aggiungi voce a ${fund.name || 'fondo'}`),
      filter: x => x.fundId === fund.id,
      newItem: last => ({
        fundId: fund.id, accountId: last?.accountId ?? data.accounts[0].id,
        ...(annual ? { every: 0, dueMonth: 1 } : {}),
      }),
      hint: annual ? item => `= ${perMonth(item.amount)}` : null,
      extra: annual ? dueEditor : null,
    })));

  const addFund = () => {
    const fund = addWallet('funds');
    render();
    app.querySelector(`[data-fund="${fund.id}"] .fund-name`)?.select();
  };

  const intro = h('p', { class: 'muted small' }, annual
    ? 'Inserisci l\'importo annuo di ogni voce: in ogni nuovo mese viene versato un dodicesimo, prelevato dal conto indicato. ' +
      'Con la campanella puoi indicare quando scade (es. luce ogni 3 mesi, bollo auto a settembre): nei mesi di scadenza vedrai un avviso.'
    : 'Ogni voce viene prelevata dal conto indicato e versata nel fondo.');
  const body = [
    intro,
    groups.length ? groups : h('p', { class: 'muted small' }, annual ? 'Nessun fondo.' : 'Nessun fondo: aggiungili nel Modello.'),
    annual ? [
      h('button', { type: 'button', class: 'btn-add btn-add-fund', onclick: addFund }, icon('vault'), 'Aggiungi fondo'),
      h('p', { class: 'muted small' }, 'Il saldo iniziale dei fondi si imposta in Impostazioni.'),
    ] : null,
  ];

  if (!annual) {
    return collapsible('contributions', [heading('Quote ai fondi', 'vault'), total()], body);
  }
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, heading('Fondi e quote annue', 'vault'), total()),
    body);
}

/** Spese pagate con i soldi di un fondo: riducono il fondo, non i conti. */
function fundExpensesCard(list) {
  if (!data.funds.length) return null;
  return collapsible('fundExpenses',
    [heading('Spese pagate dai fondi', 'bolt'), liveMoney(() => sumBy(list), 'card-total')],
    [
      h('p', { class: 'muted small' }, 'Es. la bolletta della luce pagata con il fondo Bollette.'),
      itemsEditor(list, {
        placeholder: 'Es. Bolletta luce',
        addLabel: 'Aggiungi spesa dal fondo',
        field: 'fundId',
        newItem: last => ({ fundId: last?.fundId ?? data.funds[0].id }),
      }),
    ]);
}

/** Avviso delle voci dei fondi che scadono nel mese. */
function dueBanner(key, { action = true } = {}) {
  const due = dueItems(key);
  if (!due.length) return null;
  const fundName = id => data.funds.find(f => f.id === id)?.name ?? '';
  const open = () => {
    ui.open.fundExpenses = true;
    const el = app.querySelector('[data-collapse="fundExpenses"]');
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return h('section', { class: 'due-banner', role: 'status' },
    h('span', { class: 'due-banner-icon' }, icon('bell')),
    h('div', {},
      h('strong', {}, due.length === 1 ? 'In questo mese scade un pagamento' : `In questo mese scadono ${due.length} pagamenti`),
      h('ul', {}, due.map(x => h('li', {}, x.name || 'Voce senza nome', h('span', { class: 'muted' }, ` · ${fundName(x.fundId)}`)))),
      action ? h('button', { type: 'button', class: 'btn-link', onclick: open }, 'Registra in "Spese pagate dai fondi"') : null));
}

function transfersCard(list) {
  if (data.accounts.length < 2) return null;
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, heading('Trasferimenti', 'swap'), liveMoney(() => sumBy(list), 'card-total')),
    h('p', { class: 'muted small' }, 'Soldi spostati tra i tuoi conti, es. da ING a Intesa o un prelievo da ING a Contanti. Non cambiano il totale.'),
    itemsEditor(list, {
      row: transferRow,
      placeholder: 'Es. Prelievo bancomat',
      addLabel: 'Aggiungi trasferimento',
      newItem: last => ({
        fromId: last?.fromId ?? data.accounts[0].id,
        toId: last?.toId ?? data.accounts[1].id,
      }),
    }));
}

const FUND_MONTH_COLS = [
  { key: 'versato', label: 'Versato' },
  { key: 'speso', label: 'Speso' },
  { key: 'saldo', label: 'Saldo', signed: true },
];

/** title: testo oppure [icona, testo]. */
function card(title, ...children) {
  const [iconName, text] = Array.isArray(title) ? title : [null, title];
  return h('section', { class: 'card' }, text ? heading(text, iconName) : null, ...children);
}

/* ===================== Viste ===================== */

function viewMonth() {
  const key = ui.month;
  const m = data.months[key];
  const today = monthKey(new Date());

  const picker = h('input', { type: 'month', class: 'month-picker', value: key, 'aria-label': 'Scegli il mese' });
  picker.addEventListener('change', () => {
    if (/^\d{4}-\d{2}$/.test(picker.value)) { ui.month = picker.value; render(); }
  });

  const parts = [h('div', { class: 'month-nav' },
    h('button', { type: 'button', class: 'btn-icon nav-btn', 'aria-label': 'Mese precedente', onclick: () => { ui.month = shiftMonth(key, -1); render(); } }, icon('left')),
    h('div', { class: 'month-label' }, icon('calendar'), monthLabel(key), picker),
    h('button', { type: 'button', class: 'btn-icon nav-btn', 'aria-label': 'Mese successivo', onclick: () => { ui.month = shiftMonth(key, 1); render(); } }, icon('right')))];

  if (key !== today) {
    parts.push(h('div', { class: 'center' },
      h('button', { type: 'button', class: 'btn-link', onclick: () => { ui.month = today; render(); } }, 'Torna al mese corrente')));
  }

  if (!m) {
    const t = data.template;
    const n = t.incomes.length + t.expenses.length + t.contributions.length;
    parts.push(h('section', { class: 'card empty-state' },
      h('span', { class: 'empty-icon' }, icon('calendar')),
      h('h2', {}, 'Mese non ancora creato'),
      h('p', { class: 'muted' }, n
        ? `Verranno copiate ${n} voci dal modello (entrate ricorrenti, spese fisse e quote ai fondi, queste ultime come 1/12 dell'importo annuo), poi potrai modificarle.`
        : 'Il modello è vuoto: potrai inserire le voci a mano, oppure compilare prima la sezione "Modello".'),
      dueBanner(key, { action: false }),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { createMonth(key); render(); } }, icon('plus'), `Crea ${monthLabel(key)}`)));
    return h('div', {}, parts);
  }

  const reload = () => {
    if (!confirm('Sostituire entrate, spese fisse e quote ai fondi di questo mese con quelle del modello?\n' +
      'Le "Altre spese", i trasferimenti e le "Spese pagate dai fondi" restano invariati.')) return;
    m.incomes = cloneItems(data.template.incomes);
    m.fixed = cloneItems(data.template.expenses);
    m.contributions = monthlyContributions();
    commit();
    render();
  };
  const remove = () => {
    if (!confirm(`Eliminare definitivamente ${monthLabel(key)}?`)) return;
    delete data.months[key];
    commit();
    render();
  };

  parts.push(
    dueBanner(key),
    heroCard({
      label: `Saldo di ${monthLabel(key)}`,
      getTotals: () => totalOf(aggregate([m])),
      note: (t, pct) => {
        const funds = sumBy(m.contributions);
        return usedNote(t, pct) + (funds > 0 ? ` ${eur.format(funds)} vanno nei fondi.` : '');
      },
    }),
    card(['chart', 'Riepilogo del mese'],
      flowBars(() => aggregate([m])),
      liveBlock(() => accountsTable(aggregate([m]), flowCols([m]))),
      data.funds.length ? collapsible('monthFunds',
        [h('h3', {}, 'Fondi'), liveMoney(() => fundBalances(key).reduce((s, r) => s + r.saldo, 0), 'card-total')],
        [
          liveBlock(() => {
            const balances = fundBalances(key);
            const rows = aggregateFunds([m]).map((r, i) => ({ ...r, saldo: balances[i].saldo }));
            return accountsTable(rows, FUND_MONTH_COLS, 'Fondo');
          }),
          h('p', { class: 'muted small' }, 'Saldo del fondo a fine mese (saldo iniziale + tutti i mesi fino a questo).'),
        ], 'collapsible nested') : null),
    listCard('Entrate', m.incomes, 'Aggiungi entrata', 'Es. Stipendio', 'income'),
    listCard('Spese fisse', m.fixed, 'Aggiungi spesa fissa', 'Es. Affitto', 'receipt'),
    listCard('Altre spese', m.variable, 'Aggiungi spesa', 'Es. Cena fuori', 'cart'),
    transfersCard(m.transfers),
    contributionsCard(m.contributions),
    fundExpensesCard(m.fundExpenses),
    card(['sliders', 'Azioni sul mese'], h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: reload }, 'Ricarica dal modello'),
      h('button', { type: 'button', class: 'btn btn-danger', onclick: remove }, 'Elimina mese'))));
  return h('div', {}, parts);
}

function openMonth(key) {
  ui.tab = 'mese';
  ui.month = key;
  render();
  window.scrollTo(0, 0);
}

function viewSummary() {
  const keys = Object.keys(data.months).sort();
  const overall = aggregate(keys.map(k => data.months[k])).map(r => ({
    account: r.account,
    iniziale: r.account.initial,
    movimenti: r.saldo,
    saldo: r.account.initial + r.saldo,
  }));

  const accountsTotal = overall.reduce((s, r) => s + r.saldo, 0);
  const funds = fundBalances();
  const fundsTotal = funds.reduce((s, r) => s + r.saldo, 0);
  const worth = accountsTotal + fundsTotal;

  const parts = [
    h('section', { class: `hero${worth < -0.004 ? ' negative' : ''}` },
      h('div', { class: 'hero-label' }, icon('sparkle'), data.funds.length ? 'Patrimonio totale (conti + fondi)' : 'Patrimonio totale'),
      h('div', { class: 'hero-amount' }, eur.format(worth)),
      h('div', { class: 'hero-chips' },
        h('span', { class: 'chip' }, icon('wallet'), 'Conti ', h('b', {}, eur.format(accountsTotal))),
        data.funds.length ? h('span', { class: 'chip' }, icon('vault'), 'Fondi ', h('b', {}, eur.format(fundsTotal))) : null),
      h('div', { class: 'hero-note' }, keys.length === 1 ? '1 mese registrato' : `${keys.length} mesi registrati`)),
    card(['wallet', 'Saldo dei conti'],
      h('p', { class: 'muted small' }, 'Saldo iniziale dei conti + tutti i mesi inseriti. Le uscite includono le quote versate ai fondi; i movimenti includono i trasferimenti tra conti.'),
      accountsTable(overall, [
        { key: 'iniziale', label: 'Iniziale' },
        { key: 'movimenti', label: 'Movimenti', signed: true },
        { key: 'saldo', label: 'Saldo', signed: true },
      ]))];

  if (data.funds.length) {
    parts.push(card(['vault', 'Fondi'],
      h('p', { class: 'muted small' }, 'Saldo = saldo iniziale + versato − speso, su tutti i mesi.'),
      fundTiles(funds)));
  }

  if (!keys.length) {
    parts.push(card(null, h('p', { class: 'muted' }, 'Nessun mese ancora inserito. Vai nella sezione "Mese" per iniziare.')));
    return h('div', {}, parts);
  }

  const years = [...new Set(keys.map(k => k.slice(0, 4)))].sort().reverse();
  if (ui.year !== 'all' && !years.includes(ui.year)) ui.year = 'all';
  const filtered = keys.filter(k => ui.year === 'all' || k.startsWith(ui.year));

  const yearSelect = h('select', { class: 'year-select', 'aria-label': 'Periodo', value: ui.year },
    h('option', { value: 'all' }, 'Tutti gli anni'), years.map(y => h('option', { value: y }, y)));
  yearSelect.addEventListener('change', () => { ui.year = yearSelect.value; render(); });

  const monthRows = filtered.slice().reverse().map(k => {
    const t = totalOf(aggregate([data.months[k]]));
    return h('tr', {
      class: 'clickable', tabindex: '0', title: 'Apri il mese',
      onclick: () => openMonth(k),
      onkeydown: e => { if (e.key === 'Enter') openMonth(k); },
    }, h('td', {}, monthLabel(k)), moneyCell(t.entrate), moneyCell(t.uscite), moneyCell(t.saldo, true));
  });
  const periodTotal = totalOf(aggregate(filtered.map(k => data.months[k])));

  const filteredMonths = filtered.map(k => data.months[k]);
  parts.push(h('section', { class: 'card' },
    h('div', { class: 'card-head' }, heading('Periodo', 'chart'), yearSelect),
    h('h3', {}, filtered.length > 12 ? 'Andamento (ultimi 12 mesi)' : 'Andamento'),
    trendChart(filtered),
    chartLegend(),
    h('h3', {}, 'Per conto'),
    flowBars(() => aggregate(filteredMonths)),
    accountsTable(aggregate(filteredMonths), flowCols(filteredMonths)),
    data.funds.length ? [
      h('h3', {}, 'Per fondo'),
      accountsTable(aggregateFunds(filtered.map(k => data.months[k])), [
        { key: 'versato', label: 'Versato' },
        { key: 'speso', label: 'Speso' },
        { key: 'netto', label: 'Netto', signed: true },
      ], 'Fondo'),
    ] : null,
    h('h3', {}, 'Per mese'),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Mese', 'Entrate', 'Uscite', 'Saldo'].map(t => h('th', {}, t)))),
      h('tbody', {}, monthRows,
        h('tr', { class: 'total' }, h('td', {}, 'Totale'),
          moneyCell(periodTotal.entrate), moneyCell(periodTotal.uscite), moneyCell(periodTotal.saldo, true)))))));
  return h('div', {}, parts);
}

function viewTemplate() {
  const t = data.template;
  const planned = () => ({
    ...emptyMonth(),
    incomes: t.incomes,
    fixed: t.expenses,
    contributions: t.contributions.map(x => ({ ...x, amount: monthlyQuota(x.amount) })),
  });
  return h('div', {},
    heroCard({
      label: 'Ogni mese ti restano (secondo il modello)',
      getTotals: () => totalOf(aggregate([planned()])),
      note: usedNote,
    }),
    card(['layers', 'Modello mensile'], h('p', { class: 'muted small' },
      'Le voci del modello vengono copiate in ogni nuovo mese. Modificarle qui non cambia i mesi già creati: ' +
      'per aggiornarne uno usa "Ricarica dal modello" nella pagina del mese.')),
    listCard('Entrate ricorrenti', t.incomes, 'Aggiungi entrata', 'Es. Stipendio', 'income'),
    listCard('Spese fisse', t.expenses, 'Aggiungi spesa fissa', 'Es. Affitto', 'receipt'),
    contributionsCard(t.contributions, { annual: true }),
    card(['chart', 'Totale mensile per conto'],
      flowBars(() => aggregate([planned()])),
      liveBlock(() => accountsTable(aggregate([planned()]), FLOW_COLS))));
}

function viewSettings() {
  return h('div', {}, walletsCard('accounts'), walletsCard('funds'), syncCard(), backupCard());
}

/** Gestione di conti o fondi: nome, saldo iniziale, aggiunta ed eliminazione. */
function walletsCard(kind) {
  const isFund = kind === 'funds';
  const list = data[kind];
  const noun = isFund ? 'fondo' : 'conto';

  const rows = list.map(wallet => {
    const name = h('input', { type: 'text', class: 'name-input', 'aria-label': `Nome ${noun}`, value: wallet.name });
    name.addEventListener('input', () => { wallet.name = name.value; commit(); });
    const remove = () => {
      const used = usage(isFund ? 'fundId' : 'accountId', wallet.id);
      if (!isFund && list.length === 1) return alert('Deve esistere almeno un conto.');
      if (used) return alert(`Il ${noun} "${wallet.name}" è usato in ${used} voci: spostale o rimuovile prima di eliminarlo.`);
      if (!confirm(`Eliminare il ${noun} "${wallet.name}"?`)) return;
      list.splice(list.indexOf(wallet), 1);
      commit();
      render();
    };
    return h('div', { class: 'account-row' },
      h('i', { class: 'dot', style: `background:${wallet.color}` }),
      name,
      amountInput(() => wallet.initial, v => { wallet.initial = v; }, `Saldo iniziale ${wallet.name}`),
      h('button', { type: 'button', class: 'btn-icon del', title: `Elimina ${noun}`, 'aria-label': `Elimina ${noun}`, onclick: remove }, icon('x')));
  });

  const add = () => {
    addWallet(kind);
    render();
  };

  return card(isFund ? ['vault', 'Fondi'] : ['wallet', 'Conti'],
    h('p', { class: 'muted small' }, `Nome del ${noun} e saldo iniziale (punto di partenza del saldo complessivo).`),
    rows.length ? rows : h('p', { class: 'muted small' }, 'Nessun fondo.'),
    h('button', { type: 'button', class: 'btn-add', onclick: add }, icon('plus'), `Aggiungi ${noun}`));
}

function syncCard() {
  if (sync.token && sync.gistId) {
    return card(['cloud', 'Sincronizzazione online'],
      h('p', { class: 'small' }, 'Collegato a un Gist privato di GitHub. I dati si sincronizzano automaticamente.'),
      h('p', { class: 'small muted' }, `Ultima sincronizzazione: ${formatDateTime(sync.lastSync)}`),
      h('p', { class: 'small' }, h('a', { href: `https://gist.github.com/${encodeURIComponent(sync.gistId)}`, target: '_blank', rel: 'noopener' }, 'Apri il Gist su GitHub')),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => syncNow().then(render) }, 'Sincronizza ora'),
        h('button', {
          type: 'button', class: 'btn btn-danger',
          onclick: () => {
            if (!confirm('Scollegare la sincronizzazione su questo dispositivo? I dati restano sia qui sia online.')) return;
            sync = {};
            saveSync();
            setSyncStatus('idle');
            render();
          },
        }, 'Scollega')));
  }

  const token = h('input', { type: 'password', autocomplete: 'off', placeholder: 'ghp_…', 'aria-label': 'Token GitHub' });
  const gistId = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Facoltativo', 'aria-label': 'ID del Gist' });
  const connect = h('button', { type: 'button', class: 'btn btn-primary' }, 'Collega');
  connect.addEventListener('click', async () => {
    if (!token.value.trim()) return alert('Inserisci il token GitHub.');
    connect.disabled = true;
    connect.textContent = 'Collegamento…';
    await connectGist(token.value.trim(), gistId.value.trim());
    render();
  });

  return card(['cloud', 'Sincronizzazione online'],
    h('p', { class: 'small' }, 'Per usare gli stessi dati su più dispositivi, collega un Gist privato di GitHub (gratuito).'),
    h('ol', { class: 'small' },
      h('li', {}, 'Su GitHub apri ', h('a', { href: 'https://github.com/settings/tokens/new?scopes=gist&description=Budget%20Planner', target: '_blank', rel: 'noopener' }, 'Crea token (classic)'), ', seleziona solo il permesso "gist" e scegli la scadenza.'),
      h('li', {}, 'Copia il token e incollalo qui sotto. Ripeti su ogni dispositivo con lo stesso token.'),
      h('li', {}, 'L\'app trova da sola il Gist esistente oppure ne crea uno nuovo.')),
    h('label', { class: 'field' }, h('span', {}, 'Token GitHub'), token),
    h('label', { class: 'field' }, h('span', {}, 'ID del Gist (facoltativo)'), gistId),
    h('p', { class: 'small muted' }, 'Il token resta salvato solo in questo browser.'),
    connect);
}

function backupCard() {
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    try {
      const imported = normalize(JSON.parse(await f.text()));
      if (!confirm('Importare questo file? I dati attuali verranno sostituiti.')) return;
      data = imported;
      commit();
      render();
      alert('Dati importati.');
    } catch (e) {
      alert(`Impossibile importare il file: ${e.message}`);
    }
  });

  const reset = () => {
    const extra = sync.gistId ? '\nAnche la copia online verrà sovrascritta.' : '';
    if (!confirm(`Cancellare TUTTI i dati (conti, modello e mesi)?${extra}`)) return;
    data = defaultData();
    commit();
    render();
  };

  return card(['download', 'Backup'],
    h('p', { class: 'muted small' }, 'Esporta i dati in un file JSON per tenerne una copia o trasferirli a mano.'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: exportJson }, 'Esporta JSON'),
      h('button', { type: 'button', class: 'btn', onclick: () => file.click() }, 'Importa JSON'),
      h('button', { type: 'button', class: 'btn btn-danger', onclick: reset }, 'Cancella tutto')),
    file);
}

function exportJson() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `budget-planner-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ===================== Render ===================== */

const app = document.getElementById('app');
const VIEWS = { mese: viewMonth, riepilogo: viewSummary, modello: viewTemplate, impostazioni: viewSettings };

function render() {
  refreshers = [];
  app.replaceChildren(VIEWS[ui.tab]());
  app.querySelectorAll(':scope > div > .card, :scope > div > .hero')
    .forEach((el, i) => el.style.setProperty('--i', Math.min(i, 8)));
  document.querySelectorAll('.tabbar button').forEach(b => {
    const active = b.dataset.tab === ui.tab;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => {
  ui.tab = b.dataset.tab;
  render();
  window.scrollTo(0, 0);
}));

/* ===================== Sincronizzazione GitHub Gist ===================== */

const syncState = { running: false, pending: false, timer: null };

function loadSync() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSync() {
  localStorage.setItem(SYNC_KEY, JSON.stringify(sync));
}

function setSyncStatus(status, message = '') {
  const el = document.getElementById('sync-status');
  const labels = { idle: '', busy: '☁️ …', ok: '☁️ ✓', error: '☁️ ⚠️' };
  el.textContent = labels[status] ?? '';
  el.title = message;
  el.setAttribute('aria-label', message);
}

async function gh(path, options = {}) {
  const res = await fetch(GITHUB_API + path, {
    ...options,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${sync.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('token non valido o scaduto');
    if (res.status === 404) throw new Error('Gist non trovato (o token senza permesso "gist")');
    throw new Error(`GitHub ${res.status}: ${body.message || res.statusText}`);
  }
  return res.json();
}

async function findGist() {
  for (let page = 1; page <= 10; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const found = list.find(g => g.files && g.files[GIST_FILE]);
    if (found) return found.id;
    if (list.length < 100) break;
  }
  return null;
}

async function createGist() {
  const gist = await gh('/gists', {
    method: 'POST',
    body: JSON.stringify({
      description: 'Budget Planner - dati',
      public: false,
      files: { [GIST_FILE]: { content: JSON.stringify(data) } },
    }),
  });
  return gist.id;
}

async function pullRemote() {
  const gist = await gh(`/gists/${encodeURIComponent(sync.gistId)}`);
  const file = gist.files?.[GIST_FILE];
  if (!file) return null;
  let content = file.content;
  if (file.truncated) content = await (await fetch(file.raw_url, { cache: 'no-store' })).text();
  return normalize(JSON.parse(content));
}

async function pushRemote() {
  await gh(`/gists/${encodeURIComponent(sync.gistId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(data) } } }),
  });
}

function scheduleSync() {
  if (!sync.token || !sync.gistId) return;
  clearTimeout(syncState.timer);
  syncState.timer = setTimeout(syncNow, 1500);
  setSyncStatus('busy', 'Modifiche da sincronizzare');
}

/** Confronta locale e online: vince la versione modificata più di recente. */
async function syncNow() {
  if (!sync.token || !sync.gistId) return;
  if (syncState.running) { syncState.pending = true; return; }
  clearTimeout(syncState.timer);
  syncState.timer = null;
  syncState.running = true;
  setSyncStatus('busy', 'Sincronizzazione in corso…');
  try {
    const localStamp = data.updatedAt;
    const remote = await pullRemote();
    if (remote && remote.updatedAt > localStamp) {
      if (data.updatedAt === localStamp) { // nessuna modifica locale durante il download
        data = remote;
        persist();
        render();
      }
    } else if (!remote || remote.updatedAt < localStamp) {
      await pushRemote();
    }
    sync.lastSync = Date.now();
    saveSync();
    setSyncStatus('ok', `Sincronizzato alle ${new Date().toLocaleTimeString('it-IT')}`);
  } catch (e) {
    setSyncStatus('error', `Errore di sincronizzazione: ${e.message}`);
  } finally {
    syncState.running = false;
    if (syncState.pending) { syncState.pending = false; syncNow(); }
  }
}

async function connectGist(token, gistId) {
  const previous = sync;
  sync = { token, gistId: gistId || null };
  setSyncStatus('busy', 'Collegamento a GitHub…');
  try {
    if (!sync.gistId) sync.gistId = await findGist();
    const remote = sync.gistId ? await pullRemote() : null;
    if (!sync.gistId) sync.gistId = await createGist();

    if (remote && hasContent(remote)) {
      const useRemote = !hasContent(data) || confirm(
        `Online esiste già un salvataggio (aggiornato il ${formatDateTime(remote.updatedAt)}).\n\n` +
        'OK = usa i dati online su questo dispositivo\n' +
        'Annulla = sovrascrivi i dati online con quelli di questo dispositivo');
      if (useRemote) data = remote;
      else data.updatedAt = Date.now();
    } else {
      data.updatedAt = Date.now();
    }
    persist();
    saveSync();
    await syncNow();
  } catch (e) {
    sync = previous;
    saveSync();
    setSyncStatus('error', e.message);
    alert(`Collegamento non riuscito: ${e.message}`);
  }
}

document.addEventListener('visibilitychange', () => {
  if (!sync.gistId) return;
  if (document.visibilityState === 'visible') syncNow();
  else if (syncState.timer) syncNow(); // invia subito le modifiche prima di chiudere l'app
});
window.addEventListener('online', () => syncNow());

/* ===================== Avvio ===================== */

render();
syncNow();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
