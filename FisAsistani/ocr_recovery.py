"""Sorunlu dar fişlerde bölgesel tekrar okuma ve tutar çapraz kontrolü."""
import re
from core import draft,normalized,money,ocr_money

def financial(line):
 if line.startswith(('[OCR KONTROL:', '[OCR BILGI:')):return False
 return bool(re.search(r'TOPLAM|TOPKDV|^KDV\b|^TOP\b|ODENECEK|%\s*\d',normalized(line)))
def balanced(d):
 printed=re.findall(r'(?m)^TOPKDV\s*[:* ]*(\d+(?:[.,]\d{3})*[.,]\d{2})',normalized(d.get('ocr','')))
 return bool(d['toplam'] and d['kalemler'] and len(set(printed))==1 and abs(sum(money(r['kdv']) for r in d['kalemler'])-ocr_money(printed[0]))<=money('0.03'))

def recover(im,text,read):
 from z_reports import is_z_report
 from invoices import is_invoice
 if is_z_report(text) or is_invoice(text):return text
 if im.height<im.width*1.8:return text
 d=draft(text,use_vendor_hints=False)
 # Dar fiş numaraları tam görüntüde küçültüldüğünde rakamlar birleşebilir.
 fis=bool(re.search(r'\bFIS\s*NO',normalized(text)))
 needs_money=not balanced(d)
 if not needs_money and d['evrak_no']:return text
 regional=read(im.crop((0,int(im.height*.22),im.width,int(im.height*.60))))
 rd=draft(regional,use_vendor_hints=False)
 notes=[]
 if balanced(rd) and (not d['evrak_tarihi'] or rd['evrak_tarihi']==d['evrak_tarihi']):
  if d['toplam'] and rd['toplam']!=d['toplam']:
   notes.append('Bölgesel toplam okuması farklı: '+d['toplam']+' / '+rd['toplam']+'. Fotoğraftan doğrulayın.')
  lines=[l for l in text.splitlines() if not financial(l)]
  lines += [l for l in regional.splitlines() if financial(l)]
  text='\n'.join(lines)
  notes.extend(re.findall(r'\[OCR KONTROL: ([^\]]+)\]',regional))
 if fis:
  numbers=[]
  for scale in (2,3):
   crop=im.crop((0,int(im.height*.23),im.width,int(im.height*.35)))
   t=read(crop.resize((crop.width*scale,crop.height*scale)))
   n=draft(t,use_vendor_hints=False)['evrak_no']
   if n and n.isdigit():numbers.append(n)
  if len(numbers)==2 and len(set(numbers))==1:
   if d['evrak_no'] and d['evrak_no']!=numbers[0]:
    notes.append('Bölgesel fiş numarası farklı: '+d['evrak_no']+' / '+numbers[0]+'. Fotoğraftan doğrulayın.')
   text=re.sub(r'(?im)\bF[Iİ]S\s*NO\s*[:.\-]?\s*[A-Z0-9/-]+', 'FIS NO: '+numbers[0],text)
 return text+''.join('\n[OCR KONTROL: '+n+']' for n in notes)
