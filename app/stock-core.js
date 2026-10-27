(function(root){
'use strict';
const num=v=>{if(typeof v==='number')return v;let s=String(v??'').trim();if(!s)return NaN;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');return Number(s)};
const cents=v=>Math.round(num(v)*100);
const key=v=>String(v||'').trim().toLocaleUpperCase('tr-TR').replace(/\s+/g,' ');
function unit(v){const s=key(v);return ({C62:'ADET',AD:'ADET',ADET:'ADET',TNE:'TON',TON:'TON',KGM:'KG',KİLOGRAM:'KG',KILOGRAM:'KG',KG:'KG',BX:'KUTU',KUTU:'KUTU',LTR:'LİTRE',LT:'LİTRE',MTR:'METRE'})[s]||s}
function productName(v){const fixes={CAM:'ÇAM',CAMN:'ÇAM','ÇAMN':'ÇAM',OMRUK:'TOMRUK',TOMNRUK:'TOMRUK',TOMURK:'TOMRUK',TOMRKU:'TOMRUK',TOMRUKK:'TOMRUK'};return key(v).replace(/[^A-ZÇĞİÖŞÜ0-9]+/g,' ').split(' ').filter(Boolean).map(x=>fixes[x]||x).join(' ')}
function lines(text){const out=[];for(const raw of text.split('\n')){const m=raw.match(/^\s*(\d+)\s+(.+?)\s+(\d[\d.,]*)\s*(Adet|AD|C62|TON|TNE|KG|KGM|KUTU|BX|LİTRE|LITRE|LT|LTR|METRE|MTR|M2|M3|PAKET|ÇUVAL|CUVAL)\b/i);if(m)out.push({name:productName(m[2]),quantity:num(m[3]),unit:unit(m[4]),stock:true,source:raw})}return out}
function parties(text){
 const split=String(text).search(/\bSAYIN\b/i);if(split<0)return {issuerName:'',receiverName:''};
 function name(block){const rows=block.split('\n').map(x=>x.trim()).filter(Boolean),out=[];for(let row of rows){if(!out.length&&(/^[\d.\/-]+\s+\d{1,2}:\d{2}/.test(row)||/^(e-Belge|e-?Arşiv Fatura|e-?Fatura)$/i.test(row)))continue;if(/^(VKN|TCKN|Vergi|Tel|Fax|Web|E-?Posta|ETTN|Fatura|Özelleştirme|Senaryo)/i.test(row)||/\b(MAH\.?|MAHALLESİ|CAD\.?|CADDESİ|SOK\.?|SOKAK|BLOK|SİTESİ|Sitesi|NO\s*:|KAPI)\b/i.test(row)||row.includes('/'))break;if(/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(row))out.push(row);if(/(ŞİRKETİ|SIRKETI|ŞTİ\.?|STI\.?|A\.Ş\.?)$/i.test(row)||out.length===3)break;}return out.join(' ')}
 return {issuerName:name(text.slice(0,split)),receiverName:name(text.slice(split).replace(/^SAYIN\s*/i,''))};
}
function direction(i,c){if(i.sellerVkn===c.vkn&&i.buyerVkn!==c.vkn)return 'giden';if(i.buyerVkn===c.vkn&&i.sellerVkn!==c.vkn)return 'gelen';return ''}
function validate(i,c){const e=[];if(!direction(i,c))e.push('Satıcı/alıcı VKN kendi firmanızla tekil eşleşmeli.');for(const p of ['seller','buyer']){if(!/^\d{10,11}$/.test(i[p+'Vkn']||''))e.push('Taraf VKN/TCKN eksik.');if(!i[p+'Name']?.trim()||/[�□]/.test(i[p+'Name']))e.push('Firma unvanı eksik veya bozuk karakter içeriyor.');}if(!/^\d{4}-\d{2}-\d{2}$/.test(i.date)||Number.isNaN(Date.parse(i.date+'T12:00:00'))||new Date(i.date+'T12:00:00Z').toISOString().slice(0,10)!==i.date)e.push('Fatura tarihi geçersiz.');if(i.date?.slice(0,7)<c.start)e.push('Fatura başlangıç döneminden önce; firma başlangıcını düzenleyin.');if(!i.number?.trim())e.push('Fatura numarası gerekli.');for(const n of ['vat','deductible','total'])if(!Number.isSafeInteger(i[n])||i[n]<0)e.push('Tutarlar geçerli ve negatif olmayan değerler olmalı.');if(i.deductible>i.vat)e.push('İndirilecek KDV fatura KDV tutarını aşamaz.');if(!i.lines.length)e.push('En az bir mal/hizmet satırı gerekli.');for(const l of i.lines)if(!l.name?.trim()||/[�□]/.test(l.name)||!Number.isFinite(l.quantity)||l.quantity<=0||!l.unit?.trim())e.push('Ürün adı, pozitif miktar ve birim gerekli.');return [...new Set(e)]}
function duplicate(a,b){return a.companyId===b.companyId&&((a.hash&&a.hash===b.hash)||(a.ettn&&b.ettn&&key(a.ettn)===key(b.ettn))||(a.sellerVkn&&a.sellerVkn===b.sellerVkn&&a.number&&key(a.number)===key(b.number)))}
function periods(c,invoices,end){let carry=c.opening||0;const rows=[];for(let m=c.start;m<=end;){let incoming=0,outgoing=0;for(const i of invoices.filter(i=>i.companyId===c.id&&i.approved&&!i.deleted&&normalizeDate(i.date)&&i.date.slice(0,7)===m)){if(i.type==='iptal')continue;const d=direction(i,c);if(i.type==='iade'){if(d==='gelen')outgoing+=i.vat;else incoming+=i.deductible}else if(d==='gelen')incoming+=i.deductible;else if(d==='giden')outgoing+=i.vat;}const due=Math.max(0,outgoing-incoming-carry),next=Math.max(0,carry+incoming-outgoing);rows.push({period:m,opening:carry,incoming,outgoing,due,carry:next});carry=next;const [y,mo]=m.split('-').map(Number);m=mo===12?`${y+1}-01`:`${y}-${String(mo+1).padStart(2,'0')}`;}return rows}
function stock(c,invoices,start,end,month='all'){const map=new Map(),moves=[];for(const i of invoices){if(i.companyId!==c.id||!i.approved||i.deleted||i.type==='iptal'||!normalizeDate(i.date)||!direction(i,c)||i.date>end)continue;const sign=direction(i,c)==='gelen'?1:-1;for(const l of i.lines){if(l.stock===false)continue;const name=productName(l.name),k=name+'|'+unit(l.unit);if(!map.has(k))map.set(k,{name,unit:unit(l.unit),opening:0,incoming:0,outgoing:0,balance:0});const s=map.get(k);const q=l.quantity*sign;s.balance+=q;if(i.date<start)s.opening+=q;if(i.date>=start&&(month==='all'||i.date.slice(5,7)===month)){if(q>0)s.incoming+=q;else s.outgoing-=q;moves.push({date:i.date,number:i.number,party:sign>0?i.sellerName:i.buyerName,vkn:sign>0?i.sellerVkn:i.buyerVkn,name,unit:unit(l.unit),incoming:Math.max(0,q),outgoing:Math.max(0,-q),type:i.type})}}}return {items:[...map.values()].map(s=>({...s,balance:Math.round(s.balance*1e6)/1e6})),moves}}

function normalizeDate(value){
 const m=String(value||'').trim().match(/^(?:(\d{4})[./-](\d{1,2})[./-](\d{1,2})|(\d{1,2})[./-](\d{1,2})[./-](\d{4}))$/);
 if(!m)return '';const y=+(m[1]||m[6]),mo=+(m[2]||m[5]),d=+(m[3]||m[4]);
 if(y<2000||y>2100||mo<1||mo>12||d<1||d>31)return '';
 const result=y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
 return new Date(Date.UTC(y,mo-1,d)).toISOString().slice(0,10)===result?result:'';
}
function invoiceDate(raw,spatialDate){
 const matches=[...String(raw||'').matchAll(/Fatura\s*Tarihi\s*:?\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})(?!\d)/gi)];
 const dates=[...new Set([...matches.map(m=>normalizeDate(m[1])),normalizeDate(spatialDate)].filter(Boolean))];
 return {date:dates.length===1?dates[0]:'',conflict:dates.length>1};
}
function importRange(invoices){
 const dates=invoices.map(i=>normalizeDate(i.date)).filter(Boolean).sort();
 if(!dates.length)return null;
 const first=dates[0],last=dates.at(-1);
 return {from:first.slice(0,4),to:last.slice(0,4),month:first.slice(0,7)===last.slice(0,7)?first.slice(5,7):'all'};
}
function automaticIssues(i,c,info,roles){
 const issues=validate(i,c);
 if(i.dateConflict)issues.push('Fatura tarihleri çelişiyor; kaynak PDF üzerinden düzeltin.');
 if(!roles.sectionConfidence)issues.push('Satıcı/alıcı ayrımı kontrol edilmeli.');
 if(info.mathOk!==true||!(i.total>0))issues.push('Fatura toplamları kontrol edilmeli.');
 if(i.special)issues.push('Tevkifat veya özel işlem KDV tutarını kontrol edin.');
 if(!['normal','iade'].includes(i.type))issues.push('Belge türü kontrol edilmeli.');
 return [...new Set(issues)];
}

const api={normalizeDate,invoiceDate,importRange,automaticIssues,parties,num,cents,key,unit,productName,lines,direction,validate,duplicate,periods,stock};if(typeof module!=='undefined')module.exports=api;root.StockCore=api;
})(typeof window!=='undefined'?window:globalThis);
