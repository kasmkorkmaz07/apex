# Apex

Windows muhasebe çalışma alanı. Güncel kurulum: [GitHub Releases](https://github.com/kasmkorkmaz07/apex/releases/latest).

`main.js` Electron ana sürecidir. `app/fis-desktop` Cep 0.13.7 tabanlı ortak Fiş arayüzünü, `FisAsistani/desktop_service.py` yerel SQLite köprüsünü içerir. Bağımsız Fiş ekranı `Apex.exe --fis-asistani` ile açılır. Varsayılan taşınabilir Python yolu `Runtime/Python/python.exe`; yapılandırma `resources/receipt-integration.json` içinden okunur. Veriler kullanıcı Belgeler klasöründedir.

Kaynak deposunda gerçek müşteri verisi ve servis anahtarı bulunmamalıdır. Ayarlar kullanıcı kurulumundan alınır. [1.0.130 sürüm notları](SURUM-1.0.130.md).
