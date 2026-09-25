"""Etiketli Z raporu özetleri; kümülatif ve ödeme toplamlarını dışarıda tutar."""
import re

def is_z_report(text):
    from core import normalized
    u=normalized(text)
    # Normal satış fişinin altındaki Z NO yalnız sayaç bilgisidir.
    return bool(re.search(r'\bZ\s*(?:SAYAC\b|(?:GUNLUK\s+)?RAPORU\b)',u)
                or (re.search(r'\b2\s+(?:GUNLUK\s+)?RAPORU\b',u) and re.search(r'\bZ\s*NO\b',u)))

def parse(text):
    from core import normalized, ocr_money, gross_line, date_value
    u=normalized(text)
    u=re.sub(r'(?<=\d)\s*([.,])\s*(?=\d)',r'\1',u)
    u=re.sub(r'%\s*[.:]\s*(?=\d)','%',u)
    nums=re.findall(r'\bZ\s*(?:NO|SAYAC(?:\s*NO)?)\s*[:.]?\s*(\d+(?:[. ]\d{3})*)',u)
    nums={str(int(re.sub(r'\D','',n))) for n in nums}
    result={'evrak_no':next(iter(nums)) if len(nums)==1 else '', 'aciklama':'Z RAPORU', 'is_z_report':True}
    if len(nums)>1:
        result.update(mixed_documents=True,warning='Birden fazla Z numarası bulundu; raporları ayrı kırpıp yükleyin. Birleşik tutarlar aktarılmaz.',kalemler=[],toplam='',tarih='',evrak_tarihi='')
        return result
    dates=re.findall(r'\b(\d{2})[./-](\d{2})[./-](\d{4}|\d{2})\b',u)
    dates={f'{a}.{b}.{c if len(c)==4 else "20"+c}' for a,b,c in dates}
    if len(dates)==1:
        value=next(iter(dates))
        try:date_value(value);result.update(tarih=value,evrak_tarihi=value)
        except ValueError:pass
    amount=r'\d+(?:[. ]\d{3})*[.,]\d{2}(?!\d)'
    groups={};vats={};conflict=False
    lines=u.splitlines()
    for i,line in enumerate(lines):
        if re.search(r'KDV|KUM|IPTAL',line):continue
        m=re.search(r'(?:TOPLAM\s*%\s*(\d{1,2})(?!\d)|%\s*(\d{1,2})(?!\d)\s*TOPLAM)',line)
        if not m:continue
        values=re.findall(amount,line[m.end():])
        if not values and i+1<len(lines) and re.fullmatch(r'\s*[*+]?\s*'+amount+r'\s*',lines[i+1]):
            values=re.findall(amount,lines[i+1])
        if not values:continue
        rate=str(int(m[1] or m[2]));value=ocr_money(values[-1].replace(' ',''))
        if i+1<len(lines) and re.match(r'^\s*(?:TOPKDV|KDV)\b',lines[i+1]):
            vat_values=re.findall(amount,lines[i+1])
            printed_rate=re.search(r'%\s*(\d{1,2})(?!\d)',lines[i+1])
            if vat_values:
                printed_vat=ocr_money(vat_values[-1].replace(' ',''))
                if printed_rate and str(int(printed_rate[1]))!=rate:
                    candidate=str(int(printed_rate[1]))
                    from core import money
                    if abs(money(gross_line(candidate,str(value))['kdv'])-printed_vat)<=money('0.03'):
                        result['warning']='Toplam satırındaki KDV oranı ile KDV satırı farklı okundu; basılı KDV ile doğrulanan %'+candidate+' önerildi. Fotoğraftan doğrulayın.'
                        rate=candidate
                vats[rate]=printed_vat
        if rate in groups and groups[rate]!=value:conflict=True
        groups[rate]=value
    result['kalemler']=[gross_line(r,str(v)) for r,v in groups.items() if v>0] if not conflict else []
    for row in result['kalemler']:
        key=str(int(float(row['oran'])))
        if key in vats:
            row.update(matrah=str(groups[key]-vats[key]),kdv=str(vats[key]))
    totals=[]
    for line in lines:
        if re.match(r'^\s*(?:TOPLAM(?:\s+SATIS)?|TOP|NET\s+SATIS)\s+[*+\d]',line):
            values=re.findall(amount,line)
            if values:totals.append(ocr_money(values[-1].replace(' ','')))
    if groups and not conflict:
        result['toplam']=str(sum(groups.values()))
        if totals and any(t!=sum(groups.values()) for t in totals):
            result['warning']='Z raporu genel toplamı ile KDV özeti uyuşmuyor; fotoğraftan kontrol edin.'
            result['toplam']=str(next(t for t in totals if t!=sum(groups.values())))
    else:result['toplam']=str(totals[0]) if totals else ''
    return result
