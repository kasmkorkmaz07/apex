import unittest
from core import draft, money, validate


class ReceiptEvidenceTests(unittest.TestCase):
    def test_weak_critical_lines_flagged_without_numeric_replacement(self):
        from ocr_local import uncertain_lines
        self.assertEqual(uncertain_lines(['TOPLAM 780,00','VKN:1234567890','PUAN:5'],[.72,.99,.3]),['TOPLAM 780,00'])
        self.assertEqual(uncertain_lines(['TOPLAM 780,00'],None),[])
    def test_far_future_ocr_year_is_not_clean(self):
        from review import warnings
        self.assertTrue(warnings({'evrak_tarihi':'14.08.2826'}))

    def test_multiple_sellers_are_explicit(self):
        from review import warnings
        d=draft('SEYHAN VD 1234567890\nURAY VD 9876543210',use_vendor_hints=False)
        self.assertEqual(d['vkn'],'')
        self.assertTrue(warnings(d))

    def test_multiline_company_preserved(self):
        d=draft('RESTORAN\nTEST KAFE GIDA IHR ITH\nVE TIC. LTD STI\nMAH NO:1\nVKN:1234567890',use_vendor_hints=False)
        self.assertEqual(d['aciklama'],'TEST KAFE GIDA IHR ITH VE TIC. LTD STI')

    def test_office_ocr_variant_and_spaced_identity(self):
        for header,number in [('SEYHAN VERGI LAIRESI\n16726236272','16726236272'),
                              ('YUREGIR VERGT DAIRESI\n20203061554','20203061554'),
                              ('URAY VD 609 108 5492','6091085492')]:
            self.assertEqual(draft(header,use_vendor_hints=False)['vkn'],number)
        self.assertEqual(draft('BILINMEYEN 609 108 5492',use_vendor_hints=False)['vkn'],'')

    def test_company_beats_background_advertisement(self):
        d=draft('Google Play\ne-Arsiv Fatura\nTEST MAGAZACILIK A.S.\nMAH NO:4\nVKN:1234567890',use_vendor_hints=False)
        self.assertEqual(d['aciklama'],'TEST MAGAZACILIK A.S.')

    def test_broken_summary_can_use_complete_products(self):
        text='TEST LTD\nVKN:1234567890\n01.09.2026\nFIS NO:1\nPEYNIR %1.0 *150.00\nPEYNIR %1.0 ×155.00\nPOSET %20. *1.00\nTOPLAM *306.00\nTOPKDV 3.19\nKDV Orani KDV Dahil Tutar KDV\n%1.00 *35.00 *3.02'
        d=draft(text,use_vendor_hints=False)
        self.assertEqual([money(k['matrah'])+money(k['kdv']) for k in d['kalemler']],[money('305'),money('1')])
        validate(d)
        bad=draft(text.replace('155.00','154.00'),use_vendor_hints=False)
        self.assertEqual(bad['kalemler'],[])

    def test_inferred_rate_stays_explicitly_uncertain(self):
        d=draft('TEST LTD\nVKN:1234567890\n01.09.2026\nFIS NO:1\nTOPLAM *830,00\nTOPKDV +75,45',use_vendor_hints=False)
        self.assertTrue(d['vat_inferred'])
        self.assertEqual(d['kalemler'][0]['oran'],'10.00')

    def test_printed_tax_with_plus_checks_conflict(self):
        d=draft('TEST LTD\nVKN:1234567890\n01.09.2026\nFIS NO:1\nURUN %20 *780,00\nTOPLAM *780,00\nTOPKDV +116,67',use_vendor_hints=False)
        with self.assertRaisesRegex(ValueError,'basılı toplam KDV'):validate(d)

    def test_regional_replacement_keeps_disagreement_visible(self):
        from PIL import Image
        from ocr_recovery import recover
        from review import warnings
        text='TEST LTD\nVKN:1234567890\n01.09.2026\nFIS NO:2\nURUN %20 *780,00\nTOPLAM *780,00\nTOPKDV *116,67'
        regional='01.09.2026\nFIS NO:1\nURUN %20 *700,00\nTOPLAM *700,00\nTOPKDV *116,67'
        result=recover(Image.new('RGB',(100,400)),text,lambda im:regional)
        d=draft(result,use_vendor_hints=False)
        self.assertEqual(d['toplam'],'700.00')
        self.assertEqual(d['evrak_no'],'1')
        self.assertEqual(len(warnings(d)),2)
