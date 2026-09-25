import unittest
import numpy as np
from PIL import Image,ImageDraw
from scan_prepare import prepare,choose

class ScanTests(unittest.TestCase):
    def test_same_total_different_vat_is_not_silent(self):
        a='TEST FIRMA\nVKN:0123456789\n09.09.2026\nFIS NO:1\n%20\nTOPLAM 120,00'
        self.assertIn('KDV dağılımı farklı',choose(a,a.replace('%20','%10')))
    def test_detail_variant_preserves_edges_and_original(self):
        from scan_prepare import detail_variant
        im=Image.new('RGB',(420,900),'#aaaaaa')
        draw=ImageDraw.Draw(im)
        draw.text((1,2),'TOPLAM 700,00',fill='black')
        draw.text((1,880),'KDV 116,67',fill='black')
        before=im.tobytes();out=detail_variant(im)
        self.assertEqual(out.size,im.size)
        self.assertEqual(im.tobytes(),before)
        self.assertLess(np.asarray(out)[:20].min(),80)
        self.assertLess(np.asarray(out)[880:].min(),80)

    def test_better_read_does_not_erase_warning(self):
        original='TEST FIRMA\n[OCR KONTROL: Zayıf tarih satırı]'
        better='TEST FIRMA\nVKN:0123456789\n09.09.2026\nFIS NO:1\n%20\nTOPLAM 120,00'
        self.assertIn('[OCR KONTROL: Zayıf tarih satırı]',choose(original,better))
    def test_partial_receipt_boundary_is_rejected(self):
        from scan_prepare import plausible_page_quad
        q=np.float32([[0,123],[468,10],[491,558],[48,860]])
        self.assertFalse(plausible_page_quad(q))
        self.assertTrue(plausible_page_quad(np.float32([[180,80],[600,110],[650,920],[140,900]])))

    def test_perspective_and_original_preserved(self):
        im=Image.new('RGB',(800,1000),'#202020')
        draw=ImageDraw.Draw(im)
        draw.polygon([(180,80),(600,110),(650,920),(140,900)],fill='white')
        for y in range(200,800,50):draw.line((230,y,540,y),fill='black',width=4)
        before=im.tobytes();out=prepare(im)
        self.assertEqual(im.tobytes(),before)
        self.assertLess(out.width,700)
        self.assertGreater(np.asarray(out).mean(),200)

    def test_missing_field_improves_but_conflict_keeps_original(self):
        text='TEST FIRMA\nVKN:0123456789\n09.09.2026\nFIS NO:1\n%20\nTOPLAM 120,00'
        missing=text.replace('VKN:0123456789','')
        self.assertEqual(choose(missing,text),text)
        self.assertTrue(choose(text,text.replace('120,00','240,00')).startswith(text))
        self.assertIn('[OCR KONTROL:',choose(text,text.replace('120,00','240,00')))
        self.assertEqual(choose(text,''),text)
