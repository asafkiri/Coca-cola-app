import {readPdf} from './pdf-reader.js';
import {fixed, fraction, round, money, percent, gross, crateCost, unitParts, unitsFromDeposit, packSize, priceBasis, recommend, recommendParts, manualPrice, realizedMarkup} from './money.js';
import {drawPage, pageSize, signLine} from './sign-canvas.js';

const MAX_SIGNS = 12;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const num = text => `<bdi class="num">${esc(text)}</bdi>`;
const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
  print: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>',
  tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
};

const state = {doc: null, view: 'upload', docView: 'upload', units: {}, signs: [], perPage: 4, small: false, pages: [], busy: false, dirty: false, editProducts: null};
let seq = 0;

// ---------- preferences (browser only) ----------
let prefs = {storeName: 'מיני מרקט שלום', markup: '25', rounding: 'ninety', vat: '18'};
try {
  const saved = JSON.parse(localStorage.getItem('coca-prefs-v2') || localStorage.getItem('coca-prefs-v1') || 'null');
  if (saved && typeof saved.storeName === 'string' && saved.storeName.trim()) prefs.storeName = saved.storeName.trim().slice(0, 45);
  if (saved && typeof saved.markup === 'string' && markupBp(saved.markup) !== null) prefs.markup = saved.markup;
  if (saved && ['ninety', 'exact'].includes(saved.rounding)) prefs.rounding = saved.rounding;
  if (saved && typeof saved.vat === 'string' && vatBpOf(saved.vat) !== null) prefs.vat = saved.vat;
} catch {}
// Bottle counts typed by the user, per supplier product code.
let savedUnits = {};
try { savedUnits = JSON.parse(localStorage.getItem('coca-units-v1') || '{}') || {}; } catch {}
function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }

// ---------- small helpers ----------
let toastTimer;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
function notice(text) { $('#notice').textContent = text; $('#notice').hidden = !text; }
function plural(n, one, many) { return n === 1 ? one : `${n} ${many}`; }
function decimal(s) { return String(s ?? '').trim().replace(',', '.'); }
function cents(s) { try { const v = fixed(decimal(s)); return v > 0 ? v : 0; } catch { return 0; } }
function markupBp(s) { try { const v = fixed(decimal(s)); return v >= 0 && v <= 100000 ? v : null; } catch { return null; } }
function vatBpOf(s) { try { const v = fixed(decimal(s)); return v >= 0 && v <= 10000 ? v : null; } catch { return null; } }
function positiveInt(s, max = 1000) { return /^\d+$/.test(String(s).trim()) && Number(s) >= 1 && Number(s) <= max ? Number(s) : 0; }
function quantity(row) { return new Intl.NumberFormat('he-IL', {maximumFractionDigits: 3}).format(row.quantityMilli / 1000); }
function crates(milli) { const q = milli / 1000; return q === 1 ? 'ארגז אחד' : `${quantity({quantityMilli: milli})} ארגזים`; }
function rowById(id) { return state.doc.rows.find(r => r.id === id); }
function unitsOf(row) { return state.units[row.code]?.value || null; }
// Multipacks ("6 בק", "6 פח") are sold by the pack: several packs per case.
function packOf(row) { const p = packSize(row.name), u = unitsOf(row); return p > 1 && u && u > p && u % p === 0 ? p : 1; }
function perSale(row) { return packOf(row) > 1 ? `למארז (${packOf(row)})` : 'ליח׳'; }
function times(r, k) { return fraction(r.n * BigInt(k), r.d); }
function dateText(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : ''; }
function confirmDialog(title, text, ok, onOk) {
  $('#confirm-title').textContent = title; $('#confirm-text').textContent = text; $('#confirm-ok').textContent = ok;
  $('#confirm-ok').onclick = () => { $('#confirm-dialog').close(); onOk(); };
  $('#confirm-dialog').showModal();
}

// ---------- views ----------
// Browser/phone Back moves between screens, as in the other apps.
const DEPTH = {upload: 0, document: 1, calc: 1, pick: 2, signs: 3};
const VIEWS = ['upload', 'document', 'pick', 'signs', 'calc'];
const PAGE = String(Math.random()); // history entries left from before a reload are skipped
// Switching tabs replaces the history entry instead of adding one.
function show(view, fromHistory = false, replace = false) {
  if (state.busy) return;
  if (view === 'signs' && !state.signs.length) view = state.doc ? 'pick' : 'upload';
  if (!fromHistory && !replace && state.doc && view !== state.view) {
    try { if (DEPTH[view] > DEPTH[state.view] && view !== 'document') history.pushState({coca: view, page: PAGE}, ''); else history.replaceState({coca: view, page: PAGE}, ''); } catch {}
  }
  // Coming back from the price check: the invoice screens were only hidden,
  // so keep their scroll position and opened products.
  const back = replace && view !== 'calc' && state.view === 'calc';
  if (replace && view === 'calc' && state.view !== 'calc') state.docScroll = scrollY;
  try { sessionStorage.setItem('coca-mode', view === 'calc' ? 'calc' : 'doc'); } catch {}
  state.view = view;
  if (view !== 'calc') state.docView = view;
  for (const v of VIEWS) $(`#${v}-view`).hidden = v !== view;
  for (const t of document.querySelectorAll('[data-mode]')) { const on = (t.dataset.mode === 'calc') === (view === 'calc'); t.classList.toggle('on', on); t.setAttribute('aria-pressed', on); }
  if (view === 'document' && !back) renderDocument();
  if (view === 'pick' && !back) renderPick();
  if (view === 'signs') renderSigns();
  if (view === 'calc') renderCalc();
  renderActionBar();
  window.scrollTo({top: back ? state.docScroll || 0 : 0});
}
// One bottom bar per screen, like the other apps: no action appears twice.
function renderActionBar() {
  const bar = $('#action-bar'), n = state.signs.length;
  let html = '';
  if (state.view === 'document') html = `<button class="btn primary grow" type="button" data-go="pick">${ICON.print}${n ? `שלטי מבצע (${n})` : 'הכנת שלטי מבצע'}</button>`;
  if (state.view === 'pick') html = `<button class="btn light" type="button" data-go="document" aria-label="חזרה לתעודה">${ICON.back}</button><button class="btn primary grow" type="button" data-go="signs" ${n ? '' : 'disabled'}>המשך (${n})</button>`;
  if (state.view === 'calc') html = `<button class="btn primary grow" type="button" data-calc-add>＋ מוצר נוסף</button>`;
  if (state.view === 'signs') html = `<button class="btn light" type="button" data-go="pick" aria-label="חזרה לבחירה">${ICON.back}</button><button class="btn primary grow" type="button" data-export="share">${ICON.share}שתף / שמור תמונה</button><button class="btn light" type="button" data-export="print" aria-label="הדפסה">${ICON.print}<span class="label">הדפסה</span></button>`;
  bar.innerHTML = html; bar.hidden = !html || state.busy;
}

// ---------- document ----------
function pairs(items) {
  return '<dl class="breakdown">' + items.filter(Boolean).map(([label, value, cls = '']) => `<dt class="${cls}">${esc(label)}</dt><dd class="${cls}">${num(value)}</dd>`).join('') + '</dl>';
}
function groupsOf(doc) {
  const groups = doc.promos.map(p => ({promo: p, rows: doc.rows.filter(r => r.promoId === p.id)}));
  const fixedDiscount = doc.rows.filter(r => !r.promoId && r.discountBp > 0);
  const none = doc.rows.filter(r => !r.promoId && !(r.discountBp > 0));
  if (fixedDiscount.length) groups.push({title: 'הנחות נוספות מהספק', rows: fixedDiscount});
  if (none.length) groups.push({title: 'ללא הנחה', rows: none});
  return groups.filter(g => g.rows.length);
}
function promoTitle(p) { return p.text || `מבצע ${p.id}`; }
function savedWithVat(rows) { return round(gross(-rows.reduce((a, r) => a + r.discount, 0), state.doc.vatBp)); }
function itemHtml(row, groupPct) {
  const d = state.doc, units = unitsOf(row);
  const base = priceBasis(row);
  const crate = round(crateCost(base, d.vatBp));
  const unit = units ? unitParts(base, d.vatBp, units) : null;
  const returnable = row.packaging ? round(crateCost({total: row.packaging, quantityMilli: row.quantityMilli}, d.vatBp)) : 0;
  const lineVat = round(gross(row.total, d.vatBp));
  const chip = row.discountBp > 0 && row.discountBp !== groupPct ? `<span class="chip">הנחה ${num(percent(row.discountBp))}</span>` : '';
  const pack = packOf(row);
  const price = !unit ? `<div class="price-main">${num(money(crate))}<small>לארגז</small></div>`
    : pack > 1 ? `<div class="price-main">${num(money(round(times(unit.total, pack))))}<small>${perSale(row)}</small></div><div class="price-sub">${num(money(round(unit.total)))} ליח׳ · ${num(money(crate))} לארגז</div>`
    : `<div class="price-main">${num(money(round(unit.total)))}<small>ליח׳</small></div><div class="price-sub">${num(money(crate))} לארגז</div>`;
  const breakdown = pairs([
    [`מחיר ספק לארגז, לפני הנחה (ללא מע״מ)`, money(row.unitPrice)],
    [`סחורה: ${crates(row.quantityMilli)} (ללא מע״מ)`, money(row.gross)],
    row.discount ? [`הנחה ${percent(row.discountBp)}`, money(row.discount), 'good'] : null,
    row.deposit ? ['פיקדון', money(row.deposit)] : null,
    row.packaging ? ['ערך אריזה', money(row.packaging)] : null,
    row.tax ? ['מס קנייה', money(row.tax)] : null,
    ['סה״כ בתעודה, לפני מע״מ', money(row.total), 'strong'],
    [`כולל מע״מ ${percent(d.vatBp)}`, money(lineVat)],
    row.packaging ? ['אריזה חוזרת, בנפרד (כולל מע״מ)', money(-round(gross(row.packaging, d.vatBp)))] : null,
    [`לארגז (חלקי ${quantity(row)})`, money(crate), 'strong'],
    unit ? [`ליחידה (חלקי ${units})`, money(round(unit.total)), 'strong'] : null,
    unit && pack > 1 ? [`למארז (${pack} יח׳)`, money(round(times(unit.total, pack))), 'strong'] : null,
    unit && row.deposit ? ['מתוך זה פיקדון ליחידה', money(round(unit.pass))] : null,
  ]);
  return `<article class="item" data-row="${row.id}">
    <details>
      <summary>
        <div class="item-main"><div class="item-name">${esc(row.name)}</div><div class="meta">${esc(crates(row.quantityMilli))}${units ? ` · ${units} יח׳ בארגז` : ''}</div>${returnable ? `<span class="returnable">אריזה חוזרת בנפרד: ${num(money(returnable))} לארגז</span>` : ''}</div>
        <div class="item-price">${chip}${price}</div>
      </summary>
      <div class="item-details">
        ${breakdown}
        ${units ? unitsField(row) : ''}
      </div>
    </details>
    ${units ? '' : `<label class="units-ask">${UNITS_Q} <input inputmode="numeric" data-units="${esc(row.code)}" placeholder="למשל 20" aria-label="יחידות בארגז ${esc(row.name)}"></label>`}
  </article>`;
}
const UNITS_Q = 'כמה בקבוקים או פחיות בארגז?';
function unitsField(row) {
  const units = unitsOf(row), src = state.units[row.code]?.source, inferred = unitsFromDeposit(row, state.doc.vatBp);
  const hint = src === 'deposit' ? 'חושב לפי הפיקדון בתעודה (30 אג׳ ליחידה). אפשר לתקן.'
    : src === 'user' ? 'הוזן ידנית ונשמר במכשיר הזה לפעם הבאה.' + (inferred && inferred !== units ? ` לפי הפיקדון בתעודה: ${inferred}. מחיקת המספר מחזירה אותו.` : '')
    : 'לא ניתן לחשב מהתעודה. הזן כמה בקבוקים או פחיות יש בארגז אחד.';
  return `<label class="units-field">יחידות בארגז <input inputmode="numeric" data-units="${esc(row.code)}" value="${units || ''}" aria-label="יחידות בארגז ${esc(row.name)}"></label><p class="hint">${hint}</p>`;
}
function renderDocument() {
  const d = state.doc, s = d.summary;
  const cratesTotal = d.rows.reduce((a, r) => a + r.quantityMilli, 0);
  const savings = round(gross(-s.discount, d.vatBp));
  const groups = groupsOf(d).map(g => {
    const pct = g.promo?.pctBp ?? null;
    const head = g.promo
      ? `<div class="group-name">${ICON.tag}${esc(promoTitle(g.promo))}</div><div class="meta">מבצע ספק · ${plural(g.rows.length, 'מוצר אחד', 'מוצרים')} · ${esc(crates(g.rows.reduce((a, r) => a + r.quantityMilli, 0)))} · חסכת ${num(money(savedWithVat(g.rows)))}</div>`
      : `<div class="group-name">${esc(g.title)}</div><div class="meta">${plural(g.rows.length, 'מוצר אחד', 'מוצרים')} · ${esc(crates(g.rows.reduce((a, r) => a + r.quantityMilli, 0)))}${g.rows.some(r => r.discount) ? ` · חסכת ${num(money(savedWithVat(g.rows)))}` : ''}</div>`;
    const chip = pct && !g.promo.text.includes(percent(pct)) ? `<span class="chip strong">${num(percent(pct))}</span>` : '';
    return `<section class="group${g.promo ? ' promo' : ''}"><header class="group-head"><div>${head}</div>${chip}</header>${g.rows.map(r => itemHtml(r, pct)).join('')}</section>`;
  }).join('');
  $('#document-view').innerHTML = `
    <section class="doc-card">
      <div class="doc-head">
        <div><h1>תעודה ${esc(d.number || 'ללא מספר')}</h1><div class="meta">${esc(d.date)} · ${plural(d.rows.length, 'מוצר אחד', 'מוצרים')} · ${esc(crates(cratesTotal))}</div></div>
        <button class="btn light small" type="button" data-action="upload">תעודה אחרת</button>
      </div>
      <div class="ok-badge">${ICON.check}הסכומים תואמים לתעודה</div>
      <div class="totals">
        <div><span>סה״כ לתשלום</span><strong>${num(money(s.total))}</strong><small>כולל מע״מ</small></div>
        <div><span>חסכת בהנחות</span><strong class="good">${num(money(savings))}</strong><small>כולל מע״מ</small></div>
      </div>
      <details class="more"><summary>פירוט הסכומים בתעודה</summary>${pairs([
        ['סחורה לפני הנחות', money(s.gross)], ['הנחות', money(s.discount), 'good'], ['ערך אריזות', money(s.packaging)], ['מס קנייה', money(s.tax)], ['פיקדון', money(s.deposit)],
        s.rounding ? ['הפרש עיגול', money(s.rounding)] : null, ['לפני מע״מ', money(s.beforeVat), 'strong'], [`מע״מ ${percent(d.vatBp)}`, money(s.vat)], ['סה״כ כולל מע״מ', money(s.total), 'strong'],
      ])}</details>
    </section>
    ${d.hasReturns ? '<p class="note">בתעודה יש גם אריזות מוחזרות. הן אינן נכללות במחירי המוצרים.</p>' : ''}
    ${d.warnings.map(w => `<p class="note warn">${esc(w)}</p>`).join('')}
    <div class="section-head"><h2>המחירים שלך</h2><p>מחיר סופי: אחרי ההנחה, כולל מע״מ, פיקדון וכל החיובים (גם ה"חסכת" כולל מע״מ).${d.rows.some(r => r.packaging) ? ' ערך אריזה חוזרת (ארגז ובקבוקים שמוחזרים לספק) מוצג בנפרד ולא נכלל במחיר.' : ''} לחיצה על מוצר מציגה את החישוב.</p></div>
    ${groups}`;
}
// Updates the product in place: re-rendering the list would move or replace
// the element the user is tapping right now.
function refreshRows(code) {
  const tmp = document.createElement('div');
  for (const r of state.doc.rows.filter(r => r.code === code)) {
    const el = $(`[data-row="${r.id}"]`); if (!el) continue;
    tmp.innerHTML = itemHtml(r, state.doc.promos.find(p => p.id === r.promoId)?.pctBp ?? null);
    el.querySelector('summary').innerHTML = tmp.querySelector('summary').innerHTML;
    // Exactly one units input per row: the amber question stays until the next
    // full render, otherwise the field lives in the details.
    const details = tmp.querySelector('.item-details'), ask = el.querySelector('.units-ask input');
    details.querySelector('.units-field')?.nextElementSibling?.remove(); details.querySelector('.units-field')?.remove();
    if (ask) { if (ask !== document.activeElement) ask.value = unitsOf(r) || ''; }
    else details.insertAdjacentHTML('beforeend', unitsField(r));
    el.querySelector('.item-details').innerHTML = details.innerHTML;
  }
}
function setUnits(code, value) {
  const n = positiveInt(value);
  if (n) state.units[code] = {value: n, source: 'user'};
  else { const row = state.doc.rows.find(r => r.code === code); const v = unitsFromDeposit(row, state.doc.vatBp); state.units[code] = {value: v, source: v ? 'deposit' : null}; }
  if (n) savedUnits[code] = n; else delete savedUnits[code];
  store('coca-units-v1', savedUnits);
}

// ---------- loading a document ----------
function pickFile() {
  if (state.busy) return;
  const open = () => { $('#pdf-file').value = ''; $('#pdf-file').click(); };
  if (state.signs.length) confirmDialog('תעודה חדשה', 'התעודה והשלטים הנוכחיים יוחלפו.', 'בחירת תעודה', open);
  else open();
}
async function loadFile(file) {
  if (!file) return;
  notice(''); state.busy = true;
  $('#loading-label').textContent = 'קורא ובודק את התעודה…';
  $('#loading').hidden = false; $('#action-bar').hidden = true;
  for (const v of VIEWS) $(`#${v}-view`).hidden = true;
  try {
    const doc = await readPdf(file, (n, total) => { $('#loading-label').textContent = `קורא ובודק עמוד ${n} מתוך ${total}…`; });
    state.doc = doc; state.signs = []; state.pages = []; state.dirty = false; state.units = {};
    for (const r of doc.rows) {
      const saved = positiveInt(savedUnits[r.code]), inferred = unitsFromDeposit(r, doc.vatBp);
      state.units[r.code] = saved ? {value: saved, source: 'user'} : {value: inferred, source: inferred ? 'deposit' : null};
    }
    state.busy = false; show('document');
  } catch (e) {
    state.busy = false;
    notice('לא ניתן לקרוא את התעודה. ' + e.message + (state.doc ? ' התעודה הקודמת נשארה פתוחה.' : ''));
    show(state.doc ? state.view === 'upload' ? 'document' : state.view : 'upload');
  } finally {
    $('#loading').hidden = true;
  }
}

// ---------- picking what goes on signs ----------
function signSource(source) { return state.signs.find(s => s.source === source); }
function defaultTitle(ids) { return ids.length === 1 ? rowById(ids[0]).name : ''; }
function createSign(source, ids) {
  return {id: `s${++seq}`, source, productIds: ids, title: defaultTitle(ids), autoTitle: true, kind: 'unit', price: '', qty: '', pct: '', oldPrice: '', validUntil: '', note: '', touched: false};
}
function togglePick(source) {
  const existing = signSource(source);
  if (existing) {
    const remove = () => { state.signs = state.signs.filter(s => s !== existing); state.dirty = true; renderPick(); renderActionBar(); document.querySelector(`[data-pick="${source}"]`)?.focus({preventScroll: true}); };
    if (existing.touched) confirmDialog('הסרת השלט', 'הפרטים שהוזנו בשלט הזה יימחקו.', 'הסרה', remove); else remove();
    return;
  }
  if (state.signs.length >= MAX_SIGNS) { toast(`אפשר עד ${MAX_SIGNS} שלטים בכל פעם`); return; }
  const [type, id] = source.split(':');
  const ids = type === 'promo' ? state.doc.rows.filter(r => r.promoId === id).map(r => r.id) : [id];
  state.signs.push(createSign(source, ids)); state.dirty = true;
  renderPick(); renderActionBar();
}
function pickCard(source, title, meta, chip) {
  const on = !!signSource(source);
  return `<button type="button" class="pick${on ? ' on' : ''}" data-pick="${esc(source)}" aria-pressed="${on}">
    <span class="tick" aria-hidden="true">${ICON.check}</span>
    <span class="pick-text"><strong>${esc(title)}</strong><span class="meta">${meta}</span></span>
    ${chip ? `<span class="chip">${chip}</span>` : ''}
  </button>`;
}
function renderPick() {
  const d = state.doc;
  // A one-product promotion is the same sign as that product's own card.
  const promos = d.promos.filter(p => d.rows.filter(r => r.promoId === p.id).length > 1).map(p => {
    const rows = d.rows.filter(r => r.promoId === p.id);
    return pickCard(`promo:${p.id}`, promoTitle(p), `${plural(rows.length, 'מוצר אחד', 'מוצרים')}: ${esc(rows.map(r => r.name).join(' · '))}`, '');
  }).join('');
  const singles = d.rows.map(r => pickCard(`row:${r.id}`, r.name, esc(unitsOf(r) ? `${money(round(times(unitParts(priceBasis(r), d.vatBp, unitsOf(r)).total, packOf(r))))} ${perSale(r)} · ${money(round(crateCost(priceBasis(r), d.vatBp)))} לארגז` : `${money(round(crateCost(priceBasis(r), d.vatBp)))} לארגז`), r.discountBp ? num(percent(r.discountBp)) : '')).join('');
  $('#pick-view').innerHTML = `
    <div class="screen-head"><h1>הכנת שלטי מבצע</h1><p>כל בחירה היא שלט אחד. אפשר עד ${MAX_SIGNS} שלטים.</p></div>
    ${promos ? `<h2 class="list-label">מבצעי הספק בתעודה</h2><p class="hint top">כל מוצרי המבצע נכנסים לשלט אחד. תיאור המבצע של הספק ומחירי העלות לא מודפסים; בשלט מופיע רק מה שממלאים בעריכה.</p>${promos}` : ''}
    <h2 class="list-label">מוצר בודד</h2>${singles}`;
}

// ---------- sign editing ----------
function signById(id) { return state.signs.find(s => s.id === id); }
function signRows(sign) { return sign.productIds.map(rowById).filter(Boolean); }
function bundleQty(sign) { return sign.kind === 'bundle' ? positiveInt(sign.qty) : 1; }
function pctValue(sign) { try { const v = fixed(decimal(sign.pct)); return v > 0 && v < 10000 ? v : 0; } catch { return 0; } }
function recommendation(sign) {
  const rows = signRows(sign), d = state.doc;
  if (sign.kind === 'pct') {
    const pcts = rows.map(r => r.discountBp).filter(v => v > 0);
    return pcts.length === rows.length && pcts.length ? {type: 'pct', value: Math.floor(Math.min(...pcts) / 100)} : {missing: 'לחלק מהמוצרים אין הנחת ספק. הקלד את אחוז ההנחה.'};
  }
  const q = bundleQty(sign);
  if (!q) return {missing: 'הקלד כמות במבצע כדי לקבל המלצה.'};
  const noUnits = rows.find(r => !unitsOf(r));
  if (noUnits) return {missing: 'units', row: noUnits};
  if (mixedPacks(sign)) return {missing: MIXED};
  const m = markupBp(prefs.markup) ?? 2500;
  // A shared sign must cover the most expensive product in it.
  const all = rows.map(r => ({row: r, ...recommend(priceBasis(r), d.vatBp, unitsOf(r), m, q * packOf(r), prefs.rounding)}));
  return {...all.reduce((a, b) => b.cents > a.cents ? b : a), ranked: all.some(x => x.cents !== all[0].cents)};
}
function packSign(sign) { const rows = signRows(sign); return rows.length > 0 && rows.every(r => packOf(r) > 1); }
const MIXED = 'בשלט יש גם מארזים וגם יחידות בודדות. כדאי להפריד לשני שלטים.';
function mixedPacks(sign) { return signRows(sign).some(r => packOf(r) > 1) && !packSign(sign); }
function recHtml(sign) {
  const r = recommendation(sign);
  if (r.missing === 'units') return `<label class="rec missing">${esc(r.row.name)}: ${UNITS_Q} <input inputmode="numeric" data-units="${esc(r.row.code)}" placeholder="למשל 20"></label>`;
  if (r.missing) return `<div class="rec missing">${esc(r.missing)}</div>`;
  const text = r.type === 'pct'
    ? `המלצה: <b>${r.value}%</b> <span>(ההנחה שקיבלת מהספק)</span>`
    : `המלצת מחיר: <b>${num(money(r.cents))}</b> <span>(עלות ${perSale(r.row)} ${num(money(round(times(r.parts.total, packOf(r.row)))))} · רווח ${esc(prefs.markup)}%${r.ranked ? ` · לפי ${esc(r.row.name)}, היקר בשלט` : ''})</span>`;
  return `<div class="rec"><span>💡 ${text}</span><button type="button" class="use" data-apply="${sign.id}">השתמש</button></div>`;
}
function profitHtml(sign) {
  if (sign.kind === 'pct' || mixedPacks(sign)) return '';
  const sale = cents(sign.price), q = bundleQty(sign);
  if (!sale || !q) return '';
  const d = state.doc;
  const rates = signRows(sign).filter(unitsOf).map(r => realizedMarkup(priceBasis(r), d.vatBp, unitsOf(r), q * packOf(r), sale)).filter(v => v !== null);
  if (!rates.length) return '';
  const min = Math.min(...rates);
  if (min < 0) return '<p class="profit bad">המחיר נמוך מהעלות. בדוק את המחיר או את מספר היחידות בארגז.</p>';
  return `<p class="profit${min * 100 < (markupBp(prefs.markup) ?? 0) - 5 ? ' low' : ''}">רווח על העלות: ${num(min.toFixed(1) + '%')}${Math.max(...rates) - min >= 0.05 ? ' (הנמוך בשלט)' : ''}</p>`;
}
function field(sign, key, label, attrs = '') {
  return `<label class="field">${esc(label)}<input data-f="${key}" data-sign="${sign.id}" value="${esc(sign[key])}" ${attrs}></label>`;
}
function editorHtml(sign, index) {
  const rows = signRows(sign);
  const pack = packSign(sign);
  const kinds = [['unit', pack ? 'מחיר למארז' : 'מחיר ליח׳'], ['bundle', 'כמות במחיר'], ['pct', '% הנחה']]
    .map(([k, label]) => `<button type="button" data-kind="${k}" data-sign="${sign.id}" class="${sign.kind === k ? 'on' : ''}" aria-pressed="${sign.kind === k}">${label}</button>`).join('');
  const money_ = 'inputmode="decimal" autocomplete="off"';
  const fields = sign.kind === 'unit' ? field(sign, 'price', pack ? 'מחיר למארז (₪)' : 'מחיר ליח׳ (₪)', `${money_} placeholder="0.00"`) + field(sign, 'oldPrice', 'במקום ₪ (רשות)', money_)
    : sign.kind === 'bundle' ? field(sign, 'qty', pack ? 'מארזים' : 'כמות', 'inputmode="numeric" placeholder="3"') + field(sign, 'price', 'מחיר כולל (₪)', `${money_} placeholder="12"`) + field(sign, 'oldPrice', 'במקום ₪ (רשות)', money_)
    : field(sign, 'pct', 'אחוז הנחה (%)', `${money_} placeholder="10"`);
  return `<article class="sign-card" data-editor="${sign.id}">
    <div class="sign-top"><span class="meta">שלט ${index + 1} · ${plural(rows.length, 'מוצר אחד', 'מוצרים')}</span><button type="button" class="link" data-edit-products="${sign.id}">שינוי מוצרים</button></div>
    ${field(sign, 'title', 'כותרת השלט', `maxlength="120" autocomplete="off"${rows.length > 1 ? ' placeholder="למשל: FUZE tea"' : ''}`)}
    ${rows.length > 1 ? `<div class="names"><span class="hint">לחיצה על שם קובעת אותו ככותרת:</span>${rows.map(r => `<button type="button" class="name-chip" data-title-from="${r.id}" data-sign="${sign.id}">${esc(r.name)}</button>`).join('')}</div>` : ''}
    <div class="seg kinds" role="group" aria-label="סוג המבצע">${kinds}</div>
    <div class="fields ${sign.kind}">${fields}</div>
    <div id="rec-${sign.id}">${recHtml(sign)}</div>
    <div id="profit-${sign.id}">${profitHtml(sign)}</div>
    <div class="fields two">${field(sign, 'validUntil', 'בתוקף עד (רשות)', `type="date"${sign.validUntil ? '' : ' class="empty"'}`)}${field(sign, 'note', 'הערה (לא חובה)', 'maxlength="80" placeholder="עד גמר המלאי"')}</div>
  </article>`;
}
// "2 בדף (קטן)" is the 2-per-page layout drawn smaller (sign-canvas.js).
function smallPage() { return state.perPage === 2 && state.small; }
function renderSigns() {
  $('#sign-editors').innerHTML = state.signs.map(editorHtml).join('');
  for (const b of document.querySelectorAll('[data-per-page]')) { const on = Number(b.dataset.perPage) === state.perPage && b.hasAttribute('data-small') === smallPage(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
  renderPreview();
}
function refreshSign(sign) {
  const rec = $('#rec-' + sign.id), profit = $('#profit-' + sign.id);
  if (rec && !rec.contains(document.activeElement)) rec.innerHTML = recHtml(sign);
  if (profit) profit.innerHTML = profitHtml(sign);
}

// ---------- sign preview and export ----------
function drawData(sign) {
  return {
    title: sign.title.trim(), kind: sign.kind, note: sign.note.trim(), validUntil: dateText(sign.validUntil),
    priceCents: cents(sign.price), qty: positiveInt(sign.qty), oldCents: cents(sign.oldPrice),
    pctText: pctValue(sign) ? new Intl.NumberFormat('en-US', {maximumFractionDigits: 2}).format(pctValue(sign) / 100) : '',
    products: signRows(sign).map(r => ({name: r.name, barcode: r.barcode})),
  };
}
const fontsReady = Promise.all(['900 40px Heebo', '800 40px Heebo'].map(f => document.fonts.load(f, 'אב₪1'))).catch(() => {});
fontsReady.then(() => { state.pages = []; if (state.view === 'signs') renderPreview(); });
function renderPreview() {
  const data = state.signs.map(drawData), per = state.perPage, small = smallPage();
  const chunks = [];
  for (let i = 0; i < data.length; i += per) chunks.push(data.slice(i, i + per));
  const guides = chunks.length === 1;
  // Redraw only pages whose content changed.
  state.pages = chunks.map((signs, i) => {
    const key = JSON.stringify([per, small, prefs.storeName, guides, signs]), old = state.pages[i];
    if (old && old.key === key) return old;
    return {key, canvas: drawPage(old?.canvas || document.createElement('canvas'), signs, per, prefs.storeName, guides, small)};
  });
  const host = $('#preview-pages');
  host.replaceChildren(...state.pages.flatMap(({canvas}, i) => {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `תצוגת דף ${i + 1} מתוך ${state.pages.length}`);
    if (state.pages.length === 1) return [canvas];
    const label = document.createElement('div'); label.className = 'page-label'; label.textContent = `עמוד ${i + 1} מתוך ${state.pages.length}`;
    return [label, canvas];
  }));
}
let previewTimer;
function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 150); }
function problems() {
  const out = [];
  state.signs.forEach((s, i) => {
    const d = drawData(s), name = `שלט ${i + 1}`;
    if (!d.title) out.push(`${name}: בלי כותרת`);
    if (!signLine(d)) out.push(`${name}: בלי ${s.kind === 'pct' ? 'אחוז הנחה' : s.kind === 'bundle' ? 'כמות ומחיר' : 'מחיר'}`);
    else if (s.kind !== 'pct') {
      const q = bundleQty(s), noUnits = signRows(s).find(r => !unitsOf(r));
      if (noUnits) out.push(`${name}: חסר מספר היחידות בארגז של ${noUnits.name}, המחיר לא נבדק מול העלות`);
      else if (mixedPacks(s)) out.push(`${name}: ${MIXED}`);
      if (signRows(s).some(r => unitsOf(r) && realizedMarkup(priceBasis(r), state.doc.vatBp, unitsOf(r), q * packOf(r), d.priceCents) < 0)) out.push(`${name}: המחיר נמוך מהעלות`);
      if (d.oldCents && d.oldCents <= d.priceCents) out.push(`${name}: מחיר ה"במקום" אינו גבוה ממחיר המבצע`);
    }
  });
  return out;
}
function checked(action) {
  if (!state.signs.length) return;
  clearTimeout(previewTimer); renderPreview();
  const list = problems();
  if (list.length) confirmDialog('כדאי לבדוק לפני שממשיכים', list.join('\n'), action === 'print' ? 'להדפיס בכל זאת' : 'לשמור בכל זאת', () => exportSigns(action));
  else exportSigns(action);
}
function png(canvas) { return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('png')), 'image/png')); }
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
async function exportSigns(action) {
  if (action === 'print') return printSigns();
  let files;
  try {
    const blobs = await Promise.all(state.pages.map(p => png(p.canvas)));
    files = blobs.map((b, i) => new File([b], `shelet-${today()}${blobs.length > 1 ? '-' + (i + 1) : ''}.png`, {type: 'image/png'}));
  } catch { toast('שגיאה ביצירת התמונה'); return; }
  if (navigator.canShare?.({files})) {
    try { await navigator.share({files}); state.dirty = false; return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  files.forEach((f, i) => setTimeout(() => {
    const a = document.createElement('a'); a.download = f.name; a.href = URL.createObjectURL(f);
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, i * 400));
  state.dirty = false;
  toast(files.length > 1 ? `${files.length} תמונות ירדו. אפשר לפתוח אותן מהקבצים או מההורדות` : 'התמונה ירדה. אפשר לפתוח אותה מהקבצים או מההורדות');
}
// A landscape page (1 per page) is turned onto portrait A4: same paper result
// without depending on the browser's page-orientation support.
function printImage(canvas) {
  if (canvas.width <= canvas.height) return canvas.toDataURL('image/png');
  const c = document.createElement('canvas'); c.width = canvas.height; c.height = canvas.width;
  const ctx = c.getContext('2d'); ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(canvas, 0, 0);
  return c.toDataURL('image/png');
}
function fillPrintRoot() {
  $('#print-root').replaceChildren(...state.pages.map(p => { const img = new Image(); img.alt = ''; img.src = printImage(p.canvas); return img; }));
}
function printSigns() {
  const root = $('#print-root');
  fillPrintRoot();
  Promise.all([...root.children].map(i => i.decode())).then(() => {
    document.body.classList.add('print-signs'); state.dirty = false;
    window.print();
  }).catch(() => toast('לא ניתן להכין את ההדפסה'));
}
// The browser's own print (Ctrl+P) on the sign screen prints the signs too, not the editor.
window.addEventListener('beforeprint', () => {
  if (state.view !== 'signs' || !state.signs.length || document.body.classList.contains('print-signs')) return;
  clearTimeout(previewTimer); renderPreview(); fillPrintRoot(); document.body.classList.add('print-signs');
});
window.addEventListener('afterprint', () => { document.body.classList.remove('print-signs'); $('#print-root').replaceChildren(); });

// ---------- price check without an invoice ----------
// Filled from the supplier's ordering app; kept in this browser so switching
// apps on the phone (which may reload the page) does not lose it.
function newCalc() { return {id: `c${++seq}`, name: '', price: '', discount: '', tax: '', units: '', deposit: ''}; }
let calcItems = [];
try { calcItems = (JSON.parse(localStorage.getItem('coca-calc-v1') || '[]') || []).filter(i => i && typeof i === 'object').map(i => ({...newCalc(), ...Object.fromEntries(['name', 'price', 'discount', 'tax', 'units', 'deposit'].map(k => [k, String(i[k] ?? '').slice(0, 60)]))})); } catch {}
if (!calcItems.length) calcItems = [newCalc()];
function saveCalc() { store('coca-calc-v1', calcItems.map(({id, ...rest}) => rest)); }
function amountOrZero(s) { if (!String(s).trim()) return 0; try { const v = fixed(decimal(s)); return v >= 0 ? v : null; } catch { return null; } }
function calcInput(item) {
  const errors = [];
  const priceCents = cents(item.price);
  const discountBp = amountOrZero(item.discount), taxCents = amountOrZero(item.tax), depositCents = amountOrZero(item.deposit);
  const units = String(item.units).trim() ? positiveInt(item.units) || null : null;
  const LIMIT = 10000000; // ₪100,000
  if (String(item.price).trim() && (!priceCents || priceCents > LIMIT)) errors.push('המחיר לארגז');
  if (discountBp === null || discountBp >= 10000) errors.push('אחוז ההנחה');
  if (taxCents > LIMIT || depositCents > LIMIT) errors.push('סכום גדול מדי');
  if (taxCents === null) errors.push('מס הקנייה');
  if (depositCents === null) errors.push('הפיקדון');
  if (String(item.units).trim() && !units) errors.push('יחידות בארגז (מספר שלם)');
  return {priceCents, discountBp, taxCents, depositCents, units, errors};
}
function calcResultHtml(item) {
  try { return calcResultInner(item); } catch { return '<p class="calc-empty bad">בדוק את הסכומים שהוזנו.</p>'; }
}
function calcResultInner(item) {
  const vatBp = vatBpOf(prefs.vat) ?? 1800, vatText = percent(vatBp);
  const c = calcInput(item);
  if (!String(item.price).trim()) return `<p class="calc-empty">הזן מחיר לארגז כדי לראות את המחיר הסופי.</p>`;
  if (c.errors.length) return `<p class="calc-empty bad">בדוק: ${esc(c.errors.join(', '))}</p>`;
  const r = manualPrice(c, vatBp), full = c.discountBp ? manualPrice({...c, discountBp: 0}, vatBp) : null;
  const saved = full ? round(full.crate) - round(r.crate) : 0;
  const rec = r.unit ? recommendParts(r.unit, markupBp(prefs.markup) ?? 2500, 1, prefs.rounding) : null;
  const includes = ['מע״מ ' + vatText, c.discountBp ? 'הנחה' : '', c.taxCents ? 'מס קנייה' : '', r.unit && c.depositCents ? 'פיקדון' : ''].filter(Boolean);
  return `<div class="calc-main">
      <div><span>לארגז</span><strong>${num(money(round(r.crate)))}</strong></div>
      ${r.unit ? `<div><span>ליחידה</span><strong>${num(money(round(r.unit.total)))}</strong></div>` : ''}
    </div>
    <p class="meta">כולל ${esc(includes.join(', '))}${saved > 0 ? ` · לפני ההנחה ${num(money(round(full.crate)))} · חסכת ${num(money(saved))} לארגז` : ''}</p>
    ${r.unit ? '' : `<p class="hint">הזן יחידות בארגז כדי לראות מחיר ליחידה${c.depositCents ? ' ולכלול את הפיקדון' : ''}.</p>`}
    ${rec ? `<div class="rec"><span>💡 מחיר מכירה מומלץ: <b>${num(money(rec.cents))}</b> ליח׳ <span>(רווח ${esc(prefs.markup)}%)</span></span></div>` : ''}
    <details class="more"><summary>איך זה מחושב?</summary>${pairs([
      ['מחיר לארגז, לפני מע״מ', money(c.priceCents)],
      c.discountBp ? [`הנחה ${percent(c.discountBp)}`, money(-r.discount), 'good'] : null,
      c.taxCents ? ['מס קנייה', money(c.taxCents)] : null,
      ['לפני מע״מ', money(round(r.beforeVat)), 'strong'],
      [`מע״מ ${vatText}`, money(round(r.vat))],
      r.unit && c.depositCents ? [`פיקדון (${c.units} × ${money(c.depositCents)})`, money(round(r.deposit))] : null,
      ['לארגז', money(round(r.crate)), 'strong'],
      r.unit ? [`ליחידה (חלקי ${c.units})`, money(round(r.unit.total)), 'strong'] : null,
    ])}</details>`;
}
function calcField(item, key, label, attrs) {
  return `<label class="field">${esc(label)}<input data-calc-f="${key}" data-calc="${item.id}" value="${esc(item[key])}" autocomplete="off" ${attrs}></label>`;
}
function renderCalc() {
  const dec = 'inputmode="decimal"';
  $('#calc-view').innerHTML = `
    <div class="screen-head"><h1>בדיקת מחיר</h1><p>בלי תעודה: ממלאים לפי אפליקציית ההזמנות של הספק. מחיר הארגז ומס הקנייה לפני מע״מ, ההנחה באחוזים, והפיקדון ליחידה (בדרך כלל 30 אג׳ או ₪1).</p></div>
    ${calcItems.map((item, i) => `<article class="sign-card calc-card" data-calc-card="${item.id}">
      <div class="sign-top"><span class="meta">מוצר ${i + 1}</span><button type="button" class="link" data-calc-remove="${item.id}">${calcItems.length > 1 ? 'הסרה' : 'ניקוי'}</button></div>
      ${calcField(item, 'name', 'שם המוצר (לא חובה)', 'maxlength="60" placeholder="למשל: קרלסברג חוזר 500"')}
      <div class="fields calc2">${calcField(item, 'price', 'מחיר לארגז לפני מע״מ (₪)', `${dec} placeholder="105.57"`)}${calcField(item, 'discount', 'הנחה (%)', `${dec} placeholder="0"`)}</div>
      <div class="fields calc3">${calcField(item, 'tax', 'מס קנייה לארגז (₪)', `${dec} placeholder="0"`)}${calcField(item, 'units', 'יח׳ בארגז (לא חובה)', 'inputmode="numeric" placeholder="24"')}${calcField(item, 'deposit', 'פיקדון ליח׳ (₪)', `${dec} placeholder="0.30"`)}</div>
      <div class="calc-result" id="calc-res-${item.id}">${calcResultHtml(item)}</div>
    </article>`).join('')}
    <p class="hint">מחושב עם מע״מ ${esc(percent(vatBpOf(prefs.vat) ?? 1800))}. אפשר לשנות בהגדרות.</p>`;
}

// ---------- products dialog ----------
function editProducts(id) {
  const sign = signById(id); state.editProducts = id;
  $('#product-options').innerHTML = state.doc.rows.map(r => `<label class="option"><input type="checkbox" value="${r.id}" ${sign.productIds.includes(r.id) ? 'checked' : ''}><span>${esc(r.name)}</span></label>`).join('');
  $('#save-products').disabled = !sign.productIds.length;
  $('#products-dialog').showModal();
}
$('#product-options').addEventListener('change', () => { $('#save-products').disabled = !$('#product-options input:checked'); });
$('#save-products').addEventListener('click', () => {
  const ids = [...$('#product-options').querySelectorAll('input:checked')].map(i => i.value);
  if (!ids.length) return;
  const sign = signById(state.editProducts);
  sign.productIds = ids; sign.touched = true; state.dirty = true;
  if (sign.autoTitle) sign.title = defaultTitle(ids);
  $('#products-dialog').close(); renderSigns();
});

// ---------- settings ----------
$('#settings-button').addEventListener('click', () => {
  $('#store-name').value = prefs.storeName; $('#default-markup').value = prefs.markup;
  for (const r of document.querySelectorAll('[name=rounding]')) r.checked = r.value === prefs.rounding;
  $('#calc-vat').value = prefs.vat; $('#calc-vat').setCustomValidity('');
  $('#default-markup').setCustomValidity('');
  $('#settings-dialog').showModal();
});
$('#default-markup').addEventListener('input', e => e.target.setCustomValidity(''));
$('#settings-form').addEventListener('submit', e => {
  e.preventDefault();
  const markup = decimal($('#default-markup').value), input = $('#default-markup');
  if (markupBp(markup) === null) { input.setCustomValidity('הרווח צריך להיות מספר בין 0 ל־1,000, בלי סימן %'); input.reportValidity(); return; }
  const vat = decimal($('#calc-vat').value) || '18', vatInput = $('#calc-vat');
  if (vatBpOf(vat) === null) { vatInput.setCustomValidity('המע״מ צריך להיות מספר בין 0 ל־100, בלי סימן %'); vatInput.reportValidity(); return; }
  prefs = {vat, storeName: $('#store-name').value.trim().slice(0, 45) || prefs.storeName, markup, rounding: document.querySelector('[name=rounding]:checked')?.value || 'ninety'};
  toast(store('coca-prefs-v2', prefs) ? `ההגדרות נשמרו · רווח ${markup}%` : 'הדפדפן לא מאפשר לשמור. ההגדרות בתוקף עד סגירת הדף');
  $('#settings-dialog').close();
  if (state.view === 'signs') renderSigns();
  if (state.view === 'calc') renderCalc();
});
$('#calc-vat').addEventListener('input', e => e.target.setCustomValidity(''));

// ---------- events ----------
$('#upload-button').addEventListener('click', pickFile);
$('#pdf-file').addEventListener('change', e => loadFile(e.target.files[0]));
for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', e => { if (e.target.closest('[data-close]')) d.close(); });
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  // Screens are redrawn after these buttons; keep keyboard focus on the same control.
  const again = b.dataset.pick ? `[data-pick="${b.dataset.pick}"]` : b.dataset.kind ? `[data-kind="${b.dataset.kind}"][data-sign="${b.dataset.sign}"]` : b.dataset.perPage ? `[data-per-page="${b.dataset.perPage}"]${b.hasAttribute('data-small') ? '[data-small]' : ':not([data-small])'}` : null;
  handleClick(b);
  if (again && !document.querySelector('dialog[open]') && (document.activeElement === document.body || !document.activeElement)) document.querySelector(again)?.focus({preventScroll: true});
});
function handleClick(b) {
  if (b.dataset.mode) { notice(''); show(b.dataset.mode === 'calc' ? 'calc' : state.docView, false, true); }
  if (b.dataset.calcAdd !== undefined) {
    calcItems.push(newCalc()); saveCalc(); renderCalc();
    const cards = document.querySelectorAll('[data-calc-card]'); cards[cards.length - 1].scrollIntoView({behavior: 'smooth', block: 'center'});
    cards[cards.length - 1].querySelector('[data-calc-f="price"]').focus({preventScroll: true});
  }
  if (b.dataset.calcRemove) {
    const i = calcItems.findIndex(c => c.id === b.dataset.calcRemove);
    if (calcItems.length > 1) calcItems.splice(i, 1); else calcItems = [newCalc()];
    saveCalc(); renderCalc();
    const cards = document.querySelectorAll('[data-calc-card]');
    cards[Math.min(i, cards.length - 1)]?.querySelector('[data-calc-remove]')?.focus({preventScroll: true});
  }
  if (b.dataset.action === 'upload') pickFile();
  if (b.dataset.go) {
    notice('');
    if (DEPTH[b.dataset.go] < DEPTH[state.view] && history.state?.coca === state.view) history.back(); else show(b.dataset.go);
  }
  if (b.dataset.pick) togglePick(b.dataset.pick);
  if (b.dataset.export) checked(b.dataset.export);
  if (b.dataset.perPage) { state.perPage = Number(b.dataset.perPage); state.small = b.hasAttribute('data-small'); state.dirty = true; renderSigns(); }
  if (b.dataset.editProducts) editProducts(b.dataset.editProducts);
  const sign = signById(b.dataset.sign || b.dataset.apply);
  if (!sign) return;
  if (b.dataset.kind && b.dataset.kind !== sign.kind) {
    // A unit price must never silently become a bundle total (or back).
    sign.kind = b.dataset.kind; sign.price = ''; sign.oldPrice = ''; sign.touched = true; state.dirty = true; renderSigns();
  }
  if (b.dataset.titleFrom) { sign.title = rowById(b.dataset.titleFrom).name; sign.autoTitle = false; sign.touched = true; state.dirty = true; $(`[data-editor="${sign.id}"] [data-f="title"]`).value = sign.title; schedulePreview(); }
  if (b.dataset.apply) {
    const r = recommendation(sign);
    if (r.missing) return;
    if (r.type === 'pct') sign.pct = String(r.value); else sign.price = (r.cents / 100).toFixed(2);
    sign.touched = true; state.dirty = true; renderSigns();
  }
}
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.units !== undefined) {
    setUnits(el.dataset.units, el.value);
    for (const s of state.signs) if (signRows(s).some(r => r.code === el.dataset.units)) refreshSign(s);
    return;
  }
  if (el.dataset.calcF) {
    const item = calcItems.find(c => c.id === el.dataset.calc); if (!item) return;
    item[el.dataset.calcF] = el.value; saveCalc();
    $('#calc-res-' + item.id).innerHTML = calcResultHtml(item);
    return;
  }
  const sign = signById(el.dataset.sign); if (!sign || !el.dataset.f) return;
  sign[el.dataset.f] = el.value; sign.touched = true; state.dirty = true;
  if (el.type === 'date') el.classList.toggle('empty', !el.value);
  if (el.dataset.f === 'title') sign.autoTitle = false;
  refreshSign(sign); schedulePreview();
});
// Units typed by the user update the prices once the field is left (or Enter).
document.addEventListener('change', e => {
  const code = e.target.dataset.units;
  if (code === undefined) return;
  if (state.view === 'document') refreshRows(code);
  if (state.view === 'signs') {
    const s = signById(e.target.closest('[data-editor]')?.dataset.editor);
    if (s) { $('#rec-' + s.id).innerHTML = recHtml(s); $('#profit-' + s.id).innerHTML = profitHtml(s); }
  }
});
window.addEventListener('popstate', e => {
  if (e.state?.coca && e.state.page !== PAGE) { history.back(); return; }
  if (state.busy || !state.doc) return;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  notice(''); show(e.state?.coca || 'document', true);
});
window.addEventListener('beforeunload', e => { if (state.signs.length && state.dirty) { e.preventDefault(); e.returnValue = ''; } });
// A phone may reload the page while the user checks prices in the supplier's app.
let startCalc = false;
try { startCalc = sessionStorage.getItem('coca-mode') === 'calc'; } catch {}
show(startCalc ? 'calc' : 'upload');
