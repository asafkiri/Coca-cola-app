import {fixed,validateInvoice} from './money.js';
const compact = s => s.replace(/[\s"'״׳‎‏‪-‮]/g,'');
const center = i => i.x + i.w/2;
const right = i => i.x + i.w;
const numeric = s => /^-?[\d,]+(?:\.\d+)?-?$/.test(s.trim());
export function linesOf(page) {
  const lines=[];
  for(const item of [...page.items].filter(i=>i.str.trim()).sort((a,b)=>b.y-a.y || b.x-a.x)) {
    let line=lines.find(l=>Math.abs(l.y-item.y)<1.6);
    if(!line) {line={y:item.y,items:[]};lines.push(line);}
    line.items.push(item);
  }
  return lines.sort((a,b)=>b.y-a.y);
}
function lineText(l){return l.items.map(i=>i.str).join(' ');}
// Right-to-left reading order; a run of Latin/number items stays left-to-right.
function rtlText(items){
  const sorted=[...items].sort((a,b)=>right(b)-right(a)),out=[];
  let run=[];
  const flush=()=>{out.push(...run.sort((a,b)=>a.x-b.x));run=[];};
  for(const i of sorted){if(/[֐-׿]/.test(i.str)){flush();out.push(i);}else run.push(i);}
  flush();
  return out.map(i=>i.str.trim()).join(' ').replace(/\s+/g,' ').trim();
}
function onlyAmount(line) {
  const nums=line.items.filter(i=>numeric(i.str));
  if(nums.length!==1) throw new Error('סכום סיכום לא ברור: '+lineText(line));
  return fixed(nums[0].str);
}
// "000000" in the promotion column means the row is not part of a promotion.
export function promoKey(raw){const id=String(raw||'').replace(/^0+/,'');return id||null;}
const PROMO_END=['חשבוניותמס','חיובבגיןמכירה','מפרטהתחשבנות','מפרטאספקה','אישורקבלת','מוחזרות'];
function promoFromText(id,text){
  const display=text.replace(/([֐-׿])(\d)/g,'$1 $2').replace(/\s+/g,' ').trim();
  const pct=[...display.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].at(-1)||display.match(/%\s*(\d+(?:\.\d+)?)/);
  let pctBp=null;try{if(pct)pctBp=fixed(pct[1]);}catch{}
  return {id,text:display,pctBp};
}
export function parsePages(pages) {
  const doc={rows:[],supplyRows:[],promos:[],warnings:[],summary:{},vatBp:null,number:'',date:'',pageCount:pages.length,hasReturns:false};
  let tableCount=0,inPromos=false,promoCols=null,supplyTotalRight=null;
  for(const page of pages){
    const lines=linesOf(page);
    // The page header (supplier, customer, document number) repeats on every page.
    const headerLine=lines.find(l=>l.y>page.height*0.75 && compact(lineText(l)).includes('ת.משלוח'));
    for(const l of lines){
      const txt=compact(lineText(l));
      const date=lineText(l).match(/\b\d{2}\/\d{2}\/\d{4}\b/); if(date && !doc.date)doc.date=date[0];
      if(txt.includes('ת.משלוח') && !doc.number){const n=l.items.find(i=>/^\d{7,12}$/.test(i.str)); if(n)doc.number=n.str;}
      // "דף מתוך N" in the page header: refuse a file with missing pages.
      const of=l.y>page.height*0.75 && l.items.map(i=>compact(i.str).match(/^דף\d*מתוך(\d{1,3})$/)).find(Boolean);
      if(of && Number(of[1])>pages.length)throw new Error(`בקובץ ${pages.length} עמודים, אבל התעודה מציינת ${of[1]}. יש לבחור את התעודה המלאה.`);
      const fields=[['חיובבגיןמכירה','gross'],['חיובבגיןאריזות','packaging'],['חיובבגיןחוקהפיקדון','deposit'],['הנחותבחשבונית','discount'],['הפרשיעיגול','rounding'],['סהכחיובלפנימעמ','beforeVat'],['סהככוללמעמ','total']];
      const f=fields.find(([label])=>txt.includes(label));
      if(f){if(doc.summary[f[1]]!==undefined)throw new Error('נמצאו מספר סיכומי תעודות. יש לבחור תעודה אחת בכל פעם.');doc.summary[f[1]]=onlyAmount(l);}
      if(l.items.some(i=>compact(i.str)==='מסקניה') && l.items.filter(i=>numeric(i.str)).length===1)doc.summary.tax=onlyAmount(l);
      const vat=lineText(l).match(/(?:%\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*%)\s*מע["״]?מ/);
      if(vat){doc.vatBp=fixed(vat[1]||vat[2]);doc.summary.vat=onlyAmount(l);}
    }
    // Promotion details, possibly continuing on the next page.
    for(const l of lines){
      if(headerLine && l.y>=headerLine.y-1)continue;
      const t=compact(lineText(l));
      if(t.includes('פירוטהמבצעים')){inPromos=true;continue;}
      if(!inPromos)continue;
      if(PROMO_END.some(m=>t.includes(m))){inPromos=false;continue;}
      if(t.includes('תיאורהמבצע')){
        const idHead=l.items.filter(i=>/^(מס|מבצע|מסמבצע)$/.test(compact(i.str))).sort((a,b)=>right(b)-right(a))[0];
        const descHead=l.items.find(i=>compact(i.str).includes('תיאור'));
        promoCols={id:idHead?right(idHead):null,desc:descHead?right(descHead):null};
        continue;
      }
      const ids=l.items.filter(i=>/^\d{4,12}$/.test(i.str.trim()) && (!promoCols?.id || Math.abs(right(i)-promoCols.id)<=8));
      const id=ids.sort((a,b)=>right(b)-right(a))[0];
      const text=rtlText(l.items.filter(i=>i!==id));
      if(id){
        const key=promoKey(id.str.trim());
        if(key && !doc.promos.some(p=>p.id===key))doc.promos.push(promoFromText(key,text));
      }else if(text && doc.promos.length){
        const last=doc.promos.at(-1),next=promoFromText(last.id,last.text+' '+text);
        Object.assign(last,{text:next.text,pctBp:last.pctBp??next.pctBp});
      }
    }
    // Returned crates are listed separately. The amounts below must still
    // reconcile exactly, so a return that changes the totals is refused.
    const ret=lines.findIndex(l=>compact(lineText(l)).includes('מוחזרות') && compact(lineText(l)).includes('אריזות') && !compact(lineText(l)).includes('סהכ'));
    if(ret>=0){for(const l of lines.slice(ret+1)){const t=compact(lineText(l));if(t.includes('סהכאריזותמוחזרות')||t.includes('מפרטהתחשבנות'))break;if(l.items.filter(i=>numeric(i.str)).length>=3){doc.hasReturns=true;break;}}}
    const supplyHeader=lines.find(l=>compact(lineText(l)).includes('שםהמוצר') && !compact(lineText(l)).includes('פיקדון'));
    const supplyTitle=lines.some(l=>compact(lineText(l)).includes('מפרטאספקה'));
    // The supply list may continue on the next page without its title.
    const supplyStart=supplyHeader && supplyTitle ? supplyHeader.y-3 : supplyTotalRight!==null ? (headerLine ? headerLine.y-1 : page.height) : null;
    if(supplyStart!==null){
      // The delivered total is the "סה"כ" column; ordered and free quantities
      // are to its left. Header words sit on three stacked lines.
      const totalHead=supplyHeader && page.items.find(i=>Math.abs(i.y-supplyHeader.y)<=12 && compact(i.str)==='סהכ');
      if(totalHead)supplyTotalRight=right(totalHead);
      else if(supplyTitle)supplyTotalRight=-1;
      for(const l of lines.filter(l=>l.y<supplyStart)){
        const t=compact(lineText(l));
        if(t.includes('סהכ')||t.includes('מוחזרות')||t.includes('מפרטהתחשבנות')){supplyTotalRight=null;break;}
        const nums=l.items.filter(i=>numeric(i.str)).sort((a,b)=>b.x-a.x);
        const barcode=nums.find(i=>/^\d{12,14}$/.test(i.str));
        if(!barcode)continue;
        const code=nums.find(i=>i.x<barcode.x && /^\d{4,8}$/.test(i.str));
        if(!code)continue;
        const left=nums.filter(i=>i.x<code.x);
        const total=(supplyTotalRight>0 && left.find(i=>Math.abs(right(i)-supplyTotalRight)<=8)) || left[0];
        if(!total)continue;
        const name=rtlText(l.items.filter(i=>i.x>right(total) && right(i)<=code.x+1));
        doc.supplyRows.push({code:code.str,barcode:barcode.str,name,quantityMilli:fixed(total.str,3)});
      }
    }
    const heads=lines.filter(l=>{const t=compact(lineText(l));return t.includes('שםמוצר')&&t.includes('פיקדון')&&t.includes('ערךאריזה');});
    for(const h of heads){
      tableCount++;
      const header=page.items.filter(i=>Math.abs(i.y-h.y)<=6 && i.str.trim());
      const find=(label)=>header.find(i=>compact(i.str)===label);
      const priceHeads=header.filter(i=>compact(i.str)==='מחיר').sort((a,b)=>a.x-b.x);
      const columns={total:priceHeads[0],deposit:find('פיקדון'),tax:find('מסקניה'),packaging:find('ערךאריזה'),discount:find('ערך'),discountBp:find('אחוז'),gross:find('סהכ'),unitPrice:priceHeads[1],quantityMilli:find('כמות'),code:find('קוד')};
      if(Object.values(columns).some(v=>!v))throw new Error('כותרות טבלת המחירים אינן מזוהות. לא חושב מחיר משוער.');
      // Optional promotion-number column, right of the product code.
      const promoHead=header.find(i=>/^(מבצע|מסמבצע)$/.test(compact(i.str)) && i.x>columns.code.x);
      const anchors=Object.entries(columns).map(([k,i])=>({k,x:center(i)}));
      if(promoHead)anchors.push({k:'promo',x:center(promoHead)});
      for(const l of lines.filter(l=>l.y<h.y-7)){
        const t=compact(lineText(l));
        if(t.includes('סהכ:')||t.includes('פירוטהמבצעים')||t.includes('מפרטהתחשבנות'))break;
        const vals={};
        for(const i of l.items.filter(i=>numeric(i.str))){
          const closest=[...anchors].sort((a,b)=>Math.abs(a.x-center(i))-Math.abs(b.x-center(i)))[0];
          if(Math.abs(closest.x-center(i))>22)continue; // promotion number without a header
          if(vals[closest.k]!==undefined)throw new Error('שני ערכים באותה עמודה. נדרש לבדוק את התעודה.');
          vals[closest.k]=i.str;
        }
        const names=l.items.filter(i=>!numeric(i.str) && i.x>columns.quantityMilli.x && i.x<columns.code.x).sort((a,b)=>b.x-a.x).map(i=>i.str);
        if(!Object.keys(vals).filter(k=>k!=='promo').length){if(names.length && doc.rows.length)doc.rows.at(-1).name+=' '+names.join(' ');continue;}
        if(!vals.code || Object.keys(columns).some(k=>vals[k]===undefined))throw new Error('שורת מוצר חסרה או לא ברורה: '+lineText(l));
        const row={id:`r${doc.rows.length}`,code:vals.code,name:names.join(' '),promoId:promoKey(vals.promo),page:pages.indexOf(page)+1};
        if(!row.name)throw new Error('שם מוצר חסר בקוד '+row.code);
        for(const key of Object.keys(columns).filter(k=>k!=='code'))row[key]=fixed(vals[key],key==='quantityMilli'?3:2);
        doc.rows.push(row);
      }
    }
  }
  if(!tableCount)throw new Error('לא נמצאה טבלת התחשבנות מוכרת. בחר את קובץ ה־PDF המקורי שהורדת מאפליקציית קוקה־קולה, ולא צילום.');
  // An omitted rounding row is accepted only when the remaining amounts
  // reconcile exactly; it is never inferred to absorb an unexplained gap.
  if(doc.summary.rounding===undefined)doc.summary.rounding=0;
  const supply=new Map(doc.supplyRows.map(r=>[r.code,r]));
  for(const r of doc.rows){
    const s=supply.get(r.code);
    r.barcode=s?.barcode||'';
    // The pricing table cuts long names ("...FRIDGE-PACK מב"); the supply table has them in full.
    const short=compact(r.name).slice(0,-3);
    if(s?.name && s.name.length>r.name.length && compact(s.name).startsWith(short))r.name=s.name;
  }
  for(const r of doc.rows){
    if(!r.promoId)continue;
    if(!doc.promos.some(p=>p.id===r.promoId))doc.promos.push({id:r.promoId,text:'',pctBp:null});
    const p=doc.promos.find(p=>p.id===r.promoId);
    if(p.pctBp!==null && p.pctBp!==r.discountBp)doc.warnings.push(`ההנחה ב${r.name} (${r.discountBp/100}%) שונה מתיאור המבצע (${p.pctBp/100}%)`);
  }
  doc.promos=doc.promos.filter(p=>doc.rows.some(r=>r.promoId===p.id));
  doc.validation=validateInvoice(doc);
  if(!doc.validation.ok){
    const error=new Error(doc.hasReturns?'בתעודה יש החזרת אריזות, והסכומים שלה אינם נתמכים בגרסה זו. '+doc.validation.errors.join(' · '):'החשבון לא עבר אימות. '+doc.validation.errors.join(' · '));
    error.details=doc.validation.errors;throw error;
  }
  return doc;
}
const PDF_ERRORS={InvalidPDFException:'הקובץ אינו PDF תקין. בחר את התעודה המקורית שהורדת.',MissingPDFException:'הקובץ לא נמצא או ריק.',PasswordException:'הקובץ מוגן בסיסמה. יש לבחור קובץ לא מוגן.'};
export async function readPdf(file, onProgress=()=>{}) {
  if(!file.size)throw new Error('הקובץ ריק. בחר את התעודה שוב.');
  if(file.size>20*1024*1024)throw new Error('הקובץ גדול מ־20MB. בחר תעודה אחת בכל פעם.');
  const pdfjs=await import('./vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',import.meta.url).href;
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true});
  let pdf;
  try{pdf=await task.promise;}
  catch(e){await task.destroy().catch(()=>{});throw new Error(PDF_ERRORS[e?.name]||'לא ניתן לפתוח את הקובץ. בחר את קובץ ה־PDF המקורי של התעודה.');}
  try{
    if(pdf.numPages>30)throw new Error('אפשר עד 30 עמודים בתעודה אחת');
    const pages=[];
    for(let n=1;n<=pdf.numPages;n++){
      onProgress(n,pdf.numPages);
      const p=await pdf.getPage(n);const t=await p.getTextContent();
      pages.push({width:p.view[2],height:p.view[3],items:t.items.filter(i=>typeof i.str==='string').map(i=>({str:i.str,x:i.transform[4],y:i.transform[5],w:i.width,h:i.height}))});
      p.cleanup();
    }
    return parsePages(pages);
  } finally {await pdf.destroy();}
}
