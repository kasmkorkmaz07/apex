"""Olasılık yüzdesi uydurmadan eksikleri ve bilinen çelişkileri gösterir."""
import re
from datetime import datetime
from core import validate

def warnings(d):
 items=[]
 for field in ('tarih','evrak_tarihi'):
  try:
   year=datetime.strptime(d.get(field,''),'%d.%m.%Y').year
   if year>datetime.now().year+1:
    items.append('Tarih olağan dışı ileri bir yıl içeriyor: '+d[field]+'. Fotoğraftan doğrulayın.')
  except ValueError:pass
 if d.get('vat_inferred'):items.append('KDV oranı basılı tutarlardan hesaplandı; doğrudan okunmadı.')
 items.extend(re.findall(r'\[OCR KONTROL: ([^\]]+)\]',d.get('ocr','')))
 if 'Birden fazla' in d.get('vendor_source',''):items.append(d['vendor_source'])
 return list(dict.fromkeys(items))

def assessment(d):
 items=warnings(d)
 try:validate(d)
 except (ValueError,KeyError) as e:items.insert(0,str(e))
 if items:return ' • '.join(dict.fromkeys(items))
 sources=re.findall(r'\[OCR BILGI: ([^\]]+)\]',d.get('ocr',''))
 return 'Alan ve tutar kontrolleri geçti. Fotoğraftan doğrulayarak onaylayın.'+(' '+sources[-1] if sources else '')


def needs_review(d):
 if warnings(d):return True
 try:validate(d)
 except (ValueError,KeyError):return True
 return False
