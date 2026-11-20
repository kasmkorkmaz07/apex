# Apex 1.0.151

- Tekil belge numarası, tarih ve tutar eşleştiğinde eksik firma adı hata yerine doğrulanamayan bilgi olarak gösterilir. Gerçek firma, VKN, tarih ve tutar farkları kontrol edilmeye devam eder.
- Fatura karşılaştırmasına durum, fatura numarası / firma / VKN araması ve tarih aralığı filtreleri eklendi. Eşleşen kayıtlar ayrıca görüntülenebilir.
- Tahakkuk Gönder bölümüne dosyasız yalnızca mesaj seçeneği eklendi. Anlık ve zamanlı gönderimler desteklenir.

Zamanlı mesajlar için Apex ve WhatsApp açık, bilgisayar uyanık ve Windows oturumu kullanılabilir olmalıdır.

Doğrulama sırasında gerçek alıcılara mesaj gönderilmedi. Karşılaştırma, filtreleme, dosyasız gönderim, zamanlama ve ekli dosya davranışları otomatik testlerle kontrol edildi.

## Profil parolasını taşıma

Özel profil parolaları mevcut ayarlardan okunur. Ortak profil parolası artık Windows makine ayarlarında tutulur. Eski kurulumun üzerine geçmeden önce yönetici PowerShell oturumunda aşağıdaki komutu kaynak klasöründen çalıştırın. Apex başka bir dizindeyse eski app.asar yolunu belirtin.

```powershell
.\scripts\Set-ApexProfilePassword.ps1 -MigrateFrom "$env:ProgramFiles\Apex\resources\app.asar"
```

Taşıma aynı parolayı korur. Yeni bir bilgisayarda ortak parola belirlemek veya sonradan değiştirmek için aynı betiği yönetici olarak parametresiz çalıştırın. Ortak parola ayarlanana kadar bu parolayı gerektiren girişler kapalıdır.
