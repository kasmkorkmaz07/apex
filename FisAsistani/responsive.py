"""Dar pencerede liste / detay geçişi; geniş pencerede iki bölmeli çalışma."""
from tkinter import ttk

def install(app,heading,top,bottom,pane,left,detail,right):
    root=app.root
    root.minsize(640,420)
    switch=ttk.Frame(root,padding=(12,0))
    app.compact=False
    app.compact_page='list'
    def show(page):
        app.compact_page=page
        if app.compact:
            for child in pane.panes():pane.forget(child)
            pane.add(detail if page=='detail' else left,weight=1)
            for widget,options in left_children:
                widget.pack_forget()
                if (page=='photo')==(widget is app.preview):widget.pack(**options)
        list_button.configure(style='Accent.TButton' if page=='list' else 'TButton')
        detail_button.configure(style='Accent.TButton' if page=='detail' else 'TButton')
        photo_button.configure(style='Accent.TButton' if page=='photo' else 'TButton')
    list_button=ttk.Button(switch,text='Belgeler',command=lambda:show('list'))
    list_button.pack(side='left')
    detail_button=ttk.Button(switch,text='Kayıt detayı / onay',command=lambda:show('detail'))
    detail_button.pack(side='left',padx=6)
    photo_button=ttk.Button(switch,text='Fotoğraf',command=lambda:show('photo'));photo_button.pack(side='left',padx=6)
    left_children=[(w,dict(w.pack_info())) for w in left.pack_slaves()]
    for w,options in left_children:options.pop('in',None)
    actions=next(((w,o) for w,o in left_children if any(isinstance(c,ttk.Button) for c in w.winfo_children())),None)
    if actions:
        left_children.remove(actions);left_children.insert(next(i for i,(w,o) in enumerate(left_children) if w is app.tree.master),actions)
    app.show_record_detail=lambda:show('detail') if app.compact else None
    title=next(w for w in heading.winfo_children() if isinstance(w,ttk.Label))
    original_title=title.cget('text')
    hint=next((w for w in root.winfo_children() if isinstance(w,ttk.Label) and str(w.cget('text')).startswith('Yüklemeler seçili')),None)
    bottom_info=bottom.winfo_children()[-1]
    controls=list(top.winfo_children())
    # Mükellef satırı ve eylemler ayrı satırlara ayrılır, sağa taşmaz.
    for widget in controls:widget.pack_forget()
    for index,widget in enumerate(controls):
        row,col=(0,index) if index<4 else (1,index-4)
        widget.grid(row=row,column=col,sticky='w',padx=3,pady=3)
    top.columnconfigure(1,weight=1)
    app.client_box.configure(width=24)
    app.client_box.grid(sticky='ew')
    last=None
    def resize(event=None):
        nonlocal last
        width=root.winfo_width();compact=width<1100
        if width<10:return
        if compact==last:return
        last=compact;app.compact=compact
        title.configure(text='Fiş Asistanı' if compact else original_title)
        for child in pane.panes():pane.forget(child)
        if compact:
            switch.pack(fill='x',before=pane)
            if hint:hint.pack_forget()
            bottom_info.pack_forget()
            top.configure(padding=4);bottom.configure(padding=4);heading.configure(padding=(10,7))
            pane.configure(height=100)
            app.tree.configure(height=2)
            app.preview.configure(height=100)
            show(app.compact_page)
        else:
            switch.pack_forget();pane.add(left,weight=2);pane.add(detail,weight=3)
            for widget,options in left_children:
                widget.pack_forget();widget.pack(**options)
            if hint:hint.pack(anchor='w',before=bottom)
            bottom_info.pack(side='left',padx=8)
            top.configure(padding=12);bottom.configure(padding=12);heading.configure(padding=(20,14))
            pane.configure(height=400)
            app.tree.configure(height=6);app.preview.configure(height=280)
        # Aynı satırda kalan araç düğmelerinin taşmasını önler.
        style=ttk.Style(root)
        style.configure('TButton',padding=(7,5) if compact else (12,7))
        style.configure('Accent.TButton',padding=(9,5) if compact else (16,9))
        style.configure('Header.TLabel',font=('Segoe UI',12 if compact else 19,'bold'))
        app.tax.column('oran',width=100,minwidth=70)
        app.tax.column('tutar',width=180,minwidth=100)
    def changed(event):
        if event.widget==root:resize()
    app.update_layout=resize
    root.bind('<Configure>',changed,add='+')
    root.after_idle(resize)
