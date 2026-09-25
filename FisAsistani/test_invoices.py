import unittest
import tempfile
from pathlib import Path
from openpyxl import load_workbook
from core import draft,validate,Store,money
from accounting import profile,save_profile
from test_income import SAMPLES
from test_core import sample

TEXT='''MUSTAFA ÇETİNER
BELEDİYE EVLERİ 84216 SK. NO:4
TCKN:15739210064
e-Arşiv Fatura
SAYIN
ADYA MÜHENDİSLİK SANAYİ VE TİCARET LİMİTED ŞİRKETİ
VKN:0080795489
Fatura No:GIB2026000000003
Fatura Tarihi:29-06-2026 13:00
Mal Hizmet Toplam Tutarı 1.750,00 TL
Hesaplanan KDV(%20) 350,00 TL
Vergiler Dahil Toplam Tutar 2.100,00 TL
Ödenecek Tutar 2.100,00 TL'''

class InvoiceTests(unittest.TestCase):
 def test_counterparty_by_kind(self):
  for kind in ('gelir','gider'):
   d=draft(TEXT,kind);validate(d)
   self.assertEqual(d['aciklama'],'ADYA MÜHENDİSLİK SANAYİ VE TİCARET LİMİTED ŞİRKETİ' if kind=='gelir' else 'MUSTAFA ÇETİNER');self.assertEqual(d['vkn'],'0080795489' if kind=='gelir' else '15739210064')
   self.assertEqual(d['evrak_no'],'GIB2026000000003');self.assertEqual(d['evrak_tarihi'],'29.06.2026')
   self.assertEqual(d['toplam'],'2100.00');self.assertEqual(d['kalemler'][0]['kdv'],'350.00')
 def test_all_requested_labels(self):
  for label in ('HESAPLANAN GERÇEK USULDE KATMA DEĞER VERGİSİ (20)','HESAPLANAN GERÇEK %20','HESAPLANAN KDV %20'):
   d=draft(TEXT.replace('Hesaplanan KDV(%20)',label).replace('Ödenecek Tutar','ÖDENECEK NET TUTAR'));validate(d)
   self.assertEqual(d['kalemler'][0]['oran'],'20')
 def test_base_label_is_not_vat_amount(self):
  d=draft(TEXT.replace('Hesaplanan KDV(%20) 350,00','KDV MATRAHI %20 1.750,00'));validate(d)
  self.assertEqual(d['kalemler'][0]['kdv'],'350.00')
 def test_buyer_id_never_fills_missing_seller_id(self):
  d=draft(TEXT.replace('TCKN:15739210064',''));self.assertEqual(d['vkn'],'')
  with self.assertRaises(ValueError):validate(d)
 def test_income_requires_buyer_not_seller_id(self):
  d=draft(TEXT.replace('VKN:0080795489',''),'gelir')
  self.assertEqual(d['vkn'],'');self.assertEqual(d['seller_vkn'],'15739210064')
  with self.assertRaises(ValueError):validate(d)
 def test_general_expense_requires_supplier_id(self):
  d=draft(TEXT.replace('TCKN:15739210064',''));d['accounting_mode']='genel'
  with self.assertRaises(ValueError):validate(d)
 def test_z_never_uses_issuers_id(self):
  d=draft('VKN:1234567890\n'+SAMPLES[0][3],'gelir')
  self.assertEqual(d['vkn'],'');validate(d)
 def test_missing_seller_boundary_never_uses_buyer(self):
  d=draft(TEXT[TEXT.index('SAYIN'):]);self.assertEqual(d['aciklama'],'');self.assertEqual(d['vkn'],'')
 def test_withholding_mismatch_blocks(self):
  d=draft(TEXT.replace('Ödenecek Tutar 2.100,00','Ödenecek Tutar 1.820,00'))
  self.assertEqual(d['kalemler'],[])
  with self.assertRaises(ValueError):validate(d)
 def test_multi_rate_and_zero_income(self):
  text=TEXT[:TEXT.index('Mal Hizmet Toplam')]+'''KDV MATRAHI %0 100,00 TL
Hesaplanan KDV %10 10,00 TL
Hesaplanan KDV %20 20,00 TL
Ödenecek Net Tutar 330,00 TL'''
  income=draft(text,'gelir');validate(income);self.assertEqual(len(income['kalemler']),3)
  expense=draft(text,'gider');validate(expense);self.assertEqual(len(expense['kalemler']),2)
  self.assertEqual(expense['excluded_zero_total'],'100.00')
 def test_invoice_excel_both_modes_and_kinds(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=Store(Path(tmp)/'db')
   try:
    for mode in ('isletme','genel'):
     cid=s.client(mode);p=profile(s,cid);p.update(mode=mode,income_code='HZ',rates={'20':['740.20','191.20']},closing='320.01',income_rates={'20':['600.20','391.20']},income_closing='120.01');save_profile(s,cid,p)
     for kind in ('gelir','gider'):
      rid=s.add(cid,None,draft(TEXT,kind),'09-2026');d=s.get(rid)[1];s.save(rid,d,True)
      self.assertEqual(s.receipt_period(rid),'06-2026');self.assertEqual(d['tarih'],'29.06.2026');self.assertEqual(d['aciklama'],'ADYA MÜHENDİSLİK SANAYİ VE TİCARET LİMİTED ŞİRKETİ' if kind=='gelir' else 'MUSTAFA ÇETİNER')
     path=Path(tmp)/(mode+'.xlsx');s.sync_month(cid,'06-2026',path);w=load_workbook(path)
     try:
      if mode=='isletme':
       self.assertEqual(w['Gelir_Aktarim']['A1'].value,'HZ');self.assertEqual(w['Gelir_Aktarim']['F1'].value,2100)
       self.assertEqual(w['Gider_Aktarim']['G1'].value,2100);self.assertEqual(w['Gider_Aktarim']['E1'].value,'MUSTAFA ÇETİNER')
      else:
       for sheet in ('Genel_Satis_Aktarim','Genel_Alis_Aktarim'):
        self.assertEqual(w[sheet]['C1'].value,'ADYA MÜHENDİSLİK SANAYİ VE TİCARET LİMİTED ŞİRKETİ' if 'Satis' in sheet else 'MUSTAFA ÇETİNER');self.assertEqual(w[sheet]['D1'].value,'0080795489' if 'Satis' in sheet else '15739210064')
        self.assertEqual(w[sheet]['F1'].value,1750);self.assertEqual(w[sheet]['G1'].value,350)
     finally:w.close()
   finally:s.db.close()
 def test_z_month_corrected_on_save_expense_receipt_unchanged(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=Store(Path(tmp)/'db')
   try:
    cid=s.client('T');rid=s.add(cid,None,draft(SAMPLES[1][3],'gelir'),'09-2026')
    self.assertEqual(s.receipt_period(rid),'08-2026');self.assertEqual(s.get(rid)[1]['tarih'],'01.08.2026')
    d=s.get(rid)[1];d['evrak_tarihi']='31.07.2026';s.save(rid,d,True)
    self.assertEqual(s.receipt_period(rid),'07-2026');self.assertEqual(s.get(rid)[1]['tarih'],'31.07.2026')
    self.assertEqual(s.monthly_records(cid,'08-2026'),[]);self.assertEqual(len(s.monthly_records(cid,'07-2026')),1)
    d=sample();d.update(tarih='31.08.2026',evrak_tarihi='31.08.2026');rid=s.add(cid,None,d,'09-2026')
    self.assertEqual(s.get(rid)[1]['tarih'],'01.09.2026');self.assertEqual(s.get(rid)[1]['evrak_tarihi'],'31.08.2026')
   finally:s.db.close()
 def test_mixed_z_does_not_merge_amounts(self):
  d=draft(SAMPLES[0][3]+'\n'+SAMPLES[2][3],'gelir')
  self.assertEqual(d['kalemler'],[]);self.assertEqual(d['toplam'],'');self.assertEqual(d['evrak_no'],'')
 def test_invoice_reanalysis_and_vendor_memory_preserve_seller(self):
  from reanalysis import merge
  d=draft(TEXT)
  result=merge(d,draft('eksik okuma'));self.assertTrue(result['is_invoice']);self.assertEqual(result['evrak_no'],d['evrak_no'])
  with tempfile.TemporaryDirectory() as tmp:
   s=Store(Path(tmp)/'db')
   try:
    s.add_vendor(d['vkn'],'BAŞKA TABELA ADI')
    self.assertEqual(s.recall_vendor(d)['aciklama'],'MUSTAFA ÇETİNER')
   finally:s.db.close()

if __name__=='__main__':unittest.main()
