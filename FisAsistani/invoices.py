"""Fatura özetlerini ve SAYIN'dan önceki düzenleyen bilgisini okur."""
import re
from decimal import Decimal


def is_invoice(text):
    from core import normalized
    u=normalized(text)
    return bool(re.search(r'\bFATURA\s*TARIHI\b',u) or
                (re.search(r'\bFATURA\s*(?:NO|NUMARASI)\b',u) and re.search(r'\bSAYIN\b',u)))


def parse(text, kind):
    from core import normalized, date_value, ocr_money, gross_line, money
    annotations=[x for x in text.splitlines() if x.startswith('[OCR ')]
    text='\n'.join(x for x in text.splitlines() if not x.startswith('[OCR '))
    u=normalized(text)
    d=dict(tarih='',evrak_tarihi='',aciklama='',vkn='',evrak_no='',
           kod='ML' if kind=='gelir' else 'MS',toplam='',kalemler=[],ocr=text,
           kind=kind,is_invoice=True)
    notes=[]
    nums=set(re.findall(r'\bFATURA\s*(?:NO|NUMARASI)\s*[:.]?\s*([A-Z0-9/-]*\d[A-Z0-9/-]*)',u))
    if len(nums)==1:d['evrak_no']=next(iter(nums))
    dates=set(re.findall(r'\bFATURA\s*TARIHI\s*[:.]?\s*(\d{2}[./-]\d{2}[./-]\d{4})',u))
    if len(dates)==1:
        value=re.sub(r'[/\-]','.',next(iter(dates)))
        try:date_value(value);d.update(tarih=value,evrak_tarihi=value)
        except ValueError:pass
    # Layout sırasındaki üst satıcı bloğu: alıcıya asla geri düşme.
    header_lines=[];boundary=False
    for line in text.splitlines():
        if re.search(r'\bSAYIN\b',normalized(line)):
            boundary=True;break
        header_lines.append(line)
    header='\n'.join(header_lines) if boundary else ''
    ids=set(re.findall(r'\b(?:TCKN|VKN)\s*[:.]?\s*(\d{10,11})(?!\d)',normalized(header))) - {'11111111111'}
    if len(ids)==1:d['seller_vkn']=next(iter(ids))
    buyer=re.split(r'\bSAYIN\b',text,maxsplit=1,flags=re.I)[1] if boundary else ''
    buyer=re.split(r'\b(?:ETTN|Mal\s+Hizmet|Sıra\s+No)\b',buyer,maxsplit=1,flags=re.I)[0]
    buyer_ids=set(re.findall(r'\b(?:TCKN|VKN)\s*[:.]?\s*(\d{10,11})(?!\d)',normalized(buyer))) - {'11111111111'}
    if len(buyer_ids)==1:d['buyer_vkn']=next(iter(buyer_ids))
    def party_name(block):
        names=[]
        for line in block.splitlines():
            spaced=bool(re.search(r'\S[ \t]{4,}\S',line.strip()))
            # Alıcıyla aynı yatay satırdaki sağ fatura bilgi sütununu ayır.
            line=re.split(r'\b(?:Fatura\s+(?:No|Tarihi|Tipi)|Özelleştirme\s+No|Senaryo)\s*:',line,maxsplit=1,flags=re.I)[0]
            line=re.sub(r'\s+',' ',line).strip();n=normalized(line)
            if not n:continue
            if re.search(r'^(?:E[- ]?(?:ARSIV|FATURA|BELGE)|FATURA|LOGO)\b',n):continue
            if not names and re.match(r'^\d{2}[./-]\d{2}[./-]\d{4}.*E-BELGE',n):continue
            if re.search(r'\d|/|\b(?:TEL|FAX|FAKS|WEB|E-POSTA|VERGI|TCKN|VKN|SOKAK|SOK|SK|CADDE|CAD|CD|MAHALLESI|MAH|NO)\b',n):break
            names.append(line)
            if spaced:notes.append('Ünvan satırında geniş boşluklar var; kelime parçaları kesilmeden korundu. PDF/görüntüden doğrulayın.')
        return ' '.join(names)
    d['seller_name']=party_name(header)
    d['buyer_name']=party_name(buyer)
    party='buyer' if kind=='gelir' else 'seller'
    d['invoice_party']=party
    d['vkn']=d.get(party+'_vkn','')
    d['aciklama']=d.get(party+'_name','')
    if not boundary:notes.append('SAYIN bölümü ayrılamadı; gelir için alıcı, gider için satıcı ünvanı ve VKN/TCKN alanlarını görüntüden doldurun.')
    amount=r'\d+(?:[. ]\d{3})*,\d{2}|\d+\.\d{2}'
    payable=[]; vats={}; bases={}; conflicting=False
    lines=[re.sub(r'[ \t]+',' ',x).strip() for x in u.splitlines() if x.strip()]
    for i,line in enumerate(lines):
        following=' '+lines[i+1] if i+1<len(lines) and re.fullmatch(r'[*+ ]*(?:'+amount+r')\s*(?:TL|TRY)?',lines[i+1]) else ''
        line+=following
        if re.search(r'ODENECEK\s+(?:NET\s+)?TUTAR',line):
            vals=re.findall(amount,re.split(r'ODENECEK\s+(?:NET\s+)?TUTAR',line)[-1])
            if vals:payable.append(ocr_money(vals[-1].replace(' ','')))
        if not re.search(r'HESAPLANAN\s+(?:KDV|GERCEK|KATMA)|KDV\s*MATRAHI',line):continue
        rate=re.search(r'%\s*(\d{1,2})(?:[.,]0{1,2})?|\(\s*(\d{1,2})\s*\)',line)
        if not rate:continue
        key=str(int(rate[1] or rate[2]))
        vals=re.findall(amount,line[rate.end():])
        if not vals:continue
        value=ocr_money(vals[-1].replace(' ',''))
        group=bases if 'MATRAH' in line else vats
        if key in group and group[key]!=value:conflicting=True
        group[key]=value
    if len(set(payable))==1:d['toplam']=str(payable[0])
    rates=set(vats)|set(bases)
    if d['toplam'] and rates and not conflicting:
        total=money(d['toplam'])
        if len(rates)==1:
            rate=next(iter(rates));row=gross_line(rate,str(total))
            vat=vats.get(rate,money(row['kdv']));base=total-vat
            if abs(base*money(rate)/100-vat)<=Decimal('.03') and (rate not in bases or abs(bases[rate]-base)<=Decimal('.02')):
                d['kalemler']=[dict(oran=rate,matrah=str(base),kdv=str(vat))]
        else:
            rows=[]
            for rate in sorted(rates,key=int):
                base=bases.get(rate)
                if base is None and rate in vats and money(rate):base=(vats[rate]*100/money(rate)).quantize(Decimal('.01'))
                if base is None:break
                vat=vats.get(rate,(base*money(rate)/100).quantize(Decimal('.01')))
                rows.append(dict(oran=rate,matrah=str(base),kdv=str(vat)))
            if len(rows)==len(rates) and abs(sum(money(r['matrah'])+money(r['kdv']) for r in rows)-total)<=Decimal('.02'):d['kalemler']=rows
    if not d['kalemler']:notes.append('Fatura KDV özeti ile ödenecek tutar eşleştirilemedi; oran ve tutarları kontrol edin. Tevkifat/diğer vergiler otomatik dağıtılmaz.')
    zero=sum(money(r['matrah']) for r in d['kalemler'] if money(r['oran'])==0)
    if kind!='gelir' and zero:
        d['excluded_zero_total']=str(zero)
        d['kalemler']=[r for r in d['kalemler'] if money(r['oran'])!=0]
    for note in notes:d['ocr']+='\n[OCR KONTROL: '+note+']'
    if annotations:d['ocr']+='\n'+'\n'.join(annotations)
    return d


def embedded_text(image):
    from pathlib import Path
    sidecar=Path(str(image)+'.invoice.txt')
    return sidecar.read_text(encoding='utf-8') if sidecar.exists() else ''
