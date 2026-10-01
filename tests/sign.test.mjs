import test from 'node:test';
import assert from 'node:assert/strict';
import {priceText,priceSegments,signLine,pageSize,drawPage,SIGN_SMALL_SCALE} from '../sign-canvas.js';
test('shelf-style prices, as in the other apps',()=>{
  assert.equal(priceText(1680),'₪16-80');assert.equal(priceText(1000),'₪10');assert.equal(priceText(405),'₪4-05');
  assert.deepEqual(priceSegments({kind:'unit',priceCents:590}),[{t:'רק ב- ',k:'small'},{t:'90',k:'sup'},{t:'5',k:'big'},{t:' ₪',k:'small'}]);
  assert.deepEqual(priceSegments({kind:'bundle',qty:3,priceCents:1200}),[{t:'3',k:'big'},{t:' יח׳ ב- ',k:'small'},{t:'12',k:'big'},{t:' ₪',k:'small'}]);
  assert.equal(priceSegments({kind:'bundle',qty:0,priceCents:1200}),null);assert.equal(priceSegments({kind:'unit',priceCents:0}),null);
  assert.equal(signLine({kind:'pct',pctText:'12.5'}),'12.5% הנחה');assert.equal(signLine({kind:'pct',pctText:''}),'');
});
test('A4 at 150dpi; one sign per page is landscape',()=>{assert.deepEqual(pageSize(4),{W:1240,H:1754});assert.deepEqual(pageSize(1),{W:1754,H:1240});});
// "2 בדף (קטן)": drawPage into a recording canvas. Text is measured as half the font size per character.
function record(signs,perPage,guides,...small){
  const calls=[],props={font:'10px Arial'};
  const ctx=new Proxy(props,{
    get:(t,k)=>k==='measureText'?s=>({width:String(s).length*parseFloat(/(\d+)px/.exec(t.font)[1])*0.5}):k in t?t[k]:(...a)=>{calls.push([k,...a]);},
    set:(t,k,v)=>{t[k]=v;calls.push(['='+k,v]);return true;},
  });
  const canvas={getContext:()=>ctx};
  drawPage(canvas,signs,perPage,'מיני מרקט שלום',guides,...small);
  return {canvas,calls,moves:calls.filter(c=>c[0]==='translate'||c[0]==='scale'),drawn:calls.filter(c=>c[0]!=='translate'&&c[0]!=='scale')};
}
const testSign=(title,n)=>({title,kind:'unit',priceCents:990,oldCents:1290,qty:0,pctText:'',note:'עד גמר המלאי',validUntil:'31.10.2026',products:Array.from({length:n},(_,i)=>({name:'מוצר '+i,barcode:'72900000000'+String(i).padStart(2,'0')}))});
const cm=px=>(px/150*2.54).toFixed(1);
test('2 בדף (קטן): the 2-per-page page drawn exactly, scaled 0.88 around the A4 centre',()=>{
  assert.equal(SIGN_SMALL_SCALE,0.88);
  for(const [signs,guides] of [[[testSign('משקה קולה 1.5 ליטר',3),testSign('תה קר אפרסק',9)],false],[[testSign('סודה',1)],true],[[testSign('מים מינרליים',12)],false]]){
    const big=record(signs,2,guides),small=record(signs,2,guides,true);
    assert.deepEqual([small.canvas.width,small.canvas.height],[1240,1754],'stays A4 portrait');
    assert.deepEqual(small.calls.slice(0,4),[['=fillStyle','#ffffff'],['fillRect',0,0,1240,1754],['translate',74,105],['scale',0.88,0.88]],'white page first, then the transform');
    assert.deepEqual(small.moves,[['translate',74,105],['scale',0.88,0.88]]);
    assert.deepEqual(big.moves,[]);
    assert.deepEqual(small.drawn,big.calls,'same title, price, barcodes and line breaks as the big page');
  }
  // One sign: the dashed cut guide of the empty slot is drawn after the transform too.
  const one=record([testSign('סודה',1)],2,true,true);
  const dash=one.calls.findIndex(c=>c[0]==='setLineDash'&&c[1].length);
  assert.ok(dash>3&&one.calls[dash+1][0]==='strokeRect','cut guide follows the scaled signs');
});
test('2 בדף (קטן): each sign about 17.3×12.3 cm instead of 19.6×14 cm',()=>{
  const frames=r=>r.calls.filter((c,i)=>c[0]==='strokeRect'&&r.calls.slice(0,i).findLast(p=>p[0]==='=lineWidth')?.[1]===5).map(c=>c.slice(1));
  const signs=[testSign('משקה קולה',2),testSign('סודה',2)];
  const big=frames(record(signs,2,false)),small=frames(record(signs,2,false,true));
  assert.deepEqual(big,[[40,40,1160,825],[40,889,1160,825]]);
  assert.deepEqual(small,big);
  const k=SIGN_SMALL_SCALE;
  assert.deepEqual(big.map(f=>[cm(f[2]),cm(f[3])]),[['19.6','14.0'],['19.6','14.0']]);
  assert.deepEqual(small.map(f=>[cm(f[2]*k),cm(f[3]*k)]),[['17.3','12.3'],['17.3','12.3']]);
  // The scaled frames sit centred, with white margins all around.
  const left=74+40*k,right=1240-(74+1200*k),top=105+40*k,bottom=1754-(105+(889+825)*k);
  assert.ok(Math.abs(left-right)<1&&Math.abs(top-bottom)<1,JSON.stringify({left,right,top,bottom}));
});
test('4, 2 (גדול) and 1 per page are not scaled',()=>{
  const signs=[testSign('משקה קולה',3)];
  for(const pp of [4,2,1]){
    const plain=record(signs,pp,true),off=record(signs,pp,true,false);
    assert.deepEqual(plain.moves,[]);assert.deepEqual(off.calls,plain.calls);
    assert.deepEqual([plain.canvas.width,plain.canvas.height],Object.values(pageSize(pp)));
  }
});
