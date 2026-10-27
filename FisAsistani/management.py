import tkinter as tk
from tkinter import ttk,messagebox
from inline_table import CellEditor

def show(app,kind,add_new=False):
    if app.busy or not app.discard():return
    vendor=kind=='vendor'
    from in_app_panel import panel
    win=panel(app.root,'Kayıtlı Cariler' if vendor else 'Mükellefler')
    frame=ttk.Frame(win.body,padding=16);frame.pack(fill='both',expand=True)
    ttk.Label(frame,text='KAYITLI CARİLER' if vendor else 'MÜKELLEFLER',style='Title.TLabel').pack(anchor='w')
    buttons=ttk.Frame(frame);buttons.pack(fill='x',pady=6)
    create=ttk.LabelFrame(frame,text='Yeni cari' if vendor else 'Yeni mükellef',padding=8)
    new_name=tk.StringVar();new_id=tk.StringVar()
    ttk.Label(create,text='Ünvan' if vendor else 'Mükellef adı').grid(row=0,column=0,sticky='w')
    name_entry=ttk.Entry(create,textvariable=new_name)
    name_entry.grid(row=1,column=0,sticky='ew',padx=(0,8))
    if vendor:
        ttk.Label(create,text='VKN / TCKN').grid(row=2,column=0,sticky='w')
        ttk.Entry(create,textvariable=new_id).grid(row=3,column=0,sticky='ew',padx=(0,8))
    create.columnconfigure(0,weight=1)
    query=tk.StringVar();archived=tk.BooleanVar();status=tk.StringVar(value='Çift tıklayın, yazın ve Enter ile kaydedin. Ok tuşları / Tab: diğer hücre. Esc: vazgeç.')
    ttk.Label(frame,text='Ünvanın bir bölümünü veya vergi numarasını yazın').pack(anchor='w')
    ttk.Entry(frame,textvariable=query).pack(fill='x',pady=5)
    ttk.Label(frame,textvariable=status,wraplength=900).pack(fill='x')
    area=ttk.Frame(frame);area.pack(fill='both',expand=True,pady=10)
    tree=ttk.Treeview(area,columns=('id','name'),show='headings',selectmode='browse')
    tree.heading('id',text='VKN / TCKN' if vendor else 'No');tree.heading('name',text='Ünvan' if vendor else 'Mükellef')
    tree.column('id',width=150,stretch=False);tree.column('name',width=650)
    scroll=ttk.Scrollbar(area,command=tree.yview);scroll.pack(side='right',fill='y')
    tree.configure(yscrollcommand=scroll.set);tree.pack(fill='both',expand=True)
    keys={}
    def save(row,col,value):
        vals=list(tree.item(row,'values'));vals[0 if col=='id' else 1]=value
        old=keys[row]
        if old is None and (not vals[1] or (vendor and not vals[0])):
            tree.item(row,values=vals);status.set('Diğer hücreyi de doldurun; iki alan tamamlanınca cari kaydedilir.');return
        if vendor:
            if old is None:app.store.add_vendor(*vals)
            else:app.store.update_vendor(old,*vals)
            keys[row]=vals[0]
        else:
            if not value:raise ValueError('Mükellef adı boş olamaz.')
            if old is None:
                vals[0]=app.store.client(vals[1])
                from accounting import settings
                win.after_idle(lambda cid=vals[0]:settings(app,cid))
            else:app.store.rename_client(int(old),vals[1])
            keys[row]=vals[0];app.reload_clients();app.repoint_exports()
        tree.item(row,values=vals);status.set('Kaydedildi. Cari değişiklikleri sonraki okumalarda kullanılır.')
    editor=CellEditor(tree,('id','name') if vendor else ('name',),save,status.set)
    def refresh(*_):
        if not editor.commit():return
        from core import normalized
        tree.delete(*tree.get_children());keys.clear()
        rows=app.store.vendor_rows(query.get()) if vendor else app.store.clients(archived.get())
        for key,name in rows:
            if vendor or all(w in normalized(name) for w in normalized(query.get()).split()):
                row=tree.insert('','end',values=(key,name));keys[row]=key
    def cleanup_empty():
        active=editor.row if editor.entry is not None else None
        for row,key in list(keys.items()):
            if key is None and row!=active and tree.exists(row) and not any(tree.item(row,'values')):
                tree.delete(row);keys.pop(row,None)
    win.bind('<FocusOut>',lambda e:win.after_idle(cleanup_empty),add='+')
    def add():
        if not editor.commit():return
        create.pack(fill='x',after=buttons,pady=4)
        name_entry.focus_set()
    def save_new():
        name=new_name.get().strip()
        if not name:status.set('Mükellef adını / ünvanı yazın.');name_entry.focus_set();return
        try:
            if vendor:
                key=new_id.get().strip();app.store.add_vendor(key,name)
            else:
                key=app.store.client(name);app.reload_clients();app.repoint_exports()
        except Exception as exc:status.set(str(exc));return
        new_name.set('');new_id.set('');create.pack_forget();query.set('');archived.set(False);refresh()
        for row,value in keys.items():
            if str(value)==str(key):tree.selection_set(row);tree.see(row);break
        status.set('Cari kaydedildi.' if vendor else 'Mükellef kaydedildi. Defter türü / hesaplar düğmesinden ayarlarını düzenleyebilirsiniz.')
        if not vendor:
            from accounting import settings
            win.after_idle(lambda:settings(app,key))
    ttk.Button(create,text='Kaydet',command=save_new,style='Accent.TButton').grid(row=1,column=1,padx=3)
    ttk.Button(create,text='Vazgeç',command=create.pack_forget).grid(row=1,column=2,padx=3)
    name_entry.bind('<Return>',lambda e:save_new())
    def remove():
        editor.cancel()
        rows=tree.selection()
        if not rows:return
        key=keys[rows[0]]
        if key is None:tree.delete(rows[0]);keys.pop(rows[0],None);return
        if vendor:
            if messagebox.askyesno('Cari sil','Seçili cari hafızadan silinsin mi? Kayıtlı fişler ve Excel dosyaları değişmez.',parent=win):
                app.store.delete_vendor(key);refresh()
            return
        if messagebox.askyesno('Mükellef','Mükellefin listeden kaldırılmasını / geri alınmasını onaylıyor musunuz? Fişleri korunur.',parent=win):
            app.store.archive_client(int(key),not archived.get());app.reload_clients();refresh()
    def close():
        if editor.commit():win.destroy()
    ttk.Button(buttons,text='+ Cari ekle' if vendor else '+ Mükellef ekle',command=add).pack(side='left')
    ttk.Button(buttons,text='Seçili hücreyi düzenle',command=editor.start_selected).pack(side='left',padx=8)
    if vendor:
        ttk.Button(buttons,text='Seçili cariyi sil',command=remove).pack(side='left')
    if not vendor:
        def accounting_settings():
            if not editor.commit():return
            rows=tree.selection()
            if rows and keys[rows[0]] is not None:
                from accounting import settings
                settings(app,int(keys[rows[0]]))
            else:status.set('Önce bir mükellef seçin veya adını kaydedin.')
        ttk.Button(buttons,text='Defter türü / hesaplar',command=accounting_settings).pack(side='left')
        ttk.Button(buttons,text='Sil / geri al',command=remove).pack(side='left')
        ttk.Checkbutton(buttons,text='Silinenler',variable=archived,command=refresh).pack(side='left')
    ttk.Button(buttons,text='Kapat',command=close).pack(side='right')
    win.close_action=close;query.trace_add('write',refresh);refresh()
    controls=buttons.winfo_children()
    for button in controls:button.pack_forget()
    for index,button in enumerate(controls):
        button.grid(row=index//3,column=index%3,sticky='ew',padx=3,pady=3)
    for column in range(3):buttons.columnconfigure(column,weight=1)
    win.cell_editor=editor;win.records_tree=tree;win.add_record=add
    win.new_name=new_name;win.new_id=new_id;win.save_new=save_new;win.create_form=create
    if add_new:win.after_idle(add)
    return win
