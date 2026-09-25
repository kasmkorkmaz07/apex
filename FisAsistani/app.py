"""Yerel işletme defteri fiş asistanı — ilk deneme sürümü."""
import os
import json
from pathlib import Path
import queue
import shutil
import sqlite3
import threading
from datetime import datetime
import uuid
import tkinter as tk
from tkinter import ttk, filedialog, simpledialog, messagebox
from core import Store, draft, money, gross_line, export_xlsx, relevant_text, date_value, vat_records, validate

BASE = Path(__file__).resolve().parent

class App:
    def __init__(self, root, data_dir=None):
        self.root = root
        self.home = Path(data_dir) if data_dir else BASE / 'veriler'
        (self.home/'fotograflar').mkdir(parents=True, exist_ok=True)
        from instance_lock import InstanceLock
        self.instance_lock=InstanceLock(self.home)
        root.bind('<Destroy>',lambda e:self.instance_lock.close() if e.widget==root else None,add='+')
        self.store = Store(self.home/'kayitlar.sqlite3')
        self.export_root=Path(data_dir)/'excel' if data_dir else Path(json.loads((BASE/'export_settings.json').read_text(encoding='utf-8'))['root'])
        self.repoint_exports()
        self.events = queue.Queue()
        self.busy = False
        self.cancel_import = threading.Event()
        self.import_notes = []
        self.import_added = 0
        self.import_duplicates = 0
        self.current = None
        self.dirty = False
        self.loading = False
        self.kind = 'gider'
        root.title('Fiş Asistanı • Mükellef ve Belge Yönetimi')
        root.geometry(f'{min(1440,root.winfo_screenwidth()-40)}x{min(940,root.winfo_screenheight()-80)}')
        root.minsize(980,640)
        root.protocol('WM_DELETE_WINDOW', self.close)
        style = ttk.Style(root)
        style.theme_use('clam')
        style.configure('.', font=('Segoe UI',10))
        root.configure(background='#f2f5f9')
        style.configure('TFrame',background='#f2f5f9')
        style.configure('TLabel',background='#f2f5f9',foreground='#24364b')
        style.configure('Title.TLabel',font=('Segoe UI',16,'bold'),foreground='#143b58')
        style.configure('TButton',padding=(12,7),background='#e5edf5',foreground='#163c56',borderwidth=0)
        style.map('TButton',background=[('active','#cbdfee')])
        style.configure('Treeview',rowheight=32,background='white',fieldbackground='white',foreground='#24364b',borderwidth=0)
        style.configure('Treeview.Heading',font=('Segoe UI',10,'bold'),background='#dce8f2',padding=8)
        style.map('Treeview',background=[('selected','#1d658d')],foreground=[('selected','white')])
        style.configure('TNotebook.Tab',padding=(14,6),font=('Segoe UI',10,'bold'),width=19)
        style.map('TNotebook.Tab',padding=[('selected',(14,6)),('!selected',(14,6))],expand=[('selected',(0,0,0,0)),('!selected',(0,0,0,0))])
        style.configure('Header.TFrame',background='#132d46')
        style.configure('Header.TLabel',background='#132d46',foreground='white',font=('Segoe UI',19,'bold'))
        style.configure('Accent.TButton',background='#167b8b',foreground='white',padding=(16,9))
        style.map('Accent.TButton',background=[('active','#116575'),('disabled','#a9bcc3')])
        style.configure('TLabelframe',background='#f2f5f9',borderwidth=1,relief='solid')
        style.configure('TLabelframe.Label',font=('Segoe UI',10,'bold'),foreground='#47617a',background='#f2f5f9')
        style.configure('TNotebook',background='#f2f5f9',borderwidth=0)
        style.map('TNotebook.Tab',background=[('selected','#167b8b')],foreground=[('selected','white')])
        heading=ttk.Frame(root,padding=(20,14),style='Header.TFrame');heading.pack(fill='x')
        ttk.Label(heading,text='Fiş Asistanı  /  Belge kontrol merkezi',style='Header.TLabel').pack(side='left')
        ttk.Button(heading,text='KAYITLI CARİLER',command=lambda:self.manage('vendor')).pack(side='right',padx=5)
        ttk.Button(heading,text='MÜKELLEFLER',command=lambda:self.manage('client')).pack(side='right',padx=5)
        from ocr_settings import show as show_ocr_settings
        ttk.Button(heading,text='OCR AYARLARI',command=lambda:show_ocr_settings(self.root)).pack(side='right',padx=5)
        top = ttk.Frame(root,padding=12)
        top.pack(fill='x')
        ttk.Label(top,text='Mükellef').pack(side='left')
        self.client_var = tk.StringVar()
        self.client_box = ttk.Combobox(top,textvariable=self.client_var,state='readonly',width=28)
        self.client_box.pack(side='left',padx=6)
        self.client_box.bind('<<ComboboxSelected>>', self.change_client)
        self.active_client = None
        ttk.Button(top,text='Mükellef ekle',command=self.add_client).pack(side='left')
        self.import_btn = ttk.Button(top,text='+ Dosya yükle',command=self.import_photos,style='Accent.TButton')
        self.import_btn.pack(side='left',padx=8)
        self.cancel_btn=ttk.Button(top,text='Yüklemeyi durdur',command=self.cancel_upload,state='disabled')
        self.cancel_btn.pack(side='left')
        ttk.Button(top,text='Elle fiş ekle',command=self.new_manual).pack(side='left')
        ttk.Button(top,text='Kullanım ve kod rehberi',command=lambda:os.startfile(BASE/'GELIR-GUNCELLEME.md')).pack(side='right')
        self.tabs = ttk.Notebook(root,height=1)
        self.tabs.add(ttk.Frame(self.tabs),text='↗  GİDERLER')
        self.tabs.add(ttk.Frame(self.tabs),text='↙  GELİRLER')
        self.tabs.pack(fill='x',padx=12)
        self.tabs.bind('<<NotebookTabChanged>>',self.change_kind)
        ttk.Label(root,text='Yüklemeler seçili mükellef, ay ve gelir/gider bölümüne eklenir. Onaylanan fişler aylık Excel’i günceller.',padding=(12,0)).pack(anchor='w')
        pane = ttk.Panedwindow(root,orient='horizontal')
        pane.pack(fill='both',expand=True,padx=12,pady=10)
        left = ttk.LabelFrame(pane,text='  BELGELER  ',padding=10)
        detail=ttk.LabelFrame(pane,text='  KAYIT DETAYI  ',padding=(6,4))
        detail_canvas=tk.Canvas(detail,highlightthickness=0,background='#f2f5f9')
        detail_scroll=ttk.Scrollbar(detail,orient='vertical',command=detail_canvas.yview)
        detail_scroll.pack(side='right',fill='y');detail_canvas.pack(side='left',fill='both',expand=True)
        detail_canvas.configure(yscrollcommand=detail_scroll.set)
        right=ttk.Frame(detail_canvas,padding=(6,4))
        detail_window=detail_canvas.create_window((0,0),window=right,anchor='nw')
        right.bind('<Configure>',lambda e:detail_canvas.configure(scrollregion=detail_canvas.bbox('all')))
        detail_canvas.bind('<Configure>',lambda e:detail_canvas.itemconfigure(detail_window,width=e.width))
        pane.add(left,weight=2)
        pane.add(detail,weight=3)
        filters=ttk.Frame(left);filters.pack(fill='x',pady=(0,8))
        self.search=tk.StringVar();self.only_pending=tk.BooleanVar()
        ttk.Label(filters,text='Belge ara').pack(side='left')
        ttk.Entry(filters,textvariable=self.search,width=22).pack(side='left',padx=6,fill='x',expand=True)
        ttk.Checkbutton(filters,text='Onay bekleyenler',variable=self.only_pending,command=self.refresh).pack(side='left')
        self.search.trace_add('write',lambda *_:self.schedule_refresh())
        list_area=ttk.Frame(left);list_area.pack(fill='x')
        self.document_counts=tk.StringVar(value='Belge yok')
        ttk.Label(left,textvariable=self.document_counts).pack(anchor='w',before=list_area,pady=3)
        self.tree = ttk.Treeview(list_area,columns=('tarih','aciklama','durum','kaynak'),show='headings',height=6)
        for c,t,w in [('tarih','Tarih',90),('aciklama','Açıklama',170),('durum','Durum',130),('kaynak','Kaynak / sayfa',170)]:
            self.tree.heading(c,text=t)
            self.tree.column(c,width=w)
        self.tree.pack(side='left',fill='both',expand=True)
        scrollbar=ttk.Scrollbar(list_area,orient='vertical',command=self.tree.yview)
        scrollbar.pack(side='right',fill='y');self.tree.configure(yscrollcommand=scrollbar.set)
        self.tree.tag_configure('review',foreground='#995c00',background='#fff5df')
        self.tree.bind('<<TreeviewSelect>>', self.select)
        receipt_actions=ttk.Frame(left);receipt_actions.pack(fill='x',pady=8)
        ttk.Button(receipt_actions,text='Fotoğrafı aç',command=self.open_image).pack(side='left')
        ttk.Button(receipt_actions,text='Seçilen fişleri sil',command=self.delete_selected).pack(side='right')
        self.tree.bind('<Delete>',lambda e:self.delete_selected())
        from receipt_preview import ReceiptPreview
        self.preview = ReceiptPreview(left)
        self.preview.pack(fill='both',expand=True)
        self.vars = {}
        self.field_widgets={}
        style.configure('Review.TEntry',fieldbackground='#fff1d8',bordercolor='#c47913')
        style.configure('Review.TCombobox',fieldbackground='#fff1d8',bordercolor='#c47913')
        for r,(key,label) in enumerate([('tarih','Kayıt tarihi (GG.AA.YYYY)'),('evrak_tarihi','Evrak tarihi'),
            ('aciklama','Firma / açıklama'),('vkn','Belgedeki VKN / TCKN'),('evrak_no','Evrak no / Z no / Z sayaç'),
            ('kod','Kayıt türü'),('toplam','Kayıt tutarı (KDV dahil)')]):
            ttk.Label(right,text=label).grid(row=r,column=0,sticky='w',pady=3)
            v = tk.StringVar()
            self.vars[key] = v
            v.trace_add('write',lambda *_: self.mark_dirty())
            from accounting import DESCRIPTIONS
            w = ttk.Combobox(right,textvariable=v,values=['MS','ML'],state='readonly') if key=='kod' else (ttk.Combobox(right,textvariable=v,values=DESCRIPTIONS) if key=='aciklama' else ttk.Entry(right,textvariable=v))
            self.field_widgets[key]=w
            w.grid(row=r,column=1,sticky='ew',padx=8,pady=3)
        template_buttons=ttk.Frame(right);template_buttons.grid(row=14,column=0,columnspan=2,sticky='w',pady=6)
        ttk.Button(template_buttons,text='Şablon ekle',command=self.add_description_template).pack(side='left')
        ttk.Button(template_buttons,text='Şablon sil',command=self.delete_description_template).pack(side='left',padx=6)
        right.columnconfigure(1,weight=1)
        ttk.Label(right,text='Fişten otomatik okunan KDV ve tutar').grid(row=7,column=0,columnspan=2,sticky='w',pady=(12,3))
        self.tax = ttk.Treeview(right,columns=('oran','tutar'),show='headings',height=3)
        self.tax.heading('oran',text='KDV %')
        self.tax.heading('tutar',text='KDV dahil tutar (TL)')
        self.tax.grid(row=9,column=0,columnspan=2,sticky='ew',pady=5)
        from inline_table import CellEditor
        self.tax_editor = CellEditor(self.tax, ('oran','tutar'), self.save_tax_cell, lambda msg:self.status.set(msg))
        tax_buttons = ttk.Frame(right)
        tax_buttons.grid(row=8,column=0,columnspan=2,sticky='w')
        ttk.Button(tax_buttons,text='Düzelt / ekle',command=self.edit_tax).pack(side='left')
        ttk.Button(tax_buttons,text='Seçili satırı kaldır',command=self.remove_tax).pack(side='left',padx=5)
        ttk.Button(tax_buttons,text='Yeniden analiz et',command=self.reanalyze).pack(side='left')
        ttk.Button(tax_buttons,text='Cariden tamamla',command=self.complete_vendor).pack(side='left',padx=4)
        buttons = ttk.Frame(right)
        buttons.grid(row=10,column=0,columnspan=2,sticky='ew',pady=5)
        ttk.Button(buttons,text='Taslak kaydet',command=lambda:self.save(False)).pack(side='left')
        ttk.Button(buttons,text='Kontrol ettim, onayla',command=lambda:self.save(True),style='Accent.TButton').pack(side='left',padx=8)
        self.review_text=tk.StringVar();self.review_ack=tk.BooleanVar()
        check=ttk.LabelFrame(right,text='OKUMA KONTROLÜ',padding=6)
        check.grid(row=11,column=0,columnspan=2,sticky='ew',pady=6)
        ttk.Label(check,textvariable=self.review_text,wraplength=570,foreground='#915000').pack(fill='x')
        ttk.Checkbutton(check,text='Okuma uyarılarını fotoğraftan kontrol ettim',variable=self.review_ack).pack(anchor='w')
        suggestions=ttk.Frame(check);suggestions.pack(fill='x',pady=3)
        self.vendor_choice=tk.StringVar();self.vendor_options={}
        self.vendor_suggestions=ttk.Combobox(suggestions,textvariable=self.vendor_choice,state='readonly',width=40)
        self.vendor_suggestions.pack(side='left',fill='x',expand=True)
        ttk.Button(suggestions,text='Seçili cariyi kullan',command=self.use_vendor_suggestion).pack(side='left')
        self.account_vars={}
        accounts=ttk.Frame(right);self.account_frame=accounts;accounts.grid(row=13,column=0,columnspan=2,sticky='ew')
        ttk.Label(accounts,text='Bu belgeye özel hesaplar (boşsa mükellef ayarı)').grid(row=0,column=0,columnspan=3,sticky='w')
        for col,(key,label) in enumerate([('base','Matrah hesabı'),('vat','KDV hesabı'),('closing','Kapatma hesabı')]):
            ttk.Label(accounts,text=label).grid(row=1,column=col,sticky='w')
            v=tk.StringVar();self.account_vars[key]=v
            ttk.Entry(accounts,textvariable=v,width=17).grid(row=2,column=col,sticky='ew',padx=3)
            accounts.columnconfigure(col,weight=1)
            v.trace_add('write',lambda *_:self.mark_dirty())

        self.ocr = tk.Text(right,height=4,width=52,wrap='word',state='disabled')
        self.ocr.grid(row=12,column=0,columnspan=2,sticky='nsew')
        right.rowconfigure(12,weight=1)
        bottom = ttk.Frame(root,padding=12)
        bottom.pack(fill='x',before=pane)
        ttk.Label(bottom,text='Yükleme / Excel ayı').pack(side='left')
        self.period = tk.StringVar(value=datetime.now().strftime('%m-%Y'))
        self.period_box=ttk.Combobox(bottom,textvariable=self.period,width=9,state='readonly',values=[f'{m:02d}-{y}' for y in range(datetime.now().year-2,datetime.now().year+2) for m in range(1,13)])
        self.period_box.pack(side='left',padx=5)
        self.active_period=self.period.get()
        self.period_box.bind('<<ComboboxSelected>>',self.change_period)
        ttk.Button(bottom,text='Excel çıkar / güncelle',command=self.export).pack(side='left',padx=8)
        ttk.Button(bottom,text='Excel dosyasını aç',command=self.open_month).pack(side='left',padx=5)
        ttk.Label(bottom,text='Aynı dosya • KDV Dahil').pack(side='left',padx=8)
        self.vat_summary=tk.StringVar(value='Aylık gider KDV toplamı için mükellef seçin.')
        self.vat_summary_label=ttk.Label(root,textvariable=self.vat_summary,padding=(12,7),foreground='#126879',wraplength=900)
        self.vat_summary_label.pack(fill='x',before=pane)
        self.vat_summary_label.bind('<Configure>',lambda e:self.vat_summary_label.configure(wraplength=max(200,e.width-24)))
        self.status = tk.StringVar(value='Hazır. Önce mükellef ekleyin veya seçin.')
        ttk.Label(root,textvariable=self.status,padding=8,relief='sunken').pack(fill='x')
        from responsive import install
        install(self,heading,top,bottom,pane,left,detail,right)
        self.reload_clients()
        root.after(150,self.poll)

    def mark_dirty(self):
        if not self.loading and self.current:
            self.dirty = True
            self.review_ack.set(False)
            if getattr(self,'review_job',None):self.root.after_cancel(self.review_job)
            self.review_job=self.root.after(250,self.update_review)

    def update_review(self):
        self.review_job=None
        if not self.current or self.loading:return
        try:
            d=dict(self.store.get(self.current)[1]);d.update({k:v.get().strip() for k,v in self.vars.items()})
            d['kalemler']=[gross_line(*self.tax.item(i,'values')) for i in self.tax.get_children()]
            from review import assessment
            self.review_text.set(assessment(d)+'\n'+d.get('vendor_source','Ünvan: belge okuması'))
            for key,w in self.field_widgets.items():
                if key!='kod':w.configure(style=('Review.TCombobox' if not d.get(key) else 'TCombobox') if key=='aciklama' else ('Review.TEntry' if not d.get(key) else 'TEntry'))
        except (ValueError,KeyError) as e:self.review_text.set(str(e))

    def cancel_upload(self):
        self.cancel_import.set();self.cancel_btn.configure(state='disabled')
        self.status.set('Yükleme durduruluyor; devam eden fiş okumasının bitmesi bekleniyor.')

    def delete_selected(self):
        if self.busy:
            messagebox.showinfo('İşlem sürüyor','Yükleme tamamlanınca fiş silebilirsiniz.');return
        ids=self.tree.selection()
        if not ids:
            messagebox.showinfo('Fiş seçimi','Silmek istediğiniz fişleri seçin. Ctrl veya Shift ile birden fazla seçebilirsiniz.');return
        if not messagebox.askyesno('Seçilen fişleri sil',f'{len(ids)} kayıt silinecek ve aylık Excel güncellenecek. Zirve’ye aktarılmış kayıtlar Zirve’den silinmez. Devam edilsin mi?'):return
        try:
            periods=self.store.delete_receipts(self.client_id(),ids)
            self.current=None;self.dirty=False;self.refresh();self.fill(draft(kind=self.kind))
            errors=[]
            for period in periods:
                try:self.store.sync_month(self.client_id(),period)
                except Exception as e:errors.append(period+': '+str(e))
            self.status.set(f'{len(ids)} fiş silindi.')
            if errors:messagebox.showwarning('Fişler silindi, Excel güncellenemedi','Silme işlemi kaydedildi; aylık Excel henüz yenilenmedi. Aşağıdaki sorunu giderip ilgili ayda Excel çıkar / güncelle düğmesine basın.\n\n'+'\n'.join(errors))
        except Exception as e:messagebox.showerror('Silinemedi',str(e))

    def manage(self,kind):
        from management import show
        return show(self,kind)

    def change_period(self,event=None):
        if not self.discard():self.period.set(self.active_period);return
        self.active_period=self.period.get();self.current=None;self.dirty=False
        self.refresh();self.fill(draft(kind=self.kind))

    def export_target(self,cid,name,period):
        filename=''.join(c for c in name if c.isalnum() or c in ' -_').strip()[:100] or 'Mukellef'
        others=[n for i,n in self.store.clients() if i!=cid and (''.join(c for c in n if c.isalnum() or c in ' -_').strip()[:100] or 'Mukellef').casefold()==filename.casefold()]
        if others:filename+=f'_{cid}'
        return self.export_root/period/(filename+'.xlsx')

    def repoint_exports(self):
        with self.store.db:
            for cid,period,name in self.store.db.execute('SELECT m.client,m.period,c.name FROM monthly_exports m JOIN clients c ON c.id=m.client').fetchall():
                self.store.db.execute('UPDATE monthly_exports SET path=? WHERE client=? AND period=?',(str(self.export_target(cid,name,period)),cid,period))

    def change_kind(self,event=None):
        kind = 'gider' if self.tabs.index(self.tabs.select())==0 else 'gelir'
        if kind==self.kind:
            return
        if not self.discard():
            self.tabs.select(0 if self.kind=='gider' else 1)
            return
        self.kind = kind
        self.current = None
        self.dirty = False
        self.refresh()
        self.fill(draft(kind=kind))

    def selected_period(self):
        p = self.period.get().strip()
        return datetime.strptime(p,'%m-%Y').strftime('%m-%Y')

    def month_path(self):
        cid = self.client_id()
        return self.export_target(cid,self.client_var.get(),self.selected_period())

    def open_month(self):
        try:
            path = self.month_path()
            if not path.exists():
                if self.busy:
                    raise ValueError('Dosyaların okunması sürüyor; bitmesini bekleyin.')
                path=self.store.sync_month(self.client_id(),self.selected_period(),path)
            os.startfile(path)
        except Exception as e:
            messagebox.showerror('Aylık Excel',str(e))

    def save_tax_cell(self, row, column, value):
        values=list(self.tax.item(row,'values'))
        money(value)
        values[0 if column=='oran' else 1]=value
        if all(values):gross_line(*values)
        self.tax.item(row,values=values)
        self.mark_dirty();self.vat_reviewed=True

    def edit_tax(self):
        if not self.tax_editor.commit():return
        selected=self.tax.selection()
        row=selected[0] if selected else self.tax.insert('','end',values=('',''))
        self.tax.selection_set(row);self.tax_editor.start(row,'oran')

    def remove_tax(self):
        self.tax_editor.cancel()
        for item in self.tax.selection():
            self.tax.delete(item)
            self.mark_dirty()

    def use_vendor_suggestion(self):
        if self.kind=='gelir' and self.current and not self.store.get(self.current)[1].get('is_invoice'):
            self.vars['vkn'].set('');return
        choice=self.vendor_options.get(self.vendor_choice.get())
        if choice:
            self.vars['vkn'].set(choice[0])
            if self.kind!='gelir':self.vars['aciklama'].set(choice[1])
            self.status.set('Seçtiğiniz cari alanlara uygulandı; kaydetmeden önce fotoğraftan doğrulayın.')

    def complete_vendor(self):
        if not self.current or self.busy:return
        data=dict(self.store.get(self.current)[1])
        data.update({k:v.get().strip() for k,v in self.vars.items()})
        data.pop('vkn_omitted',None)
        data=self.store.recall_vendor(data)
        for key in ('vkn','aciklama'):self.vars[key].set(data.get(key,''))
        self.status.set(data.get('vendor_source','Kesin cari eşleşmesi bulunamadı; bilgiler korunuyor.'))

    def reanalyze(self):
        if self.busy or not self.current or not self.discard():
            return
        image, old, approved, exported = self.store.get(self.current)
        if exported:
            messagebox.showinfo('Kayıt çıkarıldı','Excel’e çıkarılmış kayıt yeniden analiz edilemez.')
            return
        rid = self.current
        self.dirty = False
        self.busy = True
        self.import_btn.configure(state='disabled')
        self.status.set('Fotoğraf yeni OCR motoruyla yeniden okunuyor…')
        def worker():
            try:
                from ocr_pipeline import read_image
                text = read_image(image) if image and Path(image).exists() else old.get('ocr','')
                d = draft(text,old.get('kind','gider'))
                from reanalysis import merge
                d=merge(old,d)
                self.events.put(('reanalyzed',rid,d,image))
            except Exception as e:
                d=dict(old);d['review_ack']=False
                d['ocr']=old.get('ocr','')+'\n[OCR KONTROL: Yeni okuma başarısız; önceki belge bilgileriyle cari eşleştirmesi yapıldı.]'
                self.events.put(('reanalyzed',rid,d,image))
            finally:
                self.events.put(('done',))
        threading.Thread(target=worker,daemon=True).start()

    def discard(self):
        return not self.dirty or messagebox.askyesno('Kaydedilmemiş değişiklik', 'Kaydedilmemiş değişiklikler silinsin mi?')

    def reload_clients(self):
        self.clients = dict((name,i) for i,name in self.store.clients())
        self.client_box['values'] = list(self.clients)
        if self.client_var.get() not in self.clients:
            self.client_var.set(next(iter(self.clients),'') )
        self.active_client = self.client_var.get()
        self.refresh()

    def change_client(self,event=None):
        if not self.discard():
            self.client_var.set(self.active_client or '')
            return
        self.active_client = self.client_var.get()
        self.current = None
        self.dirty = False
        self.refresh()
        self.fill(draft(kind=self.kind))

    def client_id(self):
        if self.client_var.get() not in self.clients:
            raise ValueError('Önce mükellef ekleyin / seçin.')
        return self.clients[self.client_var.get()]

    def add_client(self):
        from management import show
        show(self,'client',add_new=True)

    def schedule_refresh(self):
        if getattr(self,'refresh_job',None):self.root.after_cancel(self.refresh_job)
        self.refresh_job=self.root.after(180,self.refresh)

    def refresh(self):
        if getattr(self,'refresh_job',None):self.root.after_cancel(self.refresh_job);self.refresh_job=None
        self.loading = True
        self.tree.delete(*self.tree.get_children())
        if self.client_var.get() in self.clients:
            for i,d,a,e in self.store.rows(self.client_id(),self.kind,period=self.selected_period()):
                from core import normalized
                if self.only_pending.get() and a:continue
                if self.search.get() and normalized(self.search.get()) not in normalized(' '.join(str(d.get(k,'')) for k in ('aciklama','vkn','evrak_no'))):continue
                from review import assessment,warnings,needs_review
                problem=not a and needs_review(d)
                state = 'Excel’e çıkarıldı' if e else ('Onaylı' if a else 'Kontrol bekliyor')
                detail=(' • %'+d['vat_partition']+' • '+d['toplam']+' TL') if d.get('vat_partition') is not None else ''
                self.tree.insert('', 'end', iid=str(i),values=(d['tarih'],d['aciklama'],('İnceleme gerekli' if problem else state)+detail,d.get('source','')),tags=('review',) if problem else ())
        self.document_counts.set(str(len(self.tree.get_children()))+' belge gösteriliyor • '+self.selected_period())
        if self.client_var.get() in self.clients:
            from vat_summary import monthly_vat,summary_text
            self.vat_summary.set(summary_text(monthly_vat(self.store,self.client_id(),self.selected_period()),self.selected_period()))
        else:self.vat_summary.set('Aylık gider KDV toplamı için mükellef seçin.')
        self.loading = False

    def fill(self,d,image=''):
        self.loading = True
        if getattr(self,'review_job',None):self.root.after_cancel(self.review_job);self.review_job=None
        d=self.store.recall_vendor(dict(d))
        self.vat_reviewed=d.get('vat_manually_reviewed',False)
        from accounting import profile,resolve
        settings=profile(self.store,self.client_id()) if self.client_var.get() in self.clients else {'mode':'isletme'}
        d['accounting_mode']=settings['mode']
        if self.kind=='gelir':
            d['kod']=settings.get('income_code','ML')
            if not d.get('aciklama') and d.get('is_z_report'):d['aciklama']='Z RAPORU'
        self.field_widgets['kod']['values']=['ML','HZ'] if self.kind=='gelir' else ['MS','ML']
        from accounting import DESCRIPTIONS
        self.field_widgets['aciklama']['values']=settings.get('descriptions',DESCRIPTIONS)
        if settings['mode']=='genel':self.account_frame.grid()
        else:self.account_frame.grid_remove()
        from review import assessment
        self.review_text.set(assessment(d)+'\n'+d.get('vendor_source','Ünvan: belge okuması'))
        self.review_text.set(self.review_text.get()+'\n'+(('VKN / TCKN: SAYIN bölümündeki alıcıya ait olmalı.' if self.kind=='gelir' else 'VKN / TCKN: üstteki satıcıya ait olmalı.') if d.get('is_invoice') else 'VKN / TCKN: gelir Z raporunda boş bırakılır.' if self.kind=='gelir' else 'VKN / TCKN: satıcıya ait olmalı.'))
        if settings['mode']=='genel':
            try:
                mappings=[resolve(d,settings,r['oran']) for r in d['kalemler']]
                self.review_text.set(self.review_text.get()+'\nHesaplar: '+', '.join(' / '.join(codes)+' → '+closing for codes,closing in mappings))
            except ValueError as e:self.review_text.set(self.review_text.get()+'\n'+str(e))
        self.vendor_options={n+' / '+v:(v,n) for v,n in self.store.suggest_vendors(d)} if not d.get('vkn') and self.kind!='gelir' else {}
        self.vendor_suggestions['values']=list(self.vendor_options)
        self.vendor_choice.set('Kesin eşleşme yok; önerilerden seçebilirsiniz' if self.vendor_options else 'Cari önerisi gerekmiyor / bulunamadı')
        self.review_ack.set(d.get('review_ack',False))
        for key,var in self.account_vars.items():var.set(d.get('account_override',{}).get(key,''))
        for k,v in self.vars.items():
            v.set(d.get(k,''))
            if k!='kod':self.field_widgets[k].configure(style=('Review.TCombobox' if not d.get(k) else 'TCombobox') if k=='aciklama' else ('Review.TEntry' if not d.get(k) else 'TEntry'))
        self.tax_editor.cancel()
        self.tax.delete(*self.tax.get_children())
        for r in d['kalemler']:
            self.tax.insert('','end',values=(r['oran'],str(money(r['matrah'])+money(r['kdv']))))
        self.ocr.configure(state='normal')
        self.ocr.delete('1.0','end')
        self.ocr.insert('1.0',relevant_text(d.get('ocr','')))
        self.ocr.configure(state='disabled')
        try:
            self.preview.load(image if image and Path(image).exists() else None)
        except Exception as e:
            self.preview.load();self.status.set('Önizleme açılamadı: '+str(e))
        self.dirty = False
        self.loading = False

    def select(self,event=None):
        selected = self.tree.selection()
        if self.loading or not selected or int(selected[0])==self.current:
            return
        if not self.discard():
            if self.current and self.tree.exists(str(self.current)):
                self.tree.selection_set(str(self.current))
            return
        self.current = int(selected[0])
        image,d,a,e = self.store.get(self.current)
        self.fill(d,image)
        self.show_record_detail()
        self.status.set('Kayıt ayı: '+self.store.receipt_period(self.current) if d.get('tarih') else 'Alanları kontrol edip kaydedin.')

    def open_image(self):
        if self.current:
            image = self.store.get(self.current)[0]
            if image and Path(image).exists():
                os.startfile(image)

    def new_manual(self):
        try:
            cid = self.client_id()
            if not self.discard():
                return
            rid = self.store.add(cid,'',draft(kind=self.kind),self.selected_period())
            self.current = None
            self.dirty = False
            self.refresh()
            self.tree.selection_set(str(rid))
            self.select()
        except Exception as e:
            messagebox.showerror('Fiş eklenemedi',str(e))

    def import_photos(self):
        try:
            cid = self.client_id()
            period = self.selected_period()
            kind = self.kind
        except ValueError as e:
            messagebox.showerror('Mükellef',str(e))
            return
        if self.busy:
            return
        paths = filedialog.askopenfilenames(title='Fiş belgeleri',filetypes=[('Desteklenen belgeler','*.pdf *.zip *.jpg *.jpeg *.png *.webp *.bmp *.tif *.tiff'),('PDF','*.pdf'),('ZIP','*.zip')])
        if not paths:
            return
        self.busy = True
        self.cancel_import.clear()
        self.cancel_btn.configure(state='normal')
        self.import_notes = []
        self.import_added = 0
        self.import_duplicates = 0
        self.import_periods = set()
        self.import_btn.configure(state='disabled')
        self.status.set('Yerel OCR hazırlanıyor. İlk çalıştırma model indirebilir.')
        def worker():
            try:
                from ocr_local import read_image
                from import_documents import document_images
                from split_receipts import split_page
                report=lambda note:self.events.put(('import_note',note))
                for target,source in document_images(paths,self.home/'fotograflar',report,self.cancel_import.is_set):
                    if self.cancel_import.is_set():
                        target.unlink(missing_ok=True)
                        break
                    self.events.put(('progress','Okunuyor: '+source))
                    try:
                        from invoices import embedded_text
                        embedded=embedded_text(target)
                        parts = [(target,embedded)] if embedded else split_page(target,self.cancel_import.is_set)
                        note = ''
                    except Exception as e:
                        parts = [(target,'')]
                        note = 'OCR okunamadı; elle düzenlenebilir: '+str(e)
                    for index,(part,text) in enumerate(parts,1):
                        if self.cancel_import.is_set(): break
                        from ocr_pipeline import finish
                        self.events.put(('progress','Alanlar ve tutarlar kontrol ediliyor: '+source))
                        from invoices import embedded_text
                        if not embedded_text(part):text = finish(part,text)
                        if self.cancel_import.is_set(): break
                        d=draft(text,kind)
                        if not d['kalemler'] and d.get('excluded_zero_total'):
                            report(source+f' / Fiş {index}: yalnız %0 KDV içeriyor; isteğiniz doğrultusunda aktarım kaydı eklenmedi.')
                            continue
                        review_note=note
                        try:validate(d)
                        except ValueError as e:review_note=review_note or str(e)
                        d['source']=source+(f' / Fiş {index}' if len(parts)>1 else '')
                        d['source_image']=str(target)
                        self.events.put(('receipt',cid,str(part),d,review_note,period))
            except Exception as e:
                self.events.put(('import_note',str(e)))
            finally:
                self.events.put(('import_done',))
        threading.Thread(target=worker,daemon=True).start()

    def poll(self):
        try:
            for _ in range(30):
                event = self.events.get_nowait()
                if event[0]=='receipt':
                    _,cid,p,d,note,period = event
                    try:
                        rid=self.store.add(cid,p,d,period)
                        actual=self.store.receipt_period(rid)
                        self.import_periods.add(actual)
                        if actual!=period:self.import_notes.append(d.get('source','')+': belge tarihine göre '+actual+' ayına kaydedildi.')
                        self.import_added += len(vat_records(d))
                        if note:
                            self.import_notes.append(d.get('source','')+': '+note)
                        self.status.set(note or 'Fotoğraf taslağa eklendi; alanları kontrol edin.')
                    except sqlite3.IntegrityError:
                        self.import_duplicates += 1
                        Path(p).unlink(missing_ok=True)
                        self.status.set('Aynı fotoğraf bu mükellefte zaten var; tekrar eklenmedi.')
                    except Exception as error:
                        self.import_notes.append(d.get('source','')+': kayıt eklenemedi; kaynak görüntü korundu. '+str(error))
                        self.status.set('Belge kaydedilemedi; yükleme notlarını kontrol edin.')
                    self.schedule_refresh()
                elif event[0]=='error':
                    self.status.set(event[1])
                elif event[0]=='progress':
                    self.status.set(event[1])
                elif event[0]=='import_note':
                    self.import_notes.append(event[1])
                elif event[0]=='import_done':
                    if len(self.import_periods)==1 and not self.dirty:
                        self.period.set(next(iter(self.import_periods)))
                        self.active_period=self.period.get()
                        self.current=None
                        self.refresh()
                    self.busy=False
                    self.cancel_btn.configure(state='disabled')
                    self.import_btn.configure(state='normal')
                    result=f'{self.import_added} taslak eklendi; {self.import_duplicates} mükerrer atlandı; {len(self.import_notes)} not.'
                    if self.cancel_import.is_set():
                        result='Yükleme durduruldu. '+result
                    self.status.set(result)
                    log=self.home/'son-yukleme.txt'
                    log.write_text(result+'\n'+'\n'.join(self.import_notes),encoding='utf-8')
                    messagebox.showinfo('Toplu yükleme',result+'\n'+'\n'.join(self.import_notes[:6])+'\nAyrıntılar: '+str(log))
                elif event[0]=='reanalyzed':
                    _,rid,d,image = event
                    d=self.store.recall_vendor(d)
                    if self.current==rid and not self.dirty:
                        old=self.store.get(rid)[1]
                        if old.get('source'):
                            d['source']=old['source']
                        old_period=self.store.receipt_period(rid)
                        self.store.save(rid,d,False)
                        self.period.set(self.store.receipt_period(rid));self.active_period=self.period.get()
                        self.fill(self.store.get(rid)[1],image)
                        self.refresh()
                        self.tree.selection_set(str(rid))
                        self.status.set('Yeniden analiz taslak olarak kaydedildi; soldaki liste güncellendi. Kontrol edip onaylayın.')
                        try:
                            if old_period!=self.store.receipt_period(rid):self.store.sync_month(self.client_id(),old_period)
                            self.store.sync_month(self.client_id(),self.store.receipt_period(rid))
                        except Exception as e:
                            self.status.set('Taslak güncellendi; aylık Excel güncellenemedi: '+str(e))
                    else:
                        self.status.set('Okuma sırasında seçim veya alanlar değişti; mevcut değişiklikler korundu. Fişi yeniden analiz edin.')
                elif event[0]=='done':
                    self.busy = False
                    self.import_btn.configure(state='normal')
        except queue.Empty:
            pass
        except Exception as error:
            self.status.set('İşlem tamamlanamadı: '+str(error))
        self.root.after(150,self.poll)

    def add_description_template(self):
        from accounting import profile,save_profile
        from template_dialog import ask_template
        value=ask_template(self.root)
        if not value:return
        cid=self.client_id();p=profile(self.store,cid)
        p['descriptions']=list(dict.fromkeys(p['descriptions']+[value]))
        save_profile(self.store,cid,p)
        self.field_widgets['aciklama']['values']=p['descriptions']
        self.status.set('Açıklama şablonu mükellefe kaydedildi.')

    def delete_description_template(self):
        from accounting import profile,save_profile
        from template_dialog import ask_template
        cid=self.client_id();p=profile(self.store,cid)
        value=ask_template(self.root,p['descriptions'],delete=True)
        if not value:return
        p['descriptions']=[x for x in p['descriptions'] if x!=value]
        save_profile(self.store,cid,p)
        self.field_widgets['aciklama']['values']=p['descriptions']
        self.status.set('Şablon silindi. Belge açıklamaları korunur.')

    def form(self):
        if not self.tax_editor.commit():raise ValueError("Düzenlenen KDV hücresini kontrol edin.")
        d = dict(self.store.get(self.current)[1]) if self.current else {}
        d.update({k:v.get().strip() for k,v in self.vars.items()})
        d['kind'] = self.kind
        if not d['vkn'] and (d.get('vkn_omitted') or (self.current and self.store.get(self.current)[1].get('vkn'))):d['vkn_omitted']=True
        elif d['vkn']:d.pop('vkn_omitted',None)
        from accounting import profile
        d['accounting_mode']=profile(self.store,self.client_id())['mode']
        d['custom_description']=d.get('kind')=='gelir' or d['aciklama'] in profile(self.store,self.client_id())['descriptions']
        d['review_ack']=self.review_ack.get()
        override={k:v.get().strip() for k,v in self.account_vars.items()}
        if any(override.values()):
            if not override['base'] or not override['closing']:raise ValueError('Belgeye özel matrah ve kapatma hesabını birlikte doldurun.')
            d['account_override']=override
        else:d.pop('account_override',None)
        if self.vat_reviewed:
            d['vat_manually_reviewed']=True
            d['vat_reviewed_at']=datetime.now().isoformat(timespec='seconds')
        d['ocr'] = self.ocr.get('1.0','end').strip()
        original_lines=d.get('kalemler',[])
        d['kalemler'] = []
        for item in self.tax.get_children():
            rate,total=self.tax.item(item,'values')
            matching=[r for r in original_lines if money(r['oran'])==money(rate) and money(r['matrah'])+money(r['kdv'])==money(total)]
            d['kalemler'].append(dict(matching[0]) if len(matching)==1 else gross_line(rate,total))
        if self.vat_reviewed and d.get('vat_partition') is not None and len(d['kalemler'])==1:
            d['vat_partition']=d['kalemler'][0]['oran']
        return d

    def save(self,approve):
        if not self.current:
            messagebox.showinfo('Fiş seçimi','Önce listeden fiş seçin.')
            return
        try:
            old_period=self.store.receipt_period(self.current)
            self.store.save(self.current,self.form(),approve)
            self.period.set(self.store.receipt_period(self.current));self.active_period=self.period.get()
            image,saved,_,_=self.store.get(self.current)
            self.fill(saved,image)
            self.dirty = False
            self.refresh()
            self.tree.selection_set(str(self.current))
            self.status.set('Fiş onaylandı.' if approve else 'Taslak kaydedildi; yeniden onay gerekir.')
            try:
                if old_period!=self.store.receipt_period(self.current):self.store.sync_month(self.client_id(),old_period)
                path = self.store.sync_month(self.client_id(),self.store.receipt_period(self.current))
                if path:
                    self.status.set('Aylık Excel güncellendi: '+str(path))
            except Exception as e:
                messagebox.showwarning('Fiş kaydedildi, Excel güncellenemedi',str(e)+'\nExcel açıksa kapatın ve ilgili ayı seçip Aylık Excel’i güncelle düğmesine basın.')
        except sqlite3.IntegrityError:
            messagebox.showerror('Mükerrer fiş','Bu mükellefte aynı VKN, evrak tarihi ve fiş numarasıyla onaylı kayıt var.')
        except Exception as e:
            messagebox.showerror('Kaydedilemedi',str(e))

    def export(self):
        try:
            if self.busy:
                raise ValueError('Dosyaların okunması sürüyor; bitince Excel çıkar düğmesine basın.')
            if self.dirty:
                raise ValueError('Önce açık fişteki değişiklikleri kaydedin.')
            cid = self.client_id()
            period = self.selected_period()
            path = self.store.sync_month(cid,period,self.month_path())
            count = len(self.store.monthly_records(cid,period))
            self.status.set('Aylık otomatik güncelleme açık: '+str(path))
            from accounting import profile
            if profile(self.store,cid)['mode']=='genel':
                messagebox.showinfo('Genel muhasebe Excel hazır',f'Gider: Genel_Alis_Aktarim\nGelir: Genel_Satis_Aktarim (Z + fatura birlikte)\nGelirde VKN / TC 4. sütunda; Z satırlarında boş, gelir faturasında alıcının kimliğidir. Evrak Türü 11. sütundur.\nZirve tanımında Zraporu ve Satış Faturası satırlarının evrak türü sütununa 11 yazın.\nSütun numaraları Sutun_Eslestirme sayfasındadır.\n{path}')
                return
            messagebox.showinfo('Aylık Excel hazır',f'{period}: {count} onaylı fiş. Yeni onaylar aynı dosyayı güncelleyecek.\n\nGelirler / Giderler: başlıklı inceleme sayfaları.\nGelir_Aktarim / Gider_Aktarim: Zirve için başlıksız sayfalar. KDV Dahil seçin.\n\nDosya tüm ayı içerir; Zirve’ye daha önce aktarılan satırları tekrar aktarmayın. Excel’de elle yapılan değişiklikler sonraki güncellemede yenilenir; düzeltmeleri uygulamada yapın.\n\n{path}')
        except Exception as e:
            messagebox.showerror('Excel oluşturulamadı',str(e))

    def close(self):
        if self.busy:
            messagebox.showinfo('İşlem sürüyor','Fotoğraflar işleniyor; bitmesini bekleyin.')
            return
        if self.discard():
            self.store.db.close()
            self.instance_lock.close()
            self.root.destroy()

if __name__=='__main__':
    root = tk.Tk()
    try:
        App(root)
        root.mainloop()
    except RuntimeError as error:
        root.withdraw();messagebox.showerror('Fiş Asistanı',str(error));root.destroy()
