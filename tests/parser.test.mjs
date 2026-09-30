import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePages,promoKey} from '../pdf-reader.js';
// Fully synthetic document: no supplier invoice or customer information.
function fixture(){
  const items=[];const add=(str,x,y,w=10)=>items.push({str,x,y,w,h:8});
  for(const [str,x,y] of [['מחיר',50,450],['פיקדון',90,450],['מס קניה',130,450],['ערך אריזה',170,450],['ערך',215,455],['הנחה',215,445],['אחוז',250,455],['הנחה',250,445],['סה"כ',290,450],['מחיר',330,455],['ליחידה',330,445],['כמות',365,450],['שם מוצר',490,450],['קוד',540,455],['מוצר',540,445]])add(str,x,y);
  for(const [str,x] of [['120.00',50],['10.00',90],['10.00',130],['20.00',170],['20.00-',215],['20.0',250],['100.00',290],['50.00',330],['2',365],['מוצר דוגמה',410],['10000',540],['111111',580]])add(str,x,425);
  add('סה"כ:',420,400);
  const summary=[];let y=500;
  for(const [label,value] of [['חיוב בגין מכירה','100.00'],['חיוב בגין אריזות','20.00'],['חיוב בגין חוק הפיקדון','10.00'],['הנחות בחשבונית','20.00-'],['מס קניה','10.00'],['הפרשי עיגול','0.00'],['סה"כ חיוב לפני מע"מ','120.00'],['%18.0 מע"מ','21.60'],['סה"כ כולל מע"מ','141.60']]){summary.push({str:label,x:520,y,w:60,h:8},{str:value,x:410,y,w:40,h:8});y-=18;}
  return [{items,width:612,height:792},{items:summary,width:612,height:792}];
}
// Adds the promotion column and the "פירוט המבצעים" section.
function withPromos(){
  const p=fixture(),items=p[0].items;
  items.push({str:"מס'",x:576,y:455,w:12,h:8},{str:'מבצע',x:570,y:445,w:18,h:8});
  items.find(i=>i.str==='111111').x=562;
  items.push({str:'פ י ר ו ט',x:300,y:300,w:40,h:8},{str:'ה מ ב צ ע י ם',x:250,y:300,w:40,h:8});
  items.push({str:"מס' מבצע",x:557,y:280,w:32,h:8},{str:'תיאור המבצע',x:472,y:280,w:44,h:8});
  items.push({str:'0000111111',x:543,y:262,w:44,h:8},{str:'קנה 6 מוצר דוגמה גמיש20%',x:420,y:262,w:94,h:8});
  return p;
}
test('parses table by headers independent of item stream order',()=>{const p=fixture();p.forEach(page=>page.items.reverse());const d=parsePages(p);assert.equal(d.rows.length,1);assert.equal(d.rows[0].code,'10000');assert.equal(d.rows[0].name,'מוצר דוגמה');assert.equal(d.rows[0].quantityMilli,2000);assert.equal(d.summary.total,14160);assert.equal(d.validation.ok,true);});
test('column positions may move together',()=>{const p=fixture();for(const i of p[0].items)i.x+=17;assert.equal(parsePages(p).rows[0].total,12000);});
test('trailing minus cannot become positive discount',()=>assert.equal(parsePages(fixture()).rows[0].discount,-2000));
test('unbalanced, incomplete, duplicate and unreadable PDFs fail visibly',()=>{for(const mutate of [p=>p.pop(),p=>p[0].items.find(i=>i.str==='120.00').str='130.00',p=>p[0].items=p[0].items.filter(i=>i.str!=='פיקדון'),p=>p[1].items=p[1].items.filter(i=>!i.str.includes('%18.0')),p=>p.push(structuredClone(p[0])),p=>p[0].items=p[0].items.filter(i=>i.str!=='10.00')]){const p=fixture();mutate(p);assert.throws(()=>parsePages(p));}assert.throws(()=>parsePages([{items:[],width:612,height:792}]));});
test('omitted rounding is not a license to absorb an unexplained difference',()=>{const p=fixture();const y=p[1].items.find(i=>i.str==='הפרשי עיגול').y;p[1].items=p[1].items.filter(i=>i.y!==y);assert.equal(parsePages(p).summary.rounding,0);p[1].items.find(i=>i.str==='120.00').str='120.13';assert.throws(()=>parsePages(p));});
test('two documents in a single file are rejected',()=>{const p=fixture();p.push(structuredClone(p[1]));assert.throws(()=>parsePages(p),/מספר סיכומי/);});
test('returned crates are flagged; the amounts must still reconcile',()=>{
  const p=fixture();p[0].items.unshift({str:'אריזות ותיבות מוחזרות',x:100,y:620,w:100},{str:'10000',x:520,y:590,w:20},{str:'2',x:200,y:590,w:10},{str:'20.00',x:120,y:590,w:20},{str:'סה"כ אריזות מוחזרות:',x:450,y:565,w:80});
  assert.equal(parsePages(p).hasReturns,true);
  p[1].items.find(i=>i.str==='120.00').str='100.00';assert.throws(()=>parsePages(p),/החזרת אריזות/);
});
test('rows without a promotion column still parse',()=>{const d=parsePages(fixture());assert.equal(d.rows[0].promoId,null);assert.deepEqual(d.promos,[]);});
test('promotion number per row and the promotion details are read',()=>{
  const d=parsePages(withPromos());
  assert.equal(d.rows[0].promoId,'111111');
  assert.deepEqual(d.promos,[{id:'111111',text:'קנה 6 מוצר דוגמה גמיש 20%',pctBp:2000}]);
  assert.deepEqual(d.warnings,[]);
});
test('a promotion percent that differs from the row is a warning, not a rejection',()=>{
  const p=withPromos();p[0].items.find(i=>i.str.includes('גמיש')).str='קנה 6 מוצר דוגמה גמיש25%';
  const d=parsePages(p);assert.equal(d.validation.ok,true);assert.equal(d.warnings.length,1);
});
test('zeros mean no promotion; ids match with or without leading zeros',()=>{
  assert.equal(promoKey('000000'),null);assert.equal(promoKey('0000546107'),'546107');assert.equal(promoKey('546107'),'546107');
  const p=withPromos();p[0].items.find(i=>i.str==='111111').str='000000';
  const d=parsePages(p);assert.equal(d.rows[0].promoId,null);assert.deepEqual(d.promos,[]);
});
test('promotion description wraps and continues after a page header',()=>{
  const p=withPromos();
  p.splice(1,0,{width:612,height:792,items:[{str:'ת. משלוח - הקפה',x:481,y:655,w:60,h:8},{str:'730192226',x:386,y:655,w:40,h:8},{str:'קירי שלום',x:470,y:670,w:44,h:8},{str:'המשך תיאור',x:450,y:600,w:60,h:8},{str:'ח ש ב ו נ י ו ת',x:289,y:560,w:40,h:8},{str:'מ ס',x:266,y:560,w:10,h:8},{str:'שורה אחרי',x:450,y:540,w:60,h:8}]});
  const d=parsePages(p);assert.equal(d.promos[0].text,'קנה 6 מוצר דוגמה גמיש 20% המשך תיאור');
});
test('a file with missing pages is rejected',()=>{
  const p=fixture();p[0].items.push({str:'דף מתוך 3',x:245,y:700,w:40,h:8});
  assert.throws(()=>parsePages(p),/עמודים/);
  p[1].items.push({str:'דף מתוך 2',x:245,y:700,w:40,h:8});p[0].items.find(i=>i.str==='דף מתוך 3').str='דף מתוך 2';
  assert.equal(parsePages(p).rows.length,1);
});
test('supply table gives barcode, full name and the delivered total, not a number inside the name',()=>{
  const p=fixture(),items=p[0].items;
  items.push({str:'מ פ ר ט',x:313,y:760,w:20,h:8},{str:'א ס פ ק ה',x:274,y:760,w:30,h:8});
  items.push({str:"מס' ברקוד",x:528,y:747,w:34,h:8},{str:'קוד',x:459,y:747,w:12,h:8},{str:'סה"כ',x:251,y:747,w:18,h:8},{str:'כמות',x:178,y:747,w:17,h:8},{str:'כמות',x:104,y:747,w:17,h:8});
  items.push({str:'שם המוצר',x:394,y:742,w:33,h:8},{str:'מוצר',x:455,y:738,w:15,h:8},{str:'כמות',x:252,y:738,w:17,h:8},{str:'מוזמנת',x:171,y:738,w:24,h:8},{str:'בהטבה',x:97,y:738,w:24,h:8});
  items.push({str:'7290000000001',x:503,y:720,w:58,h:8},{str:'10000',x:447,y:720,w:22,h:8},{str:'מוצר דוגמה מלא',x:330,y:720,w:60,h:8},{str:'500',x:300,y:720,w:12,h:8},{str:'2',x:263,y:720,w:5,h:8},{str:'2',x:189,y:720,w:5,h:8},{str:'0',x:115,y:720,w:5,h:8});
  items.push({str:'סה"כ:',x:339,y:700,w:20,h:8},{str:'2',x:263,y:700,w:5,h:8});
  const d=parsePages(p);
  assert.deepEqual(d.supplyRows,[{code:'10000',barcode:'7290000000001',name:'מוצר דוגמה מלא 500',quantityMilli:2000}]);
  assert.equal(d.rows[0].barcode,'7290000000001');assert.equal(d.rows[0].name,'מוצר דוגמה מלא 500');
});
test('an extra page or "מתוך" in ordinary text is not a missing page',()=>{
  const p=fixture();p[0].items.push({str:'דף מתוך 2',x:245,y:700,w:40,h:8});p.push({items:[],width:612,height:792});
  assert.equal(parsePages(p).rows.length,1);
  const q=withPromos();q[0].items.find(i=>i.str.includes('גמיש')).str='קנה 4 מתוך 6 טעמים גמיש20%';
  assert.equal(parsePages(q).rows.length,1);
});
test('a wrapped promotion line does not replace the percent read with the id',()=>{
  const p=withPromos();p[0].items.push({str:'בתנאי 5% מהמחזור',x:420,y:248,w:94,h:8});
  const d=parsePages(p);assert.equal(d.promos[0].pctBp,2000);assert.match(d.promos[0].text,/מהמחזור/);
});
test('the supply list may continue on the next page without its title',()=>{
  const p=fixture();
  // Page 1 ends right after the supply header; its rows continue on page 2.
  p.unshift({width:612,height:792,items:[{str:'מ פ ר ט',x:313,y:260,w:20,h:8},{str:'א ס פ ק ה',x:274,y:260,w:30,h:8},{str:"מס' ברקוד",x:528,y:247,w:34,h:8},{str:'קוד',x:459,y:247,w:12,h:8},{str:'סה"כ',x:251,y:247,w:18,h:8},{str:'שם המוצר',x:394,y:242,w:33,h:8}]});
  p.splice(1,0,{width:612,height:792,items:[{str:'ת. משלוח - הקפה',x:481,y:655,w:60,h:8},{str:'7290000000001',x:503,y:620,w:58,h:8},{str:'10000',x:447,y:620,w:22,h:8},{str:'מוצר דוגמה',x:360,y:620,w:60,h:8},{str:'2',x:263,y:620,w:5,h:8},{str:'סה"כ:',x:339,y:600,w:20,h:8},{str:'2',x:263,y:600,w:5,h:8}]});
  const d=parsePages(p);assert.equal(d.supplyRows.length,1);assert.equal(d.rows[0].barcode,'7290000000001');
});
