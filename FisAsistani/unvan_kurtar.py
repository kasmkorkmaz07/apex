"""OCR'ın kaybettiği İ/ı/Ş/ş/Ğ/ğ/Ö/ö/Ü/ü harflerini bilinen ticari kelimelerde
geri kazanır. Tesseract veya başka bir motora ihtiyaç duymaz; RapidOCR'ın
paylaşımlı 'latin' modelinin Türkçe karakterleri düzgün tanımamasının
bıraktığı en sık hasarı, sabit bir sözlükle onarır.

Yalnız TAM KELİME eşleşmesi yapılır (\b...\b); kelimenin içine gömülü
olası yanlış pozitifler (örn. rastgele bir ürün kodu) böylece dokunulmadan
kalır. Sözlükte olmayan hiçbir şey değiştirilmez — sessizce tahmin
üretmez, yalnız bilineni düzeltir.
"""
import re

# Anahtar: OCR'ın ürettiği bozuk (yalnız ASCII, İ/ı/Ş/ş/Ğ/ğ/Ö/ö/Ü/ü'siz) hal.
# Değer: doğru Türkçe büyük harf yazımı.
# Not: Türkçe'de büyük İ noktalıdır (İ), büyük I noktasızdır (I) — 'GIDA'
# zaten doğru yazımdır (gıda -> GIDA), bu yüzden sözlükte YOK.
SOZLUK = {
    'STI': 'ŞTİ', 'STİ': 'ŞTİ',
    'TIC': 'TİC', 'TİC': 'TİC',
    'TICARET': 'TİCARET',
    'TICARETI': 'TİCARETİ',
    'URUN': 'ÜRÜN', 'URUNLERI': 'ÜRÜNLERİ', 'URN': 'ÜRN',
    'SANAYI': 'SANAYİ', 'SANAYII': 'SANAYİİ',
    'INSAAT': 'İNŞAAT', 'INS': 'İNŞ',
    'ITHALAT': 'İTHALAT', 'IHRACAT': 'İHRACAT',
    'OTOMOTIV': 'OTOMOTİV',
    'TEKSTIL': 'TEKSTİL',
    'ELEKTRIK': 'ELEKTRİK', 'ELEKTRONIK': 'ELEKTRONİK',
    'MUHENDISLIK': 'MÜHENDİSLİK',
    'DIS': 'DIŞ', 'ICDIS': 'İÇDIŞ',
    'ISLETMELERI': 'İŞLETMELERİ', 'ISLETME': 'İŞLETME',
    'HIZMETLERI': 'HİZMETLERİ', 'HIZMET': 'HİZMET',
    'PAZARLAMA': 'PAZARLAMA',  # diyakritiksiz doğru; değişmeden dursun diye referans
    'NAKLIYAT': 'NAKLİYAT', 'NAKLIYE': 'NAKLİYE',
    'NALBURIYE': 'NALBURİYE',
    'KUYUMCULUK': 'KUYUMCULUK',
    'NARENCIYE': 'NARENCİYE',
    'NIHAI': 'NİHAİ', 'TUKETICI': 'TÜKETİCİ',
    'MUSTERI': 'MÜŞTERİ', 'MOSTERI': 'MÜŞTERİ',
    'BOLGE': 'BÖLGE', 'BOLGESI': 'BÖLGESİ',
    'MUDURLUGU': 'MÜDÜRLÜĞÜ', 'MUDURLUK': 'MÜDÜRLÜK',
    'VERGI': 'VERGİ', 'VERGISI': 'VERGİSİ',
    'DAIRESI': 'DAİRESİ',
    'ISYERI': 'İŞYERİ',
    'URETIM': 'ÜRETİM', 'URETICI': 'ÜRETİCİ',
    'GIYIM': 'GİYİM',
    'INSAN': 'İNSAN',
    'OGRETIM': 'ÖĞRETİM', 'EGITIM': 'EĞİTİM',
    'SAGLIK': 'SAĞLIK',
    'GUVENLIK': 'GÜVENLİK',
}
# Yalnız harften oluşan token (noktalama tokenden ayrı ele alınır).
_TOKEN = re.compile(r"[A-ZÇĞİÖŞÜ]+")


def duzelt_kelime(kelime):
    """Tek bir büyük harfli token'ı sözlükte varsa düzelt, yoksa aynen döndür."""
    return SOZLUK.get(kelime, kelime)


def duzelt_satir(satir):
    """Satırdaki her token'ı, noktalama ve boşlukları koruyarak düzeltir."""
    return _TOKEN.sub(lambda m: duzelt_kelime(m.group(0)), satir)


def duzelt_metin(metin):
    """Çok satırlı OCR çıktısını satır satır düzeltir. [OCR ...] notlarına dokunmaz."""
    sonuc = []
    for satir in metin.splitlines():
        if satir.startswith(('[OCR KONTROL:', '[OCR BILGI:')):
            sonuc.append(satir)
        else:
            sonuc.append(duzelt_satir(satir))
    return '\n'.join(sonuc)
