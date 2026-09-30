// Promotion signs drawn exactly like the other shop apps (Yotvata/Tnuva
// drawSignSlot): A4 at 150dpi, full-width slots stacked 4/2/1 per page,
// store badge, supermarket price with raised agorot, "במקום" struck through
// and the barcode list at the bottom. No purchase cost or supplier promotion
// text is ever drawn on a sign.
const FONT = 'Heebo, Arial';
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
export function pageSize(perPage) {
  return perPage === 1 ? {W: 1754, H: 1240} : {W: 1240, H: 1754};
}
// ₪16-80, the shelf-label style used for "במקום".
export function priceText(cents) {
  const sh = Math.floor(cents / 100), ag = cents % 100;
  return ag > 0 ? '₪' + sh + '-' + String(ag).padStart(2, '0') : '₪' + sh;
}
// Large shekels, raised underlined agorot, small words and ₪.
export function priceSegments(sign) {
  if (sign.kind === 'pct' || !(sign.priceCents > 0)) return null;
  const sh = Math.floor(sign.priceCents / 100), ag = sign.priceCents % 100;
  const segs = [];
  if (sign.kind === 'bundle') {
    if (!(sign.qty > 0)) return null;
    segs.push({t: String(sign.qty), k: 'big'}, {t: ' יח׳ ב- ', k: 'small'});
  } else segs.push({t: 'רק ב- ', k: 'small'});
  if (ag > 0) segs.push({t: String(ag).padStart(2, '0'), k: 'sup'});
  segs.push({t: String(sh), k: 'big'}, {t: ' ₪', k: 'small'});
  return segs;
}
export function signLine(sign) {
  if (sign.kind === 'pct') return sign.pctText ? sign.pctText + '% הנחה' : '';
  const segs = priceSegments(sign);
  return segs ? segs.map(s => s.t).join('') : '';
}
function segFonts(size) {
  return {big: `900 ${size}px ${FONT}`, small: `800 ${Math.max(14, Math.round(size * 0.3))}px ${FONT}`, sup: `900 ${Math.max(16, Math.round(size * 0.42))}px ${FONT}`};
}
function measureSegs(ctx, segs, size) {
  const F = segFonts(size), gap = Math.max(2, Math.round(size * 0.04));
  return segs.reduce((w, s) => { ctx.font = F[s.k]; return w + ctx.measureText(s.t).width + gap; }, 0) - gap;
}
function drawSegs(ctx, segs, centerX, baseY, size) {
  const F = segFonts(size), gap = Math.max(2, Math.round(size * 0.04));
  const ws = segs.map(s => { ctx.font = F[s.k]; return ctx.measureText(s.t).width; });
  const total = ws.reduce((a, b) => a + b, 0) + gap * (segs.length - 1);
  ctx.textAlign = 'right';
  let x = centerX + total / 2;
  segs.forEach((s, i) => {
    ctx.font = F[s.k];
    const y = s.k === 'sup' ? baseY - Math.round(size * 0.42) : baseY;
    ctx.fillText(s.t, x, y);
    if (s.k === 'sup') {
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = Math.max(2, Math.round(size * 0.03));
      ctx.beginPath(); ctx.moveTo(x - ws[i], y + Math.round(size * 0.07)); ctx.lineTo(x, y + Math.round(size * 0.07)); ctx.stroke();
    }
    x -= ws[i] + gap;
  });
  ctx.textAlign = 'center';
}
// A word wider than the sign (no spaces) breaks by characters instead of
// running past the frame.
export function wrapText(ctx, text, maxW) {
  const words = [];
  for (const w of String(text || '').split(/\s+/).filter(Boolean)) {
    if (ctx.measureText(w).width <= maxW) { words.push(w); continue; }
    let chunk = '';
    for (const ch of w) {
      if (ctx.measureText(chunk + ch).width <= maxW || !chunk) chunk += ch;
      else { words.push(chunk); chunk = ch; }
    }
    if (chunk) words.push(chunk);
  }
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawSlot(ctx, s, y0, slotH, W, storeName) {
  const pad = 40, x0 = pad, x1 = W - pad, cx = W / 2;
  ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 5;
  ctx.strokeRect(x0, y0, x1 - x0, slotH);
  ctx.strokeStyle = '#fda4af'; ctx.lineWidth = 1.5;
  ctx.strokeRect(x0 + 10, y0 + 10, x1 - x0 - 20, slotH - 20);
  const prods = s.products || [];
  const widthAvail = x1 - x0 - 80;
  // Barcodes only (the name when a product has none), packed by real width.
  const buildLines = font => {
    ctx.font = font;
    const out = [], counts = [];
    let line = '', cnt = 0;
    for (const p of prods) {
      const item = p.barcode || p.name;
      const cand = line ? line + '  ·  ' + item : item;
      if (line && ctx.measureText(cand).width > widthAvail) { out.push(line); counts.push(cnt); line = item; cnt = 1; }
      else { line = cand; cnt++; }
    }
    if (line) { out.push(line); counts.push(cnt); }
    return {out, counts};
  };
  const big = signLine(s);
  const oldCents = s.kind !== 'pct' && s.oldCents > 0 ? s.oldCents : 0;
  const valid = (s.validUntil || '').trim();
  const innerH = slotH - 22;
  // Base sizes were calibrated for a 316px slot; larger slots start larger.
  const slotScale = Math.max(1, slotH / 316);
  const badgeText = '🛒 ' + (storeName || '');
  let badgeFont = Math.round(34 * Math.min(slotScale, 2.2));
  ctx.font = `800 ${badgeFont}px ${FONT}`;
  let badgeTextW = ctx.measureText(badgeText).width;
  while (badgeTextW > (x1 - x0) * 0.45 && badgeFont > 18) { badgeFont -= 2; ctx.font = `800 ${badgeFont}px ${FONT}`; badgeTextW = ctx.measureText(badgeText).width; }
  const badgeH = Math.round(badgeFont * 1.5), badgeW = Math.round(badgeTextW) + 30;
  const badgeX1 = x1 - 14, badgeX0 = badgeX1 - badgeW, badgeTop = y0 + 14, badgeBottomRel = 14 + badgeH;
  const validFont = Math.round(20 * Math.min(slotScale, 2));
  ctx.font = `900 ${validFont}px ${FONT}`;
  const validW = valid ? ctx.measureText('בתוקף עד ' + valid).width : 0;
  // Start large and shrink only until everything fits.
  const B = {title: 58, titleLH: 62, big: 96, bigPad: 26, bigAfter: 44, old: 30, note: 30, listHead: 24, listSmall: 22, listLH: 30, topPad: 78};
  let M = null, titleLines = [], fitsAll = false, linesOut = [], lineCounts = [], shiftDown = 0, titleCx = cx;
  for (let f = r2(slotScale); f >= 0.4; f = r2(f * 0.92)) {
    const m = {};
    for (const k of Object.keys(B)) m[k] = Math.max(10, Math.round(B[k] * f));
    const listF = Math.min(f, 1.6); // the barcode list stays small print
    for (const k of ['listHead', 'listSmall', 'listLH']) m[k] = Math.max(10, Math.round(B[k] * listF));
    let tl;
    for (;;) {
      ctx.font = `900 ${m.title}px ${FONT}`;
      tl = wrapText(ctx, s.title || '', widthAvail);
      const widest = tl.reduce((a, ln) => Math.max(a, ctx.measureText(ln).width), 0);
      if ((tl.length <= 3 && widest <= widthAvail) || m.title <= 26) break;
      m.title = Math.max(26, Math.round(m.title * 0.88));
      m.titleLH = Math.round(m.title * 1.07);
    }
    if (tl.length > 3) { tl = tl.slice(0, 3); tl[2] = tl[2].replace(/\s+\S*$/, '') + '…'; }
    // Avoid the badge and the date: first move the title sideways, then down.
    const t0w = tl.length ? ctx.measureText(tl[0]).width : 0;
    const titleTopRel = m.topPad - Math.round(m.title * 0.75);
    let shift = 0, tCx = cx;
    if (titleTopRel < badgeBottomRel + 6) {
      const rightBound = badgeX0 - 16, leftBound = x0 + (valid ? 24 + validW + 14 : 40);
      if (cx + t0w / 2 > rightBound || (valid && cx - t0w / 2 < leftBound)) {
        if (tl.length === 1 && t0w <= rightBound - leftBound) tCx = Math.round(leftBound + (rightBound - leftBound) / 2);
        else shift = badgeBottomRel + 6 - titleTopRel;
      }
    }
    const bl = buildLines(`900 ${m.listSmall}px ${FONT}`);
    const top = shift + m.topPad + tl.length * m.titleLH + (big ? m.bigPad + m.bigAfter : 0) + (s.note ? 20 : 0);
    const listH = prods.length ? 12 + (m.listHead - 6 + m.listLH) + bl.out.length * m.listLH + 14 : 0;
    M = m; titleLines = tl; linesOut = bl.out; lineCounts = bl.counts; shiftDown = shift; titleCx = tCx;
    if (top + listH <= innerH) { fitsAll = true; break; }
  }
  ctx.fillStyle = '#fff1f2';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(badgeX0, badgeTop, badgeW, badgeH, 12); else ctx.rect(badgeX0, badgeTop, badgeW, badgeH);
  ctx.fill();
  ctx.strokeStyle = '#fda4af'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#000000'; ctx.font = `800 ${badgeFont}px ${FONT}`; ctx.textAlign = 'right';
  ctx.fillText(badgeText, badgeX1 - 15, badgeTop + Math.round(badgeH / 2) + Math.round(badgeFont * 0.35));
  ctx.textAlign = 'center';
  if (valid) {
    ctx.fillStyle = '#475569'; ctx.font = `900 ${validFont}px ${FONT}`; ctx.textAlign = 'left';
    ctx.fillText('בתוקף עד ' + valid, x0 + 24, y0 + 24 + validFont * 0.4);
    ctx.textAlign = 'center';
  }
  let y = y0 + shiftDown + M.topPad;
  ctx.fillStyle = '#0f172a'; ctx.font = `900 ${M.title}px ${FONT}`;
  for (const ln of titleLines) { ctx.fillText(ln, titleCx, y); y += M.titleLH; }
  // Anchor the list first so the price knows how much room it can fill.
  const headH = (M.listHead - 6) + M.listLH;
  const yAfterMiddle = y + (big ? M.bigPad + M.bigAfter : 0) + (s.note ? 20 : 0);
  let shown = [], hasMore = false, moreCount = 0, listY = null;
  if (prods.length) {
    let count = linesOut.length;
    if (!fitsAll) {
      const cap = Math.max(1, Math.floor(((y0 + innerH) - (yAfterMiddle + 12) - headH - 14) / M.listLH));
      if (cap < linesOut.length) { count = Math.max(1, cap - 1); hasMore = true; }
    }
    shown = linesOut.slice(0, count);
    moreCount = Math.max(0, prods.length - lineCounts.slice(0, count).reduce((a, b) => a + b, 0));
    const linesTotal = shown.length + (hasMore ? 1 : 0);
    listY = Math.max(yAfterMiddle + 12, (y0 + slotH - 26) - headH - Math.max(0, linesTotal - 1) * M.listLH);
  }
  // The price hugs the title and grows to fill the free band.
  const bandTop = y - Math.round(M.titleLH * 0.3);
  const bandBottom = listY != null ? listY - 16 : y0 + innerH - 6;
  const drawNote = (size, yy) => {
    let f = size; ctx.fillStyle = '#475569'; ctx.font = `900 ${f}px ${FONT}`;
    while (ctx.measureText('* ' + s.note).width > widthAvail && f > 14) { f--; ctx.font = `900 ${f}px ${FONT}`; }
    ctx.fillText('* ' + s.note, cx, yy);
  };
  if (big) {
    const segs = priceSegments(s);
    const noteH = s.note ? M.note + 12 : 0;
    const bandH = Math.max(M.bigPad + M.bigAfter, bandBottom - bandTop);
    const oldTxt = oldCents ? 'במקום ' + priceText(oldCents) : '';
    ctx.font = `800 ${M.old}px ${FONT}`;
    const ow = oldTxt ? ctx.measureText(oldTxt).width : 0;
    const oldSpan = oldTxt ? ow + 24 : 0;
    const measureBig = size => { if (segs) return measureSegs(ctx, segs, size); ctx.font = `900 ${size}px ${FONT}`; return ctx.measureText(big).width; };
    let bigSize = Math.max(M.big, Math.min(Math.round(190 * slotScale), Math.floor((bandH - noteH) / 0.85)));
    while (measureBig(bigSize) + oldSpan > widthAvail && bigSize > Math.round(M.big * 0.7)) bigSize -= 4;
    const bw = measureBig(bigSize);
    const groupH = Math.round(bigSize * 0.78) + noteH;
    let by = bandTop + Math.max(0, Math.min(Math.floor((bandH - groupH) / 2), 10)) + Math.round(bigSize * 0.72);
    // Price and "במקום" share a line and are centred together.
    const bigCx = cx + (oldTxt ? Math.round(oldSpan / 2) : 0);
    ctx.fillStyle = '#000000';
    if (segs) drawSegs(ctx, segs, bigCx, by, bigSize);
    else { ctx.font = `900 ${bigSize}px ${FONT}`; ctx.fillText(big, bigCx, by); }
    if (oldTxt) {
      const oldCx = bigCx - Math.round(bw / 2) - 24 - Math.round(ow / 2);
      ctx.fillStyle = '#94a3b8'; ctx.font = `800 ${M.old}px ${FONT}`;
      ctx.fillText(oldTxt, oldCx, by - 4);
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = Math.max(2, Math.round(M.old / 10));
      ctx.beginPath(); ctx.moveTo(oldCx - ow / 2 - 4, by - 4 - M.old * 0.32); ctx.lineTo(oldCx + ow / 2 + 4, by - 4 - M.old * 0.32); ctx.stroke();
    }
    if (s.note) drawNote(M.note, by + M.note + 16);
  } else if (s.note) drawNote(M.note, bandTop + Math.floor((bandBottom - bandTop) / 2));
  if (prods.length) {
    let ly = listY;
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0 + 70, ly - 8); ctx.lineTo(x1 - 70, ly - 8); ctx.stroke();
    // Solid black, slightly stroked: grey prints as dots.
    ctx.fillStyle = '#000000'; ctx.font = `900 ${M.listHead}px ${FONT}`;
    ctx.fillText('המבצע חל על הברקודים:', cx, ly + M.listHead - 6); ly += headH;
    ctx.strokeStyle = '#000000'; ctx.lineJoin = 'round';
    const inked = text => {
      ctx.font = `900 ${M.listSmall}px ${FONT}`;
      if (ctx.measureText(text).width > x1 - x0 - 50) ctx.font = `900 ${Math.max(11, M.listSmall - 3)}px ${FONT}`;
      ctx.lineWidth = Math.max(0.6, M.listSmall * 0.05);
      ctx.fillText(text, cx, ly); ctx.strokeText(text, cx, ly); ly += M.listLH;
    };
    shown.forEach(inked);
    if (hasMore && moreCount > 0) inked('ועוד ' + moreCount + ' מוצרים…');
  }
}
// Draws one A4 page. Empty slots get a dashed cutting guide when all signs
// fit on a single page, as in the other apps.
export function drawPage(canvas, signs, perPage, storeName, cutGuides) {
  const {W, H} = pageSize(perPage), pad = 40, gap = 24;
  const slotH = Math.floor((H - pad * 2 - gap * (perPage - 1)) / perPage);
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.direction = 'rtl';
  signs.forEach((s, i) => drawSlot(ctx, s, pad + i * (slotH + gap), slotH, W, storeName));
  if (cutGuides) {
    for (let i = signs.length; i < perPage; i++) {
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 2; ctx.setLineDash([12, 10]);
      ctx.strokeRect(pad, pad + i * (slotH + gap), W - pad * 2, slotH);
      ctx.setLineDash([]);
    }
  }
  return canvas;
}
