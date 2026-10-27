"""Orijinali değiştirmeden belge sınırı, perspektif ve aydınlatma düzeltme."""
import cv2
import numpy as np
from PIL import Image


def detail_variant(image):
    """Kırpmasız gölge düzeltmesi ve sınırlı yerel kontrast; rakam üretmez."""
    gray=cv2.cvtColor(np.asarray(image.convert('RGB')),cv2.COLOR_RGB2GRAY)
    # Işık alanını küçük ölçekte hesapla; yüksek çözünürlüklü yazıyı koru.
    scale=min(1,800/max(image.size))
    small=cv2.resize(gray,None,fx=scale,fy=scale,interpolation=cv2.INTER_AREA)
    background=cv2.GaussianBlur(small,(0,0),max(9,min(small.shape)/20))
    background=cv2.resize(background,(image.width,image.height),interpolation=cv2.INTER_LINEAR)
    flattened=cv2.divide(gray,np.maximum(background,1),scale=235)
    mixed=cv2.addWeighted(gray,.25,flattened,.75,0)
    contrast=cv2.createCLAHE(clipLimit=1.5,tileGridSize=(8,8)).apply(mixed)
    return Image.fromarray(cv2.addWeighted(mixed,.5,contrast,.5,0)).convert('RGB')


def plausible_page_quad(q):
    """Beyaz kağıdın içindeki lekeyi belge sınırı sanıp alt satırları kesme."""
    edges=np.roll(q,-1,axis=0)-q
    lengths=np.linalg.norm(edges,axis=1)
    if np.any(lengths<1):return False
    directions=edges/lengths[:,None]
    # Güçlü perspektif belirsizliğinde kırpmak yerine orijinali koru.
    if any(abs(np.dot(directions[i],directions[i+2]))<np.cos(np.radians(12)) for i in (0,1)):
        return False
    if any(max(lengths[i],lengths[i+2])/min(lengths[i],lengths[i+2])>1.35 for i in (0,1)):
        return False
    return True


def prepare(image, report=False):
    """Perspektif + aydınlatma düzeltmesi uygular.

    report=False (varsayılan): önceki davranış, yalnız görüntüyü döndürür.
    report=True: (görüntü, degisti) döndürür. 'degisti', çağıranın gereksiz
    ikinci bir OCR geçişini atlayabilmesi için gerçek bir sinyaldir —
    piksel farkına değil, perspektif düzeltmenin fiilen uygulanıp
    uygulanmadığına ve aydınlatma düzeltmesinin görüntüyü belirgin ölçüde
    değiştirip değiştirmediğine bakar. Aydınlatma düzeltmesi her zaman
    pikselleri hafifçe değiştirir, o yüzden ham piksel eşitliği burada
    'değişmedi' anlamına gelmez; anlamlı değişim eşiği kullanılır.
    """
    rgb=np.asarray(image.convert('RGB'))
    scale=min(1,1200/max(image.size))
    small=cv2.resize(rgb,None,fx=scale,fy=scale)
    gray=cv2.cvtColor(small,cv2.COLOR_RGB2GRAY)
    blur=cv2.GaussianBlur(gray,(5,5),0)
    _,mask=cv2.threshold(blur,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
    contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    quads=[]
    for c in contours:
        area=cv2.contourArea(c)
        # Çok küçük leke ya da (arka plan hiç görünmüyorsa) neredeyse tüm
        # kadrajı kaplayan sahte 'belge sınırı' konturunu ele; ikincisi
        # anlamsız bir tam-kadraj warp'ı tetikleyip zaman kaybettirir.
        if area<gray.size*.25 or area>gray.size*.92: continue
        poly=cv2.approxPolyDP(c,.02*cv2.arcLength(c,True),True)
        if len(poly)==4 and cv2.isContourConvex(poly):
            quads.append((area,poly.reshape(4,2).astype(np.float32)/scale))
    # Birden çok büyük kağıt bulunursa tek fişi seçerek diğerini kaybetme.
    warped=rgb
    perspektif_uygulandi=False
    if len(quads)==1:
        points=quads[0][1]
        sums=points.sum(axis=1); diffs=np.diff(points,axis=1).ravel()
        q=np.array([points[sums.argmin()],points[diffs.argmin()],points[sums.argmax()],points[diffs.argmax()]])
        if len(np.unique(q,axis=0))==4 and plausible_page_quad(q):
            w=int(max(np.linalg.norm(q[1]-q[0]),np.linalg.norm(q[2]-q[3])))
            h=int(max(np.linalg.norm(q[3]-q[0]),np.linalg.norm(q[2]-q[1])))
            if min(w,h)>150:
                matrix=cv2.getPerspectiveTransform(q,np.float32([[0,0],[w-1,0],[w-1,h-1],[0,h-1]]))
                warped=cv2.warpPerspective(rgb,matrix,(w,h),borderValue=(255,255,255))
                perspektif_uygulandi=True
    gray=cv2.cvtColor(warped,cv2.COLOR_RGB2GRAY)
    # Sert siyah-beyaz eşik yerine yerel ışık düzeltmesi: ince rakamlar korunur.
    bg=cv2.GaussianBlur(gray,(0,0),max(15,min(gray.shape)/25))
    corrected=cv2.divide(gray,np.maximum(bg,1),scale=230)
    corrected=cv2.addWeighted(gray,.35,corrected,.65,0)
    if not report:
        return Image.fromarray(corrected).convert('RGB')
    # Aydınlatma düzeltmesinin etkisini ölç. gray-bg farkının varyansı metin
    # yoğunluğundan da etkilenir (yoğun metinli düz bir fişte bile yüksek
    # çıkar); bunun yerine bg'nin KENDİ varyansına bakılır — geniş bulanıklık
    # metni zaten yok eder, yalnız yavaş değişen gerçek aydınlatma kalır.
    isiklandirma_onemli = bool(np.std(bg.astype(np.float32)) > 15)
    degisti = perspektif_uygulandi or isiklandirma_onemli
    return Image.fromarray(corrected).convert('RGB'), degisti


def choose(original,prepared):
    """Tam alan/tutar kontrolü daha iyi değilse orijinal okumayı koru."""
    from core import draft,validate,money
    a,b=draft(original,use_vendor_hints=False),draft(prepared,use_vendor_hints=False)
    fields=('vkn','evrak_tarihi','evrak_no','toplam')
    # Farklı dolu kimlik veya tutarlardan birini sessizce tercih etme.
    conflicts=[k for k in fields if a[k] and b[k] and a[k]!=b[k]]
    def taxes(d):
        values={}
        for row in d['kalemler']:
            rate=money(row['oran'])
            values[rate]=values.get(rate,0)+money(row['matrah'])+money(row['kdv'])
        return values
    tax_conflict=bool(a['kalemler'] and b['kalemler'] and taxes(a)!=taxes(b))
    if conflicts or tax_conflict:
        labels={'vkn':'VKN/TCKN','evrak_tarihi':'Tarih','evrak_no':'Fiş no','toplam':'Toplam'}
        details=[labels[k]+': '+a[k]+' / '+b[k] for k in conflicts]
        if tax_conflict:details.append('Görüntü okumaları arasında KDV dağılımı farklı; fotoğraftan doğrulayın.')
        return original+'\n[OCR KONTROL: '+ '; '.join(details)+']'
    def score(d):
        try: validate(d); valid=1
        except ValueError: valid=0
        return (valid,sum(bool(d[k]) for k in fields),bool(d['aciklama']),bool(d['kalemler']))
    selected=prepared if score(b)>score(a) else original
    # Daha dolu sonuç seçilse de önceki belirsizlik kanıtını kaybetme.
    import re
    for note in re.findall(r'\[OCR KONTROL: [^\]]+\]',original+'\n'+prepared):
        if note not in selected:selected+='\n'+note
    return selected
