"""Telefonla aynı Gemini/QR akışı; mevcut muhasebe verisini taslak olarak zenginleştirir."""
import base64
import copy
import io
import json
import re
import urllib.request
import urllib.error
from pathlib import Path
from decimal import Decimal
from PIL import Image, ImageOps
from core import gross_line, money, date_value, normalized

RATES={0,1,8,10,18,20}

def load_config(home):
    try:return json.loads((Path(home)/'desktop-preferences.json').read_text(encoding='utf-8'))
    except (OSError,ValueError):return {'theme':'auto','ai_mode':'off','ai_key':'','ai_model':''}

def save_config(home, config):
    p=Path(home)/'desktop-preferences.json';tmp=p.with_suffix('.tmp')
    tmp.write_text(json.dumps(config,ensure_ascii=False,indent=2),encoding='utf-8');tmp.replace(p)

def request(path,key,payload=None):
    req=urllib.request.Request('https://generativelanguage.googleapis.com/v1beta/'+path,
        data=json.dumps(payload).encode() if payload else None,
        headers={'x-goog-api-key':key,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=60) as response:return json.load(response)
    except urllib.error.HTTPError as error:
        code=error.code
        raise ValueError('Gemini kullanım sınırına ulaşıldı; sonra tekrar deneyin.' if code==429 else
                         'Gemini anahtarı geçersiz veya yetkisiz.' if code in (400,401,403) else
                         f'Gemini isteği tamamlanamadı ({code}).') from None
    except (OSError,ValueError):raise ValueError('Gemini bağlantısı kurulamadı; yerel belge korundu.') from None

def models(config, transport=request):
    chosen=config.get('ai_model','').strip().removeprefix('models/')
    if chosen:
        if not re.fullmatch(r'gemini-[A-Za-z0-9._-]+',chosen):raise ValueError('Gemini model adı geçersiz.')
        return ['models/'+chosen]
    values=transport('models',config['ai_key']).get('models',[])
    names=[v['name'] for v in values if 'generateContent' in v.get('supportedGenerationMethods',[]) and re.fullmatch(r'models/gemini-[\d.]+-flash(?:-lite)?',v.get('name',''))]
    names.sort(key=lambda s:(tuple(int(v) for v in re.search(r'gemini-([\d.]+)',s)[1].split('.')),not s.endswith('-lite')),reverse=True)
    if not names:raise ValueError('Uygun Gemini modeli bulunamadı; ayarlarda model adını yazın.')
    return names[:3]

def parse_qr(raw,kind='gider'):
    from urllib.parse import unquote
    value=raw
    try:
        for _ in range(3):
            if isinstance(value,dict):break
            value=json.loads(unquote(value))
    except (ValueError,TypeError):return None
    if not isinstance(value,dict):return None
    p={re.sub(r'[^a-z0-9()%]','',str(k).lower()):v for k,v in value.items()}
    def first(*keys):return next((str(p[k]).strip() for k in keys if p.get(k) is not None),'')
    number=first('no','faturano','evrakno');vkn=first(*(('avkntckn','alicivkn','alicivkntckn') if kind=='gelir' else ('vkntckn','vkn','saticivkn')))
    if not number and not vkn:return None
    d={'qr_raw':raw,'is_invoice':True,'kind':kind,'vkn':vkn if re.fullmatch(r'\d{10,11}',vkn) else '',
       'evrak_no':number,'kalemler':[],'qr_currency':first('parabirimi') or 'TRY'}
    dt=first('tarih','faturatarihi');m=re.fullmatch(r'(\d{4})-(\d{2})-(\d{2})',dt)
    if m:dt=f'{m[3]}.{m[2]}.{m[1]}'
    try:date_value(dt);d['evrak_tarihi']=dt;d['tarih']=dt
    except ValueError:pass
    total=first('odenecek','odenecektutar','vergidahil','kdvdahiltoplam')
    if total:
        try:d['toplam']=str(money(total))
        except ValueError:pass
    groups={}
    for key,val in p.items():
        m=re.fullmatch(r'(kdvmatrah|hesaplanankdv)\(?%?(\d+)\)?',key)
        if not m or int(m[2]) not in RATES:continue
        try:groups.setdefault(int(m[2]),{})[m[1]]=money(val)
        except (ValueError,TypeError):pass
    for rate,row in groups.items():
        base=row.get('kdvmatrah');tax=row.get('hesaplanankdv')
        if base is None and tax is not None and rate:base=(tax*100/Decimal(rate)).quantize(Decimal('.01'))
        if tax is None and base is not None:tax=(base*rate/100).quantize(Decimal('.01'))
        if base is not None and tax is not None and base>=0 and tax>=0:d['kalemler'].append({'oran':str(rate),'matrah':str(base),'kdv':str(tax)})
    if not d.get('toplam') and d['kalemler']:d['toplam']=str(sum(money(l['matrah'])+money(l['kdv']) for l in d['kalemler']))
    return d

def qr_image(path,kind):
    with Image.open(path) as source:im=ImageOps.exif_transpose(source).convert('RGB')
    try:
        import zxingcpp
        values=[b.text for b in zxingcpp.read_barcodes(im)]
    except ImportError:
        from qr_oku import oku_qr
        values=oku_qr(im)
    candidates=[parse_qr(v,kind) for v in values];candidates=[c for c in candidates if c]
    # Multiple invoices in a photo must be split, not assigned to the same record.
    identities={(c['vkn'],c['evrak_no']) for c in candidates}
    return max(candidates,key=lambda c:len(c['kalemler'])+bool(c.get('toplam'))) if len(identities)==1 else None

def merge_qr(d,q):
    result=copy.deepcopy(d)
    if not q or d.get('is_z_report'):return result
    for key,value in q.items():
        if value not in ('',None,[]):result[key]=value
    result['invoice_party']='buyer' if d.get('kind')=='gelir' else 'seller'
    result['review_ack']=False
    return expense_zero(result)

def expense_zero(d):
    if d.get('kind')=='gelir':return d
    zero=sum(money(l['matrah'])+money(l['kdv']) for l in d.get('kalemler',[]) if money(l['oran'])==0)
    if zero:
        d['excluded_zero_total']=str(zero)
        d['kalemler']=[l for l in d['kalemler'] if money(l['oran'])!=0]
    return d

def merge_ai(d,a):
    result=copy.deepcopy(d);qr=bool(d.get('qr_raw'))
    if a.get('belge_turu')=='z_raporu':result.update(is_z_report=True,is_invoice=False)
    elif a.get('belge_turu')=='fatura' and not d.get('is_z_report'):result['is_invoice']=True
    for key,src in [('aciklama','unvan'),('vkn','vkn_tckn'),('evrak_no','belge_no'),('evrak_tarihi','tarih')]:
        val=str(a.get(src) or '').strip()
        if not val or (qr and d.get(key)):continue
        if key=='aciklama' and (re.search(r'\b(?:MAHALLESI|CADDESI|SOKAK|BULVARI|KASIYER)\b',normalized(val)) or re.search(r'\d+\s*(?:ADET|KG|ML)\b|%\s*\d',normalized(val))):continue
        if key=='vkn' and not re.fullmatch(r'\d{10,11}',val):continue
        if key=='evrak_tarihi':
            try:date_value(val)
            except ValueError:continue
        result[key]=val
    try:
        total=money(a.get('toplam',''))
        if total>0 and not(qr and d.get('toplam')):result['toplam']=str(total)
    except (ValueError,TypeError):pass
    rows=[]
    for row in a.get('kdv',[]) if isinstance(a.get('kdv'),list) else []:
        try:
            rate=money(row['oran']);gross=money(row['kdv_dahil_tutar'])
            if rate in RATES and gross>0:rows.append(gross_line(str(rate),str(gross)))
        except (KeyError,ValueError,TypeError):continue
    existing=d.get('kalemler',[]) if qr else []
    existing_rates={money(l['oran']) for l in existing}
    combined=existing+[l for l in rows if money(l['oran']) not in existing_rates]
    try:
        if combined and abs(sum(money(l['matrah'])+money(l['kdv']) for l in combined)-money(result.get('toplam','')))<=Decimal('.05'):
            result['kalemler']=combined;result.pop('excluded_zero_total',None)
    except ValueError:pass
    if result.get('is_z_report'):
        from z_reports import parse,is_z_report
        z=parse(d.get('ocr','')) if is_z_report(d.get('ocr','')) else {}
        if z.get('kalemler'):result.update(kalemler=z['kalemler'],toplam=z['toplam'])
        result.update(vkn='',aciklama='Z RAPORU',is_invoice=False)
    if result.get('is_invoice'):result['invoice_party']='buyer' if d.get('kind')=='gelir' else 'seller'
    result['tarih']=result.get('evrak_tarihi','');result['review_ack']=False;result['ai_used']=True
    result['ocr']=d.get('ocr','')+'\n[OCR BILGI: Gemini ile okundu; belgeyi kontrol edip onaylayın.]'
    return expense_zero(result)

def read_ai(path,d,config,transport=request):
    if not config.get('ai_key'):raise ValueError('Önce Ayarlar > Gemini bölümünden API anahtarını girin.')
    with Image.open(path) as src:
        im=ImageOps.exif_transpose(src).convert('RGB');im.thumbnail((1800,1800));out=io.BytesIO();im.save(out,'JPEG',quality=88)
    party='Faturada SAYIN bölümündeki ALICI' if d.get('kind')=='gelir' else 'Üstteki SATICI'
    prompt=f'''Türkiye fiş/fatura/Z raporu. Yalnız okunabilen bilgileri JSON ver; uydurma.
Ünvan ve VKN/TCKN: {party}. Ürün adı veya adresi ünvan yapma. Z raporunda ünvan Z RAPORU, VKN boş.
Z raporunda VERGİ DÖKÜMÜ içindeki %1 TOPLAM 150 satırı 150 TL KDV DAHİL hasılattır; TOPKDV 1,49 yalnız vergidir. %01=%1. %0 dahil her oranı al. Kümülatif, iptal ve ödeme tekrarlarını alma.
toplam KDV dahil genel toplam; kdv_dahil_tutar her oranın KDV DAHİL toplamıdır, vergi tutarı değildir.
Faturada belge_no FATURA NO; Z'de Z NO/Z SAYAÇ (baş sıfırsız). Sipariş numarası değil. Tarih GG.AA.YYYY.
Şema: {{"belge_turu":"fis|fatura|z_raporu","unvan":"","vkn_tckn":"","tarih":"","belge_no":"","toplam":0,"kdv":[{{"oran":1,"kdv_dahil_tutar":150}}]}}'''
    payload={'contents':[{'parts':[{'text':prompt},{'inline_data':{'mime_type':'image/jpeg','data':base64.b64encode(out.getvalue()).decode()}}]}], 'generationConfig':{'temperature':0,'responseMimeType':'application/json'}}
    model=models(config,transport)[0]
    answer=transport(model+':generateContent',config['ai_key'],payload)
    try:
        text=''.join(p.get('text','') for p in answer['candidates'][0]['content']['parts'])
        a=json.loads(text[text.index('{'):text.rindex('}')+1])
        if not isinstance(a,dict):raise ValueError()
    except (KeyError,IndexError,ValueError,TypeError):raise ValueError('Gemini geçerli belge sonucu döndürmedi; mevcut alanlar korundu.') from None
    result=merge_ai(d,a);result['ai_model']=model;return result

def enrich(path,d,home,force=False,qr_only=False):
    result=copy.deepcopy(d)
    try:result=merge_qr(result,qr_image(path,result.get('kind','gider')))
    except Exception:pass
    if qr_only:return result
    config=load_config(home)
    from review import needs_review
    if force or (config.get('ai_key') and (config.get('ai_mode')=='always' or config.get('ai_mode')=='issues' and needs_review(result))):
        try:return read_ai(path,result,config)
        except ValueError as error:
            if force:raise
            result['ocr']=result.get('ocr','')+'\n[OCR KONTROL: '+str(error)+']'
    return result
