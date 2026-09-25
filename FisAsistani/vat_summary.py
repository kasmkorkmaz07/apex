"""Seçili ayın gider KDV'si; liste aramasından ve gelir sekmesinden bağımsız."""
from decimal import Decimal
import json
from core import money, date_value

def monthly_vat(store, client, period):
    result={'approved':Decimal('0.00'),'pending':Decimal('0.00'),'unread':0}
    for payload,approved,saved_period in store.db.execute(
        'SELECT data,approved,period FROM receipts WHERE client=? AND (period=? OR period IS NULL OR period=?)',
        (client,period,'')):
        d=json.loads(payload)
        if d.get('kind','gider')!='gider':continue
        if not saved_period:
            try:
                if date_value(d.get('tarih','')).strftime('%m-%Y')!=period:continue
            except ValueError:continue
        try:
            lines=d.get('kalemler',[])
            if not lines:raise ValueError('KDV okunmamış')
            amount=sum((money(line['kdv']) for line in lines),Decimal('0.00'))
        except (ValueError,KeyError,TypeError):
            result['unread']+=1;continue
        result['approved' if approved else 'pending']+=amount
    result['total']=result['approved']+result['pending']
    return result

def display(amount):
    return f'{amount:,.2f}'.replace(',','_').replace('.',',').replace('_','.')+' TL'

def summary_text(result,period):
    text=(f'{period} • Gider KDV toplamı: {display(result["total"])}'
          f'    |    Onaylı: {display(result["approved"])}'
          f'    |    Kontrol bekleyen: {display(result["pending"])}')
    if result['unread']:text+=f'    |    KDV okunamayan {result["unread"]} kayıt toplama dahil değil.'
    return text
