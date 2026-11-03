"""Görsel, ZIP, çok sayfalı PDF ve PDF eklerini sırayla görsele dönüştürür."""
from pathlib import Path, PurePosixPath
import hashlib
import re
import json
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
            if size>(1024 if path.suffix.lower()=='.zip' else 100)*1024*1024 or total_bytes+size>1024*1024*1024:
                raise ValueError('Dosya / toplu açma boyut sınırı aşıldı.')
            total_bytes+=size
            hasher=hashlib.sha256()
            with path.open('rb') as stream:
                for block in iter(lambda:stream.read(1024*1024),b''):hasher.update(block)
            digest=hasher.hexdigest()
            if digest in seen:
                report(label+': aynı dosya bu yüklemede zaten işlendi.'); return
            seen.add(digest)
            suffix=path.suffix.lower()
            if suffix in IMAGES:
                count+=1
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
                from pdf_text import positioned_text, party_blocks
                from PIL import Image
                def identity(text):
                    match=re.search(r'(?:FATURA\s*(?:S[ıiIİ]RA\s*)?(?:NO|NUMARASI))\s*[:.#]?\s*([A-Z0-9]{3}20\d{2}\d{9})',text,re.I)
                    if match:return match[1].upper()
                    match=re.search(r'ETTN\s*:\s*([A-F0-9]{8}(?:-\s*[A-F0-9]{4}){3}-\s*[A-F0-9]{12})',text,re.I)
                    return re.sub(r'\s+','',match[1]).upper() if match else ''
                group=[];group_id=''
                def emit_group():
                    nonlocal count
                    if not group:return
                    first=group[0];target=first[0]
                    # Keep continuation pages in the SAME document, including their image.
                    Path(str(target)+'.invoice.txt').write_text('\n'.join(g[2] for g in group),encoding='utf-8')
                    Path(str(target)+'.parties.json').write_text(json.dumps(first[3],ensure_ascii=False),encoding='utf-8')
                    if len(group)>1:Path(str(target)+'.pages.json').write_text(json.dumps([str(g[0]) for g in group]),encoding='utf-8')
                    count+=1
                    suffix=f'Sayfa {first[1]+1}' if len(group)==1 else f'Sayfa {first[1]+1}–{group[-1][1]+1} (tek belge)'
                    return target,f'{label} / {suffix}'
                with pdfium.PdfDocument(path) as pdf:
                    for index in range(len(pdf)):
                        if cancelled():return
                        with closing(pdf[index]) as page:
                            width,height=page.get_size();scale=min(300/72,3200/max(width,height))
                            bitmap=page.render(scale=scale)
                            try:
                                target=dest/(uuid.uuid4().hex+'.png')
                                im=bitmap.to_pil()
                                # Only genuinely white pages are skipped. A faint scan
                                # or an unreadable continuation must still be retained.
                                gray=im.convert('L');blank=gray.getextrema()[0]==255;gray.close()
                                im.save(target,compress_level=1);im.close()
                            finally:bitmap.close()
                        try:extracted=positioned_text(text_pages[index])
                        except Exception:extracted=''
                        try:parties=party_blocks(text_pages[index])
                        except Exception:parties=[]
                        if blank and not extracted.strip():continue
                        if len(extracted.strip())<80:
                            from ocr_local import read_image
                            try:extracted=read_image(target) or extracted
                            except ValueError:
                                report(f'{label} / Sayfa {index+1}: Metin okunamadı; sayfa görüntüsü kontrol için korundu.')
                        doc_id=identity(extracted)
                        # A different invoice number starts a new invoice; detail pages
                        # without a new identity stay with their preceding invoice.
                        if group and doc_id and group_id and doc_id!=group_id:
                            yield emit_group();group=[];group_id=''
                        elif group and not group_id:
                            yield emit_group();group=[]
                        if doc_id:group_id=doc_id
                        group.append((target,index,extracted,parties))
                    if group:yield emit_group()
                    elif len(pdf):report(label+': PDF yalnızca boş sayfalardan oluşuyor.')
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

