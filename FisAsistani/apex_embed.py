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
    user.IsWindow.argtypes=[w.HWND];user.IsWindow.restype=w.BOOL
    user.IsIconic.argtypes=[w.HWND];user.IsIconic.restype=w.BOOL
    user.ClientToScreen.argtypes=[w.HWND,c.POINTER(w.POINT)]
    user.GetParent.argtypes=[w.HWND];user.GetParent.restype=w.HWND
    user.SetParent.argtypes=[w.HWND,w.HWND];user.SetParent.restype=w.HWND
    user.GetWindowLongPtrW.argtypes=[w.HWND,c.c_int];user.GetWindowLongPtrW.restype=c.c_ssize_t
    user.SetWindowLongPtrW.argtypes=[w.HWND,c.c_int,c.c_ssize_t];user.SetWindowLongPtrW.restype=c.c_ssize_t
    user.MoveWindow.argtypes=[w.HWND,c.c_int,c.c_int,c.c_int,c.c_int,w.BOOL]
    user.ShowWindow.argtypes=[w.HWND,c.c_int]
    user.IsWindowVisible.argtypes=[w.HWND];user.IsWindowVisible.restype=w.BOOL
    user.SetWindowPos.argtypes=[w.HWND,w.HWND,c.c_int,c.c_int,c.c_int,c.c_int,w.UINT];user.SetWindowPos.restype=w.BOOL
    user.GetClientRect.argtypes=[w.HWND,c.POINTER(w.RECT)]
    def dimensions(handle):
        r=w.RECT();user.GetClientRect(handle,c.byref(r));return [r.right,r.bottom]
    hwnd=user.GetParent(window.winfo_id()) or window.winfo_id()
    # Owned top-level: Chromium cannot paint over this surface. No cross-process SetParent.
    user.SetWindowLongPtrW(hwnd,-8,parent)
    root.place_configure(x=0,y=0,relwidth=1,relheight=1,width=0,height=0)
    window.withdraw()
    requested=None;last_position=None;surface_visible=False
    def position():
        nonlocal last_position,surface_visible
        if not requested or not user.IsWindowVisible(parent) or user.IsIconic(parent):
            if surface_visible:window.withdraw();surface_visible=False
            last_position=None;return False
        x,y,width,height=requested
        origin=w.POINT(0,0);user.ClientToScreen(parent,c.byref(origin))
        current=(origin.x+x,origin.y+y,width,height)
        if current!=last_position or not surface_visible:
            window.geometry(f'{width}x{height}{current[0]:+d}{current[1]:+d}')
            window.deiconify()
            root.update_idletasks();app.update_layout()
            user.SetWindowPos(hwnd,0,*current,0x0014|0x0040)
            window.update();app.update_layout()
            surface_visible=True;last_position=current
        return bool(user.IsWindowVisible(hwnd) and root.winfo_ismapped() and root.winfo_width()>20)
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
        nonlocal requested
        try:
            for _ in range(30):
                msg=commands.get_nowait();cmd=msg.get('cmd');result=True
                if cmd=='layout':
                    rect=msg.get('rect',{});app.embed_requested=rect
                    if msg.get('visible'):
                        values=[int(rect.get(k,0)) for k in ('x','y','width','height')]
                        requested=values if values[2]>20 and values[3]>20 else None
                    else:requested=None
                    result=position() if requested else (position() or True)
                elif cmd=='close':
                    if app.busy:result=False
                    elif app.discard():
                        app.store.db.close();app.instance_lock.close();send({'id':msg.get('id'),'ok':True});window.destroy();return
                    else:result=False
                elif cmd=='parent_gone':
                    # Ana süreç beklenmedik kapanırsa okunmuş kayıtlar SQLite'ta kalır.
                    app.cancel_import.set();app.store.db.close();app.instance_lock.close();window.destroy();return
                elif cmd=='status':result={'busy':app.busy,'dirty':app.dirty,'compact':app.compact,'width':root.winfo_width(),'height':root.winfo_height(),'visible':bool(user.IsWindowVisible(hwnd)),'parent_ok':int(user.GetWindowLongPtrW(hwnd,-8) or 0)==parent,'requested':getattr(app,'embed_requested',{}),'geometry':root.geometry(),'native':dimensions(hwnd),'content':dimensions(root.winfo_id())}
                if msg.get('id') is not None:send({'id':msg['id'],'ok':result})
        except queue.Empty:pass
        except Exception as error:
            send({'id':msg.get('id'),'error':str(error)})
        position()
        root.after(40,poll)
    send({'ready':True});root.after(40,poll);window.mainloop()

if __name__=='__main__':
    try:run()
    except Exception as error:
        sys.stdout.write(json.dumps({'error':str(error)},ensure_ascii=False)+'\n');sys.stdout.flush()
        raise

