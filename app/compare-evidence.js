/* Evidence used only by invoice comparison. Original invoice/stock readers stay intact. */
(function(root){
'use strict';
const M=root.MuavinCompare||(typeof require==='function'?require('./muavin-compare'):null);
const fold=v=>String(v??'').toLocaleUpperCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/İ/g,'I');
const key=v=>fold(v).replace(/[^A-Z0-9]/g,'');
const money=v=>{if(typeof v==='number')return Number.isFinite(v)?v:null;let s=String(v??'').trim().replace(/(?:TRY|TL|EUR|USD|₺|€|\$)/gi,'').replace(/\s/g,'');if(!s)return null;if(!/^-?[\d.,]+$/.test(s))return null;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');const n=Number(s);return Number.isFinite(n)?n:null;};
function labeledMoney(text,label,last=false){const lines=String(text||'').split(/\r?\n/);for(let step=0;step<lines.length;step++){const i=last?lines.length-1-step:step;const m=fold(lines[i]).match(label);if(!m)continue;const tail=lines[i].slice(m.index+m[0].length);let hit=tail.match(/(-?\d[\d.]*,\d{2}|-?\d+\.\d{2})(?!\d)\s*(TRY|TL|EUR|USD|₺|€|\$)?/i);if(!hit&&i+1<lines.length)hit=lines[i+1].match(/^\s*(-?\d[\d.]*,\d{2}|-?\d+\.\d{2})\s*(TRY|TL|EUR|USD|₺|€|\$)?\s*$/i);if(hit)return {value:money(hit[1]),currency:/EUR|€/.test(hit[2]||'')?'EUR':/USD|\$/.test(hit[2]||'')?'USD':/TRY|TL|₺/.test(hit[2]||'')?'TRY':null};}return null;}
function blockName(block){
 const parts=[];for(let line of String(block||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean)){
  const f=fold(line);
  if(/^(SAYIN|SATICI|ALICI)\s*:?.*$/.test(f)){line=line.replace(/^(SAYIN|SATICI|ALICI)\s*:?\s*/i,'');if(!line)continue;}
  if(/^(?:E-?FATURA|E-?ARSIV|FATURA|TARIH|ETTN|VERGI|VKN|TCKN|TEL|FAX|WEB|E-?POSTA|OZELLESTIRME|SENARYO|MERSIS|SUBENO|HIZMETNO|TICARETSICIL|ADRES|MAL HIZMET|SIRA|TOPLAM|HESAPLANAN|ODENECEK)/.test(f))break;
  if(/(?:^|\s)(?:MAH\.?|MAHALLESI|CAD\.?|CADDESI|SOK\.?|SOKAK|SK\.?|BLV\.?|BULVARI|DAIRE|KAPI|APT\.?|NO\s*:)(?:\s|$)/.test(f)||/[\d.,]+\s*(?:TL|TRY)|%|\b\d{10,11}\b/.test(f))break;
  if(!/[A-Z]/.test(f))break;
  if(parts.length&&key(parts[parts.length-1])===key(line))break;
  if(parts.length&&line.split(/\s+/).length===1&&!/^(SIRKETI|LIMITED|ANONIM|LTD\.?|STI\.?)$/.test(f))break;
  parts.push(line);if(parts.length>=5||/(?:ANONIM\s+SIRKETI|LIMITED\s+SIRKETI|LTD\.?\s*STI\.?|A\.?\s*S\.)$/.test(f))break;
 }return parts.join(' ').replace(/\s+/g,' ').trim();
}
function enrichInvoice(inv,client={}){
 const out={...inv,sourceKind:inv.sourceKind||'invoice'},raw=String(inv.rawText||'');
 const split=raw.search(/\bSAYIN\b/i);
 if(split>=0){const issuer=blockName(raw.slice(0,split)),receiver=blockName(raw.slice(split).replace(/\bSAYIN\b/i,''));const id=String(client.vkn||'');let role=id&&id===inv.issuerVkn?'receiver':id&&id===inv.receiverVkn?'issuer':inv.direction==='giden'?'receiver':'issuer';
  const name=role==='receiver'?receiver:issuer;if(name&&key(name)!==key(client.name)&&key(name)!==key(role==='receiver'?issuer:receiver)){out.originalCounterpartyName=inv.counterpartyName;out.counterpartyName=name;out.partyEvidence='Faturanın '+(role==='receiver'?'alıcı':'satıcı')+' bölümü';}}
 const net=labeledMoney(raw,/\b(?:NET\s+)?ODENECEK\s+(?:TUTAR|TOPLAM)/,true),base=labeledMoney(raw,/\bMAL\s*HIZMET\s*TOPLAM\s*TUTARI?/),discount=labeledMoney(raw,/\bTOPLAM\s*ISKONTO/);
 out.comparisonPayable=net?.value??null;out.comparisonService=base?Math.round((base.value-(discount?.value||0))*100)/100:null;out.amountCurrency=net?.currency||base?.currency||null;
 const withholdingBase=labeledMoney(raw,/\bTEVKIFATA\s+TABI\s+ISLEM\s+TUTARI\b/);
 out.comparisonWithholdingBase=withholdingBase?.value??null;
 out.comparisonServiceTotal=base?.value??null;
 out.isWithholdingInvoice=/\bFATURA\s*TIPI\s*:?\s*TEVKIFAT(?:IADE)?\b/.test(fold(raw))||withholdingBase!==null;
 if(/[\d.,]+\s*(?:TL|TRY)\b/.test(raw)&&!out.amountCurrency)out.amountCurrency='TRY';
 if(!out.partyEvidence&&/(?:\d[\d.,]*\s*(?:TL|TRY)|MAL H[Iİ]ZMET|TOPLAM TUTAR|HESAPLANAN|%)/i.test(out.counterpartyName||'')){out.originalCounterpartyName=out.counterpartyName;out.counterpartyName='';out.partyEvidence='Firma adı güvenilir okunamadı';}
 return out;
}
function positionedMoney(items,label){
 const clean=items.filter(i=>String(i.text||'').trim()).map(i=>({...i,text:String(i.text).trim(),height:Number(i.height)||8}));
 const anchors=[];
 for(const first of clean){let text=first.text,end=first.x+first.width;const rest=clean.filter(i=>i!==first&&Math.abs(i.y-first.y)<2&&i.x>=end-1).sort((a,b)=>a.x-b.x);
  for(let n=0;n<5;n++){if(label.test(fold(text))){anchors.push({...first,text,width:end-first.x});break;}const next=rest.shift();if(!next||next.x-end>Math.max(24,first.height*3))break;text+=' '+next.text;end=next.x+next.width;}
 }
 for(const anchor of anchors.sort((a,b)=>a.y-b.y)){
  const inline=labeledMoney(anchor.text,label);if(inline)return {...inline,method:'PDF etiket satırı'};
  const right=anchor.x+anchor.width,candidates=clean.filter(i=>i.x>=right-2&&Math.abs(i.y-anchor.y)<=Math.max(3,anchor.height*0.8)&&/^(?:TRY|TL|EUR|USD|₺|€|\$)?\s*-?\d[\d.,]*[,.]\d{2}\s*(?:TRY|TL|EUR|USD|₺|€|\$)?$/i.test(i.text));
  if(!candidates.length)continue;
  const nearest=Math.min(...candidates.map(i=>i.x-right));const cells=candidates.filter(i=>i.x-right<=nearest+2);
  const values=[...new Set(cells.map(i=>money(i.text)))];if(values.length!==1||values[0]===null)continue;
  const cell=cells[0];const currencyItem=clean.find(i=>/^(TRY|TL|EUR|USD|₺|€|\$)$/i.test(i.text)&&Math.abs(i.y-cell.y)<=cell.height*1.5&&i.x>=cell.x-2&&i.x<=cell.x+cell.width+15);
  const currencyText=cell.text+' '+(currencyItem?.text||'');const currency=/EUR|€/i.test(currencyText)?'EUR':/USD|\$/i.test(currencyText)?'USD':/TRY|TL|₺/i.test(currencyText)?'TRY':null;
  return {value:values[0],currency,method:'PDF etiketinin sağındaki tutar hücresi'};
 }return null;
}
function enrichPdfInvoice(inv,items,client={}){
 const out=enrichInvoice(inv,client);
 const fields=[['comparisonPayable',/\b(?:NET\s+)?ODENECEK\s+(?:TUTAR|TOPLAM)/],['comparisonServiceTotal',/\bMAL\s*HIZMET\s*TOPLAM\s*TUTARI?/],['comparisonWithholdingBase',/\bTEVKIFATA\s+TABI\s+ISLEM\s+TUTARI\b/]];
 for(const [field,label]of fields){const found=positionedMoney(items,label);if(found){out[field]=found.value;out[field+'Evidence']=found.method;if(found.currency&&(field==='comparisonPayable'||!out.amountCurrency))out.amountCurrency=found.currency;}}
 if(out.comparisonWithholdingBase!==null)out.isWithholdingInvoice=true;
 // Read the explicit e-invoice identifier when a displaced label yielded a word such as Tel/Vergi.
 if(!/\d/.test(out.invoiceNo||'')){const numbers=[...new Set((String(inv.rawText||'').toUpperCase().match(/\b[A-Z]{3}\d{13}\b/g)||[]))];if(numbers.length===1){out.originalInvoiceNo=out.invoiceNo;out.invoiceNo=numbers[0];}}
 // Some telecom invoices have no SAYIN block; their issuer header is still explicit and bounded.
 if(!out.counterpartyName&&out.issuerVkn&&out.issuerVkn!==client.vkn&&out.receiverVkn===client.vkn){const name=blockName(inv.rawText||'');if(name&&key(name)!==key(client.name)){out.counterpartyName=name;out.partyEvidence='Faturanın satıcı başlık bölümü';}}
 return out;
}
function accountFrom(values,previous=''){const s=values.join(' ');const m=fold(s).match(/(?:ALT|ANA)\s*HESAP\s*KODU\s*:?\s*([0-9][0-9.\-]*)/);return m?m[1]:previous;}
function ledgerMeta(debit,credit,account,currency='TRY'){
 debit=money(debit);credit=money(credit);const both=!!debit&&!!credit;let amount=both?null:debit||credit||(debit===0||credit===0?0:null);const head=String(account).slice(0,3);
 const basis='payable';
 return {ledgerDebit:debit,ledgerCredit:credit,ledgerAmount:amount,ledgerAccount:account,amountBasis:basis,amountCurrency:currency,ledgerAmountIssue:both?'Aynı satırda borç ve alacak birlikte var':''};
}
const originalSheet=M.sheetRows;
M.sheetRows=function(rows,meta={}){const parsed=originalSheet(rows,meta);let account='',cols=null,currency='TRY';const byRow=new Map(parsed.records.map(r=>[r.sourceRow,r]));
 rows.forEach((row,index)=>{account=accountFrom(row,account);if(/\b(?:USD|EUR)\b/.test(row.join(' ')))currency=row.join(' ').match(/\b(USD|EUR)\b/)[1];if(M.columns(row))cols={debit:row.findIndex(v=>key(v)==='BORC'),credit:row.findIndex(v=>key(v)==='ALACAK')};const r=byRow.get(index+1);if(r)Object.assign(r,ledgerMeta(cols?.debit>=0?row[cols.debit]:null,cols?.credit>=0?row[cols.credit]:null,account,currency));});return parsed;};
function lines(items){const out=[];for(const i of items.filter(i=>String(i.text).trim()).sort((a,b)=>b.y-a.y||a.x-b.x)){let l=out.find(l=>Math.abs(l.y-i.y)<2);if(!l){l={y:i.y,items:[]};out.push(l);}l.items.push(i);}return out.map(l=>({...l,items:l.items.sort((a,b)=>a.x-b.x)}));}
const originalPdf=M.pdfRows;
M.pdfRows=function(pages,meta={}){const parsed=originalPdf(pages,meta);let account='',cols=null;const used=new Set();for(const page of pages){for(const l of lines(page.items)){
 const values=l.items.map(i=>i.text);account=accountFrom(values,account);if(M.columns(values)){cols={debit:l.items.find(i=>key(i.text)==='BORC'),credit:l.items.find(i=>key(i.text)==='ALACAK')};continue;}
 const r=parsed.records.find(r=>!used.has(r)&&r.pageNumber===page.pageNumber&&l.items.some(i=>M.number(i.text)===M.number(r.invoiceNo))&&l.items.some(i=>M.date(i.text)===r.invoiceDate));if(!r||!cols)continue;used.add(r);
 const cell=h=>{if(!h)return null;const v=l.items.find(i=>/^-?[\d.]+,\d{2}$/.test(String(i.text).trim())&&Math.abs((i.x+i.width)-(h.x+h.width))<12);return v?.text??null;};
 Object.assign(r,ledgerMeta(cell(cols.debit),cell(cols.credit),account));
 }}return parsed;};
const legalKey=v=>key(fold(v).replace(/ANONIM\s+SIRKETI|A\s*\.\s*S\.?/g,' AS ').replace(/LIMITED\s+SIRKETI|LTD\s*\.?\s*STI\.?/g,' LTDSTI '));
M.partyMatches=function(a,b){if(!key(a)||!key(b))return false;if(legalKey(a)===legalKey(b))return true;const x=key(a),y=key(b),short=x.length<y.length?x:y,long=x.length<y.length?y:x;return short.length>=16&&long.startsWith(short);};
function summarize(rows){const groups=new Map(),unidentified=[];for(const r of rows){const no=M.number(r.invoiceNo);if(!no||!/[0-9]/.test(no)){unidentified.push(r);continue;}const k=[no,M.date(r.invoiceDate),key(r.counterpartyName),r.ledgerAccount||'',r.ledgerAmount??'',r.comparisonPayable??'',r.comparisonService??'',r.amountCurrency||'',r.vkn||'',r.ledgerCredit??'',r.comparisonWithholdingBase??'',r.comparisonServiceTotal??'',r.isWithholdingInvoice??''].join('|');if(!groups.has(k))groups.set(k,{...r,invoiceNo:no,references:[]});groups.get(k).references.push(r);}return {rows:[...groups.values()],unidentified};}
const ledger=r=>r.sourceKind==='zirve-muavin';
function amountPair(a,b){
 const mixed=ledger(a)!==ledger(b),invoice=mixed?(ledger(a)?b:a):null;
 const basis=mixed?(invoice.isWithholdingInvoice?'withholding-base':'service-total'):'payable';
 const value=r=>mixed?(ledger(r)?r.ledgerCredit:invoice.isWithholdingInvoice?r.comparisonWithholdingBase:r.comparisonServiceTotal):ledger(r)?r.ledgerAmount:r.comparisonPayable;
 const x=value(a),y=value(b),label=mixed?(invoice.isWithholdingInvoice?'Tevkifata Tabi İşlem Tutarı ↔ Muavin Alacak':'Mal Hizmet Toplam Tutarı ↔ Muavin Alacak'):'Net ödenecek / muavinde yazılı hareket tutarı';
 if(a.amountCurrency&&b.amountCurrency&&a.amountCurrency!==b.amountCurrency)return {checked:false,conflict:true,reason:'Para birimleri farklı'};
 if(!a.amountCurrency||!b.amountCurrency)return {checked:false,reason:'Para birimi okunamadı'};
 if(!Number.isFinite(x)||!Number.isFinite(y)){const reason=mixed?(!Number.isFinite((ledger(a)?a:b).ledgerCredit)?'Muavinin Alacak sütunundaki tutar okunamadı':invoice.isWithholdingInvoice?'Tevkifata Tabi İşlem Tutarı satırı okunamadı':'Mal Hizmet Toplam Tutarı satırı okunamadı'):a.ledgerAmountIssue||b.ledgerAmountIssue||'Karşılaştırılacak tutar okunamadı';return {checked:false,basis,label,reason};}
 const diff=(Math.round(x*100)-Math.round(y*100))/100;return {checked:true,equal:Math.abs(diff)<=0.01,source:x,target:y,difference:diff,basis,label,currency:a.amountCurrency};
}
M.compare=function(source,target){const s=summarize(source),t=summarize(target),missing=[],extra=[],matched=[],review=[],seen=new Set();for(const inv of s.rows){const candidates=t.rows.filter(r=>M.number(r.invoiceNo)===M.number(inv.invoiceNo));if(!candidates.length){missing.push({invoice:inv,invoiceNo:inv.invoiceNo});continue;}candidates.forEach(r=>seen.add(r));
 if(candidates.length!==1||s.rows.filter(r=>M.number(r.invoiceNo)===M.number(inv.invoiceNo)).length!==1){review.push({invoice:inv,candidates,invoiceNo:inv.invoiceNo,reasons:['Aynı numarada birden fazla farklı kayıt var; tek belge olarak doğrulanamadı']});continue;}
 const target=candidates[0],amount=amountPair(inv,target),notes=[],reasons=[];const sameParty=M.partyMatches(inv.counterpartyName,target.counterpartyName),sameDate=!!M.date(inv.invoiceDate)&&M.date(inv.invoiceDate)===M.date(target.invoiceDate);
 if(!sameDate)reasons.push(!inv.invoiceDate||!target.invoiceDate?'Belge tarihi eksik':'Belge tarihi farklı');
 if(!sameParty)reasons.push(!inv.counterpartyName||!target.counterpartyName?'Firma adı eksik veya okunamadı':'Firma adı farklı');else if(key(inv.counterpartyName)!==key(target.counterpartyName))notes.push('Unvan kısaltması / yazım farkı kabul edildi');
 if(inv.vkn&&target.vkn&&inv.vkn!==target.vkn)reasons.push('Karşı firma VKN/TCKN farklı');
 if(amount.conflict)reasons.push(amount.reason);else if(amount.checked&&!amount.equal)reasons.push(amount.basis==='payable'?'Net tutar farklı':'Faturadaki esas tutar ile muavin Alacak tutarı farklı');else if(!amount.checked)reasons.push('Tutar doğrulanamadı: '+amount.reason);
 const row={invoice:inv,target,candidates,invoiceNo:inv.invoiceNo,amount,notes,reasons,matchBasis:reasons.length?'Belge numarası bulundu; aşağıdaki bilgiler uyuşmuyor':amount.basis==='payable'?'Fatura numarası, tarih, firma ve net tutar eşleşti':'Fatura numarası, tarih, firma ve muavin için esas alınan tutar eşleşti'};
 if(reasons.length)review.push(row);else matched.push(row);
 }for(const r of t.rows)if(!seen.has(r))extra.push({invoice:r,invoiceNo:r.invoiceNo});for(const [rows,label]of [[s.unidentified,'Gelen kayıtta'],[t.unidentified,'Bendeki kayıtta']])for(const r of rows)review.push({invoice:r,invoiceNo:'Numara okunamadı',candidates:[],reasons:[label+' evrak numarası yok']});return {mode:'muavin',sourceCount:s.rows.length,targetCount:t.rows.length,missing,extra,matched,review,rawSourceCount:source.length,rawTargetCount:target.length};};
Object.assign(M,{money,enrichInvoice,enrichPdfInvoice,positionedMoney,amountPair,ledgerMeta});if(typeof module!=='undefined')module.exports=M;
})(typeof window!=='undefined'?window:globalThis);
