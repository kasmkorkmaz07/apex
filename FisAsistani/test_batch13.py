import unittest
from core import draft
class TitleTests(unittest.TestCase):
 def test_complete_multiline_title(self):
  text='ÖZ ÖZCANLAR PET. ÜRN. OTO.\nTİC. VE SAN. LTD. ŞTİ.\nYUKARI MÜCAVİR MEVKİİ KÖY\nSOK. NO:76-1 SİNOP\nVN:6620796147\n15.06.2026 FIS NO:68\nTOPLAM 2600,00\nTOPKDV 433,33'
  self.assertEqual(draft(text,use_vendor_hints=False)['aciklama'],'ÖZ ÖZCANLAR PET. ÜRN. OTO. TİC. VE SAN. LTD. ŞTİ.')
 def test_city_in_company_name_is_not_address(self):
  text='SEYHAN AKARYAKIT\nTAŞ. İNŞ. TURZ. SAN. VE TİC. LTD. ŞTİ.\nHUZUREVLERİ MAH.\nVKN:7660524136'
  self.assertTrue(draft(text,use_vendor_hints=False)['aciklama'].startswith('SEYHAN AKARYAKIT TAŞ.'))
