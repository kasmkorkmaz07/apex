"""Yan yana kâğıtların uzun ortak kenarını piksel kanıtıyla bulur."""
import numpy as np
from PIL import Image,ImageOps

def column_parts(image,cancelled=lambda:False):
 import cv2
 rgb=np.asarray(image.convert('RGB'));oh,ow=rgb.shape[:2]
 scale=min(1,800/oh);small=cv2.resize(rgb,(max(1,int(ow*scale)),max(1,int(oh*scale))))
 h,w=small.shape[:2]
 if w<100 or h<200:return []
 gray=cv2.cvtColor(small,cv2.COLOR_RGB2GRAY)
 _,mask=cv2.threshold(gray,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
 mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((7,7),np.uint8))
 contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
 boxes=[cv2.boundingRect(c) for c in contours if cv2.contourArea(c)>gray.size*.06]
 boxes=[b for b in boxes if b[3]>h*.25 and b[3]>b[2]*.7]
 if not boxes:return []
 x=min(b[0] for b in boxes);y=min(b[1] for b in boxes)
 right=max(b[0]+b[2] for b in boxes);bottom=max(b[1]+b[3] for b in boxes)
 ys=np.arange(int(y+(bottom-y)*.15),int(y+(bottom-y)*.85));cy=(y+bottom)/2
 best=None
 for slope in np.linspace(-.18,.18,37):
  if cancelled():return []
  for mid in range(int(x+(right-x)*.35),int(x+(right-x)*.65)):
   xs=np.rint(mid+slope*(ys-cy)).astype(int)
   if xs.min()<1 or xs.max()>=w-1:continue
   center=gray[ys,xs].astype(float)
   left=gray[ys,np.clip(xs-12,0,w-1)].astype(float)
   other=gray[ys,np.clip(xs+12,0,w-1)].astype(float)
   score=float(np.mean((left+other)/2-center)+np.mean(center<80)*35)
   if best is None or score>best[0]:best=(score,mid,slope)
 if best is None or best[0]<65:return []
 _,mid,slope=best
 seam=(mid+slope*(np.arange(oh)*scale-cy))/scale
 side=np.arange(ow)[None,:]<=seam[:,None]
 result=[]
 top=max(0,int(y/scale)-15);end=min(oh,int(bottom/scale)+15)
 for belongs in (side,~side):
  pixels=rgb.copy();pixels[~belongs]=255
  cols=np.where(belongs[top:end].any(0))[0]
  start=max(int(x/scale)-15,int(cols[0]),0);stop=min(int(right/scale)+15,int(cols[-1])+1,ow)
  if stop-start<ow*.18:return []
  result.append(ImageOps.expand(Image.fromarray(pixels[top:end,start:stop]),border=15,fill='white'))
 return result
