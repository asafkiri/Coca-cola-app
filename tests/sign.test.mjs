import test from 'node:test';
import assert from 'node:assert/strict';
import {priceText,priceSegments,signLine,pageSize} from '../sign-canvas.js';
test('shelf-style prices, as in the other apps',()=>{
  assert.equal(priceText(1680),'₪16-80');assert.equal(priceText(1000),'₪10');assert.equal(priceText(405),'₪4-05');
  assert.deepEqual(priceSegments({kind:'unit',priceCents:590}),[{t:'רק ב- ',k:'small'},{t:'90',k:'sup'},{t:'5',k:'big'},{t:' ₪',k:'small'}]);
  assert.deepEqual(priceSegments({kind:'bundle',qty:3,priceCents:1200}),[{t:'3',k:'big'},{t:' יח׳ ב- ',k:'small'},{t:'12',k:'big'},{t:' ₪',k:'small'}]);
  assert.equal(priceSegments({kind:'bundle',qty:0,priceCents:1200}),null);assert.equal(priceSegments({kind:'unit',priceCents:0}),null);
  assert.equal(signLine({kind:'pct',pctText:'12.5'}),'12.5% הנחה');assert.equal(signLine({kind:'pct',pctText:''}),'');
});
test('A4 at 150dpi; one sign per page is landscape',()=>{assert.deepEqual(pageSize(4),{W:1240,H:1754});assert.deepEqual(pageSize(1),{W:1754,H:1240});});
