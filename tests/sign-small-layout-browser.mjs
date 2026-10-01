// "2 בדף (קטן)" (version 2.3) in a real browser: the app as published, with a
// synthetic document in place of the PDF reader.
// Asked for: printing like "2 בדף (גדול)", only smaller, with white margins.
// Checks:
// - four layout buttons, 4 / 2 small / 2 big / 1, in their own row under the
//   preview heading, without horizontal scrolling at 360–430px; exactly one is on.
// - "2 בדף (קטן)" stays A4 portrait (1240×1754) and is all white outside the
//   centred 88% box, while the red frames of "2 בדף (גדול)" reach into that band.
// - every small page is the big page scaled to 88% around the A4 centre: same
//   title, price, barcodes and line breaks (pixels against the big page scaled
//   as an image; a 2px shift and a 0.89 scale must fail the same comparison).
// - several pages (3 signs on 2 per page) and the cut guide of a single sign
//   are scaled the same way.
// - "שתף / שמור תמונה" and "הדפסה" hand over exactly the small pages, and the
//   browser prints them one A4 sheet each.
// - typing, redraws and going back to the picking screen keep the small layout;
//   4, 2 big and 1 per page clear it and draw exactly what they drew before.
// Run: node tests/sign-small-layout-browser.mjs (Playwright + Chromium; COCA_CHROMIUM optional)
// COCA_APP_DIR runs it against another copy of the app (default: this repository).
// Images: COCA_SCREENSHOT_DIR (default: <OS temp>/coca-sign-layouts), e.g. 2big.png, 2small.png.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {parsePages} from '../pdf-reader.js';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const appDir = path.resolve(process.env.COCA_APP_DIR || fileURLToPath(new URL('..', import.meta.url)));
const shots = process.env.COCA_SCREENSHOT_DIR || path.join(os.tmpdir(), 'coca-sign-layouts');
fs.mkdirSync(shots, {recursive: true});

// The small page: 88% of the A4, centred (each sign about 17.3×12.3 cm).
const K = 0.88, W = 1240, H = 1754;
const OX = Math.round(W * (1 - K) / 2), OY = Math.round(H * (1 - K) / 2);
const BOX = {x0: OX, y0: OY, x1: OX + Math.round(W * K), y1: OY + Math.round(H * K)};
const TOL = 2;
// The small page is drawn as vectors at 0.88; the reference is the big page
// scaled as an image (bilinear). They differ only in the anti-aliasing of text
// and lines. Measured in Chromium 141 (Playwright 1.56), mean difference per
// channel: 0.6–1.3 over the page and 7.4–8.7 over ink pixels; a 2px shift
// gives 4.2–8.9 / 44–52 and a 0.89 scale 6.2–11.8 / 61–65. The limits sit in
// between, and the test proves on every page that both negative controls fail them.
const MEAN_DIFF_MAX = 2.5, INK_DIFF_MAX = 15;

// ---------- a synthetic document (no supplier or customer data) ----------
// Columns as in tests/parser.test.mjs: settlement table, supply table with
// barcodes, and one supplier promotion over three products.
const PRODUCTS = [
  {code: '10001', barcode: '7290000000018', name: 'משקה קולה 1.5 ליטר', promo: true},
  {code: '10002', barcode: '7290000000025', name: 'משקה קולה זירו 1.5 ליטר', promo: true},
  {code: '10003', barcode: '7290000000032', name: 'משקה לימון 1.5 ליטר', promo: true},
  {code: '10004', barcode: '7290000000049', name: 'תה קר אפרסק 1.5 ליטר', promo: false},
  {code: '10005', barcode: '7290000000056', name: 'סודה 1.5 ליטר', promo: false},
];
function syntheticPages() {
  const items = [], add = (str, x, y, w = 10) => items.push({str, x, y, w, h: 8});
  // Supply table: barcode, code, name and delivered quantity (2 cases each).
  add('מ פ ר ט', 313, 760, 20); add('א ס פ ק ה', 274, 760, 30);
  for (const [str, x, y, w] of [["מס' ברקוד", 528, 747, 34], ['קוד', 459, 747, 12], ['סה"כ', 251, 747, 18], ['כמות', 178, 747, 17], ['כמות', 104, 747, 17], ['שם המוצר', 394, 742, 33], ['מוצר', 455, 738, 15], ['כמות', 252, 738, 17], ['מוזמנת', 171, 738, 24], ['בהטבה', 97, 738, 24]]) add(str, x, y, w);
  PRODUCTS.forEach((p, i) => { const y = 720 - 12 * i; add(p.barcode, 503, y, 58); add(p.code, 447, y, 22); add(p.name, 330, y, 60); add('2', 263, y, 5); add('2', 189, y, 5); add('0', 115, y, 5); });
  add('סה"כ:', 339, 640, 20); add(String(2 * PRODUCTS.length), 263, 640, 5);
  // Settlement table with the promotion column.
  for (const [str, x, y] of [['מחיר', 50, 450], ['פיקדון', 90, 450], ['מס קניה', 130, 450], ['ערך אריזה', 170, 450], ['ערך', 215, 455], ['הנחה', 215, 445], ['אחוז', 250, 455], ['הנחה', 250, 445], ['סה"כ', 290, 450], ['מחיר', 330, 455], ['ליחידה', 330, 445], ['כמות', 365, 450], ['שם מוצר', 490, 450], ['קוד', 540, 455], ['מוצר', 540, 445]]) add(str, x, y);
  add("מס'", 576, 455, 12); add('מבצע', 570, 445, 18);
  PRODUCTS.forEach((p, i) => {
    const y = 425 - 15 * i;
    // 2 cases × ₪50.00; promotion rows 20% off; purchase tax ₪10.00; deposit ₪12.20 (24 bottles a case).
    for (const [str, x] of [[p.promo ? '102.20' : '122.20', 50], ['12.20', 90], ['10.00', 130], ['0.00', 170], [p.promo ? '20.00-' : '0.00', 215], [p.promo ? '20.0' : '0.0', 250], ['100.00', 290], ['50.00', 330], ['2', 365], [p.name, 410], [p.code, 540], [p.promo ? '0000777001' : '000000', 562]]) add(str, x, y);
  });
  add('סה"כ:', 420, 425 - 15 * PRODUCTS.length);
  add('פ י ר ו ט', 300, 300, 40); add('ה מ ב צ ע י ם', 250, 300, 40);
  add("מס' מבצע", 557, 280, 32); add('תיאור המבצע', 472, 280, 44);
  add('0000777001', 543, 262, 44); add('קנה 2 שתייה 1.5 ליטר גמיש20%', 420, 262, 94);
  const summary = [];
  let y = 500;
  for (const [label, value] of [['חיוב בגין מכירה', '500.00'], ['חיוב בגין אריזות', '0.00'], ['חיוב בגין חוק הפיקדון', '61.00'], ['הנחות בחשבונית', '60.00-'], ['מס קניה', '50.00'], ['הפרשי עיגול', '0.00'], ['סה"כ חיוב לפני מע"מ', '551.00'], ['%18.0 מע"מ', '99.18'], ['סה"כ כולל מע"מ', '650.18']]) { summary.push({str: label, x: 520, y, w: 60, h: 8}, {str: value, x: 410, y, w: 40, h: 8}); y -= 18; }
  return [{items, width: 612, height: 792}, {items: summary, width: 612, height: 792}];
}
const doc = parsePages(syntheticPages());
assert.equal(doc.validation.ok, true);
assert.deepEqual(doc.rows.map(r => r.barcode), PRODUCTS.map(p => p.barcode));
assert.deepEqual(doc.promos.map(p => p.id), ['777001']);

// ---------- the app, served as published ----------
// Only the PDF reader is replaced (it returns the document above), and app.js
// gets one appended line that lets the test read the layout state.
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'};
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html');
  res.setHeader('Cache-Control', 'no-store');
  if (name === '/pdf-reader.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end('const DOC = ' + JSON.stringify(doc) + ';\nexport async function readPdf() { return structuredClone(DOC); }\n'); }
  const file = path.join(appDir, name);
  if (!file.startsWith(appDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  let body = fs.readFileSync(file);
  if (name === '/app.js') body = body + '\nwindow.__coca = {state: () => ({view: state.view, perPage: state.perPage, small: !!state.small, signs: state.signs.length, pages: state.pages.length})};\n';
  res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/';
const browser = await chromium.launch({headless: true, executablePath: process.env.COCA_CHROMIUM, args: ['--no-sandbox']});
const errors = [], external = [];
const context = await browser.newContext({viewport: {width: 360, height: 800}, serviceWorkers: 'block', locale: 'he-IL', timezoneId: 'Asia/Jerusalem'});
await context.route('**/*', route => { const u = route.request().url(); if (u.startsWith(url) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue(); external.push(u); return route.abort(); });
// Share and print are captured instead of opening the system dialogs.
await context.addInitScript(() => {
  const dataUrl = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
  window.__out = {shared: null, printed: null};
  navigator.canShare = () => true;
  navigator.share = async ({files}) => { window.__out.shared = await Promise.all(files.map(async f => ({name: f.name, type: f.type, url: await dataUrl(f)}))); };
  window.print = () => { window.__out.printed = {imgs: [...document.querySelectorAll('#print-root img')].map(i => i.src), printClass: document.body.classList.contains('print-signs')}; };
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));

const state = () => page.evaluate(() => window.__coca.state());
const settle = () => page.evaluate(() => new Promise(r => setTimeout(() => requestAnimationFrame(() => r()), 250)));
const LAYOUT = [
  {label: '4 בדף', pp: '4', small: false},
  {label: '2 בדף (קטן)', pp: '2', small: true},
  {label: '2 בדף (גדול)', pp: '2', small: false},
  {label: '1 בדף (רוחב)', pp: '1', small: false},
];
const [L4, L2S, L2B, L1] = [0, 1, 2, 3];
const layoutBtn = i => page.locator('.preview-head [data-per-page="' + LAYOUT[i].pp + '"]' + (LAYOUT[i].small ? '[data-small]' : ':not([data-small])'));
const expectedIndex = s => s.perPage === 4 ? L4 : s.perPage === 1 ? L1 : s.small ? L2S : L2B;
async function choose(i) { await layoutBtn(i).click(); await settle(); }

// Four buttons in order, exactly one on (class and aria-pressed), matching the state.
async function assertButtons(expect, why) {
  const btns = await page.$$eval('#signs-view [data-per-page]', bs => bs.map(b => ({label: b.textContent.trim(), pp: b.dataset.perPage, small: b.hasAttribute('data-small'),
    on: b.classList.contains('on'), pressed: b.getAttribute('aria-pressed'), row: b.parentElement.className, head: b.parentElement.previousElementSibling?.textContent.trim()})));
  assert.deepEqual(btns.map(b => ({label: b.label, pp: b.pp, small: b.small})), LAYOUT, why + ': four layout buttons in order');
  assert.ok(btns.every(b => b.row === 'seg small' && b.head === 'תצוגה מקדימה'), why + ': the buttons sit in the preview heading');
  const on = btns.map((b, i) => b.on ? i : -1).filter(i => i >= 0);
  assert.deepEqual(on, [expect], why + ': exactly one button on, ' + LAYOUT[expect].label + ' (got ' + on.map(i => LAYOUT[i].label).join(',') + ')');
  assert.deepEqual(btns.map(b => b.pressed), btns.map((_, i) => String(i === expect)), why + ': aria-pressed');
  const s = await state();
  assert.equal(expectedIndex(s), expect, why + ': the button matches the state ' + JSON.stringify(s));
}

// Pixel tools inside the page; they never touch the app module.
async function installPixelTools() {
  await page.evaluate(() => {
    const shots = {};
    const copy = cv => { const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(cv, 0, 0); return c; };
    const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const isRed = (d, i) => d[i] >= 180 && d[i + 1] <= 100 && d[i + 2] <= 130;
    const canvases = () => [...document.querySelectorAll('#preview-pages canvas')];
    const decode = src => new Promise((ok, fail) => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); ok(c); }; img.onerror = fail; img.src = src; });
    const same = (a, b) => { if (a.width !== b.width || a.height !== b.height) return false; const x = pixels(a), y = pixels(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
    window.px = {
      grab(name) { const cs = canvases(); cs.forEach((cv, i) => { shots[name + '#' + i] = copy(cv); }); return cs.map(cv => ({w: cv.width, h: cv.height})); },
      url(key) { return shots[key].toDataURL('image/png'); },
      sameAs(name) { const cs = canvases(); return cs.length > 0 && cs.every((cv, i) => shots[name + '#' + i] && same(cv, shots[name + '#' + i])) && !shots[name + '#' + cs.length]; },
      // Images handed to share or print, pixel for pixel against the preview pages.
      async matches(srcs) { const cs = canvases(); if (srcs.length !== cs.length) return 'count ' + srcs.length + ' vs ' + cs.length; for (let i = 0; i < cs.length; i++) { const c = await decode(srcs[i]); if (!same(c, cs[i])) return 'page ' + (i + 1) + ' differs (' + c.width + '×' + c.height + ')'; } return 'same'; },
      // Pixels that are not pure white outside the box (and inside it), and how many of them are red.
      outside(key, box) {
        const c = shots[key], d = pixels(c); let out = 0, outRed = 0, inside = 0, first = null;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255 && d[i + 3] === 255) continue;
          if (x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1) { inside++; continue; }
          out++; if (isRed(d, i)) outRed++; if (!first) first = {x, y, rgba: [d[i], d[i + 1], d[i + 2], d[i + 3]]};
        }
        return {out, outRed, inside, first};
      },
      redBox(key) {
        const c = shots[key], d = pixels(c); let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, n = 0;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          if (!isRed(d, (y * c.width + x) * 4)) continue;
          n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        return {x0, y0, x1, y1, n};
      },
      // The big page scaled as an image with the same translate+scale, against the small page.
      compare(smallKey, bigKey, k, ox, oy) {
        const s = shots[smallKey], b = shots[bigKey];
        const ref = document.createElement('canvas'); ref.width = s.width; ref.height = s.height;
        const ctx = ref.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, ref.width, ref.height);
        ctx.translate(ox, oy); ctx.scale(k, k); ctx.drawImage(b, 0, 0);
        // mean: per channel over the page; inkMean: only where either image is not white
        const a = pixels(s), r = pixels(ref); let sum = 0, ink = 0, inkSum = 0;
        for (let i = 0; i < a.length; i += 4) {
          const diff = Math.abs(a[i] - r[i]) + Math.abs(a[i + 1] - r[i + 1]) + Math.abs(a[i + 2] - r[i + 2]);
          sum += diff;
          if (!(a[i] + a[i + 1] + a[i + 2] === 765 && r[i] + r[i + 1] + r[i + 2] === 765)) { ink++; inkSum += diff; }
        }
        return {mean: sum / (a.length / 4 * 3), inkMean: inkSum / (ink * 3), ink};
      },
    };
  });
}
const grab = name => page.evaluate(n => px.grab(n), name);
const save = (key, file) => page.evaluate(k => px.url(k), key).then(u => fs.writeFileSync(path.join(shots, file + '.png'), Buffer.from(u.split(',')[1], 'base64')));
const sameAs = name => page.evaluate(n => px.sameAs(n), name);
const tolBox = {x0: BOX.x0 - TOL, y0: BOX.y0 - TOL, x1: BOX.x1 + TOL, y1: BOX.y1 + TOL};
// Small pages: A4 portrait, pure white outside the 88% box (2px tolerance), signs inside.
async function assertSmallPages(name, count, why) {
  const sizes = await grab(name);
  assert.deepEqual(sizes, Array(count).fill({w: W, h: H}), why + ': ' + count + ' small page(s), A4 portrait');
  for (let i = 0; i < count; i++) {
    const o = await page.evaluate(([k, b]) => px.outside(k, b), [name + '#' + i, tolBox]);
    assert.equal(o.out, 0, why + ', page ' + (i + 1) + ': non-white pixel outside the centred ' + K * 100 + '% box: ' + JSON.stringify(o.first));
    assert.ok(o.inside > 10000, why + ', page ' + (i + 1) + ': the signs are drawn inside the box');
  }
}
// Other layouts: the red frame reaches into the margin band.
async function assertMarginsUsed(name, size, count, why) {
  const sizes = await grab(name);
  assert.deepEqual(sizes, Array(count).fill(size), why + ': page count and size');
  for (let i = 0; i < count; i++) {
    const o = await page.evaluate(([k, b]) => px.outside(k, b), [name + '#' + i, tolBox]);
    assert.ok(o.out > 1000 && o.outRed > 1000, why + ', page ' + (i + 1) + ': the red frame reaches into the margin band (' + JSON.stringify(o) + ')');
  }
}
// Each small page against the same big page scaled as an image, with the negative controls.
async function assertScaled(smallName, bigName, count, why) {
  const fmt = r => 'mean ' + r.mean.toFixed(3) + '/ch, ink ' + r.inkMean.toFixed(2) + '/ch';
  for (let i = 0; i < count; i++) {
    const compare = (k, dx) => page.evaluate(([s, b, k, dx]) => px.compare(s, b, k, Math.round(1240 * (1 - k) / 2) + dx, Math.round(1754 * (1 - k) / 2) + dx), [smallName + '#' + i, bigName + '#' + i, k, dx]);
    const cmp = await compare(K, 0), shifted = await compare(K, 2), rescaled = await compare(0.89, 0);
    console.log(why + ', page ' + (i + 1) + ': small vs big scaled as an image: ' + fmt(cmp) + ' over ' + cmp.ink + ' ink px | shifted 2px: ' + fmt(shifted) + ' | scale 0.89: ' + fmt(rescaled));
    assert.ok(cmp.mean < MEAN_DIFF_MAX && cmp.inkMean < INK_DIFF_MAX, why + ', page ' + (i + 1) + ': the small page is the big page scaled (' + fmt(cmp) + ')');
    assert.ok(shifted.mean > MEAN_DIFF_MAX && shifted.inkMean > INK_DIFF_MAX, why + ', page ' + (i + 1) + ': the comparison catches a 2px shift (' + fmt(shifted) + ')');
    assert.ok(rescaled.mean > MEAN_DIFF_MAX && rescaled.inkMean > INK_DIFF_MAX, why + ', page ' + (i + 1) + ': the comparison catches a 0.89 scale (' + fmt(rescaled) + ')');
    const bigRed = await page.evaluate(k => px.redBox(k), bigName + '#' + i), smallRed = await page.evaluate(k => px.redBox(k), smallName + '#' + i);
    const expectRed = {x0: OX + K * bigRed.x0, y0: OY + K * bigRed.y0, x1: OX + K * (bigRed.x1 + 1) - 1, y1: OY + K * (bigRed.y1 + 1) - 1};
    for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Math.abs(smallRed[k] - expectRed[k]) <= 3, why + ', page ' + (i + 1) + ': red frame ' + k + ': ' + smallRed[k] + ' vs ' + expectRed[k].toFixed(1));
    assert.ok(bigRed.x0 < BOX.x0 - TOL && bigRed.y0 < BOX.y0 - TOL && bigRed.x1 >= BOX.x1 + TOL, why + ', page ' + (i + 1) + ': the big frame reaches the margin band: ' + JSON.stringify(bigRed));
  }
}
// Share and print: the files handed over are exactly the preview pages.
async function assertExports(count, why) {
  await page.evaluate(() => { window.__out.shared = null; window.__out.printed = null; });
  await page.locator('#action-bar [data-export="share"]').click();
  await page.waitForFunction(() => window.__out.shared || document.querySelector('dialog[open]'));
  assert.equal(await page.locator('dialog[open]').count(), 0, why + ': no warning before sharing: ' + await page.locator('dialog[open]').allTextContents());
  const shared = await page.evaluate(() => window.__out.shared);
  assert.equal(shared.length, count, why + ': shared files');
  assert.ok(shared.every((f, i) => f.type === 'image/png' && f.name.endsWith((count > 1 ? '-' + (i + 1) : '') + '.png')), why + ': PNG names ' + shared.map(f => f.name));
  assert.equal(await page.evaluate(s => px.matches(s), shared.map(f => f.url)), 'same', why + ': shared PNGs are the preview pages');
  await page.locator('#action-bar [data-export="print"]').click();
  await page.waitForFunction(() => window.__out.printed || document.querySelector('dialog[open]'));
  const printed = await page.evaluate(() => window.__out.printed);
  assert.ok(printed && printed.printClass, why + ': print mode on when printing');
  assert.equal(await page.evaluate(s => px.matches(s), printed.imgs), 'same', why + ': printed images are the preview pages');
  // Print stylesheet: only the sign images, one per sheet, fitted to the page.
  await page.emulateMedia({media: 'print'});
  const sheet = await page.evaluate(() => ({root: getComputedStyle(document.getElementById('print-root')).display, main: getComputedStyle(document.querySelector('main')).display,
    imgs: [...document.querySelectorAll('#print-root img')].map(i => ({fit: getComputedStyle(i).objectFit, w: i.naturalWidth, h: i.naturalHeight}))}));
  assert.deepEqual(sheet, {root: 'block', main: 'none', imgs: Array(count).fill({fit: 'contain', w: W, h: H})}, why + ': print sheet');
  // The browser's own print to PDF: one A4 sheet per sign page, nothing else.
  const pdf = (await page.pdf({preferCSSPageSize: true})).toString('latin1');
  const sheets = pdf.match(/\/MediaBox\s*\[[^\]]*\]/g) || [];
  assert.equal((pdf.match(/\/Type\s*\/Page\b/g) || []).length, count, why + ': printed sheets');
  assert.ok(sheets.length === count && sheets.every(b => /\[0 0 59[45](\.\d+)? 84[12](\.\d+)?\]/.test(b)), why + ': A4 sheets ' + sheets);
  await page.emulateMedia({media: null});
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
}

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__coca);
  await installPixelTools();
  await page.setInputFiles('#pdf-file', {name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic')});
  await page.waitForFunction(() => window.__coca.state().view === 'document');
  await page.locator('#action-bar [data-go="pick"]').click();
  await page.locator('[data-pick="promo:777001"]').click();
  await page.locator('[data-pick="row:r3"]').click();
  await page.locator('#action-bar [data-go="signs"]').click();
  await page.waitForFunction(() => window.__coca.state().view === 'signs');
  await page.evaluate(() => document.fonts.ready.then(() => true));
  // Two signs: the three-product promotion (three barcodes) and one product.
  const fill = async (n, f, v) => page.locator('[data-editor]').nth(n).locator('[data-f="' + f + '"]').fill(v);
  await fill(0, 'title', 'שתייה קלה 1.5 ליטר');
  for (const [n, price, old] of [[0, '9.90', '12.90'], [1, '7.90', '']]) { await fill(n, 'price', price); if (old) await fill(n, 'oldPrice', old); await fill(n, 'validUntil', '2026-10-31'); }
  await settle();
  let s = await state();
  assert.deepEqual(s, {view: 'signs', perPage: 4, small: false, signs: 2, pages: 1});

  // [1] Four buttons in their own row: no horizontal scrolling at 360–430px, one line each.
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({width, height: 800});
    const lay = await page.evaluate(() => {
      const head = document.querySelector('.preview-head'), h2 = head.querySelector('h2'), seg = head.querySelector('.seg'), r = e => e.getBoundingClientRect();
      return {scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, below: r(seg).top >= r(h2).bottom, inside: r(seg).left >= r(head).left - 0.5 && r(seg).right <= r(head).right + 0.5,
        buttons: [...seg.children].map(b => ({h: Math.round(r(b).height), clip: b.scrollWidth > b.clientWidth}))};
    });
    assert.deepEqual(lay, {scroll: 0, below: true, inside: true, buttons: Array(4).fill({h: 40, clip: false})}, 'button row at ' + width + 'px');
  }
  await page.setViewportSize({width: 360, height: 800});
  await assertButtons(L4, 'start');
  await assertMarginsUsed('4', {w: W, h: H}, 1, '4 per page');
  await save('4#0', '4');

  await choose(L2B);
  await assertButtons(L2B, '2 big');
  await assertMarginsUsed('2big', {w: W, h: H}, 1, '2 big');
  await save('2big#0', '2big');

  // [2] "2 בדף (קטן)": A4 portrait, white margins, the big page scaled to 88%.
  await choose(L2S);
  s = await state(); assert.equal(s.perPage, 2); assert.equal(s.small, true);
  await assertButtons(L2S, '2 small');
  await assertSmallPages('2small', 1, '2 small');
  await save('2small#0', '2small');
  await assertScaled('2small', '2big', 1, '2 small');
  await assertExports(1, '2 small');

  // [3] Typing, a redraw of the editors and going back to the picking screen keep the small layout.
  await fill(1, 'note', 'עד גמר המלאי'); await settle();
  assert.equal(await sameAs('2small'), false, 'the note is drawn');
  await fill(1, 'note', ''); await settle();
  await assertButtons(L2S, 'after typing');
  assert.ok(await sameAs('2small'), 'typing redraws the same small page');
  await page.locator('[data-editor]').nth(1).locator('[data-kind="pct"]').click();
  await page.locator('[data-editor]').nth(1).locator('[data-kind="unit"]').click();
  await fill(1, 'price', '7.90'); await settle();
  await assertButtons(L2S, 'after redrawing the editors');
  assert.ok(await sameAs('2small'), 'redrawing the editors draws the same small page');
  await page.locator('#action-bar [data-go="pick"]').click();
  await page.waitForFunction(() => window.__coca.state().view === 'pick');
  await page.locator('#action-bar [data-go="signs"]').click(); await settle();
  await assertButtons(L2S, 'back to the signs');
  assert.ok(await sameAs('2small'), 'back to the signs draws the same small page');

  // [4] Several pages: three signs on 2 per page are two pages (2 + 1, no cut guide), all small.
  await page.locator('#action-bar [data-go="pick"]').click();
  await page.locator('[data-pick="row:r4"]').click();
  await page.locator('#action-bar [data-go="signs"]').click();
  await fill(2, 'price', '6.90'); await fill(2, 'validUntil', '2026-10-31'); await settle();
  s = await state(); assert.deepEqual([s.signs, s.pages, s.perPage, s.small], [3, 2, 2, true]);
  await assertButtons(L2S, 'three signs');
  await assertSmallPages('3small', 2, 'three signs, small');
  await save('3small#0', '2small-page1'); await save('3small#1', '2small-page2');
  await choose(L4);
  await assertMarginsUsed('3four', {w: W, h: H}, 1, 'three signs, 4 per page');
  await choose(L2B);
  await assertButtons(L2B, 'three signs, big');
  await assertMarginsUsed('3big', {w: W, h: H}, 2, 'three signs, big');
  await save('3big#0', '2big-page1'); await save('3big#1', '2big-page2');
  await choose(L2S);
  assert.ok(await sameAs('3small'), 'back to small draws the same small pages');
  await assertScaled('3small', '3big', 2, 'three signs');
  await assertExports(2, 'three signs, small');

  // [5] Every other button clears the small layout and draws what it drew before.
  await choose(L2B);
  s = await state(); assert.equal(s.small, false);
  await assertButtons(L2B, 'small -> 2 big');
  assert.ok(await sameAs('3big'), 'small -> 2 big draws the original big pages');
  await choose(L2S); await choose(L4);
  s = await state(); assert.deepEqual([s.perPage, s.small], [4, false]);
  await assertButtons(L4, 'small -> 4');
  assert.ok(await sameAs('3four'), 'small -> 4 draws the original 4 page');
  await choose(L2S); await choose(L1);
  s = await state(); assert.deepEqual([s.perPage, s.small, s.pages], [1, false, 3]);
  await assertButtons(L1, 'small -> 1');
  await assertMarginsUsed('3one', {w: H, h: W}, 3, 'small -> 1 (landscape)');
  await save('3one#0', '1');

  // [6] One sign: the dashed cut guide of the empty slot is scaled with it.
  await page.locator('#action-bar [data-go="pick"]').click();
  // Both signs have typed prices, so removing each one asks first.
  for (const id of ['row:r3', 'row:r4']) { await page.locator('[data-pick="' + id + '"]').click(); await page.locator('#confirm-ok').click(); }
  await page.locator('#action-bar [data-go="signs"]').click(); await settle();
  s = await state(); assert.deepEqual([s.signs, s.perPage, s.small], [1, 1, false]);
  await choose(L2B);
  await assertMarginsUsed('1big', {w: W, h: H}, 1, 'one sign, big');
  await choose(L2S);
  await assertButtons(L2S, 'one sign, small');
  await assertSmallPages('1small', 1, 'one sign, small');
  const guide = await page.evaluate(() => { const c = document.querySelector('#preview-pages canvas'), d = c.getContext('2d').getImageData(0, 1754 / 2, c.width, 1754 / 2).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 226 && d[i + 1] === 232 && d[i + 2] === 240) n++; return n; });
  assert.ok(guide > 500, 'the cut guide is drawn on the small page (' + guide + ' px)');
  await assertScaled('1small', '1big', 1, 'one sign with a cut guide');
  await save('1small#0', '2small-one-sign');

  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('sign small layout: all checks passed — images in ' + shots);
} finally { await browser.close(); server.close(); }
