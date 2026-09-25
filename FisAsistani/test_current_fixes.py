import unittest
from core import draft,unlabelled_header_ids
from PIL import Image,ImageDraw
from split_receipts import paper_regions
class HeaderAndSplitTests(unittest.TestCase):
 def test_bare_valid_header_tckn(self):
  t='İPEK ECZANESİ\nÖZLEM ÖZDOĞAN\nTürkiye\n63943398566\nTarih/Saat 17.09.2026 16:02\nBelge No X012026000014737\nTOPLAM 479,84'
  self.assertEqual(draft(t)['vkn'],'63943398566')
 def test_customer_or_pos_id_not_used(self):
  for t in ['MÜŞTERİ VKN/TCKN\n63943398566','17.09.2026\n63943398566','SATIŞ\n63943398566','63943398565']:
   self.assertEqual(unlabelled_header_ids(t),[])
 def test_border_paper_not_a_receipt(self):
  im=Image.new('RGB',(1000,1200),(90,40,15));d=ImageDraw.Draw(im)
  d.rectangle((0,0,700,150),fill='white')
  for x in [100,400,700]:d.rectangle((x,300,x+170,1000),fill='white')
  regions=paper_regions(im)
  self.assertTrue(regions);self.assertEqual(len(regions[0]),3)

 def test_final_total_precedes_subtotal(self):
  t='MARKET\n01.09.2026 FIS NO 3\nVKN:1234567890\nARA TOPLAM 100,00\nTOPLAM 90,00\nÜRÜN %10 *90,00'
  self.assertEqual(draft(t)['toplam'],'90.00')
 def test_payable_precedes_before_discount_total(self):
  t='MARKET\n01.09.2026 FIS NO 3\nVKN:1234567890\nTOPLAM 100,00\nÖDENECEK TUTAR 90,00\nÜRÜN %10 *90,00'
  self.assertEqual(draft(t)['toplam'],'90.00')
 def test_seam_does_not_split_blank_or_single_paper(self):
  from split_receipts import seam_parts
  self.assertEqual(seam_parts(Image.new('RGB',(500,1000),'white')),[])
