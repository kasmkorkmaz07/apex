"""Puanlamalı alan çıkarımı ve aritmetik onarım.

core.draft() katı davranır: birden fazla aday varsa alanı boş bırakır.
Bu modül yalnız BOŞ KALAN alanlar için devreye girer, adayları puanlar,
en iyisini yazar ve güven skorunu d['guven'] altına kaydeder.
Mevcut davranış hiçbir zaman ezilmez; sadece boşluklar doldurulur.
"""
import re
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

CENT = Decimal('0.01')

# Yürürlükteki ve geçmiş KDV oranları. Bunların dışı OCR hatası sayılır.
GECERLI_ORANLAR = {0, 1, 8, 10, 18, 20}

# OCR'ın rakamlarda en sık yaptığı karışıklıklar (çift yönlü kullanılır).
KARISIKLIK = {'0': 'O8', '1': '7', '3': '8', '5': 'S6', '6': '58',
              '8': '30B', '9': '4'}


# --------------------------------------------------------------------------
# Kimlik sağlaması
# --------------------------------------------------------------------------

def vkn_gecerli(n):
    """10 haneli vergi kimlik numarası kontrol hanesi sağlaması."""
    if not re.fullmatch(r'\d{10}', n or ''):
        return False
    a = [int(c) for c in n]
    toplam = 0
    for i in range(9):
        tmp = (a[i] + 9 - i) % 10
        if tmp == 0:
            continue
        res = (tmp * pow(2, 9 - i)) % 9
        toplam += res or 9
    return (10 - toplam % 10) % 10 == a[9]


def tckn_gecerli(n):
    """11 haneli TC kimlik numarası MERNİS sağlaması."""
    if not re.fullmatch(r'[1-9]\d{10}', n or '') or len(set(n)) == 1:
        return False
    a = [int(c) for c in n]
    if (7 * sum(a[:9:2]) - sum(a[1:8:2])) % 10 != a[9]:
        return False
    return sum(a[:10]) % 10 == a[10]


def kimlik_gecerli(n):
    return vkn_gecerli(n) or tckn_gecerli(n)


# --------------------------------------------------------------------------
# Tarih
# --------------------------------------------------------------------------

TARIH_KALIBI = re.compile(r'\b(\d{1,2})[./\-](\d{1,2})[./\-](\d{2}|\d{4})\b')
TARIH_ETIKETI = re.compile(r'TARIH|TARFH|DUZENLEME|ISLEM', re.IGNORECASE)
# Kart/POS bölümündeki tarih belge tarihi değildir.
POS_ETIKETI = re.compile(r'TERMINAL|ISYERI|IS\s*YERI|BATCH|STAN|ONAY|REF\s*NO|'
                         r'KREDI\s*KART|BANKA|SON\s*KUL', re.IGNORECASE)


def tarih_adaylari(metin, bugun=None):
    """(tarih, puan, gerekce) listesi döndürür; puan yüksek olan tercih edilir."""
    bugun = bugun or datetime.now()
    sonuc = []
    for sira, satir in enumerate(metin.splitlines()):
        pos_satiri = bool(POS_ETIKETI.search(satir))
        etiketli = bool(TARIH_ETIKETI.search(satir))
        for gun, ay, yil in TARIH_KALIBI.findall(satir):
            if len(yil) == 2:
                yil = ('20' if int(yil) <= bugun.year % 100 + 1 else '19') + yil
            try:
                t = datetime(int(yil), int(ay), int(gun))
            except ValueError:
                continue
            gecen = (bugun - t).days
            # Gelecek tarih veya 3 yıldan eski tarih fiş tarihi olamaz.
            if gecen < -2 or gecen > 1095:
                continue
            puan = 100
            if etiketli:
                puan += 60
            if pos_satiri:
                puan -= 70
            # Fişin üst kısmındaki tarih, alttaki POS tarihinden olasıdır.
            puan -= min(sira, 40)
            # Yakın tarih daha olası.
            puan -= min(gecen // 30, 24)
            sonuc.append((t.strftime('%d.%m.%Y'), puan,
                          'etiketli' if etiketli else ('POS bölümü' if pos_satiri else 'başlık')))
    sonuc.sort(key=lambda x: -x[1])
    return sonuc


# --------------------------------------------------------------------------
# VKN / TCKN
# --------------------------------------------------------------------------

KIMLIK_ETIKETI = re.compile(r'VKN|VERGI|TCKN|\bT\.?\s*C\.?\b|\bV\.?\s*D\.?\b|\bVN\b',
                            re.IGNORECASE)
ALICI_ETIKETI = re.compile(r'MUSTERI|ALICI|SAYIN|NIHAI|TUKETICI', re.IGNORECASE)


def kimlik_adaylari(metin, kind='gider'):
    """Sağlaması geçen kimlikleri puanlayarak döndürür."""
    sonuc = []
    satirlar = metin.splitlines()
    for sira, satir in enumerate(satirlar):
        etiketli = bool(KIMLIK_ETIKETI.search(satir))
        # Etiket bir satırda, numara bir alt satırda olabilir.
        if not etiketli and sira and KIMLIK_ETIKETI.search(satirlar[sira - 1]):
            etiketli = True
        alici = bool(ALICI_ETIKETI.search(satir))
        for n in re.findall(r'(?<!\d)(\d{10,11})(?!\d)', satir):
            if n == '11111111111' or len(set(n)) == 1:
                continue
            if not kimlik_gecerli(n):
                continue
            puan = 100
            if etiketli:
                puan += 80
            # Gelirde alıcı kimliği istenir, giderde satıcı kimliği.
            if alici:
                puan += 50 if kind == 'gelir' else -60
            puan -= min(sira * 2, 50)
            sonuc.append((n, puan, 'etiketli' if etiketli else 'sağlama geçti'))
    sonuc.sort(key=lambda x: -x[1])
    return sonuc


# --------------------------------------------------------------------------
# Tutar
# --------------------------------------------------------------------------

TUTAR_KALIBI = re.compile(r'(?<![\d,.])(\d{1,3}(?:[.\s]\d{3})*|\d+)[.,](\d{2})(?![\d])')

TOPLAM_ETIKETLERI = [
    (re.compile(r'\bGENEL\s*TOP', re.IGNORECASE), 150),
    (re.compile(r'\bKDV\s*DAHIL\s*(?:TOPLAM|TUTAR)', re.IGNORECASE), 150),
    (re.compile(r'\bODENECEK', re.IGNORECASE), 140),
    (re.compile(r'\bTOPLAM\b', re.IGNORECASE), 120),
    (re.compile(r'\bTOP\b', re.IGNORECASE), 90),
    (re.compile(r'\bTUTAR\b', re.IGNORECASE), 70),
    (re.compile(r'\bNAKIT\b|\bKREDI\s*KART', re.IGNORECASE), 40),
]
# Bunlar toplam değildir.
TOPLAM_DISI = re.compile(r'ARA\s*TOP|TOPKDV|TOPLAM\s*KDV|PARA\s*USTU|\bPUAN\b|'
                         r'INDIRIM|\bKDV\s*[%:]', re.IGNORECASE)


def _tutar(eslesme):
    tam = eslesme[1].replace('.', '').replace(' ', '')
    return Decimal(tam + '.' + eslesme[2])


def toplam_adaylari(metin):
    sonuc = []
    for sira, satir in enumerate(metin.splitlines()):
        if TOPLAM_DISI.search(satir):
            continue
        temel = 0
        etiket = ''
        for kalip, p in TOPLAM_ETIKETLERI:
            if kalip.search(satir):
                temel, etiket = p, kalip.pattern
                break
        if not temel:
            continue
        bulunan = list(TUTAR_KALIBI.finditer(satir))
        if not bulunan:
            continue
        deger = _tutar(bulunan[-1])
        if deger <= 0:
            continue
        # Fişin altındaki toplam daha güvenilir.
        sonuc.append((str(deger), temel + min(sira, 30), etiket))
    sonuc.sort(key=lambda x: -x[1])
    return sonuc


def basili_kdv(metin):
    """Fişte basılı TOPKDV / TOPLAM KDV değerleri."""
    degerler = []
    for satir in metin.splitlines():
        if re.search(r'\bTOPKDV\b|\bTOPLAM\s*KDV\b', satir, re.IGNORECASE):
            bulunan = list(TUTAR_KALIBI.finditer(satir))
            if bulunan:
                degerler.append(_tutar(bulunan[-1]))
    return degerler


def oran_adaylari(metin):
    """Fişte geçen, mevzuata uygun KDV oranları."""
    oranlar = []
    for ham in re.findall(r'%\s*(\d{1,2})(?!\d)', metin):
        n = int(ham)
        if n in GECERLI_ORANLAR:
            oranlar.append(n)
    return sorted(set(oranlar))


# --------------------------------------------------------------------------
# Aritmetik onarım
# --------------------------------------------------------------------------

def ondalik(deger):
    """'1.234,56', '1234,56', '1234.56' ve Decimal girdilerini Decimal'e çevirir."""
    if isinstance(deger, Decimal):
        return deger
    s = str(deger).strip().replace(' ', '')
    if not s:
        raise ValueError('Tutar boş.')
    if ',' in s:
        s = s.replace('.', '').replace(',', '.')
    elif s.count('.') > 1:
        # 5.900.00 gibi OCR hatası: son nokta kuruş ayracıdır.
        sol, kurus = s.rsplit('.', 1)
        s = sol.replace('.', '') + '.' + kurus
    return Decimal(s)


def _varyantlar(tutar):
    """Tek haneli OCR karışıklığı düzeltilmiş tutar adayları."""
    s = str(ondalik(tutar))
    uretilen = {s}
    for i, c in enumerate(s):
        if not c.isdigit():
            continue
        for hedef in '0123456789':
            if hedef == c:
                continue
            # Yalnız bilinen karışıklık çiftlerini dene.
            if hedef not in KARISIKLIK.get(c, '') and c not in KARISIKLIK.get(hedef, ''):
                continue
            uretilen.add(s[:i] + hedef + s[i + 1:])
    return [Decimal(x) for x in uretilen]


def brut_satir(oran, brut):
    oran, brut = ondalik(oran), ondalik(brut)
    matrah = (brut / (1 + oran / 100)).quantize(CENT, rounding=ROUND_HALF_UP)
    return dict(oran=str(oran), matrah=str(matrah), kdv=str(brut - matrah))


def onar(toplam, oranlar, kdv_basili, tolerans=Decimal('0.02')):
    """Basılı toplam ve basılı KDV'yi tek orana oturtmaya çalışır.

    Önce toplamı olduğu gibi dener; tutmazsa toplam üzerinde tek haneli
    OCR düzeltmesi arar. Tek bir tutarlı çözüm bulunursa döndürür.
    """
    if toplam is None or toplam == '' or not kdv_basili:
        return None
    try:
        ondalik(toplam)
    except Exception:
        return None
    hedef = ondalik(kdv_basili)
    denenecek = [o for o in (oranlar or sorted(GECERLI_ORANLAR - {0}))]
    cozumler = []
    for aday in _varyantlar(toplam):
        if aday <= 0:
            continue
        for oran in denenecek:
            satir = brut_satir(oran, aday)
            if abs(ondalik(satir['kdv']) - hedef) <= tolerans:
                cozumler.append((str(aday), oran, satir, aday == ondalik(toplam)))
    if not cozumler:
        return None
    # Toplamı hiç değiştirmeyen çözüm varsa onu tercih et.
    bozulmamis = [c for c in cozumler if c[3]]
    havuz = bozulmamis or cozumler
    if len({(c[0], c[1]) for c in havuz}) != 1:
        return None
    toplam_yeni, oran, satir, aynen = havuz[0]
    return dict(toplam=toplam_yeni, kalemler=[satir], duzeltildi=not aynen)


# --------------------------------------------------------------------------
# Giriş noktası
# --------------------------------------------------------------------------

def tamamla(d, metin=None, kind=None, esik=110):
    """draft() çıktısındaki boş alanları puanlamalı adaylarla doldurur.

    Dolu alanlara dokunmaz. draft()'ın KENDİSİ zaten bir belirsizlik/çelişki
    notu bırakmışsa (örn. birden fazla satıcı kimliği, karışmış Z raporu)
    HİÇBİR ALANI DOLDURMAZ — draft()'ın bilinçli olarak boş bıraktığı bir
    alanı asla ezmez. Bu, draft()'ın kendi güvenlik mekanizmasıdır; tamamla()
    yalnız draft()'ın SESSİZCE boş bıraktığı (hiçbir aday bulunamadığı için
    boş kalan, herhangi bir çelişki notu OLMAYAN) alanları doldurur.
    """
    if '[OCR KONTROL:' in d.get('ocr',''):
        return d
    d = dict(d)
    metin = metin if metin is not None else d.get('ocr', '')
    kind = kind or d.get('kind', 'gider')
    guven = dict(d.get('guven', {}))
    notlar = []

    if not d.get('tarih') or not d.get('evrak_tarihi'):
        adaylar = tarih_adaylari(metin)
        if adaylar and adaylar[0][1] >= esik:
            deger, puan, gerekce = adaylar[0]
            for alan in ('tarih', 'evrak_tarihi'):
                if not d.get(alan):
                    d[alan] = deger
                    guven[alan] = puan
            notlar.append(f'Tarih {deger} olarak seçildi ({gerekce}).')

    if not d.get('vkn') and kind != 'gelir':
        adaylar = kimlik_adaylari(metin, kind)
        if adaylar and adaylar[0][1] >= esik:
            deger, puan, gerekce = adaylar[0]
            # İki aday da sağlamayı geçip başa baş ise karar verme.
            if len(adaylar) == 1 or adaylar[0][1] > adaylar[1][1] + 25:
                d['vkn'] = deger
                guven['vkn'] = puan
                notlar.append(f'VKN/TCKN {deger} seçildi ({gerekce}).')

    if not d.get('toplam'):
        adaylar = toplam_adaylari(metin)
        if adaylar and adaylar[0][1] >= esik:
            deger, puan, _ = adaylar[0]
            d['toplam'] = deger
            guven['toplam'] = puan
            notlar.append(f'Toplam {deger} olarak seçildi.')

    if not d.get('kalemler') and d.get('toplam'):
        kdv = basili_kdv(metin)
        if len(set(kdv)) == 1:
            cozum = onar(d['toplam'], oran_adaylari(metin), kdv[0])
            if cozum:
                d['toplam'] = cozum['toplam']
                d['kalemler'] = cozum['kalemler']
                d['vat_inferred'] = True
                guven['kalemler'] = 90
                notlar.append(
                    'Toplam OCR düzeltmesiyle {} yapıldı; basılı KDV ile tutarlı.'.format(cozum['toplam'])
                    if cozum['duzeltildi'] else
                    'KDV oranı basılı KDV ve toplamdan hesaplandı.')

    if guven:
        d['guven'] = guven
    if notlar:
        d['ocr'] = (d.get('ocr', '') +
                    '\n[OCR KONTROL: Otomatik tamamlanan alanlar var — ' +
                    ' '.join(notlar) + ' Fotoğraftan doğrulayın.]')
    return d
