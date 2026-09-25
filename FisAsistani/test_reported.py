import tempfile,unittest
from core import draft,Store,money
class ReportedCases(unittest.TestCase):
 def test_enver_next_line_and_short_total(self):
  d=draft('ENVER AKVARYUM\n5 OCAK V.D.\n7340026868\n12-09-2026 FIS NO:0034\nKEDI MAMASI %20 *600,00\nTOP *600,00\nKDV *100,00')
  self.assertEqual(d['vkn'],'7340026868');self.assertEqual(d['toplam'],'600.00');self.assertEqual(d['kalemler'][0]['oran'],'20.00')
 def test_enver_inferred_marked(self):
  d=draft('ENVER AKVARYUM\n5 OCAK V.D\n7340026868\n12-09-2026 FIS NO:0034\nARATOPLAM *600,00\nKDV *100,00')
  self.assertTrue(d['vat_inferred']);self.assertEqual(d['kalemler'][0]['oran'],'20.00')
 def test_person_and_date(self):
  d=draft('NOSTALJI MERSIN\nDOĞAN SÖNERLER\nKARADUVAR MAH.\nURAY V.D.15824201496\n16/08/2026 FIS NO:00003')
  self.assertEqual(d['aciklama'],'DOĞAN SÖNERLER')
  self.assertEqual(d['evrak_tarihi'],'16.08.2026')
 def test_bidirectional_unique(self):
  from pathlib import Path
  with tempfile.TemporaryDirectory() as tmp:
   s=Store(Path(tmp)/'db.sqlite3');s.add_vendor('7340026868','ENVER AKVARYUM')
   self.assertEqual(s.recall_vendor({'vkn':'','aciklama':'Enver Akvaryum'})['vkn'],'7340026868')
   s.add_vendor('1234567890','ENVER AKVARYUM')
   self.assertEqual(s.recall_vendor({'vkn':'','aciklama':'ENVER AKVARYUM'})['vkn'],'')
   s.db.close()
 def test_registered_name_has_priority_over_ocr(self):
  from pathlib import Path
  with tempfile.TemporaryDirectory() as tmp:
   s=Store(Path(tmp)/'db.sqlite3');s.add_vendor('7340026868','KAYITLI DOĞRU ÜNVAN')
   self.assertEqual(s.recall_vendor({'vkn':'7340026868','aciklama':'OCR YANLIŞ ÜNVAN'})['aciklama'],'KAYITLI DOĞRU ÜNVAN')
   self.assertEqual(s.recall_vendor({'vkn':'1234567890','aciklama':'FİŞTEN OKUNAN ÜNVAN'})['aciklama'],'FİŞTEN OKUNAN ÜNVAN')
   s.db.close()

 def test_ocr_cents_and_numeric_receipt(self):
  d=draft('TEST FIRMA\nVKN:1234567890\n11.08.2026 FIS NO:2\nTOPKDV *61,82\nTOPLAM *680,0C')
  self.assertEqual(d['toplam'],'680.00');self.assertEqual(d['kalemler'][0]['oran'],'10.00')
  self.assertEqual(draft('FIS NO T0000')['evrak_no'],'')
  self.assertEqual(draft('FATURA NO T092026007980787')['evrak_no'],'T092026007980787')
  self.assertEqual(draft('FIS NO 00001')['evrak_no'],'1')

 def test_document_date_ignores_displaced_pos_date_without_memory(self):
  text='ALIHAN SAHIN\nSEYHAN VERGI DAIRESI\n16726236272\nTARIH : 14/08/2026\nFIS NO: 1\nTAMCH:14. 08.2926\nELEKT.MLZ %20 *700,00\nTOPKDV *116,67\nTOPLAM *700,00'
  d=draft(text,use_vendor_hints=False)
  self.assertEqual(d['evrak_tarihi'],'14.08.2026');self.assertEqual(d['vkn'],'16726236272');self.assertEqual(d['aciklama'],'ALIHAN SAHIN')
