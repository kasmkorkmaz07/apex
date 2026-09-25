# Fiş Asistanı — Güncel kullanım ve Zirve aktarımı

18 Eylül 2026

## Belge kimliği

- Gider fişi / faturası: satıcı ünvanı ve satıcının VKN/TCKN'si.
- Gelir faturası: SAYIN bölümündeki alıcı ünvanı ve alıcının VKN/TCKN'si.
- Gelir Z raporu: açıklama Z RAPORU, VKN/TCKN boş, evrak numarası Z NO / Z SAYAÇ. Başındaki sıfırlar kaldırılır.
- Gelir faturaları ve Z raporları belge tarihinin ayına kaydedilir. Gelirde %0 KDV'li hasılat da alınır.

## Aylık gider KDV toplamı

Ay seçiminin altında seçili mükellefin gider KDV toplamı görünür. Toplam, kayıtlardaki KDV tutarlarının toplamıdır; onaylı ve kontrol bekleyen tutarlar ayrı gösterilir. Okunamayan KDV varsa kaç kaydın toplama dahil olmadığı yazılır. Kontrol bekleyen tutarı belge üzerinden doğrulayın. Arama filtresi toplamı değiştirmez; gelir sekmesinde de gösterge gider KDV'sini göstermeye devam eder. Kaydetme, onay, silme ve yeni yükleme toplamı yeniler.

## Genel muhasebe: Z raporu ve fatura birlikte

Excel çıkar / güncelle düğmesiyle güncel dosyayı oluşturun. Zirve'de Excel Sayfa Adı: **Genel_Satis_Aktarim**. Bu bir dosya adı değil, Excel içindeki sayfadır.

[Görseldeki değerleri aynen girin](Zirve-Tek-Gelir-Doldurulmus.png).

Sabit tanımlar: Evrak Tarihi 1, Evrak No 2, Açıklama 3, Vergi/TC Kimlik 4. Diğer sabit alanlar boş.

| Evrak türü | Evrak türü sütunu | Kapatma yönü | Otomatik alt hesap | Kapatma hesap sütunu |
|---|---|---|---|---|
| Zraporu | 11 | Borçlu | Hayır | 10 |
| Satış Faturası | 11 | Borçlu | Hayır | 10 |

Önce **Zraporu**, sonra **Satış Faturası** satırını seçip her biri için Tutar Tanım Listesi'ne aynı değerleri girin:

| Matrah tutarı | Yön | KDV tutarı | KDV oranı | Matrah hesap kodu | Matrah detay | KDV hesap kodu | KDV detay |
|---|---|---|---|---|---|---|---|
| 6 | Alacaklı | 7 | 5 | 8 | boş | 9 | boş |

Alt üç hesap tanım tablosu boş kalır. 600, 391, 120 gibi hesap kodlarını Fiş Asistanı'nda mükellefin kendi hesap planına göre girin; Excel bunları taşır. Buradaki 1–11 sayıları Excel sütun numaralarıdır. F2 ile kaydedin. Perakende satış fişi de aktarılacaksa aynı tanımlarla Perakende Satış Fişi türünü ekleyin.

Gider aktarımı: **Genel_Alis_Aktarim**. Gelir: **Genel_Satis_Aktarim**. Başlıklı Genel_Alis / Genel_Satis sayfaları kontrol içindir. Aynı kayıtları Zirve'ye tekrar aktarmayın.

## İşletme defteri

Mükellef ayarında ML (mal) veya HZ (hizmet) seçilir; genel muhasebe hesap tabloları gösterilmez. Gelir_Aktarim 6 sütun, Gider_Aktarim 7 sütundur. Genel muhasebe seçildiğinde ML/HZ gizlenir, gelir ve gider hesap tabloları açılır.

## Küçük pencerede çalışma

Dar pencerede Belgeler, Kayıt detayı / onay ve Fotoğraf düğmeleri arasında geçiş yapılır. Geniş pencerede liste ve detay yan yana görünür. Mükellef, cari, hesap ve şablon ekranları uygulamanın içinde açılır.

## Apex ile ortak kayıtlar

Apex ve bağımsız Fiş Asistanı aynı kayıt klasörünü kullanır. İkisini aynı anda açmak yerine açık olanı kapatıp diğerini açın. Aynı verinin iki pencereden değiştirilmesi engellenir. Paket program penceresini gizlemek yüklemeyi silmez veya kaydı onaylamaz.

OCR sonuçlarını fotoğrafla kontrol edip onaylayın. Excel yalnız onaylı kayıtları içerir. Kilitli Excel dosyası güncellenemezse kayıtlar uygulamada korunur; Excel / Zirve aktarım ekranını kapatıp Excel çıkar / güncelle düğmesine basın.
