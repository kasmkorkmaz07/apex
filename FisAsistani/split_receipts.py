"""Boş aralıklarla ayrılan fişleri, her parçada belge kanıtı arayarak böler."""
from pathlib import Path
import tempfile
import uuid
import hashlib
import numpy as np
from PIL import Image, ImageOps
from core import draft

def paper_regions(image):
    """Fotoğrafta birbirinden ayrık açık renkli uzun kağıtları bul."""
    import cv2
    gray=cv2.cvtColor(np.asarray(image),cv2.COLOR_RGB2GRAY)
    blur=cv2.GaussianBlur(gray,(5,5),0)
    layouts=[]
    chroma=np.asarray(image).max(axis=2).astype(int)-np.asarray(image).min(axis=2).astype(int)
    for threshold in (120,140,160,180,200):
        mask=(blur>threshold).astype('uint8')*255
        mask[chroma>32]=0
        mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
        contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        boxes=[]
        for c in contours:
            area=cv2.contourArea(c)
            if not gray.size*.025<area<gray.size*.7:continue
            rect=cv2.minAreaRect(c);rw,rh=rect[1]
            if min(rw,rh)<50 or not 1.8<max(rw,rh)/min(rw,rh)<12:continue
            if area/(rw*rh)<.8:continue
            x,y,w,h=cv2.boundingRect(c)
            # Fotoğraf kenarındaki kesik evrak/masa yansımaları fiş değildir.
            if x<=1 or y<=1 or x+w>=image.width-1 or y+h>=image.height-1:continue
            boxes.append((max(0,x-8),max(0,y-8),min(image.width,x+w+8),min(image.height,y+h+8)))
        if 2<=len(boxes)<=8:
            boxes=sorted(boxes,key=lambda b:(b[0],b[1]))
            if boxes not in layouts:layouts.append(boxes)
    largest=max((len(b) for b in layouts),default=0)
    return [b for b in layouts if len(b)==largest][:2]


def seam_parts(image):
    """Alt uçları temas eden yan yana kâğıtları aradaki koyu olukla ayır."""
    import cv2
    rgb=np.asarray(image);h,w=rgb.shape[:2]
    scale=min(1,450/h);small=cv2.resize(rgb,None,fx=scale,fy=scale)
    gray=cv2.cvtColor(small,cv2.COLOR_RGB2GRAY);sh,sw=gray.shape
    band=(gray[int(sh*.2):int(sh*.7)]>120).mean(0)
    lo,hi=int(sw*.25),int(sw*.75)
    center=lo+int(np.argmin(band[lo:hi]))
    if band[center]>.65:return []
    chroma=small.max(2).astype(int)-small.min(2).astype(int)
    paper=((gray>120)&(chroma<40)).astype('uint8')
    paper=cv2.morphologyEx(paper,cv2.MORPH_CLOSE,np.ones((1,max(3,int(sw*.025))),np.uint8))
    points=[]
    for y in range(int(sh*.2),int(sh*.75)):
        edges=np.diff(np.r_[0,paper[y],0].astype(int));runs=list(zip(np.where(edges==1)[0],np.where(edges==-1)[0]))
        runs=[(a,b) for a,b in runs if b-a>sw*.16]
        if len(runs)!=2:continue
        gap=runs[1][0]-runs[0][1];middle=(runs[1][0]+runs[0][1])/2
        if sw*.005<gap<sw*.18 and abs(middle-center)<sw*.12:points.append((y,middle))
    if len(points)<sh*.12:return []
    ys,xs=np.array(points).T
    slopes=[(xs[j]-xs[i])/(ys[j]-ys[i]) for i in range(len(ys)) for j in range(i+1,len(ys)) if ys[j]-ys[i]>10]
    if not slopes:return []
    slope=float(np.median(slopes));intercept=float(np.median(xs-slope*ys))
    if abs(slope)>.3:return []
    seam=(slope*np.arange(h)*scale+intercept)/scale
    mask=np.arange(w)[None,:]<=seam[:,None]
    result=[]
    for side in (mask,~mask):
        pixels=rgb.copy();pixels[~side]=255
        cols=np.where(side.any(0))[0]
        result.append(Image.fromarray(pixels[:,cols[0]:cols[-1]+1]))
    return result


def cuts(image):
    small=image.convert('L')
    small.thumbnail((1000,1000))
    a=np.asarray(small)
    candidates=[]
    for axis in (0,1):
        # Beyaz tarama zemini veya koyu fotoğraf zemini boyunca boş oluk.
        for mask in (a<210,a>65):
            occupied=mask.mean(axis=axis)
            n=len(occupied); start=None
            for i in range(n+1):
                empty=i<n and occupied[i]<0.003
                if empty and start is None: start=i
                if not empty and start is not None:
                    if i-start>=max(12,n*.025) and start>n*.12 and i<n*.88:
                        candidates.append(((i-start)/n,axis,(start+i)/2/n))
                    start=None
    return sorted(set(candidates),reverse=True)[:4]


def split_page(path, cancelled=lambda:False):
    """(görsel, OCR) çiftleri. Kaynak korunur; belirsiz bölme uygulanmaz."""
    from ocr_local import read_image
    path=Path(path)
    with Image.open(path) as original:
        image=ImageOps.exif_transpose(original).convert('RGB')
    with tempfile.TemporaryDirectory() as tmp:
        cache={}
        def read(im):
            key=(im.size,hashlib.sha256(im.tobytes()).digest())
            if key not in cache:
                p=Path(tmp)/'ocr.png'; im.save(p)
                try: cache[key]=read_image(p)
                except ValueError: cache[key]=''
            return cache[key]
        def evidence(text):
            d=draft(text)
            # Bölme doğruluğu, tüm muhasebe alanlarının dolu olmasından ayrıdır.
            import re
            from core import normalized
            signals=sum(bool(d[k]) for k in ('evrak_tarihi','evrak_no','vkn','toplam'))
            return signals>=2 and bool(re.search(r'TOPLAM|TOPKDV|FIS|BELGE|FATURA|KDV',normalized(text)))
        # Fatura içindeki tablo boşlukları ayrı fiş sınırı değildir.
        from invoices import is_invoice
        def divide(im,depth=0):
            if cancelled(): return []
            if depth<3 and len(cache)<20:
                for _,axis,fraction in cuts(im):
                    if cancelled(): return []
                    w,h=im.size
                    at=int((w if axis==0 else h)*fraction)
                    boxes=((0,0,at,h),(at,0,w,h)) if axis==0 else ((0,0,w,at),(0,at,w,h))
                    parts=[im.crop(b) for b in boxes]
                    # Recursion permits three or four receipts; no partial split is accepted.
                    groups=[divide(p,depth+1) for p in parts]
                    if all(g and all(evidence(t) for _,t in g) for g in groups):
                        return groups[0]+groups[1]
            return [(im,read(im))]
        parts=None
        for boxes in paper_regions(image):
            if cancelled():return []
            crops=[image.crop(b) for b in boxes]
            candidates=[(crop,read(crop)) for crop in crops]
            if all(t and (draft(t)['evrak_tarihi'] or draft(t)['evrak_no']) for _,t in candidates):
                parts=candidates;break
        if parts is None:
            from receipt_columns import column_parts
            crops=column_parts(image,cancelled)
            if crops:
                candidates=[(crop,read(crop)) for crop in crops]
                if all(evidence(t) for _,t in candidates):parts=candidates
        if parts is None:
            crops=seam_parts(image)
            if crops:
                candidates=[(crop,read(crop)) for crop in crops]
                if all(evidence(t) for _,t in candidates):parts=candidates
        if parts is None and image.height<image.width*1.8:
            whole=read(image)
            if is_invoice(whole):return [(path,whole)]
        if parts is None:parts=divide(image)
        if len(parts)<=1:
            if parts and not parts[0][1]:
                raise ValueError('Görüntüde metin bulunamadı. Daha net tarama deneyin.')
            return [(path,parts[0][1])] if parts else []
        result=[]
        for im,text in parts:
            target=path.parent/(uuid.uuid4().hex+'.png'); im.save(target)
            result.append((target,text))
        return result
