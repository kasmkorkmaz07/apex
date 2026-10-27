"""Orijinal görüntüden görünür alanı çizerek yakınlaştırır."""
import tkinter as tk
from PIL import Image, ImageOps, ImageTk

class ReceiptPreview(tk.Canvas):
    def __init__(self,parent):
        super().__init__(parent,background='#e8eef3',highlightthickness=0,height=280)
        self.source=None;self.scale=1;self.offset=(0,0)
        self.bind('<Configure>',lambda e:self.fit())
        self.bind('<Button-1>',self.press)
        self.bind('<B1-Motion>',self.drag)
        self.bind('<MouseWheel>',self.wheel)
        self.bind('<Double-1>',lambda e:self.fit())
    def load(self,path=None):
        self.source=None
        if path:
            with Image.open(path) as im:self.source=ImageOps.exif_transpose(im).convert('RGB')
        self.fit()
    def fit(self):
        w,h=max(1,self.winfo_width()),max(1,self.winfo_height())
        if self.source:
            self.scale=min(w/self.source.width,h/self.source.height)
            self.offset=((w-self.source.width*self.scale)/2,(h-self.source.height*self.scale)/2)
        self.draw()
    def press(self,e):
        self.focus_set();self.anchor=(e.x,e.y);self.start_offset=self.offset
    def drag(self,e):
        self.offset=(self.start_offset[0]+e.x-self.anchor[0],self.start_offset[1]+e.y-self.anchor[1]);self.draw()
    def wheel(self,e):
        if not self.source:return 'break'
        old=self.scale;new=max(.02,min(4,old*(1.25 if e.delta>0 else .8)))
        x,y=self.offset;self.offset=(e.x-(e.x-x)*new/old,e.y-(e.y-y)*new/old);self.scale=new;self.draw()
        return 'break'
    def draw(self):
        self.delete('all');w,h=max(1,self.winfo_width()),max(1,self.winfo_height())
        if not self.source:
            self.create_text(w/2,h/2,text='Fotoğraf yok.',fill='#35516b');return
        x,y=self.offset;s=self.scale
        # Tam çözünürlüklü kaynaktan yalnız ekranda görünen bölümü örnekle.
        im=self.source.transform((w,h),Image.Transform.AFFINE,(1/s,0,-x/s,0,1/s,-y/s),Image.Resampling.BICUBIC,fillcolor='#e8eef3')
        self.photo=ImageTk.PhotoImage(im);self.create_image(0,0,image=self.photo,anchor='nw')
        self.create_text(8,8,anchor='nw',text=f'%{s*100:.0f} • Tekerlek: yakınlaştır • Sürükle: taşı • Çift tık: sığdır',fill='#17334b')
