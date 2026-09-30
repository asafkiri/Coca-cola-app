import test from 'node:test';
import assert from 'node:assert/strict';
import {fixed,fraction,round,money,percent,gross,crateCost,unitParts,unitsFromDeposit,packSize,priceBasis,recommend,realizedMarkup,validateInvoice} from '../money.js';
const row=()=>({id:'x',code:'10000',name:'מוצר בדיקה',unitPrice:5000,quantityMilli:2000,gross:10000,discountBp:2000,discount:-2000,packaging:2000,tax:1000,deposit:1000,total:12000});
const doc=()=>({rows:[row()],vatBp:1800,supplyRows:[{code:'10000',quantityMilli:2000}],summary:{gross:10000,discount:-2000,packaging:2000,tax:1000,deposit:1000,rounding:0,beforeVat:12000,vat:2160,total:14160}});
test('parse PDF amounts without floating point or losing trailing minus',()=>{assert.equal(fixed('1,234.56-'),-123456);assert.equal(fixed('0.00'),0);assert.equal(fixed('18.0'),1800);assert.equal(fixed('2.5',3),2500);for(const s of ['',null,'3,4','1.234','NaN','12₪','Infinity'])assert.throws(()=>fixed(s));});
test('commercial half-up rounding is symmetric',()=>{assert.equal(round(fraction(1005,10)),101);assert.equal(round(fraction(-1005,10)),-101);assert.equal(round(fraction(1004,10)),100);});
test('money is written like the other apps: ₪ first, real minus sign',()=>{assert.equal(money(123456),'₪1,234.56');assert.equal(money(-7519),'−₪75.19');assert.equal(money(0),'₪0.00');assert.equal(percent(1600),'16%');assert.equal(percent(1250),'12.5%');});
test('discount applies to goods, fees once, VAT last',()=>{const d=doc();assert.equal(validateInvoice(d).ok,true);assert.equal(round(gross(row().total,1800)),14160);assert.equal(round(crateCost(row(),1800)),7080);assert.equal(round(unitParts(row(),1800,12).total),590);});
test('recommendation marks up merchandise plus purchase tax; packaging/deposit pass through once',()=>{const p=recommend(row(),1800,12,2500);assert.equal(p.cents,701);assert.equal(recommend(row(),1800,12,2500,2).cents,1402);assert.equal(recommend(row(),1800,12,0,2).cents,1180);assert.equal(recommend(row(),1800,12,2500,2,'ninety').cents,1490);});
test('markup is on cost, not margin on selling price',()=>{const r={...row(),quantityMilli:1000,packaging:0,deposit:0,total:700};assert.equal(recommend(r,0,1,3000).cents,910);assert.equal(realizedMarkup(r,0,1,1,910),30);});
test('do not round crate or unit costs before multiplying a bundle',()=>{const r={...row(),total:100,quantityMilli:3000,deposit:0,packaging:0};assert.equal(round(crateCost(r,0)),33);assert.equal(recommend(r,0,1,0,3).cents,100);});
test('VAT is read from the document and may be zero or different',()=>{for(const vatBp of [0,1700,1800,2000]){const d=doc();d.vatBp=vatBp;d.summary.vat=round(gross(12000,vatBp))-12000;d.summary.total=12000+d.summary.vat;assert.equal(validateInvoice(d).ok,true);}const d=doc();d.vatBp=null;assert.equal(validateInvoice(d).ok,false);});
test('document rounding remains a separate amount',()=>{const d=doc();d.summary.rounding=13;d.summary.beforeVat=12013;d.summary.vat=2162;d.summary.total=14175;assert.equal(validateInvoice(d).ok,true);assert.equal(round(crateCost(d.rows[0],1800)),7080);});
test('reject missing fees, duplicated fees, wrong order and unbalanced totals',()=>{
  for(const mutate of [d=>d.rows[0].deposit=null,d=>d.rows[0].total+=1000,d=>d.rows[0].discount=-2800,d=>d.rows[0].discountBp=3000,d=>d.rows[0].unitPrice=5100,d=>d.summary.gross+=1,d=>d.summary.vat+=1,d=>d.summary.total+=1,d=>d.rows=[],d=>d.supplyRows[0].quantityMilli=1000]){const d=doc();mutate(d);assert.equal(validateInvoice(d).ok,false);}
});
test('zero, negative, fractional or missing bottle counts cannot produce a recommendation',()=>{for(const units of [0,-1,1.5,NaN,null,10001])assert.throws(()=>recommend(row(),1800,units,2500));for(const pct of [-1,NaN,100001])assert.throws(()=>recommend(row(),1800,12,pct));for(const q of [0,-1,1.5])assert.throws(()=>recommend(row(),1800,12,2500,q));});
test('free goods are valid when explicitly printed as zero',()=>{const d=doc();Object.assign(d.rows[0],{unitPrice:0,gross:0,discount:0,discountBp:0,packaging:0,tax:0,deposit:0,total:0});Object.keys(d.summary).forEach(k=>d.summary[k]=0);assert.equal(validateInvoice(d).ok,true);assert.equal(round(crateCost(d.rows[0],1800)),0);});
test('negative returns and positive discount amounts do not silently become sale rows',()=>{for(const field of ['quantityMilli','deposit','packaging','tax','gross','total']){const d=doc();d.rows[0][field]=-1;assert.equal(validateInvoice(d).ok,false);}const d=doc();d.rows[0].discount=2000;assert.equal(validateInvoice(d).ok,false);});
test('units per case come from the deposit only when it reproduces the printed amount',()=>{
  const u=(deposit,quantityMilli,vatBp=1800,name='מוצר')=>unitsFromDeposit({deposit,quantityMilli,name},vatBp);
  assert.equal(u(3051,5000),24);assert.equal(u(610,1000),24);assert.equal(u(305,1000),12);assert.equal(u(2441,4000),24);assert.equal(u(1831,3000),24);
  assert.equal(u(0,40000),null);assert.equal(u(600,1000),null);assert.equal(u(1234,1000),null);
  assert.equal(u(615,1000,1700),24);assert.equal(u(610,1000,1700),null);
  assert.equal(u(610,1000,1800,'מארז 6 פח זירו'),24);assert.equal(u(508,1000,1800,'קרלסברג 6 בק 330'),null);
});
test('per-unit cost keeps deposit separate and rounds only at the end',()=>{
  // 2 cases, 15% discount, 24 containers each (deposit 12.20), VAT 18%.
  const r={unitPrice:10000,quantityMilli:2000,gross:20000,discountBp:1500,discount:-3000,packaging:0,tax:0,deposit:1220,total:18220};
  assert.equal(unitsFromDeposit({...r,name:'x'},1800),24);
  assert.equal(round(crateCost(r,1800)),10750);
  const p=unitParts(r,1800,24);assert.equal(round(p.total),448);assert.equal(round(p.pass),30);assert.equal(round(p.base),418);
});
test('multipack size comes from the product name',()=>{
  assert.equal(packSize('קרלסברג 6 בק 330 מ"ל פקדון'),6);assert.equal(packSize('מארז ק"ק ZERO 6 פח FRIDGE-PACK מבצע'),6);
  assert.equal(packSize('קוקה קולה 500 מ"ל'),1);assert.equal(packSize('בקבוק 1.5 ליטר'),1);assert.equal(packSize(''),1);
});
test('returnable packaging is set aside from prices and recommendations',()=>{
  // Returnable 500ml crate: 40 crates, 20 bottles each, packaging 1396.00, tax 208.00, no deposit.
  const r={name:'קרלסברג מלא חוזר',unitPrice:10557,quantityMilli:40000,gross:422280,discountBp:800,discount:-33782,packaging:139600,tax:20800,deposit:0,total:548898};
  const b=priceBasis(r);
  assert.equal(b.total,409298);assert.equal(b.packaging,0);assert.equal(r.total,548898);
  assert.equal(round(crateCost(b,1800)),12074);assert.equal(round(unitParts(b,1800,20).total),604);
  assert.equal(recommend(b,1800,20,2500,1,'ninety').cents,790);
  assert.equal(priceBasis(row()).total,10000);assert.equal(priceBasis({...row(),packaging:0}).total,12000);
});
