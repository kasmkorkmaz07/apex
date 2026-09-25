"""Fiş Asistanı'nı Apex'in yerel çocuk penceresi olarak çalıştırır.

İletişim yalnız üst sürecin stdin/stdout borularındadır; ağ portu açılmaz.
"""
import ctypes as c
from ctypes import wintypes as w
import json, queue, sys, threading
from pathlib import Path
import tkinter as tk

class EmbeddedRoot(tk.Frame):
    def __init__(self,window):
        super().__init__(window)
        self.window=window;window.app_container=self
        self.place(x=0,y=0,width=760,height=480)
    def title(self,value):self.window.title(value)
    def geometry(self,value=None):
        if value is None:return f'{self.winfo_width()}x{self.winfo_height()}'
        size=value.split('+')[0];width,height=map(int,size.split('x'));self.place_configure(width=width,height=height)
    def minsize(self,*args):pass
    def protocol(self,*args):return self.window.protocol(*args)

def run():
    home=Path(sys.argv[1]);parent=int(sys.argv[2])
    window=tk.Tk();window.withdraw();root=EmbeddedRoot(window)
    from app import App
    app=App(root,data_dir=home)
    # Aynı dosya: bağımsız sürümle mükellef, cari ve Excel ayarları paylaşılır.
    config=Path(__file__).with_name('export_settings.json')
    if config.exists():
        app.export_root=Path(json.loads(config.read_text(encoding='utf-8'))['root'])
        app.repoint_exports()
    window.overrideredirect(True);window.minsize(1,1);window.geometry('760x480+0+0')
    window.update_idletasks()
    user=c.WinDLL('user32',use_last_error=True)
    user.GetParent.argtypes=[w.HWND];user.GetParent.restype=w.HWND
    user.SetParent.argtypes=[w.HWND,w.HWND];user.SetParent.restype=w.HWND
    user.GetWindowLongPtrW.argtypes=[w.HWND,c.c_int];user.GetWindowLongPtrW.restype=c.c_ssize_t
    user.SetWindowLongPtrW.argtypes=[w.HWND,c.c_int,c.c_ssize_t];user.SetWindowLongPtrW.restype=c.c_ssize_t
    user.MoveWindow.argtypes=[w.HWND,c.c_int,c.c_int,c.c_int,c.c_int,w.BOOL]
    user.ShowWindow.argtypes=[w.HWND,c.c_int]
    user.SetWindowPos.argtypes=[w.HWND,w.HWND,c.c_int,c.c_int,c.c_int,c.c_int,w.UINT]
    user.IsWindowVisible.argtypes=[w.HWND];user.IsWindowVisible.restype=w.BOOL
    user.GetTopWindow.argtypes=[w.HWND];user.GetTopWindow.restype=w.HWND
    user.GetClientRect.argtypes=[w.HWND,c.POINTER(w.RECT)]
    def dimensions(handle):
        r=w.RECT();user.GetClientRect(handle,c.byref(r));return [r.right,r.bottom]
    hwnd=user.GetParent(window.winfo_id()) or window.winfo_id()
    style=user.GetWindowLongPtrW(hwnd,-16)
    user.SetWindowLongPtrW(hwnd,-16,(style & ~0x80CF0000)|0x40000000|0x04000000)
    c.set_last_error(0);user.SetParent(hwnd,parent)
    if c.get_last_error():raise c.WinError(c.get_last_error())
    window.deiconify();user.ShowWindow(hwnd,0)
    commands=queue.Queue()
    def send(value):
        sys.stdout.write(json.dumps(value,ensure_ascii=False)+'\n');sys.stdout.flush()
    def reader():
        for line in sys.stdin:
            try:commands.put(json.loads(line))
            except (ValueError,TypeError):continue
        commands.put({'cmd':'parent_gone'})
    threading.Thread(target=reader,daemon=True).start()
    def poll():
        try:
            for _ in range(30):
                msg=commands.get_nowait();cmd=msg.get('cmd');result=True
                if cmd=='layout':
                    rect=msg.get('rect',{});app.embed_requested=rect
                    if msg.get('visible'):
                        values=[int(rect.get(k,0)) for k in ('x','y','width','height')]
                        if values[2]>0 and values[3]>0:
                            root.geometry(f'{values[2]}x{values[3]}+{values[0]}+{values[1]}')
                            root.update_idletasks();app.update_layout()
                            user.MoveWindow(hwnd,*values,True)
                            user.MoveWindow(window.winfo_id(),0,0,values[2],values[3],True)
                            user.ShowWindow(hwnd,5)
                            # Chromium'un yerel render yüzeyinin arkasında kalmasın.
                            user.SetWindowPos(hwnd,0,*values,0x0010|0x0040)
                            root.update_idletasks();app.update_layout()
                    else:user.ShowWindow(hwnd,0)
                elif cmd=='close':
                    if app.busy:result=False
                    elif app.discard():
                        app.store.db.close();app.instance_lock.close();send({'id':msg.get('id'),'ok':True});window.destroy();return
                    else:result=False
                elif cmd=='parent_gone':
                    # Ana süreç beklenmedik kapanırsa okunmuş kayıtlar SQLite'ta kalır.
                    app.cancel_import.set();app.store.db.close();app.instance_lock.close();window.destroy();return
                elif cmd=='status':result={'busy':app.busy,'dirty':app.dirty,'compact':app.compact,'width':root.winfo_width(),'height':root.winfo_height(),'parent_ok':int(user.GetParent(hwnd) or 0)==parent,'visible':bool(user.IsWindowVisible(hwnd)),'front':int(user.GetTopWindow(parent) or 0)==hwnd,'requested':getattr(app,'embed_requested',{}),'geometry':root.geometry(),'native':dimensions(hwnd),'content':dimensions(root.winfo_id())}
                if msg.get('id') is not None:send({'id':msg['id'],'ok':result})
        except queue.Empty:pass
        root.after(40,poll)
    send({'ready':True});root.after(40,poll);window.mainloop()

if __name__=='__main__':
    try:run()
    except Exception as error:
        sys.stdout.write(json.dumps({'error':str(error)},ensure_ascii=False)+'\n');sys.stdout.flush()
        raise

