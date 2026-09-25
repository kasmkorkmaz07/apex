"""GİB isim listesiyle yalnız satıcı başlığındaki komşu kimlikleri bulur."""
import json,re,unicodedata
from pathlib import Path
from functools import lru_cache

def clean(s):
    s=''.join(c for c in unicodedata.normalize('NFKD',s.upper()) if not unicodedata.combining(c))
    s=re.sub(r'\bVERG[IT]\s+[DL]AIRESI\b','VERGI DAIRESI',s)
    s=re.sub(r'(?:VERGI\s+DAIRESI(?:\s+MUDURLUGU)?|V\.?\s*D\.?M?\.?|MM|MAL\s*MUDURLUGU)\s*$','',s)
    return re.sub(r'[^A-Z0-9]','',s)

@lru_cache(maxsize=1)
def names():
    data=json.loads((Path(__file__).parent/'tax_offices.json').read_text(encoding='utf-8'))
    return {clean(r['name']) for r in data['offices']}

def seller_ids(text):
    lines=text.splitlines();found=[]
    for i,line in enumerate(lines):
        if re.search(r'\d{2}[./-]\d{2}[./-]\d{4}',line):break
        # Bazı yazıcılar kimliği 609 108 5492 biçiminde basar.
        # Yalnız bilinen vergi dairesinden sonra, satır sonundaki rakamları birleştir.
        spaced=re.fullmatch(r'\s*(.+?\D)\s+(\d[\d \t]{8,16}\d)\s*',line)
        if spaced and clean(spaced[1]) in names():
            number=re.sub(r'\s','',spaced[2])
            if len(number) in (10,11) and number!='11111111111':found.append(number)
        m=re.fullmatch(r'\s*(.+?)[\s/:.\-]*(\d{10,11})\s*',line)
        if m and clean(m[1]) in names() and m[2]!='11111111111':found.append(m[2])
        if clean(line) in names() and i+1<len(lines):
            m=re.fullmatch(r'\s*(\d{10,11})\s*',lines[i+1])
            if m and m[1]!='11111111111':found.append(m[1])
    return found
