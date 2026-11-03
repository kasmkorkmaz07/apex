"""PDF metin parçalarını gerçek sayfa konumuyla sırala; kelimeleri yeniden bölme."""
import re

def positioned_text(page):
    chunks=[]
    def visit(text,cm,tm,font,size):
        if not text.strip():return
        x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4]
        y=tm[4]*cm[1]+tm[5]*cm[3]+cm[5]
        height=max(abs(size*cm[3]),abs(size*cm[1]),1)
        for i,line in enumerate(text.splitlines()):
            if line.strip():chunks.append((y-i*height,x,height,re.sub(r'\s+',' ',line).strip()))
    page.extract_text(visitor_text=visit)
    if not chunks or page.rotation:return page.extract_text(extraction_mode='layout')
    rows=[]
    for y,x,h,text in sorted(chunks,key=lambda c:(-c[0],c[1])):
        if rows and abs(rows[-1][0]-y)<=min(h,rows[-1][1])*.35:rows[-1][2].append((x,text))
        else:rows.append([y,h,[(x,text)]])
    # Keep the recipient column together: logos and invoice metadata on the
    # right must never become part of the legal recipient name on the left.
    output=[];deferred=[];boundary=None
    width=float(page.mediabox.width)
    for row in rows:
        parts=sorted(row[2])
        anchor=next((x for x,t in parts if re.match(r'^SAYIN\b',t,re.I)),None)
        if anchor is not None:boundary=anchor+width*.45
        if boundary is not None and any(re.match(r'^(?:ETTN|Sıra|SIRA|Mal Hizmet)\b',t,re.I) for x,t in parts if x<boundary):
            output.extend(deferred);deferred=[];boundary=None
        if boundary is not None:
            left=[t for x,t in parts if x<boundary]
            right=[t for x,t in parts if x>=boundary]
            if left:output.append(' '.join(left))
            if right:deferred.append(' '.join(right))
        else:output.append(' '.join(t for _,t in parts))
    output.extend(deferred)
    return '\n'.join(output)


def party_blocks(page):
    """Independent tax-ID bearing columns. No assumption that the seller is left."""
    chunks=[]
    def visitor(text,cm,tm,font,size):
        x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4];y=tm[4]*cm[1]+tm[5]*cm[3]+cm[5]
        for i,line in enumerate(text.splitlines()):
            if line.strip():chunks.append((x,y-i*max(abs(size*cm[3]),1),line.strip()))
    page.extract_text(visitor_text=visitor)
    if not chunks or page.rotation:return []
    width=max(float(page.mediabox.width),max(x for x,_,_ in chunks)*1.05)
    # Headers end at the first item-table header, not at a bank/account footer.
    ends=[y for x,y,t in chunks if re.match(r'^(?:Sıra|SIRA|S\. ?No|Mal/Hizmet|Mal Hizmet|Stok Kodu)\b',t,re.I)]
    bottom=max(ends) if ends else float(page.mediabox.height)*.3
    result=[]
    for left,right in [(0,width*.49),(width*.49,width)]:
        col=sorted([(x,y,t) for x,y,t in chunks if left<=x<right and y>bottom],key=lambda c:(-c[1],c[0]))
        rows=[]
        for x,y,t in col:
            if rows and abs(rows[-1][0]-y)<3:rows[-1][1].append(t)
            else:rows.append([y,[t]])
        text='\n'.join(re.sub(r'[^\S\n]+',' ',' '.join(parts)) for _,parts in rows)
        pattern=r'(?:VKN|TCKN|VERG[Iİ]\s*(?:K[Iİ]ML[Iİ]K\s*)?(?:NO|NUMARASI)|V\.?D\.?)[^\n]{0,45}?(?:\n[ \t]*)?\b(\d(?:[ \t]*\d){9,10})\b(?![ \t]*\d)'
        matches=list(re.finditer(pattern,text,re.I))
        start=0
        for m in matches:
            block=text[start:m.end()]
            # Recipient blocks below SAYIN are kept separate from the issuer.
            anchor=list(re.finditer(r'(?:^|\n)(?:SAYIN|ALICI B[Iİ]LG[Iİ]LER[Iİ]|M[ÜU]ŞTER[Iİ]\s+ADI\s+SOYADI)\b',block,re.I))
            if anchor:block=block[anchor[-1].start():]
            result.append({'vkn':re.sub(r'\s+','',m[1]),'text':block,'role':'buyer' if anchor else ''})
            start=m.end()
    return result


