import unittest,tempfile,sqlite3
from pathlib import Path
from copy import deepcopy
from core import draft,validate,Store,vat_records,money
from accounting import profile,save_profile,EMIR
from reanalysis import merge
from test_core import sample
from test_income import SAMPLES

class AuditTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.s=Store(Path(self.tmp.name)/'db');self.addCleanup(self.s.db.close)
  self.cid=self.s.client('Genel');save_profile(self.s,self.cid,deepcopy(EMIR))
 def test_normal_receipt_z_footer_is_not_income(self):
  text='DENEME FIRMA\nVKN:0123456789\n13.09.2026\nFIS NO: 0025\nURUN %20 *120,00\nTOPLAM *120,00\nTOPKDV *20,00\nZ NO: 0817\nISYERI NO:1234\nTOPLAM 90,00 TL PARAPUAN'
  d=draft(text);validate(d)
  self.assertEqual(d['kind'],'gider');self.assertEqual(d['evrak_no'],'25');self.assertEqual(d['toplam'],'120.00')
  self.assertNotIn('PARAPUAN',d['ocr'])
  d=draft(text,'gelir');validate(d);self.assertEqual(d['evrak_no'],'25');self.assertFalse(d.get('is_z_report',False))
 def test_general_bidirectional_vendor_memory(self):
  self.s.add_vendor('7340026868','ENVER AKVARYUM')
  d=self.s.recall_vendor(dict(kind='gider',accounting_mode='genel',vkn='',aciklama='ENVER AKVARYUM'))
  self.assertEqual(d['vkn'],'7340026868')
 def test_explicit_empty_id_survives_reanalysis(self):
  d=sample();rid=self.s.add(self.cid,None,d,'09-2026');cleared=dict(self.s.get(rid)[1],vkn='')
  self.s.save(rid,cleared);old=self.s.get(rid)[1];self.assertTrue(old['vkn_omitted'])
  result=merge(old,d);self.assertEqual(result['vkn'],'')
  self.assertEqual(self.s.recall_vendor(result)['vkn'],'')
 def test_general_person_rule_unless_document_description(self):
  d=sample();d.update(vkn='11872358656',aciklama='ACR AYAKKABI DUNYASI',accounting_mode='genel')
  with self.assertRaisesRegex(ValueError,'TCKN bulunan'):validate(d)
  d.update(aciklama='GİDER PUSULASI',custom_description=True);validate(d)
 def test_missing_z_number_never_restores_old_receipt_number(self):
  old=draft(SAMPLES[0][3],'gider')
  new=draft('Z RAPORU\n25.07.2026\nFIS NO:6\nTOPLAM %1 *350,00','gelir')
  result=merge(old,new);self.assertEqual(result['evrak_no'],'')
 def test_zero_vat_is_preserved_after_reanalysis(self):
  d=draft(SAMPLES[2][3],'gelir');parts=vat_records(d)
  result=merge(parts[0],d);validate(result)
  self.assertEqual(result['kalemler'][0]['oran'],'0.00');self.assertEqual(result['toplam'],'20774.75')
 def test_income_and_expense_numbers_are_independent(self):
  cid=self.s.client('İşletme');a=sample();b=dict(a,kind='gelir',kod='ML')
  for d in (a,b):
   rid=self.s.add(cid,None,d,'09-2026');self.s.save(rid,self.s.get(rid)[1],True)
  self.assertEqual(sum(a for _,_,a,_ in self.s.rows(cid)),2)
 def test_duplicate_single_vs_partitioned_is_blocked(self):
  cid=self.s.client('İşletme');a=sample();rid=self.s.add(cid,None,a,'09-2026');self.s.save(rid,a,True)
  b=dict(a,vat_partition='20.00');other=self.s.add(cid,None,b,'09-2026')
  with self.assertRaises(sqlite3.IntegrityError):self.s.save(other,b,True)
