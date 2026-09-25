"""Görsel, ZIP, çok sayfalı PDF ve PDF eklerini sırayla görsele dönüştürür."""
from pathlib import Path, PurePosixPath
import hashlib
import tempfile
import uuid
import zipfile
import shutil
from contextlib import closing

IMAGES={'.jpg','.jpeg','.png','.webp','.bmp','.tif','.tiff'}
SUPPORTED=IMAGES|{'.pdf','.zip'}

def document_images(paths, destination, report=lambda text:None, cancelled=lambda:False):
    dest=Path(destination); dest.mkdir(parents=True,exist_ok=True)
    seen=set(); count=0; total_bytes=0
    def visit(path,label,depth=0):
        nonlocal count,total_bytes
        if cancelled():
            return
        if depth>5:
            report(label+': iç içe dosya sınırı aşıldı.'); return
        try:
            size=path.stat().st_size
            if size>100*1024*1024 or total_bytes+size>1024*1024*1024:
                raise ValueError('Dosya / toplu açma boyut sınırı aşıldı.')
            total_bytes+=size
            digest=hashlib.sha256(path.read_bytes()).hexdigest()
            if digest in seen:
                report(label+': aynı dosya bu yüklemede zaten işlendi.'); return
            seen.add(digest)
            suffix=path.suffix.lower()
            if suffix in IMAGES:
                count+=1
                if count>1000: raise ValueError('Tek yüklemede 1000 sayfa sınırı aşıldı.')
                target=dest/(uuid.uuid4().hex+suffix)
                shutil.copy2(path,target)
                yield target,label
            elif suffix=='.zip':
                with zipfile.ZipFile(path) as archive, tempfile.TemporaryDirectory() as tmp:
                    for entry in archive.infolist():
                        if cancelled(): return
                        if entry.is_dir(): continue
                        entry_path=PurePosixPath(entry.filename.replace('\\','/'))
                        if entry_path.is_absolute() or '..' in entry_path.parts:
                            report(label+' / '+entry.filename+': geçersiz arşiv yolu.'); continue
                        ext=entry_path.suffix.lower()
                        if ext not in SUPPORTED:
                            report(label+' / '+entry.filename+': desteklenmeyen dosya atlandı.'); continue
                        if entry.file_size>100*1024*1024 or total_bytes+entry.file_size>1024*1024*1024:
                            report(label+' / '+entry.filename+': boyut sınırı aşıldı.'); continue
                        try:
                            target=Path(tmp)/(uuid.uuid4().hex+ext)
                            with archive.open(entry) as source, target.open('wb') as out:
                                shutil.copyfileobj(source,out)
                            yield from visit(target,label+' / '+entry.filename,depth+1)
                        except Exception as e:
                            report(label+' / '+entry.filename+': '+str(e))
            elif suffix=='.pdf':
                import pypdfium2 as pdfium
                from pypdf import PdfReader
                try: text_pages=PdfReader(path).pages
                except Exception: text_pages=[]
                with pdfium.PdfDocument(path) as pdf:
                    for index in range(len(pdf)):
                        if cancelled(): return
                        count+=1
                        if count>1000: raise ValueError('Tek yüklemede 1000 sayfa sınırı aşıldı.')
                        with closing(pdf[index]) as page:
                            width,height=page.get_size()
                            scale=min(300/72,3200/max(width,height))
                            bitmap=page.render(scale=scale)
                            try:
                                target=dest/(uuid.uuid4().hex+'.png')
                                im=bitmap.to_pil(); im.save(target); im.close()
                            finally:
                                bitmap.close()
                        try:
                            from invoices import is_invoice
                            from pdf_text import positioned_text
                            extracted=positioned_text(text_pages[index])
                            if is_invoice(extracted):Path(str(target)+'.invoice.txt').write_text(extracted,encoding='utf-8')
                        except Exception:pass  # Taranmış PDF normal OCR yoluyla okunur.
                        yield target,f'{label} / Sayfa {index+1}'
                with path.open('rb') as stream, tempfile.TemporaryDirectory() as tmp:
                    reader=PdfReader(stream)
                    for name,contents in reader.attachments.items():
                        ext=Path(name).suffix.lower()
                        if ext not in SUPPORTED:
                            report(label+' / Ek '+name+': desteklenmeyen dosya atlandı.'); continue
                        for content in contents:
                            if cancelled(): return
                            if len(content)>100*1024*1024:
                                report(label+' / Ek '+name+': boyut sınırı aşıldı.'); continue
                            target=Path(tmp)/(uuid.uuid4().hex+ext); target.write_bytes(content)
                            yield from visit(target,label+' / Ek '+name,depth+1)
            else:
                report(label+': desteklenmeyen dosya.')
        except Exception as e:
            report(label+': '+str(e))
    for path in paths:
        yield from visit(Path(path),Path(path).name)
