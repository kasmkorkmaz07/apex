import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from PIL import Image
from core import draft, Store
from ocr_pipeline import finish, reconcile, suspicious
from ocr_cloud import read, usage, text
from review import warnings

RAW = 'TEST FIRMA\nVKN: 0123456789\n13.09.2026\nFIS NO: 12\nKDV %20\nTOPLAM: 120,00\nTOPKDV *20,00'


class PipelineTests(unittest.TestCase):
    def test_valid_local_never_calls_cloud(self):
        reader = Mock()
        result = finish('does-not-exist', RAW, reader)
        reader.assert_not_called()
        self.assertIn('Google kullanılmadı', result)

    def test_missing_date_completed(self):
        result = reconcile(RAW.replace('13.09.2026', ''), RAW)
        self.assertEqual(draft(result)['evrak_tarihi'], '13.09.2026')
        self.assertFalse(warnings(draft(result)))
        self.assertIn('Google Cloud Vision', draft(result)['ocr'])

    def test_conflicting_amount_keeps_local_and_blocks_unreviewed_approval(self):
        result = reconcile(RAW, RAW.replace('120,00', '180,00').replace('20,00\n', '30,00\n'))
        d = draft(result)
        self.assertEqual(d['toplam'], '120.00')
        self.assertTrue(warnings(d))
        with tempfile.TemporaryDirectory() as tmp:
            s=Store(Path(tmp)/'db'); c=s.client('Test'); rid=s.add(c,None,d,'09-2026')
            with self.assertRaisesRegex(ValueError, 'uyarılarını'):s.save(rid,d,True)
            s.db.close()

    def test_annotations_cannot_supply_identity_or_date(self):
        d=draft('TEST FIRMA\n[OCR KONTROL: VKN: 9999999999 Tarih: 01.01.2026]')
        self.assertEqual(d['vkn'], ''); self.assertEqual(d['evrak_tarihi'], '')

    def test_vendor_hints_cannot_hide_missing_name(self):
        with patch('ocr_pipeline.draft', wraps=draft) as spy:
            suspicious(RAW)
            self.assertFalse(spy.call_args.kwargs['use_vendor_hints'])

    def test_network_failure_preserves_local(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'image.png'; Image.new('RGB',(200,300),'white').save(path)
            local=RAW.replace('13.09.2026','')
            result=finish(path,local,Mock(side_effect=TimeoutError('secret must not appear')))
            self.assertIn(local,result); self.assertNotIn('secret',result)
            self.assertTrue(warnings(draft(result)))

    def test_cache_and_limit(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ,{'FIS_GOOGLE_VISION_API_KEY':'test-key'}):
            Path(tmp,'google_ocr.json').write_text(json.dumps({'enabled':True,'limit':1}))
            transport=Mock(return_value={'fullTextAnnotation':{'text':RAW}})
            im=Image.new('RGB',(20,20),'white')
            self.assertFalse(read(im,tmp,transport)[1])
            self.assertTrue(read(im,tmp,transport)[1])
            self.assertEqual(usage(tmp),1); self.assertEqual(transport.call_count,1)
            with self.assertRaisesRegex(ValueError,'sınırına'):
                read(Image.new('RGB',(20,20),'black'),tmp,transport)
            self.assertEqual(transport.call_count,1)

    def test_disabled_no_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            transport=Mock()
            with self.assertRaisesRegex(ValueError,'kapalı'):read(Image.new('RGB',(10,10)),tmp,transport)
            transport.assert_not_called()

    def test_timeout_not_retried_and_counts_against_cap(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ,{'FIS_GOOGLE_VISION_API_KEY':'test-key'}):
            Path(tmp,'google_ocr.json').write_text(json.dumps({'enabled':True,'limit':1}))
            transport=Mock(side_effect=ValueError('Bağlantı kurulamadı'))
            with self.assertRaises(ValueError):read(Image.new('RGB',(10,10)),tmp,transport)
            self.assertEqual(usage(tmp),1);self.assertEqual(transport.call_count,1)

    def test_word_boxes_reconstruct_vat_row(self):
        def w(t,x,y):
            return {'description':t,'boundingPoly':{'vertices':[{'x':x,'y':y},{'x':x+20,'y':y},{'x':x+20,'y':y+10},{'x':x,'y':y+10}]}}
        response={'textAnnotations':[{'description':'whole'},w('169.00',100,10),w('%1',0,10),w('%10',0,30),w('115.00',100,30)]}
        self.assertEqual(text(response),'%1 169.00\n%10 115.00')

    def test_all_printed_vat_labels_trigger_second_reader(self):
        for label in ('TOPKDV','TOPLAM KDV','KDV'):
            self.assertTrue(suspicious(RAW.replace('TOPKDV *20,00',label+' *30,00')))

    def test_vat_distribution_conflict_even_when_total_matches(self):
        other=RAW.replace('KDV %20','KDV %10').replace('TOPKDV *20,00','TOPKDV *10,91')
        self.assertIn('KDV dağılımı',reconcile(RAW,other))

    @unittest.skipUnless(os.name=='nt','Windows user encryption')
    def test_key_is_encrypted_and_round_trips(self):
        from ocr_cloud import save_settings, settings, protect
        import base64
        with tempfile.TemporaryDirectory() as tmp:
            save_settings(True,1000,'dummy-only-not-a-real-key',tmp)
            stored=Path(tmp,'google_ocr.json').read_text()
            self.assertNotIn('dummy-only-not-a-real-key',stored)
            protected=settings(tmp)['protected_key']
            self.assertEqual(protect(base64.b64decode(protected),True).decode(),'dummy-only-not-a-real-key')


if __name__ == '__main__':unittest.main()
