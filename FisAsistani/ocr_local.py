import re
"""Fotoğraf yalnızca yerel OCR motoruna verilir."""
_engine = None


def uncertain_lines(texts,scores):
    """Motor puanı doğruluk olasılığı değildir; zayıf alanları incelemeye ayır."""
    from core import normalized
    if scores is None:return []
    result=[]
    for text,score in zip(texts,scores):
        u=normalized(text)
        critical=re.search(r'TARIH|VKN|TCKN|VERGI|\bV\.?D\b|\bZ\s*(?:NO|SAYAC)|\b(?:FIS|BELGE|FATURA)\s*NO|TOPLAM|TOPKDV|%\s*\d',u)
        if critical and float(score)<0.85:
            result.append(text.replace('[','(').replace(']',')'))
    return result

def _tesseract_yolu():
    from pathlib import Path
    import os, shutil
    executable = str(Path(__file__).resolve().parent.parent/'resources/app.asar.unpacked/app/Tesseract-OCR/tesseract.exe')
    models = Path(__file__).resolve().parent/'models'
    if not Path(executable).exists() or not (models/'tur.traineddata').exists():
        return None, None
    return executable, models


def turkce_hedef_metinler(result):
    """Kişi adı ve ünvan/başlık satırı: Tesseract çapraz kontrolüne aday metinler.

    RapidOCR'ın paylaşımlı 'latin' modeli İ/ı/Ş/ş/Ğ/ğ/Ö/ö/Ü/ü karakterlerini
    güvenilir tanımıyor; bu iki alan (kişi adı, ticaret ünvanı) muhasebe
    kaydında en çok işe yarayan alanlar olduğu için ayrıca kontrol edilir.
    Yalnız aday listesini döndürür — asıl OCR çağrısını yapmaz, bu yüzden
    Tesseract/RapidOCR kurulu olmadan da test edilebilir.
    """
    import re
    from core import normalized, person_name, receipt_header, BUSINESS_WORDS
    joined = '\n'.join(result.txts)
    adaylar = []
    name = person_name(joined)
    if name and any(re.search(r'\bT\.?[ ]*C\.?[ ]*:',normalized(t)) for t in result.txts):
        adaylar.append(name)
    for line in receipt_header(joined)[:2]:
        if re.search(BUSINESS_WORDS, normalized(line)):
            adaylar.append(line.strip())
    return adaylar


def refine_turkish_text(im, result):
    """Kişi adı ve ünvan satırında yalnız doğrulanan Türkçe harf düzeltmelerini kabul et.

    Her aday için RapidOCR kutusunu kırpıp Tesseract'ın Türkçe dil paketiyle
    tekrar okur; yalnız diyakritiksiz hali RapidOCR sonucuyla birebir
    eşleşiyorsa (yani tek fark İ/ı/Ş/ş/Ğ/ğ/Ö/ö/Ü/ü ise) düzeltmeyi kabul
    eder. Tesseract veya 'tur' dil paketi kurulu değilse sessizce {} döner —
    hiçbir alanı bozmadan, mevcut davranışla aynı şekilde devre dışı kalır.
    """
    import re
    from pathlib import Path
    import subprocess, tempfile
    from PIL import Image, ImageOps
    from core import normalized
    adaylar = turkce_hedef_metinler(result)
    if not adaylar:
        return {}
    executable, models = _tesseract_yolu()
    if not executable:
        return {}
    canonical = lambda t: re.sub(r'[^A-Z]','',normalized(t))
    hedef_kanonikler = {canonical(a) for a in adaylar}
    sonuc = {}
    for i,(text,box) in enumerate(zip(result.txts,result.boxes)):
        if canonical(text) not in hedef_kanonikler or i in sonuc:
            continue
        x0,y0 = max(0,int(min(p[0] for p in box))),max(0,int(min(p[1] for p in box)))
        x1,y1 = int(max(p[0] for p in box)),int(max(p[1] for p in box))
        crop=im.crop((x0,y0,x1,y1)).convert('L')
        crop=ImageOps.autocontrast(crop.resize((crop.width*3,crop.height*3),Image.Resampling.LANCZOS))
        crop=ImageOps.expand(crop,border=30,fill='white')
        try:
            with tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp)/'name.png'; crop.save(path)
                out=subprocess.run([executable,str(path),'stdout','--tessdata-dir',str(models),'-l','tur','--psm','7'],capture_output=True,timeout=15,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            corrected=out.stdout.decode('utf-8',errors='replace').strip()
            corrected=re.sub(r'[.,;:]','',corrected)
            if canonical(corrected)==canonical(text) and corrected:
                sonuc[i]=corrected
        except (OSError,subprocess.TimeoutExpired):
            pass
    return sonuc

def _read_pil(im):
    global _engine
    from rapidocr import RapidOCR, LangRec, OCRVersion, ModelType
    from PIL import Image, ImageOps
    import numpy as np
    if _engine is None:
        _engine = RapidOCR(params={'Rec.lang_type':LangRec.LATIN,
            'Rec.ocr_version':OCRVersion.PPOCRV5,'Rec.model_type':ModelType.MOBILE,
            'Det.limit_side_len':1600,'Det.limit_type':'max','Det.box_thresh':0.3})
    result = _engine(np.asarray(im))
    # Eğik satırlar tablo satırlarını birbirine karıştırır. Kutulardan eğimi
    # ölçüp görüntüyü düzelterek ikinci kez oku.
    if result.boxes is not None and len(result.boxes)>5:
        angles=[np.degrees(np.arctan2(b[1][1]-b[0][1],b[1][0]-b[0][0]))
                for b in result.boxes if b[1][0]-b[0][0]>50]
        angle=float(np.median(angles)) if angles else 0
        if 0.8<abs(angle)<15:
            im=im.rotate(angle,resample=Image.Resampling.BICUBIC,expand=True,fillcolor='white')
            result=_engine(np.asarray(im))
    refinements = refine_turkish_text(im,result) if result.txts is not None else {}
    if result.txts is None or len(result.txts) == 0:
        raise ValueError('Görüntüde metin bulunamadı. Daha net fotoğraf deneyin.')
    # Kutuların y merkezlerine göre yakın metin parçalarını aynı satırda birleştir.
    items = []
    for i,(box, txt) in enumerate(zip(result.boxes, result.txts)):
        txt = refinements.get(i,txt)
        ys = [float(p[1]) for p in box]
        xs = [float(p[0]) for p in box]
        items.append(((min(ys)+max(ys))/2, min(xs), max(ys)-min(ys), txt))
    groups = []
    for y,x,h,txt in sorted(items):
        if groups and abs(y-groups[-1][0]) < max(h,groups[-1][1])*0.45:
            groups[-1][2].append((x,txt))
        else:
            groups.append([y,h,[(x,txt)]])
    text='\n'.join(' '.join(t for _,t in sorted(g[2])) for g in groups)
    weak=uncertain_lines(result.txts,getattr(result,'scores',None))
    if weak:
        text+='\n[OCR KONTROL: Bazı kritik satırlar zayıf okundu; fotoğraftan doğrulayın: '+'; '.join(weak)+']'
    return text


def _temiz_mi(text):
    """İlk geçiş zaten güvenle onaylanabilir mi? Öyleyse sonraki pahalı
    geçişlerin (ön işleme + yeniden OCR, detay varyantı, başlık kırpması)
    hiçbiri tetiklenmez — sonucu değiştirmeyecek işe zaman harcanmaz.
    """
    if not text:
        return False
    from core import draft
    from review import needs_review
    return not needs_review(draft(text, use_vendor_hints=False))


def read_image(path):
    from PIL import Image, ImageOps
    from scan_prepare import prepare, choose
    with Image.open(path) as source:
        im=ImageOps.exif_transpose(source).convert('RGB')

    # QR kod, VKN/tarih/fiş no'yu OCR hatasından bağımsız verir; OCR'dan
    # önce denenir. Toplam tutarı vermediği için OCR'ın yerini almaz,
    # yalnız en çok hata yapılan üç alanı önceden güvenle işaretler.
    try:
        from qr_oku import guclu_alanlar, metne_ekle
        qr_alanlari = guclu_alanlar(im)
    except Exception:
        qr_alanlari = []

    try:
        original=_read_pil(im)
    except ValueError:
        original=''
    if qr_alanlari:
        original=metne_ekle(original,qr_alanlari)

    if _temiz_mi(original):
        # İlk geçiş zaten tüm alan ve tutar kontrollerini geçti; ön işleme,
        # detay varyantı ve başlık kırpması hiçbiri buraya bir şey katmaz.
        selected=original
    else:
        try:
            enhanced,degisti=prepare(im,report=True)
            # Perspektif düzeltme fiilen uygulanmadıysa ve aydınlatma
            # belirgin ölçüde düzeltilmediyse ikinci OCR aynı işi tekrarlar.
            processed=original if not degisti else _read_pil(enhanced)
        except ValueError:
            processed=''
        selected=choose(original,processed)
        # Zor belgelerde tek bir ek, kırpmasız görüntü kullan.
        from review import needs_review
        from core import draft
        if needs_review(draft(selected,use_vendor_hints=False)):
            from scan_prepare import detail_variant
            try:
                detail=_read_pil(detail_variant(im))
                selected=choose(selected,detail)
            except ValueError:
                pass
        # Eksik başlık alanları için tam fişi küçültmek yerine üst bölümü yeniden oku.
        from core import draft, normalized
        current=draft(selected,use_vendor_hints=False)
        if any(not current[k] for k in ('vkn','evrak_tarihi','aciklama')):
            try:
                header_text=_read_pil(im.crop((0,0,im.width,int(im.height*.55))).resize((im.width*2,int(im.height*.55)*2)))
                header_lines=[]
                for line in header_text.splitlines():
                    header_lines.append(line)
                    if re.search(r'\b\d{2}[./-]\d{2}[./-]\d{4}\b',normalized(line)):break
                supplement='\n'.join(header_lines)
                candidate=draft(supplement+'\n'+selected,use_vendor_hints=False)
                fields=('vkn','evrak_tarihi','aciklama')
                if (all(not current[k] or candidate[k]==current[k] for k in ('vkn','evrak_tarihi'))
                        and sum(bool(candidate[k]) for k in fields)>sum(bool(current[k]) for k in fields)):
                    selected=supplement+'\n'+selected
            except ValueError:
                pass

    from ocr_recovery import recover
    if selected:
        try:selected=recover(im,selected,_read_pil)
        except ValueError:pass
    if not selected:
        raise ValueError('Görüntüde metin bulunamadı. Daha net fotoğraf deneyin.')
    # Bilinen ticari ek/kelimelerdeki İ/ı/Ş/ş/Ğ/ğ/Ö/ö/Ü/ü kaybını sıfır
    # bağımlılıklı sözlükle geri kazan (Tesseract kurulu olmasa da çalışır).
    from unvan_kurtar import duzelt_metin
    return duzelt_metin(selected)
