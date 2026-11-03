# Apex 1.0.150

Fiş Asistanı artık aynı Baserow tablo ve bağlantı anahtarını kullanan Apex bilgisayarları arasında ofis bağlantısını şifreli paylaşır. Önce mevcut bilgisayarda Apex senkronunu çalıştırın; yeni bilgisayarda aynı Apex senkron ayarlarıyla giriş yapın. Fiş Asistanı faturaları kendi ofis sunucusundan indirir. Mevcut farklı ofis bağlantısı otomatik değiştirilmez. Yerel ağ senkronu için Fiş Asistanı bağlantısı ayrıca tanımlanmalıdır.

- Güncelleme paketinin SHA-256 ve boyut bilgisi kurulum doğrulamasına aktarılır; eksik doğrulama bilgisi varsa indirme başlamaz.
- Silinip yeniden yüklenen aynı faturalar, eski silme kaydına takılmadan güncel bilgisayar bilgileriyle eşitlenir. Başka cihazda değişmiş kayıtlar korunur.
- Uzun eşitlemelerde ilerleme sinyali zaman aşımını önler; gönderim grupları otomatik devam eder.
- Toplu belge onayında işlenen/toplam belge, yüzde, onaylanan ve hatalı belge sayıları gösterilir. Aylık Excel her belge için değil, toplu işlem sonunda ilgili ay başına bir kez hazırlanır. Belge doğrulamaları korunur.
- Güncel masaüstü tasarımı, Excel simgesi, manuel belge ekleme, ayarlarda telefon eşitlemesi ve bildirim temizleme dahildir.
- Önceki Excel tarih sıralaması, KDV, iade, tevkifat, belge arama ve toplu işlem düzeltmeleri korunur.

Eski sürüm SHA-256 bilgisi yok hatası veriyorsa bu kurulum dosyasını bir kez indirip elle çalıştırın. Sonraki güncellemeler düzeltilmiş güncelleyiciyi kullanır. Kurulum kullanıcı kayıtlarını silmez. APK bu yayında değiştirilmemiştir. Turkcell 5G erişimi telefonda ayrıca doğrulanmalıdır.
