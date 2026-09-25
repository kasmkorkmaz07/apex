import unittest,tempfile
from pathlib import Path
from core import Store,gross_line
from vat_summary import monthly_vat
class VatSummaryTests(unittest.TestCase):
 def test_month_client_kind_status_and_split(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=Store(Path(tmp)/'test.db');a=s.client('A');b=s.client('B')
   def add(cid=a,period='08-2026',kind='gider',lines=None):
    d=dict(kind=kind,tarih='15.08.2026',evrak_tarihi='15.08.2026',aciklama='Firma',vkn='1234567890',evrak_no='1',kod='MS',kalemler=lines or [gross_line(20,120)],toplam='120',ocr='')
    if lines:d['toplam']=str(sum(float(x['matrah'])+float(x['kdv']) for x in lines))
    return s.add(cid,None,d,period)
   first=add();s.db.execute('UPDATE receipts SET approved=1 WHERE id=?',(first,));s.db.commit()
   split=add(lines=[gross_line(10,110),gross_line(20,240)])
   add(b);add(period='09-2026');add(kind='gelir')
   r=monthly_vat(s,a,'08-2026');self.assertEqual((r['approved'],r['pending'],r['total']),(20,50,70))
   s.delete_receipts(a,[first]);self.assertEqual(monthly_vat(s,a,'08-2026')['total'],50)
   row=s.get(split)[1];row['kalemler'][0]['kdv']='yanlış';import json
   s.db.execute('UPDATE receipts SET data=? WHERE id=?',(json.dumps(row),split));s.db.commit()
   r=monthly_vat(s,a,'08-2026');self.assertEqual(r['unread'],1);self.assertEqual(r['total'],40)
   s.db.close()
if __name__=='__main__':unittest.main()
