# Türkçe ad satırı modeli

tur.traineddata: Tesseract tessdata_best Türkçe modeli.
Kaynak: https://github.com/tesseract-ocr/tessdata_best/blob/main/tur.traineddata
Lisans: Apache License 2.0 — https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE

Tam fiş okuması RapidOCR Latin PP-OCRv5 ile yapılır. Bu model yalnız kişi adı satırındaki Türkçe karakterlerin ikinci kez okunmasında kullanılır. Tesseract çalıştırılabilir dosyası PATH üzerinde veya mevcut Apex kurulumunda bulunursa etkinleşir. Yoksa Latin OCR sonucu kullanılır. Ad satırının harfleri iki motor arasında uyuşmuyorsa ikinci motorun sonucu otomatik kabul edilmez.
