import unittest,tempfile
from pathlib import Path
from accounting import profile,save_profile
from core import Store,draft
from pdf_text import positioned_text
from test_invoices import TEXT

class LatestTests(unittest.TestCase):
 def test_pdf_source_order_and_fragments(self):
  class Page:
   rotation=0
   def extract_text(self,visitor_text):
    cm=[.667,0,0,-.667,28,813]
    for text,y in [('SAYIN',256),('RAL TEKSTİL',271),('VKN:7340971171',400),('SİBEL KAYA',48),('TCKN:21226006560',170)]:
     visitor_text(text,cm,[1,0,0,-1,10,y],{},11)
  result=positioned_text(Page());self.assertEqual(result.splitlines()[0],'SİBEL KAYA')
  self.assertLess(result.index('21226006560'),result.index('SAYIN'))
 def test_wide_spaces_do_not_truncate_name(self):
  d=draft(TEXT.replace('MUSTAFA ÇETİNER','SİBEL KA                         YA'))
  self.assertEqual(d['aciklama'],'SİBEL KA YA');self.assertIn('geniş boşluklar',d['ocr'])
 def test_template_deletion_persists_including_builtins(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=Store(Path(tmp)/'db')
   try:
    cid=s.client('T');p=profile(s,cid);p['descriptions']=['DENEME'];save_profile(s,cid,p)
    self.assertEqual(profile(s,cid)['descriptions'],['DENEME'])
    p['descriptions']=[];save_profile(s,cid,p);self.assertEqual(profile(s,cid)['descriptions'],[])
   finally:s.db.close()
