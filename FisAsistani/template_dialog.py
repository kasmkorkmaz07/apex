"""Şablon ekleme ve silme için açık Kaydet / Sil eylemleri."""
import tkinter as tk
from tkinter import ttk

def ask_template(parent, choices=(), delete=False):
    from in_app_panel import panel
    win=panel(getattr(parent.winfo_toplevel(),'app_container',parent.winfo_toplevel()),'Şablon sil' if delete else 'Yeni açıklama şablonu')
    frame=ttk.Frame(win.body,padding=18);frame.pack(fill='both',expand=True)
    ttk.Label(frame,text='Silinecek şablonu seçin' if delete else 'Şablon açıklamasını yazın').pack(anchor='w')
    value=tk.StringVar();result=[];status=tk.StringVar()
    field=ttk.Combobox(frame,textvariable=value,values=list(choices),state='readonly',width=48) if delete else ttk.Entry(frame,textvariable=value,width=48)
    field.pack(fill='x',pady=10)
    if delete and choices:value.set(choices[0])
    ttk.Label(frame,textvariable=status).pack(anchor='w')
    def commit(event=None):
        text=value.get().strip()
        if not text:status.set('Açıklama boş bırakılamaz.');return
        if delete and text not in choices:return
        result.append(text);win.destroy()
    buttons=ttk.Frame(frame);buttons.pack(fill='x',pady=(10,0))
    ttk.Button(buttons,text='İptal',command=win.destroy).pack(side='right')
    ttk.Button(buttons,text='Sil' if delete else 'Kaydet',command=commit,style='Accent.TButton').pack(side='right',padx=8)
    field.bind('<Return>',commit);field.bind('<Escape>',lambda e:win.destroy())
    win.grab_set();field.focus_set();parent.wait_window(win)
    return result[0] if result else None
