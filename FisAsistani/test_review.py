import unittest,tempfile
from pathlib import Path
from copy import deepcopy
from core import Store,draft,gross_line
from review import warnings
from reanalysis import merge
from test_core import sample
from accounting import EMIR,save_profile,resolve

class ReviewTests(unittest.TestCase):
 def test_learn_corrected_header_and_recall_after_reopen(self):
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'db';s=Store(path);c=s.client('Test')
   d=sample();d['ocr']='TABELA DUKKAN\\nHATALI OCR ISIM'.replace('\\n','\n');d['aciklama']='DOĞRU KİŞİ ADI'
   rid=s.add(c,None,d,'09-2026');s.save(rid,d,True);s.db.close();s=Store(path)
   recovered=s.recall_vendor({'vkn':'','aciklama':'HATALI OCR ISIM','ocr':'HATALI OCR ISIM'})
   self.assertEqual(recovered['vkn'],d['vkn']);self.assertEqual(recovered['aciklama'],d['aciklama'])
   self.assertIn('eşleşmesinden',recovered['vendor_source']);s.db.close()
 def test_ambiguous_alias_never_assigns(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=Store(Path(tmp)/'db')
   for v,n in [('1234567890','BİRİNCİ CARİ'),('1234567891','İKİNCİ CARİ')]:
    s.add_vendor(v,n);s.learn_vendor({'vkn':v,'aciklama':n,'ocr':'ORTAK TABELA'})
   d=s.recall_vendor({'vkn':'','aciklama':'ORTAK TABELA','ocr':''})
   self.assertEqual(d['vkn'],'');self.assertTrue(warnings(d));s.db.close()
 def test_conflict_requires_acknowledgement(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=Store(Path(tmp)/'db');c=s.client('Test');d=sample();d['ocr']+='\n[OCR KONTROL: Toplam: 120 / 180]'
   rid=s.add(c,None,d,'09-2026')
   with self.assertRaisesRegex(ValueError,'uyarılarını'):s.save(rid,d,True)
   d['review_ack']=True;s.save(rid,d,True);s.db.close()
 def test_reanalysis_preserves_missing_fields_and_warns(self):
  old=sample();old['account_override']={'base':'740 99','vat':'191 99','closing':'320 01'}
  d=merge(old,draft(''))
  self.assertEqual(d['vkn'],old['vkn']);self.assertEqual(d['account_override'],old['account_override']);self.assertTrue(warnings(d));self.assertFalse(d['review_ack'])
 def test_account_override(self):
  d=sample();d['account_override']={'base':'740 99','vat':'191 99','closing':'320 02'}
  self.assertEqual(resolve(d,EMIR,20),(['740 99','191 99'],'320 02'))
  d['account_override']['vat']=''
  with self.assertRaises(ValueError):resolve(d,EMIR,20)

 def test_similar_name_is_suggestion_not_identity(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=Store(Path(tmp)/'db');s.add_vendor('16726236272','ALİHAN ŞAHİN')
   d={'vkn':'','aciklama':'ALIHAM SAHIN','ocr':''}
   self.assertEqual(s.recall_vendor(dict(d))['vkn'],'')
   self.assertEqual(s.suggest_vendors(d)[0][0],'16726236272');s.db.close()
 def test_greeting_is_not_learned_as_identity(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=Store(Path(tmp)/'db');s.add_vendor('1234567890','TEST CARİ')
   s.learn_vendor({'vkn':'1234567890','aciklama':'TEST CARİ','ocr':'AFIYET OLSUN'})
   self.assertEqual(s.recall_vendor({'vkn':'','aciklama':'AFIYET OLSUN','ocr':''})['vkn'],'');s.db.close()
