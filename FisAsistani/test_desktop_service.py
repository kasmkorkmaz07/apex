import base64,copy,io,tempfile,unittest,uuid
from pathlib import Path
from PIL import Image
from desktop_service import DesktopService
from core import gross_line,draft

def sample():
 d=draft('DENEME FIRMA\nVKN: 0123456789\n13.09.2026\nFIS NO: 000012\nKDV %20\nTOPLAM: 120,00');d['kod']='MS';return d

def picture(color='white'):
 b=io.BytesIO();Image.new('RGB',(100,100),color).save(b,'PNG');return base64.b64encode(b.getvalue()).decode()

class DesktopTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=DesktopService(self.tmp.name);self.cid=self.s.store.client('TEST')
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def create(self,color='white',data=None):
  ident=str(uuid.uuid4());values=dict(data or sample(),selected_period='2026-09');self.s.request('/api/documents','POST',{'document':{'id':ident,'client':str(self.cid),'kind':'gider','data':values},'imageBase64':picture(color)})
  return self.s.request('/api/documents/'+ident)
 def patch(self,d,**extra):
  return self.s.request('/api/documents/'+d['id'],'PATCH',dict(data=d['data'],revision=d['revision'],state='draft',**extra))
 def test_stale_revision_does_not_overwrite(self):
  d=self.create();d['data']['evrak_no']='CHANGED';self.patch(d)
  with self.assertRaisesRegex(ValueError,'başka pencerede'):self.patch(d)
  self.assertEqual(self.s.request('/api/documents/'+d['id'])['data']['evrak_no'],'CHANGED')
 def test_crop_multivat_restore_preserves_identity_and_hash(self):
  d=self.create();d['data']['kalemler']=[gross_line('10','110'),gross_line('20','120')];d['data']['toplam']='230';d['data']['vat_manually_reviewed']=True
  self.patch(d,imageBase64=picture('blue'));rows=self.s.find(d['id'])
  self.assertEqual(len(rows),2);self.assertEqual(len({r['image'] for r in rows}),1)
  before=copy.deepcopy(rows);doc=self.s.document(rows)
  self.s.request('/api/documents/'+doc['id'],'DELETE',{'revision':doc['revision']})
  self.assertIsNone(self.s.find(doc['id']))
  self.s.request('/api/documents/'+doc['id']+'/restore','POST')
  self.assertEqual(self.s.find(doc['id']),before)
 def test_duplicate_image_returns_original(self):
  d=self.create();result=self.s.request('/api/documents','POST',{'document':{'id':str(uuid.uuid4()),'client':str(self.cid),'kind':'gider','data':sample()},'imageBase64':picture()})
  self.assertTrue(result['duplicate']);self.assertEqual(result['id'],d['id']);self.assertEqual(len(self.s.groups()),1)
 def test_restore_after_new_receipt_reuses_sqlite_rowid(self):
  d=self.create();self.s.request('/api/documents/'+d['id'],'DELETE',{'revision':d['revision']});new=self.create('red')
  self.assertIsNone(self.s.find(d['id']))
  self.s.request('/api/documents/'+d['id']+'/restore','POST')
  self.assertEqual(len(self.s.groups()),2);self.assertNotEqual(self.s.find(new['id'])[0]['id'],self.s.find(d['id'])[0]['id'])
 def test_export_locked_against_change_or_delete(self):
  d=self.create();self.s.db.execute('UPDATE receipts SET exported=?',('fixture.xlsx',));self.s.db.commit();d=self.s.request('/api/documents/'+d['id'])
  with self.assertRaisesRegex(ValueError,'kilitli'):self.patch(d)
  with self.assertRaisesRegex(ValueError,'silinemez'):self.s.request('/api/documents/'+d['id'],'DELETE',{'revision':d['revision']})
 def test_approve_and_excel(self):
  d=self.create();self.s.request('/api/documents/'+d['id'],'PATCH',{'data':d['data'],'state':'approved','revision':d['revision']})
  out=self.s.request('/desktop/export','POST',{'client':str(self.cid),'period':'2026-09','path':str(Path(self.tmp.name)/'test.xlsx')})
  self.assertEqual(out['records'],1);self.assertTrue(Path(out['path']).is_file())

if __name__=='__main__':unittest.main()
