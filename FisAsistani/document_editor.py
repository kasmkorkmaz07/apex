"""Uygulama içinde dört köşe kırpma, perspektif, döndürme ve filtreler."""
import tkinter as tk
from tkinter import ttk,messagebox
from PIL import Image,ImageOps,ImageTk
from in_app_panel import panel

def warp(image,points):
    import cv2,numpy as np
    q=np.array(points,dtype=np.float32)
    if q.shape!=(4,2) or not cv2.isContourConvex(q.astype(np.int32)) or abs(cv2.contourArea(q))<100:
        raise ValueError('Dört köşeyi birbirini kesmeyecek şekilde belgenin çevresine yerleştirin.')
    width=round(max(np.linalg.norm(q[1]-q[0]),np.linalg.norm(q[2]-q[3])))
    height=round(max(np.linalg.norm(q[3]-q[0]),np.linalg.norm(q[2]-q[1])))
    width=max(10,min(width,6000));height=max(10,min(height,6000))
    matrix=cv2.getPerspectiveTransform(q,np.array([[0,0],[width-1,0],[width-1,height-1],[0,height-1]],np.float32))
    return Image.fromarray(cv2.warpPerspective(np.asarray(image.convert('RGB')),matrix,(width,height),borderMode=cv2.BORDER_REPLICATE))

def filtered(image,mode):
    if mode=='Sihirli':
        from scan_prepare import detail_variant
        return detail_variant(image)
    if mode=='Gri':return ImageOps.grayscale(image).convert('RGB')
    if mode=='Siyah-beyaz':
        import cv2,numpy as np
        gray=np.asarray(ImageOps.grayscale(image));return Image.fromarray(cv2.adaptiveThreshold(gray,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C,cv2.THRESH_BINARY,31,12)).convert('RGB')
    return image.copy()

def show(app,path,on_save):
    win=panel(app.root,'Belgeyi düzenle');body=win.body
    with Image.open(path) as im:source=ImageOps.exif_transpose(im).convert('RGB')
    source.thumbnail((4000,4000))
    state={'image':source,'quad':None,'display':source,'scale':1,'offset':(0,0),'drag':None}
    actions=ttk.Frame(body);actions.pack(fill='x',pady=4)
    ttk.Label(body,text='Köşeleri sürükleyin → Kırp → filtre seçin → Kaydet. Orijinal fotoğraf korunur.').pack(anchor='w')
    canvas=tk.Canvas(body,background='#111827',highlightthickness=0);canvas.pack(fill='both',expand=True,pady=8)
    controls=ttk.Frame(body);controls.pack(fill='x')
    mode=tk.StringVar(value='Orijinal')
    def reset_quad():
        w,h=state['image'].size;state['quad']=[(0,0),(w,0),(w,h),(0,h)]
    def draw(*_):
        im=state['display'];w,h=max(10,canvas.winfo_width()),max(10,canvas.winfo_height());s=min((w-30)/im.width,(h-30)/im.height)
        s=max(.01,s);x,y=(w-im.width*s)/2,(h-im.height*s)/2;state.update(scale=s,offset=(x,y))
        canvas.delete('all');state['photo']=ImageTk.PhotoImage(im.resize((max(1,int(im.width*s)),max(1,int(im.height*s)))))
        canvas.create_image(x,y,image=state['photo'],anchor='nw')
        points=[(x+px*s,y+py*s) for px,py in state['quad']]
        canvas.create_polygon(*[v for p in points for v in p],fill='',outline='#22c5c0',width=3)
        for px,py in points:canvas.create_oval(px-7,py-7,px+7,py+7,fill='#22c5c0',outline='white',width=2)
    def press(e):
        s=state['scale'];x,y=state['offset'];dist=[(x+px*s-e.x)**2+(y+py*s-e.y)**2 for px,py in state['quad']]
        state['drag']=dist.index(min(dist)) if min(dist)<1600 else None
    def drag(e):
        if state['drag'] is None:return
        s=state['scale'];x,y=state['offset'];w,h=state['image'].size
        state['quad'][state['drag']]=(min(w,max(0,(e.x-x)/s)),min(h,max(0,(e.y-y)/s)));draw()
    def apply_filter(*_):state['display']=filtered(state['image'],mode.get());draw()
    def crop():
        try:state['image']=warp(state['image'],state['quad']);reset_quad();apply_filter()
        except ValueError as error:messagebox.showerror('Kırpma',str(error),parent=app.root)
    def rotate():state['image']=state['image'].transpose(Image.Transpose.ROTATE_270);reset_quad();apply_filter()
    def auto():
        import cv2,numpy as np
        im=state['image'];a=np.asarray(im);gray=cv2.cvtColor(a,cv2.COLOR_RGB2GRAY)
        contours,_=cv2.findContours(cv2.threshold(gray,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)[1],cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        for c in sorted(contours,key=cv2.contourArea,reverse=True)[:10]:
            q=cv2.approxPolyDP(c,.025*cv2.arcLength(c,True),True)
            if len(q)==4 and cv2.isContourConvex(q) and cv2.contourArea(q)>im.width*im.height*.2:
                pts=q[:,0,:].astype(float);center=pts.mean(axis=0);pts=pts[np.argsort(np.arctan2(pts[:,1]-center[1],pts[:,0]-center[0]))];pts=np.roll(pts,-np.argmin(pts.sum(axis=1)),axis=0)
                state['quad']=[tuple(p) for p in pts];draw();return
        messagebox.showinfo('Belge sınırı','Sınır güvenle bulunamadı; köşeleri elle sürükleyebilirsiniz.',parent=app.root)
    def save():
        try:on_save(state['display']);win.destroy()
        except Exception as error:messagebox.showerror('Kaydedilemedi',str(error),parent=app.root)
    for label,fn in [('↻ Döndür',rotate),('Sınırı bul',auto),('Kırp',crop),('Orijinale dön',lambda:(state.update(image=source.copy()),reset_quad(),apply_filter()))]:ttk.Button(actions,text=label,command=fn).pack(side='left',padx=3)
    combo=ttk.Combobox(controls,textvariable=mode,values=['Orijinal','Sihirli','Gri','Siyah-beyaz'],state='readonly',width=18);combo.pack(side='left');combo.bind('<<ComboboxSelected>>',apply_filter)
    ttk.Button(controls,text='Kaydet',command=save,style='Accent.TButton').pack(side='right')
    canvas.bind('<Configure>',draw);canvas.bind('<Button-1>',press);canvas.bind('<B1-Motion>',drag)
    reset_quad();draw()
    return win
