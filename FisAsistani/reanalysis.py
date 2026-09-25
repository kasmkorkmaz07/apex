"""Yeni okumayı eksik alanları silmeden, değişiklikleri işaretleyerek birleştirir."""
from copy import deepcopy
from core import vat_records

def merge(old,new):
 if old.get('is_invoice') and not new.get('is_invoice'):
  d=deepcopy(old);d['review_ack']=False
  d['ocr']=old.get('ocr','')+'\n[OCR KONTROL: Fatura başlığı yeniden okunamadı; önceki fatura bilgileri korundu.]'
  return d
 d=deepcopy(new);notes=[]
 if old.get('vat_partition') is not None:
  matches=[p for p in vat_records(d) if p.get('vat_partition')==old['vat_partition']]
  if matches:d=matches[0]
  else:
   for key in ('vat_partition','source_receipt_total','kalemler','toplam'):
    if key in old:d[key]=deepcopy(old[key])
   notes.append('Bu KDV bölümü yeniden okunamadı; önceki tutar korundu.')
 for key in ('vkn','aciklama','evrak_no','evrak_tarihi','tarih','toplam','kalemler'):
  if key=='evrak_no' and d.get('is_z_report') and not old.get('is_z_report'):
   if not d.get(key):notes.append('Z numarası okunamadı; önceki fiş numarası Z numarası olarak kullanılmadı.')
   continue
  if key in ('vkn','aciklama') and d.get('is_invoice') and d.get('invoice_party')!=old.get('invoice_party'):
   if not d.get(key):notes.append(key+' için yeni fatura tarafı okunamadı; önceki tarafın bilgisi kullanılmadı.')
   continue
  if not d.get(key) and old.get(key):
   d[key]=deepcopy(old[key]);notes.append(key+' yeniden okunamadı; önceki değer korundu.')
 for key in ('vkn','evrak_no','evrak_tarihi','toplam'):
  if old.get(key) and d.get(key) and str(old[key])!=str(d[key]):notes.append(key+' değişti: '+str(old[key])+' / '+str(d[key]))
 for key in ('source','account_override','kod','accounting_mode','custom_description'):
  if key in old:d[key]=deepcopy(old[key])
 if old.get('custom_description'):d['aciklama']=old['aciklama']
 if old.get('vkn_omitted'):
  d['vkn']='';d['vkn_omitted']=True
 d['review_ack']=False
 if notes:d['ocr']=d.get('ocr','')+'\n[OCR KONTROL: '+'; '.join(notes)+']'
 return d
