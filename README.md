# Apex
Apex muhasebe programı ve masaüstü Fiş Asistanı kaynak kodları.

Güncel sürüm: 1.0.150. Değişiklikler: [sürüm notları](SURUM-1.0.150.md).

Kurulum dosyası GitHub Releases bölümündedir. Eski sürümde SHA-256 bilgisi yok hatası çıkıyorsa yeni kurulumu bir kez elle çalıştırın.

Kaynak arşivi kullanıcı verilerini, bağlantı anahtarlarını veya Python/Electron çalışma ortamını içermez. `app` arayüzü, kökteki Electron dosyaları ve `FisAsistani` Python hizmeti birlikte sürümlenir. APK bu sürümün kapsamında değildir.

Windows kurulumunu paketlemek için bağımlılıkları yükleyin (`npm install`), güncel kodları ve Python/OCR bağımlılıklarını içeren tam Electron uygulama klasörünü hazırlayın; ardından `node scripts/build-installer.cjs <hazır-uygulama-klasörü>` çalıştırın. Çıktı `release` klasörüne yazılır. Kaynak arşivi tek başına tam çalışma ortamı değildir.
