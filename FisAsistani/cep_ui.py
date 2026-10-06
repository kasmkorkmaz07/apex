"""Ana pencere içinde Cep bağlantısı ve eşitleme durumu."""
import json,threading,uuid
from pathlib import Path
from tkinter import ttk,StringVar,messagebox
from in_app_panel import panel

def install(app,heading):
    app.cep_stop=threading.Event();app.cep_thread=None
    def start():
        if not (app.home/'cep-baglanti.json').exists():return
        if app.cep_thread and app.cep_thread.is_alive():return
        from cep_sync import run
        app.cep_thread=threading.Thread(target=run,args=(app.home,app.cep_stop),daemon=True,name='FisCepSync');app.cep_thread.start()
    def show():
        win=panel(app.root,'Fiş Asistanı Cep',scroll=True);body=win.body
        ttk.Label(body,text='Telefon ile aynı mükellef ve belgeleri paylaşın.',wraplength=550).pack(anchor='w',pady=8)
        cfg={}
        if (app.home/'cep-baglanti.json').exists():cfg=json.loads((app.home/'cep-baglanti.json').read_text(encoding='utf8'))
        url=StringVar(value=cfg.get('url','https://fis-asistani-cep.apex-kasim-belgeler.workers.dev'));token=StringVar(value=cfg.get('token',''))
        ttk.Label(body,text='Sunucu adresi').pack(anchor='w');ttk.Entry(body,textvariable=url,width=60).pack(fill='x',pady=5)
        ttk.Label(body,text='Bilgisayar bağlantı anahtarı').pack(anchor='w');ttk.Entry(body,textvariable=token,show='•',width=60).pack(fill='x',pady=5)
        status=StringVar(value='');ttk.Label(body,textvariable=status,wraplength=650).pack(fill='x',pady=12)
        def save():
            from urllib.parse import urlparse
            address=url.get().strip().rstrip('/');parsed=urlparse(address)
            if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.path or len(token.get().strip())<32:messagebox.showerror('Bağlantı','HTTPS sunucu adresini ve bilgisayar anahtarını kontrol edin.',parent=app.root);return
            if app.cep_thread and app.cep_thread.is_alive():messagebox.showinfo('Bağlantı','Çalışan eşitlemenin bağlantısını değiştirmek için önce uygulamayı kapatıp açın.',parent=app.root);return
            data={'url':address,'token':token.get().strip(),'device':cfg.get('device') or str(uuid.uuid4())}
            (app.home/'cep-baglanti.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8');start();status.set('Eşitleme başlatıldı. Sonuç aşağıda yenilenecek.')
        ttk.Button(body,text='Kaydet ve eşitlemeyi başlat',command=save,style='Accent.TButton').pack(anchor='w',pady=8)
        ttk.Label(body,text='Telefon eşleştirme görseli kurulum paketindeki Telefon-Eslestirme.png dosyasıdır. Bu kodu yalnız kendi telefonunuzda kullanın.',wraplength=620).pack(anchor='w',pady=8)
        def update():
            if not win.winfo_exists():return
            try:
                p=app.home/'cep-durum.json'
                if p.exists():
                    d=json.loads(p.read_text(encoding='utf8'));errors=d.get('errors',[]);status.set('Son kontrol: '+d.get('time','')+'\n'+('\n'.join(errors[:8]) if errors else 'Eşitleme kontrolü tamamlandı.'))
            except (OSError,ValueError):pass
            win.after(3000,update)
        update()
    ttk.Button(heading,text='CEP',command=show).pack(side='right',padx=5)
    app.root.bind('<Destroy>',lambda e:app.cep_stop.set() if e.widget==app.root else None,add='+')
    last_status=[None]
    def refresh():
        if app.cep_stop.is_set():return
        try:
            path=app.home/'cep-durum.json'
            stamp=path.stat().st_mtime_ns if path.exists() else None
            if stamp!=last_status[0] and not getattr(app,'dirty',False) and not getattr(app,'busy',False):
                app.reload_clients();last_status[0]=stamp
        except (OSError,ValueError):pass
        app.root.after(5000,refresh)
    app.root.after(5000,refresh)
    start()
