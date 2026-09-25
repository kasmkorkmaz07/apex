"""Google Vision: tek istek, kalıcı önbellek ve yerel aylık üst sınır."""
import base64
import hashlib
import io
import json
import os
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

HOME = Path(__file__).resolve().parent / 'veriler'
LOCK = threading.Lock()


def protect(data, decrypt=False):
    """Anahtar yalnız aynı Windows kullanıcısı tarafından açılabilir."""
    import ctypes
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_byte))]
    buf = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte)))
    target = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    fn = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                   ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    fn.restype = wintypes.BOOL
    if not fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise ValueError('Google anahtarı Windows kullanıcı korumasıyla açılamadı/kaydedilemedi.')
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        kernel.LocalFree(target.data)


def settings(home=HOME):
    path = Path(home) / 'google_ocr.json'
    if not path.exists():
        return {'enabled': False, 'limit': 1000}
    return json.loads(path.read_text(encoding='utf-8'))


def save_settings(enabled, limit, key='', home=HOME):
    limit = int(limit)
    if not 0 <= limit <= 1000000:
        raise ValueError('Aylık sınır 0–1000000 arasında olmalı.')
    home = Path(home); home.mkdir(parents=True, exist_ok=True)
    config = settings(home)
    if key.strip():
        config['protected_key'] = base64.b64encode(protect(key.strip().encode())).decode()
    if enabled and not (config.get('protected_key') or os.environ.get('FIS_GOOGLE_VISION_API_KEY')):
        raise ValueError('Etkinleştirmek için Google Cloud Vision API anahtarını girin.')
    config.update(enabled=bool(enabled), limit=limit)
    target = home / 'google_ocr.json'
    tmp = target.with_suffix('.tmp')
    tmp.write_text(json.dumps(config), encoding='utf-8'); tmp.replace(target)


def connect(home):
    Path(home).mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(Path(home) / 'google_ocr.sqlite3', timeout=30)
    db.execute('CREATE TABLE IF NOT EXISTS cache (hash TEXT PRIMARY KEY, response TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS attempts (month TEXT NOT NULL, hash TEXT NOT NULL)')
    return db


def usage(home=HOME):
    db = connect(home)
    try:
        return db.execute('SELECT count(*) FROM attempts WHERE month=?',
                          (datetime.now().strftime('%Y-%m'),)).fetchone()[0]
    finally:
        db.close()


def request_vision(content, key):
    body = {'requests': [{'image': {'content': base64.b64encode(content).decode()},
                         'features': [{'type': 'DOCUMENT_TEXT_DETECTION'}],
                         'imageContext': {'languageHints': ['tr']}}]}
    req = Request('https://vision.googleapis.com/v1/images:annotate',
                  data=json.dumps(body).encode(),
                  headers={'Content-Type': 'application/json', 'X-Goog-Api-Key': key})
    try:
        with urlopen(req, timeout=30) as response:
            result = json.load(response)
    except HTTPError as e:
        raise ValueError(f'Google OCR bağlantı hatası (HTTP {e.code}); API ve faturalandırma ayarlarını kontrol edin.') from None
    except (URLError, TimeoutError, OSError):
        raise ValueError('Google OCR bağlantısı kurulamadı veya zaman aşımına uğradı.') from None
    entries = result.get('responses', [])
    if not entries or entries[0].get('error'):
        raise ValueError('Google OCR isteği tamamlanamadı; yerel sonuç korundu.')
    return entries[0]


def read(image, home=HOME, transport=request_vision):
    """Başarısız istekler de yerel sınırda sayılır; otomatik tekrar yok."""
    config = settings(home)
    if not config.get('enabled'):
        raise ValueError('Google ikinci okuma kapalı; OCR ayarlarından bağlantı kurulabilir.')
    output = io.BytesIO(); image.convert('RGB').save(output, format='PNG')
    content = output.getvalue()
    if len(content) > 14000000:
        raise ValueError('Görüntü Google isteği için çok büyük; yerel sonuç korundu.')
    fingerprint = hashlib.sha256(b'document-tr-v1' + content).hexdigest()
    with LOCK:
        db = connect(home)
        try:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT response FROM cache WHERE hash=?', (fingerprint,)).fetchone()
            if row:
                db.rollback()
                return json.loads(row[0]), True
            month = datetime.now().strftime('%Y-%m')
            count = db.execute('SELECT count(*) FROM attempts WHERE month=?', (month,)).fetchone()[0]
            if count >= config.get('limit', 1000):
                raise ValueError('Bu uygulamanın aylık Google okuma sınırına ulaşıldı; yerel sonuç korundu.')
            key = os.environ.get('FIS_GOOGLE_VISION_API_KEY', '')
            if not key and config.get('protected_key'):
                key = protect(base64.b64decode(config['protected_key']), decrypt=True).decode()
            if not key:
                raise ValueError('Google API anahtarı eksik.')
            db.execute('INSERT INTO attempts VALUES (?,?)', (month, fingerprint)); db.commit()
            result = transport(content, key)
            db.execute('INSERT OR REPLACE INTO cache VALUES (?,?)',
                       (fingerprint, json.dumps(result, ensure_ascii=False))); db.commit()
            return result, False
        finally:
            db.close()


def text(response):
    """Konumları kullanarak KDV tablosunun aynı satırını birlikte tut."""
    words = response.get('textAnnotations', [])[1:]
    groups = []
    items = []
    for word in words:
        box = word.get('boundingPoly', {}).get('vertices', [])
        if len(box) != 4:
            continue
        ys = [p.get('y', 0) for p in box]; xs = [p.get('x', 0) for p in box]
        items.append(((min(ys)+max(ys))/2, min(xs), max(ys)-min(ys), word.get('description', '')))
    for y, x, h, value in sorted(items):
        if groups and abs(y-groups[-1][0]) < max(h, groups[-1][1])*.45:
            groups[-1][2].append((x, value))
        else:
            groups.append([y, h, [(x, value)]])
    return '\n'.join(' '.join(v for _, v in sorted(g[2])) for g in groups) if groups else response.get('fullTextAnnotation', {}).get('text', '')
