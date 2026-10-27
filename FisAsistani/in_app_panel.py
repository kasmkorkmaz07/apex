"""Ana pencereye bağlı, bağımsız işletim sistemi penceresi açmayan sayfalar."""
import tkinter as tk
from tkinter import ttk

def panel(root, title, scroll=False):
    win=ttk.Frame(root, padding=12)
    win.place(x=0,y=0,relwidth=1,relheight=1)
    win.lift()
    bar=ttk.Frame(win);bar.pack(fill='x',pady=(0,8))
    ttk.Label(bar,text=title,style='Title.TLabel').pack(side='left')
    win.close_action=win.destroy
    ttk.Button(bar,text='← Geri',command=lambda:win.close_action()).pack(side='right')
    if scroll:
        canvas=tk.Canvas(win,highlightthickness=0,background=ttk.Style(root).lookup('TFrame','background') or '#f2f5f9')
        scrollbar=ttk.Scrollbar(win,orient='vertical',command=canvas.yview)
        scrollbar.pack(side='right',fill='y');canvas.pack(fill='both',expand=True)
        canvas.configure(yscrollcommand=scrollbar.set)
        body=ttk.Frame(canvas)
        item=canvas.create_window(0,0,window=body,anchor='nw')
        body.bind('<Configure>',lambda e:canvas.configure(scrollregion=canvas.bbox('all')))
        canvas.bind('<Configure>',lambda e:canvas.itemconfigure(item,width=e.width))
    else:
        body=ttk.Frame(win);body.pack(fill='both',expand=True)
    win.body=body
    return win
