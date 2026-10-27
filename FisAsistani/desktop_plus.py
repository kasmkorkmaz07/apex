"""Cep 0.10.2 özelliklerinin mevcut masaüstü muhasebe ekranına uyarlanması."""
import json, threading, uuid, hashlib
from pathlib import Path
import tkinter as tk
from tkinter import ttk,messagebox,filedialog
from in_app_panel import panel
from desktop_ai import load_config,save_config

def apply_theme(app,mode):
    dark=mode=='dark'
    if mode=='auto':
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Themes\Personalize') as key:dark=not winreg.QueryValueEx(key,'AppsUseLightTheme')[0]
        except OSError:dark=False
    c={'bg':'#0b141d','card':'#142230','ink':'#e8eff5','mut':'#93a5b6','sec':'#1d3143','pri':'#2bb3bf','nav':'#0b1c2b','warn':'#3a2b10'} if dark else {'bg':'#f1f4f8','card':'#ffffff','ink':'#0f2233','mut':'#66788a','sec':'#e8eef4','pri':'#0d7c86','nav':'#0f2b43','warn':'#fff1d6'}
    app.palette=c;s=ttk.Style(app.root);app.root.configure(bg=c['bg'])
    for name in ['TFrame','TLabel','TLabelframe','TNotebook']:s.configure(name,background=c['bg'],foreground=c['ink'])
    for name in ['Title.TLabel','TLabelframe.Label']:s.configure(name,background=c['bg'],foreground=c['ink'])
    s.configure('TButton',background=c['sec'],foreground=c['ink'],borderwidth=0)
    s.map('TButton',background=[('active',c['pri'])],foreground=[('disabled',c['mut'])])
    s.configure('Accent.TButton',background=c['pri'],foreground='#ffffff' if not dark else '#08282e')
    s.map('Accent.TButton',background=[('active',c['pri']),('disabled',c['sec'])])
    for name in ['TEntry','TCombobox']:s.configure(name,fieldbackground=c['card'],foreground=c['ink'],insertcolor=c['ink'])
    s.map('TCombobox',fieldbackground=[('readonly',c['card'])],foreground=[('readonly',c['ink'])])
    for name in ['Review.TEntry','Review.TCombobox']:s.configure(name,fieldbackground=c['warn'],foreground=c['ink'])
    s.configure('Treeview',background=c['card'],fieldbackground=c['card'],foreground=c['ink'],rowheight=34)
    s.configure('Treeview.Heading',background=c['sec'],foreground=c['ink'],padding=8)
    s.map('Treeview',background=[('selected',c['pri'])],foreground=[('selected','#ffffff' if not dark else '#08282e')])
    s.configure('Header.TFrame',background=c['nav']);s.configure('Header.TLabel',background=c['nav'],foreground='#ffffff')
    s.configure('TNotebook.Tab',background=c['sec'],foreground=c['ink'])
    s.map('TNotebook.Tab',background=[('selected',c['pri'])],foreground=[('selected','#ffffff' if not dark else '#08282e')])
    s.configure('TCheckbutton',background=c['bg'],foreground=c['ink']);s.map('TCheckbutton',background=[('active',c['sec'])])
    app.tree.tag_configure('review',background=c['warn'],foreground='#f0b45a' if dark else '#995c00')
    def walk(w):
        for child in w.winfo_children():
            if isinstance(child,tk.Text):child.configure(background=c['card'],foreground=c['ink'],insertbackground=c['ink'])
            elif isinstance(child,tk.Canvas):child.configure(background=c['bg'])
            walk(child)
    walk(app.root)

def settings(app):
    win=panel(app.root,'Ayarlar • Görünüm ve yapay zekâ',scroll=True);b=win.body;cfg=load_config(app.home)
    theme=tk.StringVar(value=cfg.get('theme','auto'));key=tk.StringVar(value=cfg.get('ai_key',''));model=tk.StringVar(value=cfg.get('ai_model',''));mode=tk.StringVar(value=cfg.get('ai_mode','off'))
    ttk.Label(b,text='Görünüm',style='Title.TLabel').pack(anchor='w',pady=8)
    themes=ttk.Frame(b);themes.pack(fill='x')
    for label,value in [('Otomatik','auto'),('Aydınlık','light'),('Karanlık','dark')]:ttk.Radiobutton(themes,text=label,value=value,variable=theme,command=lambda:apply_theme(app,theme.get())).pack(side='left',padx=8)
    ttk.Label(b,text='Gemini ile belge okuma',style='Title.TLabel').pack(anchor='w',pady=(24,8))
    ttk.Label(b,text='Etkinleştirildiğinde belge fotoğrafı Google Gemini’ye gönderilir. API anahtarınızı girin. Yerel OCR ve Excel aktarımı çalışmaya devam eder.',wraplength=650).pack(anchor='w')
    for title,var,secret in [('Gemini API anahtarı',key,True),('Model (boşsa otomatik seçilir)',model,False)]:
        ttk.Label(b,text=title).pack(anchor='w',pady=(12,3));ttk.Entry(b,textvariable=var,show='•' if secret else '').pack(fill='x')
    ttk.Label(b,text='Çalışma şekli').pack(anchor='w',pady=(12,3))
    modes={'Kapalı':'off','Yalnız şüpheli belgeler':'issues','Her belge':'always'};label=tk.StringVar(value=next((k for k,v in modes.items() if v==mode.get()),'Kapalı'))
    ttk.Combobox(b,textvariable=label,values=list(modes),state='readonly').pack(fill='x')
    status=tk.StringVar();ttk.Label(b,textvariable=status,wraplength=650).pack(fill='x',pady=12)
    def save(test=False):
        data=dict(cfg,theme=theme.get(),ai_key=key.get().strip(),ai_model=model.get().strip(),ai_mode=modes[label.get()])
        if data['ai_mode']!='off' and not data['ai_key']:status.set('Gemini anahtarını girin veya çalışma şeklini Kapalı seçin.');return
        save_config(app.home,data);apply_theme(app,theme.get());status.set('Kaydedildi.')
        if test:
            status.set('Model erişimi kontrol ediliyor…')
            def work():
                try:
                    from desktop_ai import models
                    from desktop_ai import request
                    model_name=models(data)[0];request(model_name,data['ai_key'])
                    result='Bağlantı başarılı: '+model_name
                except Exception as e:result=str(e)
                app.events.put(('desktop_callback',lambda:status.set(result) if win.winfo_exists() else None))
            threading.Thread(target=work,daemon=True).start()
    row=ttk.Frame(b);row.pack(fill='x')
    ttk.Button(row,text='Kaydet',command=save,style='Accent.TButton').pack(side='left')
    ttk.Button(row,text='Kaydet ve bağlantıyı test et',command=lambda:save(True)).pack(side='left',padx=8)
    from ocr_settings import show
    ttk.Button(b,text='Yerel OCR / Google Vision ayarları',command=lambda:show(app.root)).pack(anchor='w',pady=20)
    apply_theme(app,theme.get());return win

def analyze(app,qr_only=False):
    if app.busy or not app.current or not app.discard():return
    image,d,approved,exported=app.store.get(app.current)
    if exported:messagebox.showinfo('Kayıt kilitli','Excel’e çıkarılmış kaydı değiştirmeden önce aktarımını kontrol edin.',parent=app.root);return
    if not image or not Path(image).exists():messagebox.showinfo('Fotoğraf','Önce belge fotoğrafı yükleyin.',parent=app.root);return
    rid=app.current;app.busy=True;app.import_btn.configure(state='disabled');app.status.set('Karekod okunuyor…' if qr_only else 'Gemini belgeyi okuyor…')
    def worker():
        try:
            from desktop_ai import enrich
            new=enrich(image,d,app.home,force=not qr_only,qr_only=qr_only)
            if qr_only and not new.get('qr_raw'):raise ValueError('Desteklenen fatura karekodu bulunamadı; mevcut kayıt korundu.')
            from reanalysis import merge
            app.events.put(('reanalyzed',rid,merge(d,new),image))
        except Exception as error:app.events.put(('error',str(error)))
        finally:app.events.put(('done',))
    threading.Thread(target=worker,daemon=True).start()

def edit_image(app):
    if app.busy or not app.current or not app.discard():return
    rid=app.current;image,d,approved,exported=app.store.get(rid)
    if approved or exported:messagebox.showinfo('Belge düzenleme','Görüntü düzenlemek için onaysız taslak seçin.',parent=app.root);return
    if not image or not Path(image).exists():return
    def save(im):
        target=app.home/'fotograflar'/('duzenlenen-'+str(uuid.uuid4())+'.jpg');im.save(target,'JPEG',quality=95)
        current=app.store.get(rid)
        if current[2] or current[3]:target.unlink();raise ValueError('Belge onaylanmış; görüntü değiştirilmedi.')
        data=dict(current[1]);data.setdefault('original_image',image);data['image_edited']=True;data['review_ack']=False
        try:
            with app.store.db:app.store.db.execute('UPDATE receipts SET image=?,data=? WHERE id=?',(str(target),json.dumps(data,ensure_ascii=False),rid))
        except Exception:target.unlink(missing_ok=True);raise
        if app.current==rid:app.fill(data,str(target))
        app.status.set('Görüntü kaydedildi; Yeniden analiz et veya Gemini ile oku düğmesiyle tekrar okuyabilirsiniz. Orijinal korundu.')
    from document_editor import show
    return show(app,image,save)

def viewer(app):
    if not app.current:return
    image=app.store.get(app.current)[0]
    if not image or not Path(image).exists():return
    from receipt_preview import ReceiptPreview
    from types import SimpleNamespace
    win=panel(app.root,'Belge görüntüsü');bar=ttk.Frame(win.body);bar.pack(fill='x')
    preview=ReceiptPreview(win.body);preview.pack(fill='both',expand=True);preview.load(image)
    def zoom(delta):preview.wheel(SimpleNamespace(delta=delta,x=preview.winfo_width()/2,y=preview.winfo_height()/2))
    for label,fn in [('−',lambda:zoom(-120)),('+',lambda:zoom(120)),('Sığdır',preview.fit)]:ttk.Button(bar,text=label,command=fn).pack(side='left',padx=4)
    return win

def restore_records(store,client,ids,purge=False):
    periods=set()
    with store.db:
        for tid in ids:
            row=store.db.execute('SELECT payload FROM deleted_receipts WHERE id=?',(int(tid),)).fetchone()
            if not row:continue
            p=json.loads(row[0])
            if p['client']!=client:raise ValueError('Seçili kayıt başka mükellefe ait.')
            if not purge:
                cols=[x[1] for x in store.db.execute('PRAGMA table_info(receipts)') if x[1]!='id' and x[1] in p]
                store.db.execute('INSERT INTO receipts('+','.join(cols)+') VALUES ('+','.join('?' for _ in cols)+')',[p[k] for k in cols])
                if p.get('period'):periods.add(p['period'])
            store.db.execute('DELETE FROM deleted_receipts WHERE id=?',(int(tid),))
    return periods

def trash(app):
    if app.busy:return
    try:cid=app.client_id()
    except ValueError:return
    win=panel(app.root,'Silinen belgeler');b=win.body
    ttk.Label(b,text='Seçili mükellefin silinen kayıtları. Ctrl / Shift ile birden fazla belge seçebilirsiniz.').pack(anchor='w')
    tree=ttk.Treeview(b,columns=('date','title','no','total'),show='headings',selectmode='extended');tree.pack(fill='both',expand=True,pady=10)
    for key,name in [('date','Tarih'),('title','Ünvan'),('no','Evrak no'),('total','Tutar')]:tree.heading(key,text=name);tree.column(key,width=120)
    with app.store.db:app.store.db.execute('CREATE TABLE IF NOT EXISTS deleted_receipts(id INTEGER PRIMARY KEY, deleted_at TEXT, payload TEXT)')
    def refresh():
        tree.delete(*tree.get_children())
        for tid,payload in app.store.db.execute('SELECT id,payload FROM deleted_receipts ORDER BY id DESC'):
            p=json.loads(payload)
            if p['client']!=cid:continue
            d=json.loads(p['data']);tree.insert('','end',iid=str(tid),values=(d.get('evrak_tarihi',''),d.get('aciklama',''),d.get('evrak_no',''),d.get('toplam','')))
    def action(purge=False):
        ids=tree.selection()
        if not ids:return
        if purge and not messagebox.askyesno('Kalıcı sil',f'{len(ids)} silinmiş kayıt kalıcı kaldırılacak. Devam edilsin mi?',parent=app.root):return
        try:
            periods=restore_records(app.store,cid,ids,purge)
            for period in periods:app.store.sync_month(cid,period)
            app.refresh();refresh();app.status.set('Silinen kayıtlar güncellendi.')
        except Exception as error:messagebox.showerror('İşlem',str(error),parent=app.root)
    row=ttk.Frame(b);row.pack(fill='x')
    ttk.Button(row,text='Tümünü seç',command=lambda:tree.selection_set(tree.get_children())).pack(side='left')
    ttk.Button(row,text='Geri al',command=action,style='Accent.TButton').pack(side='right')
    ttk.Button(row,text='Kalıcı sil',command=lambda:action(True)).pack(side='right',padx=8)
    refresh();apply_theme(app,load_config(app.home).get('theme','auto'));return win

def install(app,heading,top,pane,actions,tax_buttons):
    # Navigation mirrors the phone while retaining desktop Excel/accounting controls.
    nav=ttk.Frame(app.root,padding=(12,5));nav.pack(fill='x',before=top)
    for child in heading.winfo_children():
        if isinstance(child,ttk.Button) and child.cget('text') in ('OCR AYARLARI','MÜKELLEFLER','KAYITLI CARİLER'):child.pack_forget()
    for label,fn in [('Belgeler',lambda:app.show_documents()),('Cariler',lambda:app.manage('vendor')),('Mükellefler',lambda:app.manage('client')),('Ayarlar',lambda:settings(app)),('Silinenler',lambda:trash(app))]:
        ttk.Button(nav,text=label,command=fn).pack(side='left',padx=3)
    ttk.Button(actions,text='Kırp / filtre',command=lambda:edit_image(app)).pack(side='left',padx=4)
    # Separate row prevents overflow in a compact Apex window.
    airow=ttk.Frame(tax_buttons.master);airow.grid(row=15,column=0,columnspan=2,sticky='ew',pady=8)
    ttk.Button(airow,text='✦ Gemini ile oku',command=lambda:analyze(app),style='Accent.TButton').pack(side='left')
    ttk.Button(airow,text='QR’den tamamla',command=lambda:analyze(app,True)).pack(side='left',padx=6)
    ttk.Button(airow,text='Tüm belgeleri seç',command=lambda:app.tree.selection_set(app.tree.get_children())).pack(side='left')
    types=ttk.Frame(tax_buttons.master);types.grid(row=16,column=0,columnspan=2,sticky='ew',pady=5)
    ttk.Label(types,text='Belge türü').pack(side='left',padx=4)
    app.document_type=tk.StringVar(value='Fiş');combo=ttk.Combobox(types,textvariable=app.document_type,values=['Fiş','Fatura','Z raporu'],state='readonly',width=15);combo.pack(side='left')
    def change_type(event=None):
        if app.document_type.get()=='Z raporu':app.vars['vkn'].set('');app.vars['aciklama'].set('Z RAPORU')
        app.mark_dirty()
    combo.bind('<<ComboboxSelected>>',change_type)
    apply_theme(app,load_config(app.home).get('theme','auto'))
