"""Hafızadan bağımsız kontrol; yalnız şüpheli son fişi ikinci motora gönder."""
import re
from core import draft, normalized, money
from review import needs_review


def clean(text):
    return re.sub(r'(?m)^\[OCR (?:BILGI|KONTROL):[^\n]*\]\s*', '', text).strip()


def parsed(text):
    from z_reports import is_z_report
    return draft(clean(text),kind='gelir' if is_z_report(text) else 'gider', use_vendor_hints=False)


def suspicious(text):
    return '[OCR KONTROL:' in text or needs_review(parsed(text))


def vat(d):
    totals = {}
    for row in d['kalemler']:
        rate = money(row['oran'])
        totals[rate] = totals.get(rate, 0) + money(row['matrah']) + money(row['kdv'])
    return totals


def reconcile(local, remote, cached=False):
    a, b = parsed(local), parsed(remote)
    conflicts = []
    for key, label in [('vkn', 'VKN/TCKN'), ('evrak_tarihi', 'Evrak tarihi'),
                       ('evrak_no', 'Belge no'), ('toplam', 'Toplam'), ('aciklama', 'Ünvan')]:
        x, y = a.get(key), b.get(key)
        if x and y:
            equal = normalized(x) == normalized(y) if key == 'aciklama' else x == y
            if not equal:
                conflicts.append(f'{label}: yerel {x} / Google {y}')
    if a['kalemler'] and b['kalemler'] and vat(a) != vat(b):
        conflicts.append('KDV dağılımı: yerel '+str(vat(a))+' / Google '+str(vat(b)))
    origin = 'Google önbelleği' if cached else 'Google Cloud Vision'
    if conflicts:
        return local+'\n[OCR KONTROL: İki okuyucu uyuşmuyor; '+'; '.join(conflicts)+']\n[OCR BILGI: Yerel sonuç korundu; '+origin+' ile karşılaştırıldı.]'
    # Eksik alanlar ancak bütün halinde geçerli ikinci okumayla tamamlanır.
    if remote.strip() and not needs_review(b):
        old_notes = re.findall(r'\[OCR KONTROL: [^\]]+\]', local)
        return clean(remote)+'\n'+'\n'.join(old_notes)+'\n[OCR BILGI: '+origin+' kullanıldı; dolu alanlarda yerel okumayla çelişki bulunmadı.]'
    return local+'\n[OCR KONTROL: Google ikinci okumada da eksik veya tutarsız alanlar var; yerel sonuç korundu.]'


def finish(path, local, reader=None):
    if not suspicious(local):
        return local+'\n[OCR BILGI: Yerel OCR; alan ve tutar kontrolleri geçti. Google kullanılmadı.]'
    from PIL import Image, ImageOps
    from scan_prepare import prepare
    from ocr_cloud import read, text
    try:
        with Image.open(path) as source:
            image = prepare(ImageOps.exif_transpose(source).convert('RGB'))
        response, cached = (reader or read)(image)
        return reconcile(local, text(response), cached)
    except Exception as error:
        # Ağ/kimlik bilgisi detayını veya anahtarı hata metnine taşımayın.
        message = str(error) if isinstance(error, ValueError) else 'İkinci okuyucu tamamlanamadı; yerel sonuç korundu.'
        message = message.replace('[', '(').replace(']', ')').replace('\n', ' ')
        return local+'\n[OCR KONTROL: '+message+']'


def read_image(path):
    from invoices import embedded_text
    embedded=embedded_text(path)
    if embedded:return embedded
    from ocr_local import read_image as read_local
    try:
        local = read_local(path)
    except ValueError:
        local = ''
    return finish(path, local)
