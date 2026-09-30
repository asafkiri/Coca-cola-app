import {fixed,validateInvoice} from './money.js';
const compact = s => s.replace(/[\s"'״׳\u200e\u200f\u202a-\u202e]/g,'');
const center = i => i.x + i.w/2;
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
function onlyAmount(line) {
  const nums=line.items.filter(i=>numeric(i.str));
  if(nums.length!==1) throw new Error('סכום סיכום לא ברור: '+lineText(line));
  return fixed(nums[0].str);
}
export function parsePages(pages) {
  const doc={rows:[],supplyRows:[],summary:{},vatBp:null,number:'',date:'',pageCount:pages.length};
  let tableCount=0;
  for(const page of pages){
    const lines=linesOf(page);
    for(const l of lines){
      const txt=compact(lineText(l));
      const date=lineText(l).match(/\b\d{2}\/\d{2}\/\d{4}\b/); if(date && !doc.date)doc.date=date[0];
      if(txt.includes('ת.משלוח') && !doc.number){const n=l.items.find(i=>/^\d{7,12}$/.test(i.str)); if(n)doc.number=n.str;}
      const fields=[['חיובבגיןמכירה','gross'],['חיובבגיןאריזות','packaging'],['חיובבגיןחוקהפיקדון','deposit'],['הנחותבחשבונית','discount'],['הפרשיעיגול','rounding'],['סהכחיובלפנימעמ','beforeVat'],['סהככוללמעמ','total']];
      const f=fields.find(([label])=>txt.includes(label));
      if(f){if(doc.summary[f[1]]!==undefined)throw new Error('נמצאו מספר סיכומי תעודות. יש לבחור תעודה אחת בכל פעם.');doc.summary[f[1]]=onlyAmount(l);}
      if(l.items.some(i=>compact(i.str)==='מסקניה') && l.items.filter(i=>numeric(i.str)).length===1)doc.summary.tax=onlyAmount(l);
      const vat=lineText(l).match(/(?:%\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*%)\s*מע["״]?מ/);
      if(vat){doc.vatBp=fixed(vat[1]||vat[2]);doc.summary.vat=onlyAmount(l);}
    }
    // Reject nonempty return tables rather than treating them as purchases.
    const ret=lines.findIndex(l=>compact(lineText(l)).includes('מוחזרות') && compact(lineText(l)).includes('אריזות') && !compact(lineText(l)).includes('סהכ'));
    if(ret>=0){for(const l of lines.slice(ret+1)){const t=compact(lineText(l));if(t.includes('סהכאריזותמוחזרות')||t.includes('מפרטהתחשבנות'))break;if(l.items.filter(i=>numeric(i.str)).length>=3)throw new Error('התעודה כוללת החזרות אריזות. בגרסה זו אפשר לקרוא תעודת אספקה ללא החזרות בלבד.');}}
    const supplyHeader=lines.find(l=>compact(lineText(l)).includes('שםהמוצר') && !compact(lineText(l)).includes('פיקדון'));
    if(supplyHeader && lines.some(l=>compact(lineText(l)).includes('מפרטאספקה'))){
      // In the supply table the total delivered count is the numeric column
      // immediately left of the product name; the other counts are order/free.
      for(const l of lines.filter(l=>l.y<supplyHeader.y-3)){
        if(compact(lineText(l)).includes('סהכ'))break;
        const nums=l.items.filter(i=>numeric(i.str)).sort((a,b)=>b.x-a.x);
        const barcode=nums.find(i=>/^\d{12,14}$/.test(i.str));
        if(!barcode)continue;
        const code=nums.find(i=>i.x<barcode.x && /^\d{4,8}$/.test(i.str));
        const counts=nums.filter(i=>code && i.x<code.x);
        if(code && counts.length)doc.supplyRows.push({code:code.str,barcode:barcode.str,quantityMilli:fixed(counts[0].str,3)});
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
      const anchors=Object.entries(columns).map(([k,i])=>({k,x:center(i)}));
      for(const l of lines.filter(l=>l.y<h.y-7)){
        const t=compact(lineText(l));
        if(t.includes('סהכ:')||t.includes('פירוטהמבצעים')||t.includes('מפרטהתחשבנות'))break;
        const vals={};
        for(const i of l.items.filter(i=>numeric(i.str))){
          const closest=[...anchors].sort((a,b)=>Math.abs(a.x-center(i))-Math.abs(b.x-center(i)))[0];
          if(Math.abs(closest.x-center(i))>22)continue; // promotion number, not a price
          if(vals[closest.k]!==undefined)throw new Error('שני ערכים באותה עמודה. נדרש לבדוק את התעודה.');
          vals[closest.k]=i.str;
        }
        const names=l.items.filter(i=>!numeric(i.str) && i.x>columns.quantityMilli.x && i.x<columns.code.x).sort((a,b)=>b.x-a.x).map(i=>i.str);
        if(!Object.keys(vals).length){if(names.length && doc.rows.length)doc.rows.at(-1).name+=' '+names.join(' ');continue;}
        if(!vals.code || Object.keys(columns).some(k=>vals[k]===undefined))throw new Error('שורת מוצר חסרה או לא ברורה: '+lineText(l));
        const row={id:`r${doc.rows.length}`,code:vals.code,name:names.join(' '),page:pages.indexOf(page)+1};
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
  const barcodes=new Map(doc.supplyRows.map(r=>[r.code,r.barcode]));
  doc.rows.forEach(r=>r.barcode=barcodes.get(r.code)||'');
  doc.validation=validateInvoice(doc);
  if(!doc.validation.ok){const error=new Error('החשבון לא עבר אימות. '+doc.validation.errors.join(' · '));error.details=doc.validation.errors;throw error;}
  return doc;
}
export async function readPdf(file, onProgress=()=>{}) {
  if(file.size>20*1024*1024)throw new Error('הקובץ גדול מ־20MB. בחר תעודה אחת בכל פעם.');
  const pdfjs=await import('./vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',import.meta.url).href;
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true});
  const pdf=await task.promise;
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
