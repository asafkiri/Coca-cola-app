// All document amounts are integer agorot. Keep fractional unit costs as
// rational BigInts until final display; never multiply rounded crate prices.
export function fixed(value, places = 2) {
  let s = String(value ?? '').trim().replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  if (/^\d[\d,]*(?:\.\d+)?-$/.test(s)) s = '-' + s.slice(0, -1);
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)) throw new Error('מספר חסר או לא תקין: ' + s);
  s = s.replaceAll(',', '');
  const sign = s.startsWith('-') ? -1 : 1;
  const [whole, fraction = ''] = s.replace('-', '').split('.');
  if (fraction.length > places) throw new Error('דיוק מספרי לא נתמך: ' + s);
  const n = sign * (Number(whole) * 10 ** places + Number(fraction.padEnd(places, '0')));
  if (!Number.isSafeInteger(n)) throw new Error('מספר גדול מדי');
  return n;
}
export function fraction(n, d = 1) {
  const r = {n: BigInt(n), d: BigInt(d)};
  if (r.d <= 0n) throw new Error('מחלק חייב להיות חיובי');
  return r;
}
export function round(r) {
  const sign = r.n < 0n ? -1n : 1n;
  const a = r.n * sign;
  const n = sign * ((a * 2n + r.d) / (2n * r.d));
  const v = Number(n);
  if (!Number.isSafeInteger(v)) throw new Error('תוצאה גדולה מדי');
  return v;
}
export function ceil(r) {
  if (r.n < 0n) throw new Error('מחיר לא יכול להיות שלילי');
  return Number((r.n + r.d - 1n) / r.d);
}
const amountFormat = new Intl.NumberFormat('he-IL', {minimumFractionDigits:2, maximumFractionDigits:2});
// ₪ before the number, like the other apps: ₪1,234.50 / −₪75.19.
export function money(cents) {
  return (cents < 0 ? '−' : '') + '₪' + amountFormat.format(Math.abs(cents) / 100);
}
export function percent(bp) {
  return new Intl.NumberFormat('he-IL', {maximumFractionDigits:2}).format(bp / 100) + '%';
}
export function gross(cents, vatBp) { return fraction(BigInt(cents) * BigInt(10000 + vatBp), 10000); }
export function crateCost(row, vatBp) {
  return fraction(BigInt(row.total) * BigInt(10000 + vatBp) * 1000n, 10000n * BigInt(row.quantityMilli));
}
// Deposit law: 30 agorot per container including VAT; the document prints it
// before VAT. The count is only suggested when it reproduces the printed
// deposit to the agora, so a changed deposit rate falls back to asking.
export const DEPOSIT_PER_CONTAINER = 30;
export function unitsFromDeposit(row, vatBp) {
  if (!Number.isSafeInteger(row.deposit) || row.deposit <= 0 || !(row.quantityMilli > 0) || !Number.isInteger(vatBp)) return null;
  const vat = BigInt(10000 + vatBp), qty = BigInt(row.quantityMilli), rate = BigInt(DEPOSIT_PER_CONTAINER);
  const units = round(fraction(BigInt(row.deposit) * vat * 1000n, rate * 10000n * qty));
  if (units < 1 || units > 1000) return null;
  const printed = round(fraction(qty * BigInt(units) * rate * 10000n, 1000n * vat));
  if (Math.abs(printed - row.deposit) > 1) return null;
  // "6 בק" / "6 פח": a case holds whole multipacks.
  const pack = packSize(row.name);
  if (pack > 1 && units % pack !== 0) return null;
  return units;
}
// Containers in a multipack named like "קרלסברג 6 בק" or "ZERO 6 פח"; 1 otherwise.
export function packSize(name) {
  const m = String(name || '').match(/(?:^|\s)(\d{1,2})\s*(?:בק|פח)(?=\s|$)/);
  return m && Number(m[1]) > 1 ? Number(m[1]) : 1;
}
// Returnable crates and bottles ("ערך אריזה") are refunded when they go back
// to the supplier, so prices and recommendations leave them out; the app shows
// them separately. The invoice itself is validated with them included.
export function priceBasis(row) {
  return row.packaging ? {...row, total: row.total - row.packaging, packaging: 0} : row;
}
export function unitParts(row, vatBp, units) {
  if (!Number.isInteger(units) || units <= 0 || units > 10000) throw new Error('יש להזין מספר בקבוקים שלם וחיובי');
  const denom = 10000n * BigInt(row.quantityMilli) * BigInt(units);
  const factor = BigInt(10000 + vatBp) * 1000n;
  // Packaging and deposit pass through once, without markup. Purchase tax
  // remains in the merchandise cost. Both are already in the row total.
  const pass = row.deposit + row.packaging;
  return {base: fraction(BigInt(row.total - pass) * factor, denom), pass: fraction(BigInt(pass) * factor, denom), total: fraction(BigInt(row.total) * factor, denom)};
}
export function recommend(row, vatBp, units, markupBp, quantity = 1, rounding = 'exact') {
  if (!Number.isInteger(markupBp) || markupBp < 0 || markupBp > 100000) throw new Error('אחוז הרווח חייב להיות בין 0 ל־1,000');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new Error('כמות המבצע חייבת להיות מספר שלם וחיובי');
  return recommendParts(unitParts(row, vatBp, units), markupBp, quantity, rounding);
}
// Markup on base (merchandise + purchase tax, incl. VAT); pass (deposit) is
// added once. base and pass share one denominator.
export function recommendParts(p, markupBp, quantity = 1, rounding = 'exact') {
  const raw = fraction((p.base.n * BigInt(10000 + markupBp) + p.pass.n * 10000n) * BigInt(quantity), p.base.d * 10000n);
  let cents = ceil(raw); // never recommend below the requested markup
  if (rounding === 'ninety') {
    const target = Math.floor(cents / 100) * 100 + 90;
    cents = cents <= target ? target : target + 100;
  }
  return {cents, parts:p};
}
// Price check without an invoice, from what the supplier's ordering app shows:
// case price and purchase tax before VAT, discount on the goods only, and the
// deposit per container as the consumer amount (already incl. VAT).
export function manualPrice({priceCents, discountBp = 0, taxCents = 0, depositCents = 0, units = null}, vatBp) {
  for (const v of [priceCents, discountBp, taxCents, depositCents, vatBp]) if (!Number.isSafeInteger(v) || v < 0) throw new Error('ערך לא תקין');
  if (!(priceCents > 0) || discountBp >= 10000) throw new Error('ערך לא תקין');
  if (units !== null && (!Number.isInteger(units) || units < 1 || units > 1000)) throw new Error('מספר יחידות לא תקין');
  const d = 100000000n; // amounts below are in agorot × d
  const goods = BigInt(priceCents) * BigInt(10000 - discountBp) * 10000n;
  const beforeVat = goods + BigInt(taxCents) * d;
  const merch = beforeVat * BigInt(10000 + vatBp) / 10000n; // exact: d is a multiple of 10000
  const deposit = units ? BigInt(depositCents) * BigInt(units) * d : 0n;
  const out = {goods: fraction(goods, d), beforeVat: fraction(beforeVat, d), vat: fraction(merch - beforeVat, d), deposit: fraction(deposit, d), crate: fraction(merch + deposit, d), unit: null};
  if (units) {
    const du = d * BigInt(units);
    out.unit = {base: fraction(merch, du), pass: fraction(BigInt(depositCents) * du, du), total: fraction(merch + deposit, du)};
  }
  return out;
}
export function realizedMarkup(row, vatBp, units, quantity, saleCents) {
  const p = unitParts(row, vatBp, units);
  const b = Number(p.base.n) / Number(p.base.d) * quantity;
  const pass = Number(p.pass.n) / Number(p.pass.d) * quantity;
  return b > 0 ? (saleCents - pass - b) / b * 100 : null;
}
export function validateInvoice(doc) {
  const errors = [];
  const sums = {gross:0,discount:0,packaging:0,tax:0,deposit:0,total:0};
  if (!doc.rows.length) errors.push('לא נמצאו שורות מוצרים');
  if (!Number.isInteger(doc.vatBp) || doc.vatBp < 0 || doc.vatBp > 10000) errors.push('שיעור המע״מ חסר או לא תקין');
  for (const row of doc.rows) {
    const label = row.name || row.code;
    const required = ['unitPrice','quantityMilli','discountBp',...Object.keys(sums)];
    if (required.some(k => !Number.isSafeInteger(row[k]))) { errors.push(label + ': חסר נתון כספי'); continue; }
    if (row.quantityMilli <= 0 || row.unitPrice < 0 || row.gross < 0 || row.total < 0 || row.discount > 0 || row.deposit < 0 || row.packaging < 0 || row.tax < 0 || row.discountBp < 0 || row.discountBp > 10000) errors.push(label + ': ערך לא נתמך; תעודות זיכוי והחזרות אינן נתמכות');
    if (row.gross + row.discount + row.packaging + row.tax + row.deposit !== row.total) errors.push(label + ': סכום השורה אינו תואם לסחורה פחות הנחה ועוד החיובים');
    if (Math.abs(round(fraction(BigInt(row.unitPrice) * BigInt(row.quantityMilli),1000)) - row.gross) > 1) errors.push(label + ': המחיר כפול הכמות אינו תואם לסכום הסחורה');
    if (Math.abs(round(fraction(BigInt(row.gross) * BigInt(row.discountBp),10000)) + row.discount) > 1) errors.push(label + ': אחוז ההנחה אינו תואם לסכום ההנחה');
    for (const k of Object.keys(sums)) sums[k] += row[k];
  }
  for (const k of Object.keys(sums)) {
    if (!Number.isSafeInteger(doc.summary[k])) errors.push('חסר סכום סיכום: ' + k);
    else if (k !== 'total' && sums[k] !== doc.summary[k]) errors.push('סכום שורות המוצרים אינו תואם לסיכום (' + ({gross:'סחורה',discount:'הנחות',packaging:'אריזות',tax:'מס קנייה',deposit:'פיקדון'}[k]) + ')');
  }
  const s = doc.summary;
  if (![s.rounding,s.beforeVat,s.vat,s.total].every(Number.isSafeInteger)) errors.push('סיכום המסמך חסר');
  else {
    if (sums.total + s.rounding !== s.beforeVat) errors.push('סיכום לפני מע״מ אינו תואם לשורות ולהפרשי העיגול');
    if (s.beforeVat + s.vat !== s.total) errors.push('הסכום הסופי אינו תואם לסכום לפני מע״מ ועוד המע״מ');
    if (Number.isInteger(doc.vatBp) && round(gross(s.beforeVat,doc.vatBp)) - s.beforeVat !== s.vat) errors.push('סכום המע״מ אינו תואם לשיעור שנרשם בתעודה');
  }
  if (doc.supplyRows?.length) {
    const actual = new Map();
    for (const row of doc.rows) actual.set(row.code,(actual.get(row.code)||0)+row.quantityMilli);
    const supplied = new Map();
    for (const row of doc.supplyRows) supplied.set(row.code,(supplied.get(row.code)||0)+row.quantityMilli);
    for (const [code,qty] of supplied) if (actual.get(code)!==qty) errors.push('הכמות בפירוט הכספי שונה ממפרט האספקה, קוד ' + code);
    for (const code of actual.keys()) if (!supplied.has(code)) errors.push('קוד חסר במפרט האספקה: '+code);
  }
  return {ok:errors.length===0,errors:[...new Set(errors)],sums};
}
