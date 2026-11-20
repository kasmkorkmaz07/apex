/* Additive adapter: the original PDF/ZIP invoice reader and legacy comparison stay intact. */
(function(){
'use strict';
const M=window.MuavinCompare;
let resultFilter='all';
let resultSearch='', resultFrom='', resultTo='';
const style=document.createElement('style');
style.textContent='.muavin-result-row{display:flex!important;flex-direction:column;align-items:stretch;gap:6px;min-width:0}.muavin-result-row>*{min-width:0;overflow-wrap:anywhere}.muavin-result-row button{align-self:flex-start}.muavin-summary .excel-control-stats{grid-template-columns:repeat(3,minmax(0,1fr))}';
document.head.append(style);
async function readWorkbook(file){
 if(!window.XLSX)throw Error('Excel okuyucu yüklenemedi. Apex’i yeniden açın.');
 const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false,cellText:true});
 let recognized=false;const records=[];
 for(const sheetName of wb.SheetNames){
  const sheet=wb.Sheets[sheetName],rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',range:0});let cols=null;
  rows.forEach((row,index)=>{const found=M.invoiceReportColumns(row)||M.columns(row);if(found){cols=found;return}if(!cols)return;
   const when=row[cols.date];if(typeof when==='number'){const d=XLSX.SSF.parse_date_code(when,{date1904:!!wb.Workbook?.WBProps?.date1904});row[cols.date]=d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:'';}
   const noCell=sheet[XLSX.utils.encode_cell({r:index,c:cols.no})];if(noCell?.t==='n')row[cols.no]=noCell.w||String(noCell.v);
  });
  const meta={fileName:file.name,sheetName};
  const report=M.invoiceReportRows(rows,meta);
  const parsed=report.recognized?report:M.sheetRows(rows,meta);recognized ||= parsed.recognized;records.push(...parsed.records);
 }
 if(!recognized)throw Error('Fatura listesinde Fatura No, Fatura Tarihi ve Cari Adı / Unvan sütunları; muavinde Evrak No, Evrak Tarihi ve Açıklama sütunları gerekli.');
 if(!records.length)throw Error('Başlıklar bulundu ancak karşılaştırılacak kayıt okunamadı.');
 return records;
}
async function detectLedgerPdf(file){
 if(!window.pdfjsLib)throw Error('PDF okuyucu yüklenemedi. Apex’i yeniden açın.');
 const pdf=await pdfjsLib.getDocument(pdfJsDocumentOptions(await file.arrayBuffer())).promise;
 const pages=[];let ledgerTitle=false;
 try{for(let n=1;n<=pdf.numPages;n++){
  const content=await(await pdf.getPage(n)).getTextContent();
  const items=content.items.map(i=>({text:i.str||'',x:i.transform[4],y:i.transform[5],width:i.width||0,height:i.height||0}));
  ledgerTitle ||= /muavin\s*defter/i.test(items.map(i=>i.text).join(' '));
  pages.push({pageNumber:n,items,text:pdfTextContentToLines(content)});
 }}finally{await pdf.destroy();}
 const parsed=M.pdfRows(pages,{fileName:file.name});return {...parsed,ledgerTitle,pages};
}
window.processInvoiceCompareInputFile=async function(file,context,side,depth=0){
 const ext=file.name.split('.').pop().toLowerCase();
 if(ext==='zip'){
  if(depth>=4)throw Error('ZIP iç içe klasör sınırı aşıldı; içteki dosyayı doğrudan ekleyin.');
  const archive=await JSZip.loadAsync(file),out=[];
  for(const entry of Object.values(archive.files).filter(e=>!e.dir&&/\.(pdf|xlsx|xls|zip)$/i.test(e.name))){
   const child=new File([await entry.async('uint8array')],entry.name.split('/').pop());
   const rows=await processInvoiceCompareInputFile(child,context,side,depth+1);
   out.push(...rows.map(r=>({...r,fileName:file.name+' / '+entry.name+(r.pageNumber?' · Sayfa '+r.pageNumber:'')})));
  }
  if(!out.length)throw Error('ZIP içinde okunabilir PDF veya Excel kaydı bulunamadı.');return out;
 }
 if(['xlsx','xls'].includes(ext))return readWorkbook(file);
 if(ext==='pdf'){
  const parsed=await detectLedgerPdf(file);
  if(parsed.recognized){
   if(!parsed.records.length)throw Error('Muavin başlıkları bulundu ancak kayıt okunamadı; Excel çıktısını kullanın.');
   const fileUrl=URL.createObjectURL(file),pdfStoreId=await persistInvoicePdfFile(file,file.name);
   return parsed.records.map(r=>({...r,fileUrl,pdfStoreId}));
  }
  if(parsed.ledgerTitle)throw Error('Muavin sütunları okunamadı. Metni seçilebilir PDF veya Zirve Excel çıktısını yükleyin.');
  const rows=await processInvoiceInputFile(file,context);
  return rows.map(row=>{const page=parsed.pages.find(p=>p.pageNumber===Number(row.pageNumber||1));const usePage=page&&!/ocr/i.test(row.readMode||'');const text=usePage&&page.text.length>String(row.rawText||'').length?page.text:row.rawText;return M.enrichPdfInvoice({...row,rawText:text},usePage?page.items:[],context.client);});
 }
 if(ext!=='pdf')throw Error('PDF, Excel (XLSX/XLS) veya ZIP dosyası ekleyin.');
 return (await processInvoiceInputFile(file,context)).map(row=>M.enrichInvoice(row,context.client));
};

window.runInvoiceCompare=function(){

 if(!invoiceCompareState.source.length||!invoiceCompareState.target.length){alert('Her iki tarafa da fatura veya muavin kayıtlarını ekleyin.');return;}
 invoiceCompareState.result=M.compare(invoiceCompareState.source,invoiceCompareState.target);resultFilter='all';
 const r=invoiceCompareState.result;
 invoiceCompareStatus(`${r.missing.length} bende yok, ${r.extra.length} karşı tarafta yok, ${r.review.length} kayıt farklı veya eksik bilgi içeriyor. ${r.matched.length} eşleşen kayıt gizlendi.`,r.missing.length||r.review.length||r.extra.length?'warn':'ok');
 renderInvoiceCompare();
};
function moneyText(value,currency='TRY'){return Number.isFinite(value)?new Intl.NumberFormat('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value)+' '+currency:'Okunamadı';}
function info(inv){return [inv.invoiceDate||'Tarih okunamadı',inv.counterpartyName||'Firma adı okunamadı'].join(' · ');}
function amountInfo(inv,other){
 if(inv.sourceKind==='zirve-muavin')return 'Muavin Alacak: '+moneyText(inv.ledgerCredit,inv.amountCurrency)+' · Borç: '+moneyText(inv.ledgerDebit,inv.amountCurrency)+' · Hesap: '+(inv.ledgerAccount||'Okunamadı');
 const net='Net ödenecek: '+moneyText(inv.comparisonPayable,inv.amountCurrency);
 return other?.sourceKind==='zirve-muavin'?net+' · '+(inv.isWithholdingInvoice?'Tevkifata Tabi İşlem Tutarı: '+moneyText(inv.comparisonWithholdingBase,inv.amountCurrency):'Mal Hizmet Toplam Tutarı: '+moneyText(inv.comparisonServiceTotal,inv.amountCurrency)):net;
}
function comparisonDetail(row){const a=row.amount;return (row.matchBasis?'<strong>'+escapeHtml(row.matchBasis)+'</strong>':'')+(a?.checked?'<span>'+escapeHtml(a.label+': '+moneyText(a.source,a.currency)+' ↔ '+moneyText(a.target,a.currency)+' · Fark: '+moneyText(a.difference,a.currency))+'</span>':'')+(row.notes||[]).map(n=>'<small>'+escapeHtml(n)+'</small>').join('');}
function location(inv){return [inv.fileName,inv.sheetName?`${inv.sheetName} / satır ${inv.sourceRow}`:inv.pageNumber?`Sayfa ${inv.pageNumber}`:''].filter(Boolean).join(' · ');}
function preview(inv){return inv.fileUrl?`<button class="icon-btn eye-btn" onclick="openInvoicePdf('${escapeAttr(inv.fileUrl)}',${Number(inv.pageNumber||1)},'${escapeAttr(inv.pdfStoreId||'')}')" title="Kaynağı görüntüle">${eyeIcon()}</button>`:'';}
const originalRender=window.renderInvoiceCompareResult;
window.renderInvoiceCompareResult=function(){
 const r=invoiceCompareState.result;document.getElementById('invoice-compare-summary')?.classList.toggle('muavin-summary',r?.mode==='muavin');
 if(r?.mode!=='muavin'){document.getElementById('muavin-result-controls')?.remove();return originalRender();}
 const summary=document.querySelector('#invoice-compare-summary .excel-control-stats'),list=document.getElementById('invoice-compare-results');if(!summary||!list)return;
 summary.innerHTML=[[r.sourceCount,'Gelen kayıtlar'],[r.targetCount,'Bendeki kayıtlar'],[r.matched.length,'Eşleşen'],[r.missing.length,'Bende yok'],[r.review.length,'Bilgi / tutar farkı'],[r.extra.length,'Yalnızca bende']].map(([count,label])=>`<div class="excel-control-stat"><strong>${count}</strong><span>${label}</span></div>`).join('');
 let filterBox=document.getElementById('muavin-result-controls');
 if(!filterBox){
  filterBox=document.createElement('div');filterBox.id='muavin-result-controls';
  filterBox.style.cssText='display:flex;flex-wrap:wrap;gap:10px;margin:12px 0;flex-shrink:0';
  list.before(filterBox);
 }
 const focused=document.activeElement?.id, caret=document.activeElement?.selectionStart;
 filterBox.innerHTML=`<label>Durum <select id="muavin-result-filter">${[['all','Eksik ve farklı kayıtlar'],['missing','Bende yok'],['review','Bilgi / tutar farkı'],['extra','Yalnızca bende'],['matched','Eşleşen kayıtlar']].map(([value,label])=>`<option value="${value}" ${value===resultFilter?'selected':''}>${label}</option>`).join('')}</select></label><label>Ara <input id="muavin-result-search" type="search" placeholder="Fatura no, firma veya VKN" value="${escapeAttr(resultSearch)}"></label><label>Başlangıç <input id="muavin-result-from" type="date" value="${escapeAttr(resultFrom)}"></label><label>Bitiş <input id="muavin-result-to" type="date" value="${escapeAttr(resultTo)}"></label><button id="muavin-filter-clear" type="button">Filtreleri temizle</button><span id="muavin-filter-count" aria-live="polite"></span>`;
 const groups=[['review',r.review,'Bilgi / tutar farkı'],['missing',r.missing,'Bendeki kayıtlarda bulunamadı'],['extra',r.extra,'Bende var, karşı tarafta yok'],['matched',r.matched,'Eşleşen kayıt']];
 const query=resultSearch.trim().toLocaleLowerCase('tr-TR');
 const rows=groups.filter(([type])=>resultFilter==='all'?type!=='matched':type===resultFilter).flatMap(([type,rows,label])=>rows.filter(row=>{
  const records=[row.invoice,...(row.candidates||[row.target].filter(Boolean))];
  const searchable=records.map(inv=>[inv.invoiceNo,inv.counterpartyName,inv.vkn].join(' ')).join(' ').toLocaleLowerCase('tr-TR');
  const date=row.invoice.invoiceDate||'';
  return (!query||searchable.includes(query))&&(!resultFrom||date>=resultFrom)&&(!resultTo||(!!date&&date<=resultTo));
 }).map(row=>{
  const targets=row.candidates||[row.target].filter(Boolean);
  return `<div class="excel-missing-row invoice-compare-result-row muavin-result-row"><strong>${escapeHtml(label)} · ${escapeHtml(row.invoiceNo)}</strong><span>${escapeHtml(info(row.invoice))}</span><small>${escapeHtml(amountInfo(row.invoice,row.target||targets[0]))}</small>${comparisonDetail(row)}<small>${escapeHtml(location(row.invoice))}</small>${preview(row.invoice)}${row.reasons?.length?`<span style="color:var(--danger,#b45309)">${escapeHtml(row.reasons.join(' · '))}</span>`:''}${targets.map(t=>`<span>Bendeki kayıt: ${escapeHtml(info(t))}</span><small>${escapeHtml(amountInfo(t,row.invoice))}</small><small>${escapeHtml(location(t))}${t.references?.length>1?` · ${t.references.length} kayıt satırı`:''}</small>${preview(t)}`).join('')}</div>`;
 }));
 list.innerHTML=rows.join('')||'<div class="timeline-item">Seçilen filtrelere uygun kayıt yok.</div>';
 document.getElementById('muavin-filter-count').textContent=rows.length+' kayıt gösteriliyor';
 document.getElementById('muavin-result-filter').onchange=e=>{resultFilter=e.target.value;renderInvoiceCompareResult();};
 document.getElementById('muavin-result-search').oninput=e=>{resultSearch=e.target.value;renderInvoiceCompareResult();};
 document.getElementById('muavin-result-from').onchange=e=>{resultFrom=e.target.value;renderInvoiceCompareResult();};
 document.getElementById('muavin-result-to').onchange=e=>{resultTo=e.target.value;renderInvoiceCompareResult();};
 document.getElementById('muavin-filter-clear').onclick=()=>{resultFilter='all';resultSearch='';resultFrom='';resultTo='';renderInvoiceCompareResult();};
 if(focused==='muavin-result-search'){const input=document.getElementById(focused);input.focus();if(caret!==null)input.setSelectionRange(caret,caret);}
};
const originalClientRender=window.renderInvoiceCompare;
window.renderInvoiceCompare=function(){originalClientRender();for(const side of ['source','target']){const rows=invoiceCompareState[side],el=document.getElementById(`invoice-compare-${side}-name`);if(el&&rows.some(r=>r.sourceKind==='zirve-muavin'))el.textContent=`${rows.length} fatura / muavin kaydı okundu`;}};
})();
