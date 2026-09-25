import unittest
from invoices import parse
from reanalysis import merge
from test_invoices import TEXT

class PartyTests(unittest.TestCase):
 def test_same_line_invoice_metadata(self):
  t=TEXT.replace('SAYIN\nADYA MÜHENDİSLİK SANAYİ VE TİCARET LİMİTED ŞİRKETİ\nVKN:0080795489','SAYIN Fatura Tipi: SATIS\nAHMET YAKAN Fatura No: GIB2026000000003\nyureğir / ADANA / TÜRKİYE Fatura Tarihi:29-06-2026\nTCKN:17065236022')
  d=parse(t,'gelir')
  self.assertEqual((d['aciklama'],d['vkn']),('AHMET YAKAN','17065236022'))
 def test_reanalysis_cannot_restore_old_seller_as_buyer(self):
  old=parse(TEXT,'gider');old['kind']='gelir';old.pop('invoice_party')
  new=parse(TEXT.replace('VKN:0080795489',''),'gelir')
  self.assertEqual(merge(old,new)['vkn'],'')
 def test_print_header_is_not_seller(self):
  self.assertEqual(parse('17.09.2026 14:48 e-Belge\n'+TEXT,'gider')['aciklama'],'MUSTAFA ÇETİNER')
