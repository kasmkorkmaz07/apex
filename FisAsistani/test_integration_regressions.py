import unittest,tempfile,json,time
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from core import Store,gross_line
class IntegrationRegressionTests(unittest.TestCase):
 def test_indexed_month_matches_legacy_and_constant_queries(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=Store(Path(tmp)/'db');c=s.client('A')
   d=dict(kind='gider',tarih='15.08.2026',evrak_tarihi='15.08.2026',aciklama='Firma',vkn='1234567890',evrak_no='1',kod='MS',kalemler=[gross_line(20,120)],toplam='120',ocr='')
   with s.db:
    s.db.executemany('INSERT INTO receipts(client,data,period,approved) VALUES (?,?,?,1)',[(c,json.dumps(d),'08-2026' if i%10==0 else '07-2026') for i in range(1000)])
   calls=[];s.db.set_trace_callback(calls.append);r=s.monthly_records(c,'08-2026')
   self.assertEqual(len(r),100);self.assertEqual(len(calls),1)
   self.assertEqual(len(s.rows(c,period='07-2026')),900);s.db.close()
 def test_adjacent_invoice_receipts_split_before_whole_page_shortcut(self):
  from split_receipts import split_page
  text='E-ARSIV FATURA\nTARIH: 01.08.2026\nFATURA NO: ABC2026000000001\nVKN: 1234567890\nTOPLAM 120,00\nKDV %20 20,00'
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'pair.png';Image.new('RGB',(1000,1000),'white').save(p)
   with patch('split_receipts.paper_regions',return_value=[[(0,0,500,1000),(500,0,1000,1000)]]),patch('ocr_local.read_image',return_value=text):
    self.assertEqual(len(split_page(p)),2)
 def test_single_instance_releases(self):
  from instance_lock import InstanceLock
  with tempfile.TemporaryDirectory() as tmp:
   a=InstanceLock(Path(tmp))
   with self.assertRaises(RuntimeError):InstanceLock(Path(tmp))
   a.close();b=InstanceLock(Path(tmp));b.close()
if __name__=='__main__':unittest.main()
