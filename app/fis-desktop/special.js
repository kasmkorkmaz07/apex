// Invoice type is distinct from e-invoice scenario. Never infer ledger side
// from who issued a return invoice: the selected side describes the original trade.
const norm=s=>String(s||'').toLocaleUpperCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/İ/g,'I');
export function invoiceType(d){return norm(d.invoice_type||((norm(d.ocr).match(/FATURA\s*TIPI\s*:?\s*(TEVKIFATIADE|TEVKIFAT|IADE|SATIS|ISTISNA|IHRACKAYITLI)/)||[])[1])||'SATIS');}
export const isReturn=d=>['IADE','TEVKIFATIADE'].includes(invoiceType(d));
export const isWithholding=d=>['TEVKIFAT','TEVKIFATIADE'].includes(invoiceType(d));
export const typeRank=d=>isWithholding(d)?0:isReturn(d)?1:2;
export function specialFields(text,number){
 const u=norm(text),lines=u.split(/\r?\n/),lastAmount=line=>{const a=[...line.replace(/%\s*\d+(?:[.,]\d+)?/g,'').matchAll(/\d+(?:[.,]\d{3})*[.,]\d{2}(?!\d)/g)];return a.length?number(a.at(-1)[0]):NaN;};
 const type=(u.match(/FATURA\s*TIPI\s*:?\s*(TEVKIFATIADE|TEVKIFAT|IADE|SATIS|ISTISNA|IHRACKAYITLI)/)||[])[1]||'';
 const w={code:'',ratio:'',amount:'',subject_vat:'',payable:''};
 const code=u.match(/(?:TEVKIFAT\s*SEBEBI|KDV\s*TEVKIFAT)\s*:?\s*[-\[]*\s*(6\d{2})\b/);if(code)w.code=code[1];
 let gross='',tax='';const candidates=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i],value=lastAmount(line),v=Number.isFinite(value)?value:lastAmount(lines[i+1]||'');
  if(/VERGILER\s*DAHIL\s*TOPLAM|KDV\s*DAHIL\s*TOPLAM/.test(line)&&Number.isFinite(v))gross=v.toFixed(2);
  if(/ODENECEK\s*(?:NET\s*)?TUTAR/.test(line)&&Number.isFinite(v))w.payable=v.toFixed(2);
  if(/HESAPLANAN\s*KDV/.test(line)&&! /TEVKIF/.test(line)&&Number.isFinite(v))tax=v.toFixed(2);
  if(/TEVKIFATA\s*TABI\s*ISLEM.*HES/.test(line)&&Number.isFinite(v))w.subject_vat=v.toFixed(2);
  if(/(?:HESAPLANAN\s*)?KDV\s*TEVKIFAT/.test(line)){
   const fraction=line.match(/\b([1-9])\s*\/\s*10\b/),percent=line.match(/%\s*(\d{1,3})(?:[.,]00)?/);
   if(fraction)candidates.push(fraction[1]+'/10');else if(percent&&+percent[1]%10===0&&+percent[1]>0&&+percent[1]<=100)candidates.push((+percent[1]/10)+'/10');
   if(Number.isFinite(v)&&/[.,]\d{2}\s*(?:TL|TRY)?\s*$/.test(line))w.amount=v.toFixed(2);
  }
 }
 const ratios=[...new Set(candidates)];if(ratios.length===1)w.ratio=ratios[0];
 if(!w.subject_vat)w.subject_vat=tax;
 return {invoice_type:type,withholding:w,gross};
}
export function validateSpecial(d){
 if(!isWithholding(d))return;
 const w=d.withholding||{},m=/^(\d{1,2})\/10$/.exec(w.ratio||'');
 if(!m||+m[1]<1||+m[1]>10)throw Error('Tevkifat oranını 2/10 veya 7/10 biçiminde doldurun.');
 const tax=(d.kalemler||[]).reduce((n,l)=>n+Number(l.kdv),0),subject=Number(w.subject_vat),amount=Number(w.amount),pay=Number(w.payable);
 if(!w.subject_vat||!w.amount||!w.payable||!Number.isFinite(subject+amount+pay)||subject<=0||subject>tax+.02||amount<=0||pay<0)throw Error('Tevkifata tabi KDV, kesinti ve ödenecek tutarı kontrol edin.');
 if(Math.abs(Math.round(subject*(+m[1]/10)*100)-Math.round(amount*100))>2)throw Error('Tevkifat oranı ile kesinti tutarı uyuşmuyor.');
 if(Math.abs(Math.round((Number(d.toplam)-amount)*100)-Math.round(pay*100))>2)throw Error('KDV dahil toplam − tevkifat, ödenecek tutara eşit olmalı.');
}
