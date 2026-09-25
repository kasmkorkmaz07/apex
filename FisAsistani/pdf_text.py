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
    return '\n'.join(' '.join(t for _,t in sorted(row[2])) for row in rows)
