"""Açık Excel dosyasını bozmadan atomik kaydet ve anlaşılır hata göster."""
from pathlib import Path
import tempfile
import os


def save_workbook(workbook, path):
    path = Path(path)
    temporary = None
    try:
        fd, name = tempfile.mkstemp(prefix='.'+path.stem+'-', suffix='.tmp.xlsx', dir=path.parent)
        os.close(fd)
        temporary = Path(name)
        workbook.save(temporary)
        temporary.replace(path)
    except PermissionError:
        from file_lock import owners
        locked_by=owners(path)
        detail=('Dosyayı kullanan program: '+', '.join(locked_by)+'\n\n') if locked_by else ''
        if any('zirve' in name.lower() for name in locked_by):
            detail+='Zirve’nin Excel aktarım ekranını kapatın. Kilit sürerse Zirve’yi normal şekilde kapatıp yeniden deneyin.\n\n'
        raise PermissionError(
            f'Excel dosyası şu anda değiştirilemiyor: {path.name}\n\n'
            +detail+
            'Dosya Excel’de veya Zirve’de açıksa kapatın. Ardından Excel çıkar / güncelle düğmesine tekrar basın.\n'
            'Kaydedilmiş fiş düzeltmeleriniz uygulamada duruyor; mevcut Excel dosyası korunmuştur.\n\n'
            'Dosya kapalıyken de sürerse OneDrive eşitlemesini ve klasörün yazma iznini kontrol edin.'
        ) from None
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
