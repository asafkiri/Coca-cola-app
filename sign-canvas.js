// Render the same canvases for preview, PNG sharing and printing. No customer
// document or acquisition cost is ever drawn on a sign.
function wrap(ctx,text,maxWidth){const lines=[];let line='';for(const word of text.split(/\s+/)){const next=line?line+' '+word:word;if(ctx.measureText(next).width>maxWidth&&line){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);return lines;}
function textBlock(ctx,text,x,y,width,fontSize,maxLines=3,color='#202331',weight=700){let size=fontSize,lines=[];do{ctx.font=`${weight} ${size}px Arial`;lines=wrap(ctx,text,width);if(lines.length<=maxLines&&lines.every(l=>ctx.measureText(l).width<=width))break;size-=2;}while(size>16);ctx.fillStyle=color;ctx.textAlign='center';ctx.direction='rtl';ctx.textBaseline='middle';lines.slice(0,maxLines).forEach((l,i)=>ctx.fillText(l,x,y+i*size*1.2,width));return lines.length*size*1.2;}
function drawSign(ctx,sign,rect,storeName){
  const {x,y,w,h}=rect;const s=Math.min(w/570,h/790);const pad=20*s;
  ctx.save();ctx.translate(x,y);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#d5163d';ctx.lineWidth=3*s;ctx.strokeRect(pad,pad,w-pad*2,h-pad*2);ctx.lineWidth=s;ctx.strokeRect(pad+7*s,pad+7*s,w-pad*2-14*s,h-pad*2-14*s);
  const center=w/2;let top=pad+36*s;
  textBlock(ctx,storeName||'מבצע בחנות',center,top,w-100*s,23*s,1,'#202331',700);
  top+=58*s;
  const titleHeight=textBlock(ctx,sign.title||'כותרת השלט',center,top,w-85*s,36*s,3);
  const priceY=Math.max(top+titleHeight+90*s,h*.53);
  if(sign.valid){
    const text=sign.kind==='pct'?`${sign.pct}%`: (sign.priceCents/100).toFixed(2).replace(/\.00$/,'');
    if(sign.kind==='bundle')textBlock(ctx,`${sign.qty} בקבוקים ב־`,center,priceY-77*s,w-80*s,29*s,1);
    ctx.direction='ltr';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#d5163d';let fontSize=100*s;
    do{ctx.font=`900 ${fontSize}px Arial`;if(ctx.measureText(text).width<=w-100*s)break;fontSize-=3*s;}while(fontSize>38*s);
    ctx.fillText(text,center,priceY,w-70*s);
    if(sign.kind==='pct')textBlock(ctx,'הנחה',center,priceY+70*s,w-80*s,35*s,1,'#d5163d');
    else textBlock(ctx,sign.kind==='bundle'?'₪ לכל המבצע':'₪ לבקבוק',center,priceY+70*s,w-80*s,27*s,1);
    if(sign.oldCents>0 && sign.kind!=='pct'){
      const old=`במקום ${(sign.oldCents/100).toFixed(2)} ₪`;
      ctx.font=`${20*s}px Arial`;ctx.fillStyle='#6e7380';ctx.direction='rtl';ctx.fillText(old,center,priceY+111*s);
      const tw=ctx.measureText(old).width;ctx.strokeStyle='#6e7380';ctx.lineWidth=1.5*s;ctx.beginPath();ctx.moveTo(center-tw/2,priceY+111*s);ctx.lineTo(center+tw/2,priceY+111*s);ctx.stroke();
    }
  }else{textBlock(ctx,'השלם את פרטי השלט',center,priceY,w-90*s,27*s,2,'#a0a5af');}
  const footerY=h-pad-90*s;
  if(sign.note)textBlock(ctx,sign.note,center,footerY-35*s,w-90*s,18*s,2,'#444957',400);
  if(sign.validUntil)textBlock(ctx,'בתוקף עד '+sign.validUntil,center,footerY+18*s,w-90*s,18*s,1,'#444957',400);
  textBlock(ctx,sign.kind==='pct'?'ההנחה על מחיר המוצר, ללא פיקדון ואריזה':'המחיר כולל מע״מ, פיקדון ואריזה',center,h-pad-27*s,w-85*s,16*s,1,'#6e7380',400);
  ctx.restore();
}
export function renderPages(signs,perPage,storeName){
  const canvases=[];
  for(let offset=0;offset<signs.length;offset+=perPage){
    const canvas=document.createElement('canvas');canvas.width=1240;canvas.height=1754;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    const cols=perPage===4?2:1;const rows=perPage===4?2:perPage===2?2:1;
    const cw=(1240-40)/cols,ch=(1754-40)/rows;
    signs.slice(offset,offset+perPage).forEach((sign,i)=>{
      let w=cw,h=ch;
      // A single sign uses a centered landscape rectangle on an A4 page.
      if(perPage===1){w=1200;h=1200;}
      const x=20+(cols-1-i%cols)*cw,y=perPage===1?(1754-h)/2:20+Math.floor(i/cols)*ch;
      drawSign(ctx,sign,{x,y,w,h},storeName);
    });
    canvases.push(canvas);
  }
  return canvases;
}
