(function(root){
'use strict';
const text=v=>String(v??'').trim();
const fold=v=>text(v).toLocaleUpperCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/İ/g,'I').replace(/ı/g,'I');
const header=v=>fold(v).replace(/[^A-Z0-9]/g,'');
const number=v=>fold(v).replace(/[\s./_-]/g,'');
function date(v){
 if(v instanceof Date)return Number.isNaN(v.getTime())?'':v.toISOString().slice(0,10);
 const m=text(v).match(/^(?:(\d{4})[./-](\d{1,2})[./-](\d{1,2})|(\d{1,2})[./-](\d{1,2})[./-](\d{4}))$/);if(!m)return '';
 const y=+(m[1]||m[6]),mo=+(m[2]||m[5]),d=+(m[3]||m[4]);if(y<1900||y>2100)return '';
 const value=`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 return new Date(Date.UTC(y,mo-1,d)).toISOString().slice(0,10)===value?value:'';
}
const dateHeader=v=>/^(EVRTAR|EVRAKTAR|EVRAKTARIHI|EVRTARIHI)$/.test(header(v));
const noHeader=v=>/^(EVRAKNO|EVRAKNUMARASI|ENRAKNO)$/.test(header(v));
function columns(values){const c={date:values.findIndex(dateHeader),no:values.findIndex(noHeader),party:values.findIndex(v=>header(v)==='ACIKLAMA')};return Object.values(c).every(n=>n>=0)?c:null;}
function record(no,when,party,meta){return {invoiceNo:text(no),invoiceDate:date(when),counterpartyName:text(party),sourceKind:'zirve-muavin',...meta};}
function sheetRows(rows,meta={}){
 let cols=null,recognized=false,last=null;const records=[];
 rows.forEach((row,i)=>{
  const next=columns(row);if(next){cols=next;recognized=true;last=null;return}if(!cols)return;
  if(row.some(v=>/ALTHISAPKODU|ALTHESAPKODU/.test(header(v)))){last=null;return}
  const no=text(row[cols.no]),party=text(row[cols.party]),when=row[cols.date];
  if(/^(ALTHESAPTOPLAMI|GENELTOPLAM|DEVIR|NAKLIYEKUN|TOPLAM)/.test(header(party))){last=null;return}
  if(no){last=record(no,when,party,{...meta,sourceRow:i+1});records.push(last)}
  else if(date(when)){last=record('',when,party,{...meta,sourceRow:i+1});records.push(last)}
  else if(party&&last&&!row.some((v,k)=>k!==cols.party&&text(v))){last.counterpartyName+=' '+party;}
 });return {recognized,records};
}
function groupLines(items){const lines=[];for(const item of items.filter(i=>text(i.text)).sort((a,b)=>b.y-a.y||a.x-b.x)){let l=lines.find(l=>Math.abs(l.y-item.y)<2);if(!l){l={y:item.y,items:[]};lines.push(l)}l.items.push(item);}return lines.sort((a,b)=>b.y-a.y).map(l=>({...l,items:l.items.sort((a,b)=>a.x-b.x)}));}
function pdfRows(pages,meta={}){
 const records=[];let recognized=false,carryHeader=null;
 for(const page of pages){let cols=carryHeader,last=null;
  for(const line of groupLines(page.items)){
   const items=line.items,values=items.map(i=>i.text),found=columns(values);
   if(found){cols={when:items[found.date],no:items[found.no],party:items[found.party],serial:items.find(i=>/^(SNO|SERINO)$/.test(header(i.text))),money:items.find(i=>header(i.text)==='BORC')};recognized=true;carryHeader=cols;last=null;continue}
   const joined=values.join(' ');if(/alt\s*hesap\s*toplam|genel\s*toplam|nakli\s*yek[uü]n/i.test(joined)){last=null;continue}
   if(!cols)continue;
   const when=items.find(i=>i.x>=cols.when.x-5&&i.x<(cols.serial?.x??cols.no.x)-2&&date(i.text));
   const invoice=items.find(i=>i.x>=(cols.serial?cols.serial.x+cols.serial.width:cols.when.x+cols.when.width)-2&&i.x<cols.no.x+cols.no.width+12&&/\d/.test(i.text)&&/^[A-Za-z0-9 ./_-]+$/.test(text(i.text)));
   if(!when&&!invoice){
    if(last&&items.every(i=>i.x>=last._partyX&&i.x<(cols.money?.x??Infinity)-3)&&!/(Firma\s*:|Alt Hesap|Muavin Defter|Sayfa No)/i.test(joined))last.counterpartyName+=' '+joined;
    continue;
   }
   // The description header is centered; use the end of the document-number cell.
   const partyX=invoice?invoice.x+invoice.width+2:cols.no.x+cols.no.width+12;
   const party=items.filter(i=>i.x>=partyX&&i.x<(cols.money?.x??Infinity)-3).map(i=>i.text).join(' ');
   last=record(invoice?.text||'',when?.text||'',party,{...meta,pageNumber:page.pageNumber,sourceRow:records.length+1,_partyX:partyX});records.push(last);
  }
 }
 records.forEach(r=>delete r._partyX);return {recognized,records};
}
const partyKey=v=>fold(v).replace(/[^A-Z0-9]/g,'');
function partyMatches(a,b){const x=partyKey(a),y=partyKey(b);if(!x||!y)return false;if(x===y)return true;const short=x.length<y.length?x:y,long=x.length<y.length?y:x;return short.length>=16&&long.startsWith(short);}
function summarize(rows){const groups=new Map(),unidentified=[];for(const r of rows){const no=number(r.invoiceNo);if(!no||!/[0-9]/.test(no)){unidentified.push(r);continue}const k=no+'|'+date(r.invoiceDate)+'|'+partyKey(r.counterpartyName);if(!groups.has(k))groups.set(k,{...r,invoiceNo:no,references:[]});groups.get(k).references.push(r);}return {rows:[...groups.values()],unidentified};}
function compare(source,target){
 const s=summarize(source),t=summarize(target),missing=[],extra=[],matched=[],review=[],seen=new Set();
 for(const inv of s.rows){const candidates=t.rows.filter(r=>number(r.invoiceNo)===number(inv.invoiceNo));
  if(!candidates.length){missing.push({invoice:inv,invoiceNo:inv.invoiceNo});continue}
  candidates.forEach(r=>seen.add(r));
  const exact=candidates.filter(r=>date(inv.invoiceDate)&&date(r.invoiceDate)===date(inv.invoiceDate)&&partyMatches(inv.counterpartyName,r.counterpartyName));
  if(candidates.length===1&&exact.length===1)matched.push({invoice:inv,target:exact[0],invoiceNo:inv.invoiceNo});
  else {let reasons=[];if(candidates.length>1)reasons.push('Aynı numarada birden fazla tarih/firma kaydı var');if(!date(inv.invoiceDate)||candidates.some(r=>!date(r.invoiceDate)))reasons.push('Fatura tarihi eksik');else if(candidates.some(r=>date(r.invoiceDate)!==date(inv.invoiceDate)))reasons.push('Fatura tarihi farklı');if(!inv.counterpartyName||candidates.some(r=>!r.counterpartyName))reasons.push('Karşı firma adı eksik');else if(candidates.some(r=>!partyMatches(inv.counterpartyName,r.counterpartyName)))reasons.push('Karşı firma adı farklı veya kısaltılmış');review.push({invoice:inv,candidates,invoiceNo:inv.invoiceNo,reasons});}
 }
 for(const r of t.rows)if(!seen.has(r))extra.push({invoice:r,invoiceNo:r.invoiceNo});
 for(const r of s.unidentified)review.push({invoice:r,invoiceNo:'Numara okunamadı',candidates:[],reasons:['Kaynak faturanın numarası okunamadı']});
 for(const r of t.unidentified)review.push({invoice:r,invoiceNo:'Numara okunamadı',candidates:[],reasons:['Muavin kaydında evrak numarası yok']});
 return {mode:'muavin',sourceCount:s.rows.length,targetCount:t.rows.length,missing,extra,matched,review,rawSourceCount:source.length,rawTargetCount:target.length};
}
const api={date,number,columns,sheetRows,pdfRows,partyMatches,compare};
if(typeof module!=='undefined')module.exports=api;root.MuavinCompare=api;
})(typeof window!=='undefined'?window:globalThis);
