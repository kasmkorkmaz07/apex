"""Explicit return / withholding metadata and per-client posting rules."""
import re
from decimal import Decimal,ROUND_HALF_UP

def invoice_type(d):
 from core import normalized
 value=normalized(d.get('invoice_type') or '')
 if not value:
  m=re.search(r'FATURA\s*TIPI\s*:?\s*(TEVKIFATIADE|TEVKIFAT|IADE|SATIS|ISTISNA|IHRACKAYITLI)',normalized(d.get('ocr') or ''))
  value=m[1] if m else 'SATIS'
 return value

def is_return(d):return invoice_type(d) in ('IADE','TEVKIFATIADE')
def is_withholding(d):return invoice_type(d) in ('TEVKIFAT','TEVKIFATIADE')
def is_special(d):return is_return(d) or is_withholding(d)

def validate_special(d):
 from core import money
 if d.get('invoice_type_conflict'):raise ValueError('Metin ile karekodun fatura tipi farklı; fatura tipini kontrol edip yeniden seçin.')
 if not is_withholding(d):return
 w=d.get('withholding') or {}
 m=re.fullmatch(r'(10|[1-9])/10',str(w.get('ratio','')))
 if not m:raise ValueError('Tevkifat oranını 2/10 veya 7/10 biçiminde doldurun.')
 for key in ('subject_vat','amount','payable'):
  if w.get(key) in (None,''):raise ValueError('Tevkifat alanları eksik: '+key)
 subject,amount,payable=(money(w[k]) for k in ('subject_vat','amount','payable'))
 tax=sum(money(row['kdv']) for row in d['kalemler'])
 if subject<=0 or subject>tax+Decimal('.02') or amount<=0 or payable<0:raise ValueError('Tevkifata tabi KDV ve kesinti tutarlarını kontrol edin.')
 expected=(subject*Decimal(m[1])/10).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
 if abs(expected-amount)>Decimal('.02'):raise ValueError('Tevkifat oranı / tutarı uyuşmuyor.')
 if abs(money(d['toplam'])-amount-payable)>Decimal('.02'):raise ValueError('KDV dahil toplam − tevkifat, ödenecek tutara eşit olmalı.')

def validate_rules(p):
 from core import money
 seen=set()
 for r in p.get('special_rules',[]):
  if r.get('kind') not in ('gelir','gider') or r.get('type') not in ('IADE','TEVKIFAT'):raise ValueError('İade/tevkifat hesap tanımı türü geçersiz.')
  if r.get('type')=='IADE' and r.get('rate') in ('*','',None):raise ValueError('İade hesabı için KDV oranını seçin: %0, %1, %10 veya %20.')
  if r.get('rate')!='*' and money(r.get('rate','')) not in (0,1,8,10,18,20):raise ValueError('Hesap tanımındaki KDV oranını kontrol edin.')
  required=['base','closing']+(['vat'] if r.get('rate')=='*' or money(r['rate']) else [])
  if r['type']=='TEVKIFAT':
   if not re.fullmatch(r'(10|[1-9])/10',r.get('ratio','')):raise ValueError('Tevkifat oranını seçin.')
   if r['kind']=='gider':required.append('withholding')
  if any(not str(r.get(k) or '').strip() for k in required):raise ValueError('İade/tevkifat tanımının hesaplarını doldurun veya boş tanımı kaldırın.')
  key=(r.get('kind'),r.get('type'),r.get('ratio') if r['type']=='TEVKIFAT' else str(money(r['rate'])))
  if key in seen:raise ValueError('Aynı işlem için birden fazla hesap tanımı var.')
  seen.add(key)

def rule_for(d,p,rate):
 from core import money
 w=d.get('withholding') or {};typ=invoice_type(d)
 rules=[r for r in p.get('special_rules',[]) if r.get('kind')==d.get('kind','gider') and r.get('type')==typ and ((r.get('rate')=='*' and typ!='IADE') or (r.get('rate') not in ('*','',None) and money(r['rate'])==money(rate))) and (not is_withholding(d) or r.get('ratio')==w.get('ratio'))]
 rules=list({tuple(r.get(k,'') for k in ('base','vat','withholding','closing')):r for r in rules}.values())
 if len(rules)!=1:raise ValueError(str(d.get('evrak_no','Belge'))+': '+typ+' için mükellef ayarlarında tek bir uygun hesap tanımı bulunmalı (%'+str(rate)+').')
 rule=dict(rules[0])
 if money(rate)==0:rule['vat']=''
 required=['base','closing']+(['vat'] if money(rate)!=0 else [])+(['withholding'] if is_withholding(d) and d.get('kind')=='gider' else [])
 if any(not str(rule.get(k) or '').strip() for k in required):raise ValueError('İade/tevkifat hesap tanımı eksik: '+str(d.get('evrak_no','')))
 return rule
