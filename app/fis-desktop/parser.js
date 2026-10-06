// Amounts arrive from both OCR (spaces/repeated separators) and structured QR fields.
export function money(value){
 if(typeof value==='number')return Number.isFinite(value)?value:NaN;
 if(value==null||String(value).trim()==='')return NaN;
 let s=String(value).replace(/\s/g,'').replace(/(?:TL|TRY|₺)/gi,'').replace(/^[*×+]/,'');
 if(!/^\d+(?:[.,]\d+)*$/.test(s))return NaN;
 const last=Math.max(s.lastIndexOf('.'),s.lastIndexOf(','));
 if(last>=0){const decimals=s.length-last-1;s=decimals===1||decimals===2?s.slice(0,last).replace(/[.,]/g,'')+'.'+s.slice(last+1):s.replace(/[.,]/g,'');}
 return Number(s);
}
const amounts=s=>[...s.matchAll(/(?<![\d.,])\d+(?:[.,]\d{3}| \d{3})*[.,]\s?\d{2}(?!\d|[.,]\d)/g)].map(m=>money(m[0])).filter(Number.isFinite);
export function mergeQr(d,q){
 // Missing QR fields must never erase a valid OCR value; party identity stays role-specific.
 const result={...d};for(const key of ['vkn','aciklama','evrak_no','evrak_tarihi','toplam'])if(q[key]!==''&&q[key]!=null)result[key]=q[key];
 if(q.kalemler?.length)result.kalemler=q.kalemler;
 for(const key of ['is_invoice','is_z_report','qr_raw','qr_currency','qr_warnings'])if(q[key]!=null)result[key]=q[key];
 return result;
}
export function parseDraft(text='',kind='gider',qrs=[]){
 const norm=s=>s.toLocaleUpperCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/İ/g,'I');
 text=text.replace(/％/g,'%');
 const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),u=norm(text);
 const isZ=/\bZ\s+(GUNLUK\s+)?RAPOR|Z\s*SAYAC/.test(u),invoice=/FATURA|E-ARSIV/.test(u)&&!isZ;
 let block=lines.slice(0,18);const sayin=lines.findIndex(l=>/^SAYIN\b/.test(norm(l)));
 if(invoice&&kind==='gelir'){block=sayin>=0?lines.slice(sayin,sayin+16):[];}
 else if(sayin>=0)block=lines.slice(0,sayin);
 const party=block.join('\n');
 const vknFound=pickVkn(party);
 const title=pickTitle(block,invoice&&kind==='gelir'&&sayin>=0,vknFound);
 const dm=findDate(lines);
 const nm=isZ?u.match(/Z\s*(?:NO|SAYAC)[ \t]*[:.]?[ \t]*(\d[\d. ]*)/):u.match(/(?:FATURA|BELGE|FIS)\s*(?:NO|NUMARASI)\s*[:.#]?\s*([A-Z0-9-]*\d[A-Z0-9-]*)/);
 let docNo=nm?nm[1].replace(/[. ]/g,''):'';
 if(invoice){const invoiceNo=lines.filter(l=>!/(?:SAP|SIPARIS|IRSALIYE)/.test(norm(l))).map(l=>norm(l).match(/FATURA\s*(?:NO|NUMARASI)\s*[:.]?\s*([A-Z0-9]{3}20\d{2}\d{9})\b/)).find(Boolean);if(invoiceNo)docNo=invoiceNo[1];}
 {const lead=docNo.match(/^(\d{1,12})[A-Z]{2,}$/);if(lead)docNo=lead[1];}
 if(/^\d+$/.test(docNo))docNo=docNo.replace(/^0+(?=\d)/,'');
 const amount=money;
 let total='',totalPriority=-1;
 for(let i=0;i<lines.length;i++){const n=norm(lines[i]);const priority=/ODENECEK|VERGILER DAHIL|KDV DAHIL TOPLAM/.test(n)?3:/GENEL TOPLAM|(?:^|[^A-Z])T[O0]PLAM\b|^TOP\s|^TUTAR\b/.test(n)?2:0;
  if((isZ&&/%\s*\d/.test(n))||!priority||/KUM|FIS|ADET|TOP\s*KDV|TOPLAM KDV|KDV\s*TOP|TOPLAM ISKONTO|ARA TOPLAM|MATRAH|INDIRIM|PUAN|USTU|NAKIT|KREDI|KARTI|VISA|MASTER/.test(n))continue;
  let nums=amounts(lines[i]);if(!nums.length&&lines[i+1]&&/^[*×+\d\s.,]+(?:TL|TRY)?$/.test(lines[i+1]))nums=amounts(lines[i+1]);
  if(nums.length&&priority>=totalPriority){total=nums.at(-1).toFixed(2);totalPriority=priority;}
 }
 // Payment/POS copies can repeat the same payment. Do not infer a total from
 // multiple payment lines: equal amounts can also represent distinct payments.
 if(!total){const payments=[],changes=[];for(let i=0;i<lines.length;i++){
  const n=norm(lines[i]),pay=/^(?:NAKIT|KREDI|K\.?\s?KARTI|BANKA KARTI|VISA|MASTER)/.test(n),change=/PARA\s*USTU/.test(n);
  if(!pay&&!change)continue;let nums=amounts(lines[i]);
  if(!nums.length&&lines[i+1]&&/^[*×+\d\s.,]+(?:TL|TRY)?$/.test(lines[i+1]))nums=amounts(lines[i+1]);
  if(nums.length)(pay?payments:changes).push(nums.at(-1));
 }if(payments.length===1&&changes.length<=1&&payments[0]-(changes[0]||0)>0)total=(payments[0]-(changes[0]||0)).toFixed(2);}

 const rates=[...new Set([...u.matchAll(/%\s*0?(\d{1,2})\b/g)].map(m=>+m[1]).filter(x=>[0,1,8,10,18,20].includes(x)))];
 const ocrVat=[];
 // Z tax breakdown prints gross revenue and VAT separately. Only TOPLAM is gross.
 const zGross=new Map();
 if(isZ)for(let i=0;i<lines.length;i++){
  const n=norm(lines[i]);
  if(!/TOPLAM/.test(n)||/KDV|MATRAH|KUM|IPTAL/.test(n))continue;
  const rm=/%\s*0?(0|1|8|10|18|20)\b/.exec(n);if(!rm)continue;
  const rest=n.slice(0,rm.index)+n.slice(rm.index+rm[0].length);
  let nums=amounts(rest);
  if(!nums.length){const integer=/TOPLAM\s*[:*×+]?\s*(\d+)\s*(?:TL|TRY)?$/.exec(rest);if(integer)nums=[Number(integer[1])];}
  if(!nums.length&&lines[i+1]&&/^[*×+\d\s.,]+(?:TL|TRY)?$/.test(lines[i+1])){const value=money(lines[i+1]);if(Number.isFinite(value))nums=[value];}
  if(nums.length)zGross.set(+rm[1],vatLine(+rm[1],nums.at(-1)));
 }

 for(const line of lines){const normalized=norm(line);const m=/KDV\s*%\s*(\d{1,2})(?:[.,]00)?\s*\(?(?:MATRAH)\s*[:.]?\s*([\d.,]+)/.exec(normalized);if(m&&[0,1,8,10,18,20].includes(+m[1])){const base=amount(m[2]);if(Number.isFinite(base))ocrVat.push({oran:Number(m[1]).toFixed(2),matrah:base.toFixed(2),kdv:(Math.round(base*Number(m[1]))/100).toFixed(2)});}}
 // Tax summaries: calculated VAT, taxable base, and per-rate gross totals.
 for(let i=0;!isZ&&i<lines.length;i++){const n=norm(lines[i]),rm=/%\s*0?(\d{1,2})(?:[.,]00)?\b/.exec(n);if(!rm||!rates.includes(+rm[1]))continue;
  const rest=n.slice(rm.index+rm[0].length);let nums=amounts(rest);
  if(!nums.length&&lines[i+1]&&/^[*×+\d\s.,]+(?:TL|TRY)?$/.test(lines[i+1]))nums=amounts(lines[i+1]);
  if(!nums.length)continue;const rate=+rm[1];let row;
  if(/MATRAH/.test(n)){const base=nums[0];row={oran:rate.toFixed(2),matrah:base.toFixed(2),kdv:(Math.round(base*rate)/100).toFixed(2)};}
  else if(/HESAPLANAN|TOPKDV|KDV/.test(n)&&! /DAHIL/.test(n)&&rate>0){const tax=nums.at(-1);row={oran:rate.toFixed(2),matrah:(Math.round(tax*10000/rate)/100).toFixed(2),kdv:tax.toFixed(2)};}
  else if(/TOPLAM/.test(n))row=vatLine(rate,nums.at(-1));
  if(row&&!ocrVat.some(l=>l.oran===row.oran))ocrVat.push(row);
 }
 // A clearly printed total tax can recover a single damaged percent sign, never a mixed-rate guess.
 if(total&&!ocrVat.length){const taxLine=lines.find(l=>/TOPKDV|TOPLAM KDV/.test(norm(l)));const tax=taxLine&&amounts(taxLine).at(-1);
  if(tax>0){const candidates=[1,8,10,18,20].filter(r=>Math.abs(Number(vatLine(r,total).kdv)-tax)<=0.03);if(candidates.length===1&&(!rates.length||rates.includes(candidates[0])))ocrVat.push(vatLine(candidates[0],total));}
 }
 // Recover item rates only when both gross and printed tax reconcile; OCR 820/220 can mean %20.
 const itemTotals=new Map();let printedTax=null,uncertainItemRate=false;
 for(let i=0;i<lines.length;i++){const line=lines[i],n=norm(line);if(/TOPKDV|TOPLAM KDV|^KDV(?:\s|:|$)/.test(n)&&!/%/.test(n)){let nums=amounts(line);if(!nums.length&&lines[i+1]&&/^[*×+\d\s.,]+(?:TL|TRY)?$/.test(lines[i+1]))nums=amounts(lines[i+1]);if(nums.length)printedTax=nums.at(-1);}
  if(/TOPLAM|TOPKDV|KDV|MATRAH|ODENECEK/.test(n))continue;
  let item=n;
  if(/%\s*0?(?:0|1|8|10|18|20)\s*$/.test(n)&&lines[i+1]&&/^[*×+\d\s.,]+(?:TL|TRY)?$/.test(lines[i+1]))item+=' '+lines[i+1];
  const rateMatch=/(?:^|\s)(%\s*|[W$]|[82](?=20\s)|[.,](?=0?[018]\s))?(0?0|0?1|8|10|18|20)\s+[*×]?\s*([^\n]+?)\s*(?:TL)?$/.exec(item);
  if(rateMatch){
   let gross=money(rateMatch[3]),clean=/^\d[\d., ]*[.,]\s*\d{2}$/.test(rateMatch[3]);
   if(!clean||!Number.isFinite(gross)){
    // Receipt printers repeat quantity × unit price directly above each item.
    // Use it only for an explicitly identified VAT row, then reconcile the entire receipt.
    gross=NaN;
    for(let j=i-1;j>=Math.max(0,i-2);j--){const q=/^([0-9I]+(?:[.,]\d+)?)\s*(?:AD|ADET|KG|GR|LT)?\s*[X×*]\s*(\d[\d., ]*[.,]\d{2})\s*$/.exec(norm(lines[j]));if(q){gross=money(q[1].replace(/I/g,'1'))*money(q[2]);break;}if(/%/.test(lines[j]))break;}
   }
   if(Number.isFinite(gross)){uncertainItemRate ||= !rateMatch[1]||/[.,W$82]/.test(rateMatch[1]);itemTotals.set(+rateMatch[2],(itemTotals.get(+rateMatch[2])||0)+gross);}
  }
 }
 const itemRows=[...itemTotals].map(([rate,gross])=>vatLine(rate,gross));
 if(total&&itemRows.length&&(!uncertainItemRate||printedTax!=null)&&Math.abs(itemRows.reduce((s,l)=>s+Number(l.matrah)+Number(l.kdv),0)-Number(total))<=0.02&&(printedTax==null||Math.abs(itemRows.reduce((s,l)=>s+Number(l.kdv),0)-printedTax)<=0.03)){ocrVat.splice(0,ocrVat.length,...itemRows);}
 if(isZ&&zGross.size)ocrVat.splice(0,ocrVat.length,...zGross.values());
 const uniqueVat=[...new Map(ocrVat.map(l=>[l.oran,l])).values()];
 if(!total&&uniqueVat.length)total=uniqueVat.reduce((sum,l)=>sum+Number(l.matrah)+Number(l.kdv),0).toFixed(2);
 const d={kind,is_invoice:invoice,is_z_report:isZ,aciklama:isZ?'Z RAPORU':title,vkn:isZ?'':vknFound,evrak_no:docNo,evrak_tarihi:dm||'',toplam:total,kalemler:[],ocr:text,review_ack:false};
 if(uniqueVat.length)d.kalemler=uniqueVat;else if(total&&rates.length===1&&(printedTax==null||Math.abs(Number(vatLine(rates[0],total).kdv)-printedTax)<=0.03))d.kalemler=[vatLine(rates[0],total)];
 if(uniqueVat.length)d.ocr_warnings=['KDV matrahı metinden okundu; hesaplanan toplamı belgeyle kontrol edin.'];
 for(const qr of qrs){const m=qr.match(/^(\d{10})\s+(\d{2})-(\d{2})-(\d{4})\s+(\d{3,6})\s/);if(m&&!isZ&&!(invoice&&kind==='gelir')){d.vkn=m[1];d.evrak_tarihi=`${m[2]}.${m[3]}.${m[4]}`;d.evrak_no=m[5].replace(/^0+(?=\d)/,'');break;}}
 for(const {raw,q} of (isZ?[]:qrs).map(raw=>({raw,q:parseQr(raw,kind)})).filter(x=>x.q).sort((a,b)=>((!!b.q.vkn)+ (!!b.q.evrak_no)+(!!b.q.toplam)+b.q.kalemler.length)-((!!a.q.vkn)+(!!a.q.evrak_no)+(!!a.q.toplam)+a.q.kalemler.length))){if(q){
  Object.assign(d,mergeQr(d,q));
  for(const key of ['evrak_no','evrak_tarihi','toplam'])if(q[key]!==''&&q[key]!=null)d[key]=q[key];
  if(q.aciklama)d.aciklama=q.aciklama;
  if(q.kalemler.length)d.kalemler=q.kalemler;
  Object.assign(d,{is_invoice:q.is_invoice,qr_raw:raw,qr_currency:q.qr_currency,qr_warnings:q.qr_warnings});break;
 }}
 d.aciklama=normalizeTitle(d.aciklama);d.tarih=d.evrak_tarihi;d.mobile_ocr=true;return excludeAutomaticZero(d);
}
export function vatLine(rate,gross){const n=money(gross),r=Number(rate),base=Math.round(n/(1+r/100)*100)/100;return {oran:r.toFixed(2),matrah:base.toFixed(2),kdv:(Math.round((n-base)*100)/100).toFixed(2)};}

// GIB e-Fatura/e-Arsiv payload; supplier and customer identifiers are distinct.
export function parseQr(raw,kind='gider'){
 let obj;let source=String(raw).replace(/^\uFEFF/,'').trim();
 try{if(/^https?:/.test(source)){const url=new URL(source);const value=[...url.searchParams.values()].find(v=>v.trim().startsWith('{'));if(value)source=value;}if(source.startsWith('%7B')||source.startsWith('%7b'))source=decodeURIComponent(source);obj=JSON.parse(source);if(typeof obj==='string')obj=JSON.parse(obj);}catch{
  const start=source.indexOf('{'),end=source.lastIndexOf('}');if(start<0||end<start){source='{'+source+'}';}
  try{obj=JSON.parse(source.slice(Math.max(0,source.indexOf('{')),source.lastIndexOf('}')+1).replace(/[“”]/g,'"'));}catch{
   obj={};for(const m of source.matchAll(/["“']?([a-zA-Z]+(?:\([\d.,]+\))?)["”']?\s*:\s*(?:["“']([^"”'\r\n]*)["”']|([^,}\r\n]+))/g))obj[m[1]]=m[2]??m[3];
  }
 }
 if(!obj||typeof obj!=='object'||Array.isArray(obj))return null;
 const entries=Object.entries(obj).map(([k,v])=>[k.toLocaleLowerCase('tr-TR').replace(/ı/g,'i').replace(/[\s_\-]/g,''),v]);
 const p=Object.fromEntries(entries);
 const aliases={no:['faturano','faturanumarasi','belgeno','invoicenumber'],vkntckn:['vkn','tckn','saticivkntckn','saticivkn'],avkntckn:['alicivkntckn','alicivkn','alicitckn'],tarih:['faturatarihi','duzenlemetarihi'],odenecek:['odenecektutar','odeneceknettutar','payableamount'],vergidahil:['vergidahiltoplamtutar','kdvdahiltoplam','toplamtutar']};
 for(const [key,names] of Object.entries(aliases))if(p[key]==null){const name=names.find(n=>p[n]!=null);if(name)p[key]=p[name];}
 
 if(!p.no&&!p.vkntckn&&!p.avkntckn)return null;
 const str=v=>v==null?'':String(v).trim();
 const num=v=>{const n=money(v);return Number.isFinite(n)&&n>=0?n:null;};
 const date=str(p.tarih);const m=/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(date);
 const vkn=str(kind==='gelir'?p.avkntckn:p.vkntckn);
 const title=str(kind==='gelir'?(p.aliciunvan||p.aunvan):(p.saticiunvan||p.unvan));
 let total=num(p.odenecek??p.vergidahil);const rates=new Map(),warnings=[];
 for(const [key,value] of entries){const match=/^(kdvmatrah|hesaplanankdv)\(?%?(\d+(?:[.,]\d+)?)\)?$/.exec(key);if(!match)continue;
  const rate=Number(match[2].replace(',','.'));if(![0,1,8,10,18,20].includes(rate)){warnings.push('Desteklenmeyen KDV oranı: '+rate);continue;}
  const row=rates.get(rate)||{};row[match[1]]=num(value);rates.set(rate,row);
 }
 const lines=[];
 for(const [rate,row] of rates){let base=row.kdvmatrah,vat=row.hesaplanankdv;
  if(base==null&&vat!=null&&rate>0)base=Math.round(vat*100/rate*100)/100;
  if(vat==null&&base!=null)vat=Math.round(base*rate)/100;
  if(base==null||vat==null){warnings.push('%'+rate+' KDV satırının tutarı eksik.');continue;}
  lines.push({oran:rate.toFixed(2),matrah:base.toFixed(2),kdv:vat.toFixed(2)});
 }
 if(total==null&&lines.length)total=Math.round(lines.reduce((s,l)=>s+Number(l.matrah)+Number(l.kdv),0)*100)/100;
 if(!lines.length)warnings.push('Kodda KDV dağılımı bulunamadı; eksik satırları tamamlayın.');
 if(!/^\d{10,11}$/.test(vkn))warnings.push((kind==='gelir'?'Alıcının':'Satıcının')+' VKN/TCKN bilgisi kodda eksik.');
 if(total==null)warnings.push('Kodda ödenecek tutar bulunamadı.');
 if(total!=null&&lines.length&&Math.abs(lines.reduce((s,l)=>s+Number(l.matrah)+Number(l.kdv),0)-total)>0.02)warnings.push('Ödenecek tutar ile KDV dağılımı farklı; tevkifat/diğer vergileri kontrol edin.');
 const currency=str(p.parabirimi).toUpperCase()||'TRY';if(!['TRY','TRL','TL'].includes(currency))warnings.push('Dövizli belge: '+currency+'. TL tutarları ayrıca doğrulanmalı.');
 return {kind,is_invoice:true,is_z_report:false,aciklama:title,vkn,evrak_no:str(p.no),evrak_tarihi:m?`${m[3]}.${m[2]}.${m[1]}`:date,tarih:m?`${m[3]}.${m[2]}.${m[1]}`:date,toplam:total==null?'':total.toFixed(2),kalemler:lines,ocr:'',qr_raw:String(raw),qr_currency:currency,qr_warnings:warnings,review_ack:false};
}

export function matchVendor(d,vendors=[]){
 if(d.is_z_report)return d;
 const norm=s=>NORM(s).replace(/[^A-Z0-9]/g,'');
 const lev=(a,b)=>{const m=[...Array(b.length+1).keys()];for(let i=1;i<=a.length;i++){let p=m[0];m[0]=i;for(let j=1;j<=b.length;j++){const t=m[j];m[j]=Math.min(m[j]+1,m[j-1]+1,p+(a[i-1]===b[j-1]?0:1));p=t;}}return m[b.length];};
 const digits=v=>String(v??'').replace(/\D/g,'');d.vkn=digits(d.vkn);let found=d.vkn?vendors.find(v=>digits(v.vkn)===d.vkn&&String(v.name||'').trim()):null,note='Cari: VKN eşleşmesi';
 if(!found&&d.vkn&&!isValidVkn(d.vkn)){
  const near=vendors.filter(v=>String(v.vkn).length===d.vkn.length&&[...String(v.vkn)].filter((c,i)=>c!==d.vkn[i]).length<=1);
  if(near.length===1&&norm(d.aciklama||'').length>=8&&norm(d.aciklama)===norm(near[0].name)){found=near[0];note='Cari: VKN OCR hatası cariden düzeltildi';}
 }
 if(!found&&(!d.vkn||!isValidVkn(d.vkn))&&d.kind!=='gelir'){
  const raw=d.ocr||'',names=norm(raw);
  const c=vendors.filter(v=>{const name=norm(v.name);return (name.length>=15&&names.includes(name))||raw.split(/\r?\n/).some(l=>/MERSIS/.test(NORM(l))&&l.replace(/\D/g,'').startsWith('0'+v.vkn)&&l.replace(/\D/g,'').length===16);});
  if(c.length===1){found=c[0];note='Cari: ünvan eşleşmesi';}
  else if(!c.length&&d.aciklama&&norm(d.aciklama).length>=8){
   const t=norm(d.aciklama),f=vendors.filter(v=>{const n=norm(v.name);return 1-lev(t,n)/Math.max(t.length,n.length)>=0.85;});
   if(f.length===1){found=f[0];note='Cari: ünvan benzerliği';}
  }
 }
 if(found){d.vkn=digits(found.vkn);d.aciklama=found.name;d.vendor_source=note;}
 return d;
}

const NORM=s=>String(s??'').toLocaleUpperCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/İ/g,'I');
export function isValidVkn(v){
 v=String(v||'');
 if(/^\d{10}$/.test(v)){let sum=0;for(let i=0;i<9;i++){const t=(+v[i]+9-i)%10;let x=(t*2**(9-i))%9;if(t!==0&&x===0)x=9;sum+=x;}return (10-sum%10)%10===+v[9];}
 if(/^\d{11}$/.test(v)){if(v[0]==='0')return false;const d=[...v].map(Number);const odd=d[0]+d[2]+d[4]+d[6]+d[8],even=d[1]+d[3]+d[5]+d[7];return ((odd*7-even)%10+10)%10===d[9]&&d.slice(0,10).reduce((a,b)=>a+b,0)%10===d[10];}
 return false;
}
const DIGITFIX={O:'0',I:'1',L:'1',S:'5',B:'8'};
function pickVkn(party){
 const n=NORM(party),found=[];
 const res=[/(?:T\.?C\.?K\.?N|V\.?K\.?N|V\.?\s*N(?:O)?\.?|T\.?C\.?\s*(?:KIMLIK\s*)?NO|VERGI\s*(?:KIMLIK\s*)?(?:NO|NUMARASI))\s*[:.]?\s*([0-9OILSB](?:[ \t]*[0-9OILSB]){9,10})\b/g,/(?:V\.?D\.?|VERGI\s*DAIRESI)[^\n\d]{0,35}(\d{10,11})\b/g];
 for(const re of res)for(const m of n.matchAll(re)){if((m[1].match(/\d/g)||[]).length<8)continue;found.push(m[1].replace(/\s/g,'').replace(/[OILSB]/g,c=>DIGITFIX[c]));}
 return found.find(isValidVkn)||found[0]||'';
}
const NOT_TITLE=/ADRES|\bMAH\b|MAHALLE|\bSK\b|\bSOK\b|SOKAK|\bCAD\b|CADDE|BULVAR|\bBLV\b|\bNO\s*[:.]|\bTEL\b|\bFAX\b|\bGSM\b|VKN|TCKN|VERGI|\bV\.?D\b|WWW|@|\.COM|\.NET|MERSIS|SICIL|\bKASA\b|\bFIS\b|FATURA|ARSIV|BELGE|TARIH|\bSAAT\b|KASIYER|SATIS|MUSTERI|HOSGELD|TESEKKUR|\bEKU\b|\bZ\s*NO|\bPOS\b|TERMINAL|ISYERI|ONAY|MALI|IRSALIYE|SIPARIS|PLAKA|TOPLAM|\bKDV\b|TUTAR|FIYAT|ISKONTO|\bTL\b|\bADET\b|\bKG\b/;
const STRONG=/(?:\bA\.?\s?S\.?(?=\s|$|,)|\bANONIM\b|\bLIMITED\b|\bLTD\b|\bSTI\b|\bSIRKETI\b|\bKOLL\b|\bKOOP|\bHOLDING\b)/;
const MEDIUM=/\b(?:TICARET|TIC|SANAYI|SAN|PAZARLAMA|MARKET|GIDA|INSAAT|TURIZM|ECZANE|OTOMOTIV|PETROL|AKARYAKIT|RESTORAN|LOKANTA|KAFE|CAFE|BUFE|KIRTASIYE|TEKSTIL)\b/;
const CONT=/^(?:VE\s|TIC|SAN|LTD|STI|LIMITED|ANONIM|A\.?\s?S\b|SIRKET|PAZ|INS|TUR|GIDA|OTO|TEKS|DIS\s|IC\s)/;
const PRICE_RE=/(?<![\d.,])\d+(?:[.,]\d{3})*[.,]\d{2}(?!\d)/,DATE_RE=/(?<!\d)\d{1,2}\s*[.\/-]\s*\d{1,2}\s*[.\/-]\s*(?:20)?\d{2}(?!\d)/;
export const looksLikeProduct=t=>{const n=NORM(t);return /\d+\s*[X*]\s*\d/.test(n)||/\b\d+\s*(?:ADET|AD|KG|GR|LT|ML)\b/.test(n)||PRICE_RE.test(n)||/%\s*\d/.test(n)||/^\d/.test(n);};
function pickTitle(lines,afterSayin,vkn=''){
 let stop=lines.findIndex((l,i)=>i>0&&(PRICE_RE.test(l)||DATE_RE.test(l)||/^(?:TARIH|SAAT|FIS\s*NO|KASIYER|URUN|MIKTAR|ADET|TOPLAM|KDV|SIRA)\b/.test(NORM(l))));
 if(stop<0||stop>14)stop=Math.min(lines.length,14);
 let best=null;
 lines.forEach((raw,i)=>{
  let t=raw.trim(),sayin=false;
  if(/^SAYIN\b/.test(NORM(t))){t=t.replace(/^SAYIN\s*[:.]?\s*/i,'');sayin=true;if(!t)return;}
  const n=NORM(t);
  if(t.length<3||t.length>160||!/[A-Z]{3}/.test(n)||NOT_TITLE.test(n)||looksLikeProduct(t))return;
  if(((n.match(/\d/g)||[]).length)>(n.match(/[A-Z]/g)||[]).length*0.3)return;
  const header=i<stop,strong=STRONG.test(n),medium=MEDIUM.test(n);
  if(!header&&!strong&&!sayin)return;
  const prevSayin=afterSayin&&i>0&&/^SAYIN\s*$/.test(NORM(lines[i-1]));
  const score=(strong?8:0)+(medium?3:0)+(header?3:0)+(i<3?2:0)+(sayin||prevSayin?6:0)+(t===t.toLocaleUpperCase('tr-TR')?1:0)-i*0.15;
  if(score<4.5)return;
  if(!best||score>best.score)best={score,i,t};
 });
 const person=(l)=>{const t=(l||'').trim(),n=NORM(t);if(!t||/\d/.test(t)||NOT_TITLE.test(n)||STRONG.test(n)||MEDIUM.test(n)||/SUBE|MAGAZA|\bAVM\b|MERKEZ|PLAZA|CARSI|\bDEPO|SATIS|SITESI|SUBESI|LOKASYON|BOLGE|\bSEHIR|ILCE|TESEKKUR|HOSGELD|BIZI|NOLU/.test(n)||looksLikeProduct(t))return false;const w=t.split(/\s+/);return w.length>=2&&w.length<=4&&w.every(x=>/^[A-Za-zÇĞİÖŞÜçğıöşü.]{2,}$/.test(x))&&t.length<=40;};
 let pi=-1;for(let k=0;k<Math.min(stop,6);k++)if(person(lines[k])&&(k!==best?.i)){const priceNext=lines[k+1]&&PRICE_RE.test(lines[k+1])&&!/[A-Za-z]{3}/.test(lines[k+1]);if(!priceNext){pi=k;break;}}
 if(pi>=0&&(/^\d{11}$/.test(vkn)||(best&&pi===best.i+1&&!STRONG.test(NORM(best.t))))&&(!best||pi<=best.i+2)){return lines[pi].trim().replace(/\s+/g,' ');}
 if(!best){return pi>=0&&/^\d{11}$/.test(vkn)?lines[pi].trim():'';}
 let {t}=best;const bi=best.i;let i=bi;
 const SUF=new Set('INS INSA INSAAT SAN SANAYI TIC TICARET LTD STI SIRKETI LIMITED ANONIM AS A S PAZ PAZARLAMA TUR TURIZM VE GIDA OTO OTOMOTIV TEKS TEKSTIL DIS IC NAK NAKLIYAT TAS TASIMA TASIMACILIK ULUSLARARASI MUH TAAH'.split(' '));
 const suffixOnly=x=>{const w=NORM(x).replace(/[^A-Z0-9]/g,' ').split(/\s+/).filter(Boolean);return w.length>0&&w.every(k=>SUF.has(k));};
 const titleLike=x=>x&&!NOT_TITLE.test(NORM(x))&&!looksLikeProduct(x)&&/[A-Z]{3}/.test(NORM(x))&&!/^SAYIN\s*$/i.test(x.trim())&&x.trim().length<=160;
 let k0=0;while(k0<3&&i>0&&suffixOnly(lines[i])&&titleLike(lines[i-1])){t=lines[i-1].trim()+' '+t;i--;k0++;}
 for(let k=1;k<=2;k++){const nx=lines[bi+k];if(!nx)break;const nn=NORM(nx);if(CONT.test(nn)&&!NOT_TITLE.test(nn)&&!looksLikeProduct(nx))t+=' '+nx.trim();else break;}
 return t.replace(/\s+/g,' ').replace(/^[^A-Za-z0-9ÇĞİÖŞÜçğıöşü]+|[\s,;:-]+$/g,'');
}
export function validDate(d,m,y){const t=new Date(Date.UTC(y,m-1,d));return y>=2000&&y<=2100&&t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d;}
function findDate(lines){
 let best=null;
 lines.forEach(line=>{
  const n=NORM(line);
  for(const m of line.matchAll(/(?<!\d)(\d{1,2})\s*[.\/-]\s*(\d{1,2})(?:\s*[.\/-]\s*(\d{4}|\d{2})|(20\d{2}))(?!\d)/g)){
   const d=+m[1],mo=+m[2];let y=+(m[3]||m[4]);if(y<100)y+=2000;
   if(!validDate(d,mo,y))continue;
   const prio=/VADE|SON ODEME|IRSALIYE|SIPARIS/.test(n)?-5:/TARIH/.test(n)?3:0;
   if(!best||prio>best.prio)best={prio,v:String(d).padStart(2,'0')+'.'+String(mo).padStart(2,'0')+'.'+y};
  }
 });
 return best?.v||'';
}
export function checkDoc({type,vkn,date,total,gross,title}){
 const w=[],t=Number(total);
 if(type!=='z'){
  if(vkn&&!isValidVkn(vkn))w.push('VKN/TCKN doğrulanamadı (kontrol basamağı tutmuyor). Fişteki numarayla karşılaştırın.');
  if(!vkn)w.push('VKN/TCKN boş.');
  if(title&&looksLikeProduct(title))w.push('Firma ünvanı bir ürün satırına benziyor; ünvanı kontrol edin.');
 }
 if(!/^\d{2}\.\d{2}\.\d{4}$/.test(date||'')||!validDate(...String(date).split('.').map(Number)))w.push('Tarih GG.AA.YYYY biçiminde olmalı.');
 if(!(t>0))w.push('Toplam tutar okunamadı.');
 else if(Number.isFinite(gross)&&Math.abs(gross-t)>0.05)w.push('KDV satırları toplamı ('+gross.toFixed(2)+') belge toplamıyla ('+t.toFixed(2)+') uyuşmuyor.');
 return w;
}

export function normalizeTitle(value){return String(value||'').replace(/\bT[Iİıi]C\./gi,'TİC.').replace(/\b[SŞsş]T[Iİıi]\./gi,'ŞTİ.').replace(/\bA\.?[SŞsş]\.(?=\s|$)/gi,'A.Ş.');}
export function excludeAutomaticZero(d){
 if(d.vat_manually_reviewed||d.zero_excluded)return d;
 const rows=d.kalemler||[],zero=rows.filter(l=>Number(l.oran)===0).reduce((s,l)=>s+Number(l.matrah)+Number(l.kdv),0);
 if(zero>0&&Number.isFinite(money(d.toplam))){d={...d,original_total:d.toplam,toplam:Math.max(0,money(d.toplam)-zero).toFixed(2),kalemler:rows.filter(l=>Number(l.oran)!==0),zero_excluded:zero.toFixed(2)};}
 return d;
}
