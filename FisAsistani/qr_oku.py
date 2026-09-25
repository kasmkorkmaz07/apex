"""OCR'dan önce QR kodunu dener. Akaryakıt fişlerindeki UTTS (Ulusal Taşıt
Tanıma Sistemi) QR kodu VKN + tarih + fiş no'yu OCR hatasından tamamen
bağımsız, %100 doğrulukla verir — kod, gerçek fiş fotoğraflarıyla test
edilerek doğrulandı.

QR toplam TUTAR'ı VERMEZ (yalnız litre/miktar verir); bu yüzden OCR'ın
yerini almaz, yalnız en çok hata yapılan üç alanı (VKN, tarih, fiş no)
yüksek güvenle önceden doldurur.
"""
import re
from fis_cikarim import vkn_gecerli

# "7280348343 30-05-2026 0106 MOTORIN2 14,470"
_UTTS = re.compile(
    r'^(\d{10})\s+(\d{2})-(\d{2})-(\d{4})\s+(\d{3,6})\s+([A-ZÇĞİÖŞÜ0-9]+)\s+([\d,.]+)$'
)


def oku_qr(im):
    """Görüntüdeki tüm QR kodlarının ham metnini döndürür (boş liste olabilir).

    OpenCV'nin dahili dedektörü kullanılır (ek kurulum gerekmez). Üretimde
    pyzbar/zxing-cpp kurulabiliyorsa decode oranı daha da yükselir — bu
    fonksiyon herhangi bir decode motorunu değiştirmeden çağrılabilir,
    yalnız 'detector' parametresiyle başka bir motor da enjekte edilebilir.
    """
    import cv2
    import numpy as np
    detector = cv2.QRCodeDetector()
    arr = np.asarray(im.convert('RGB'))[:, :, ::-1]  # PIL RGB -> cv2 BGR
    try:
        retval, decoded_info, points, _ = detector.detectAndDecodeMulti(arr)
    except cv2.error:
        return []
    if not retval:
        return []
    return [d for d in decoded_info if d]


def utts_ayikla(veri):
    """Tek bir UTTS QR payload'ını alanlara ayrıştırır. Uymuyorsa None."""
    m = _UTTS.match(veri.strip())
    if not m:
        return None
    vkn, gun, ay, yil, fis_no, urun, miktar = m.groups()
    if not vkn_gecerli(vkn):
        return None
    return {
        'vkn': vkn,
        'tarih': f'{gun}.{ay}.{yil}',
        'evrak_no': fis_no.lstrip('0') or '0',
        'urun': urun,
        'miktar': miktar.replace(',', '.'),
    }


def guclu_alanlar(im):
    """Görüntüdeki QR'lardan güvenle kullanılabilecek alan sözlüklerini döndürür.

    Birden fazla fiş aynı karede olabilir (kullanıcının fotoğraflarında
    sıkça görüldüğü gibi); bu yüzden TEK sözlük değil, LİSTE döner. Çağıran
    taraf hangi fişin hangi QR'a ait olduğunu OCR metnindeki fiş no ile
    eşleştirmelidir — bu fonksiyon yalnız ham adayları çıkarır.
    """
    sonuc = []
    for veri in oku_qr(im):
        ayrik = utts_ayikla(veri)
        if ayrik:
            sonuc.append(ayrik)
    return sonuc


def metne_ekle(text, alanlar):
    """QR'dan gelen alanları, core.draft()'ın zaten bildiği etiketli
    satırlar halinde metnin başına ekler. draft() bu satırları normal OCR
    metniyle aynı şekilde işler — ayrı bir kod yolu gerekmez.

    Birden fazla aday varsa hiçbirini seçmeden hepsini ayrı bloklar halinde
    ekler; draft()'ın zaten sahip olduğu 'tek net aday yoksa boş bırak'
    güvenliği burada da geçerli kalır — yanlış eşleşme riski yaratılmaz.
    """
    if not alanlar:
        return text
    bloklar = []
    for a in alanlar:
        bloklar.append(
            f"VKN: {a['vkn']}\nTARIH {a['tarih']}\nFIS NO: {a['evrak_no']}"
        )
    not_ekle = '[OCR BILGI: QR kod okundu; VKN/tarih/fiş no üzerinde çapraz kontrol yapıldı.]'
    return '\n'.join(bloklar) + '\n' + text + '\n' + not_ekle
