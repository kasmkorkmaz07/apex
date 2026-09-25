"""Google anahtarını sohbet veya düz metin dosya yerine Windows ile sakla."""
import tkinter as tk
from tkinter import ttk
from ocr_cloud import settings, save_settings, usage


def show(parent):
    from in_app_panel import panel
    win=panel(parent,'OCR ayarları',scroll=True)
    box = ttk.Frame(win.body, padding=20); box.pack(fill='both', expand=True)
    config = settings()
    enabled = tk.BooleanVar(value=config.get('enabled', False))
    limit = tk.StringVar(value=str(config.get('limit', 1000)))
    key = tk.StringVar()
    ttk.Label(box, text='Şüpheli fişlerde Google ile ikinci okuma', font=('Segoe UI', 14, 'bold')).pack(anchor='w', pady=8)
    ttk.Label(box, text='Etkin olduğunda yalnız eksik veya çelişkili fiş görüntüleri Google Cloud Vision’a gönderilir.', wraplength=620).pack(anchor='w', pady=5)
    ttk.Checkbutton(box, text='Google ikinci okuyucuyu etkinleştir', variable=enabled).pack(anchor='w', pady=8)
    ttk.Label(box, text='Google Cloud Vision API anahtarı (kayıtlı anahtarı korumak için boş bırakın)').pack(anchor='w')
    ttk.Entry(box, textvariable=key, show='•').pack(fill='x', pady=5)
    ttk.Label(box, text='Anahtar Windows kullanıcı hesabınızla şifrelenir. '+('Kayıtlı anahtar var.' if config.get('protected_key') else 'Henüz anahtar kaydedilmedi.')).pack(anchor='w')
    row = ttk.Frame(box); row.pack(fill='x', pady=12)
    ttk.Label(row, text='Bu uygulamanın aylık istek sınırı:').pack(side='left')
    ttk.Entry(row, textvariable=limit, width=10).pack(side='left', padx=8)
    ttk.Label(box, text=f'Bu ay bu uygulamadan gönderilen istek: {usage()}').pack(anchor='w')
    ttk.Label(box, text='Bu sayaç Google hesabındaki diğer kullanımları içermez; ücretsiz kota garantisi değildir. Başarısız denemeler de sayılır. Aynı görüntünün kayıtlı sonucu tekrar kullanılır.', wraplength=620).pack(anchor='w', pady=8)
    status = tk.StringVar()
    ttk.Label(box, textvariable=status, wraplength=620).pack(anchor='w')
    def save():
        try:
            save_settings(enabled.get(), limit.get(), key.get())
            key.set(''); status.set('Ayarlar kaydedildi. Yeni yüklemelerde ve yeniden analizde uygulanacak.')
        except (ValueError, OSError) as e:
            status.set(str(e))
    ttk.Button(box, text='Ayarları kaydet', command=save).pack(anchor='e', pady=8)
