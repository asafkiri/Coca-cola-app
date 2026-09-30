import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePages} from '../pdf-reader.js';
// Fully synthetic document: no supplier invoice or customer information.
function fixture(){
  const items=[];const add=(str,x,y)=>items.push({str,x,y,w:10,h:8});
  for(const [str,x,y] of [['מחיר',50,450],['פיקדון',90,450],['מס קניה',130,450],['ערך אריזה',170,450],['ערך',215,455],['הנחה',215,445],['אחוז',250,455],['הנחה',250,445],['סה"כ',290,450],['מחיר',330,455],['ליחידה',330,445],['כמות',365,450],['שם מוצר',490,450],['קוד',540,455],['מוצר',540,445]])add(str,x,y);
  for(const [str,x] of [['120.00',50],['10.00',90],['10.00',130],['20.00',170],['20.00-',215],['20.0',250],['100.00',290],['50.00',330],['2',365],['מוצר דוגמה',410],['10000',540],['111111',580]])add(str,x,425);
  add('סה"כ:',420,400);
  const summary=[];let y=500;
  for(const [label,value] of [['חיוב בגין מכירה','100.00'],['חיוב בגין אריזות','20.00'],['חיוב בגין חוק הפיקדון','10.00'],['הנחות בחשבונית','20.00-'],['מס קניה','10.00'],['הפרשי עיגול','0.00'],['סה"כ חיוב לפני מע"מ','120.00'],['%18.0 מע"מ','21.60'],['סה"כ כולל מע"מ','141.60']]){summary.push({str:label,x:520,y,w:60,h:8},{str:value,x:410,y,w:40,h:8});y-=18;}
  return [{items,width:612,height:792},{items:summary,width:612,height:792}];
}
test('parses table by headers independent of item stream order',()=>{const p=fixture();p.forEach(page=>page.items.reverse());const d=parsePages(p);assert.equal(d.rows.length,1);assert.equal(d.rows[0].code,'10000');assert.equal(d.rows[0].name,'מוצר דוגמה');assert.equal(d.rows[0].quantityMilli,2000);assert.equal(d.summary.total,14160);assert.equal(d.validation.ok,true);});
test('column positions may move together',()=>{const p=fixture();for(const i of p[0].items)i.x+=17;assert.equal(parsePages(p).rows[0].total,12000);});
test('trailing minus cannot become positive discount',()=>assert.equal(parsePages(fixture()).rows[0].discount,-2000));
test('unbalanced, incomplete, duplicate and unreadable PDFs fail visibly',()=>{for(const mutate of [p=>p.pop(),p=>p[0].items.find(i=>i.str==='120.00').str='130.00',p=>p[0].items=p[0].items.filter(i=>i.str!=='פיקדון'),p=>p[1].items=p[1].items.filter(i=>!i.str.includes('%18.0')),p=>p.push(structuredClone(p[0])),p=>p[0].items=p[0].items.filter(i=>i.str!=='10.00')]){const p=fixture();mutate(p);assert.throws(()=>parsePages(p));}assert.throws(()=>parsePages([{items:[],width:612,height:792}]));});
test('omitted rounding is not a license to absorb an unexplained difference',()=>{const p=fixture();const y=p[1].items.find(i=>i.str==='הפרשי עיגול').y;p[1].items=p[1].items.filter(i=>i.y!==y);assert.equal(parsePages(p).summary.rounding,0);p[1].items.find(i=>i.str==='120.00').str='120.13';assert.throws(()=>parsePages(p));});
test('two documents in a single file are rejected',()=>{const p=fixture();p.push(structuredClone(p[1]));assert.throws(()=>parsePages(p),/מספר סיכומי/);});
test('nonempty crate-return table is rejected',()=>{const p=fixture();p[0].items.unshift({str:'אריזות ותיבות מוחזרות',x:100,y:620,w:100},{str:'10000',x:520,y:590,w:20},{str:'2',x:200,y:590,w:10},{str:'20.00',x:120,y:590,w:20},{str:'סה"כ אריזות מוחזרות:',x:450,y:565,w:80});assert.throws(()=>parsePages(p),/החזרות/);});
