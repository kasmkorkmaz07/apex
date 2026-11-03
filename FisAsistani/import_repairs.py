"""Narrow, audited repair of the six-decimal QR parsing bug in unapproved drafts."""
import json,re
from decimal import Decimal,ROUND_HALF_UP,InvalidOperation

def repair_qr_decimals(db):
    db.execute('CREATE TABLE IF NOT EXISTS import_repairs(receipt_id INTEGER,reason TEXT,original TEXT,repaired TEXT,PRIMARY KEY(receipt_id,reason))')
    with db:
        for rid,raw in db.execute('SELECT id,data FROM receipts WHERE approved=0 AND exported=0').fetchall():
            try:
                d=json.loads(raw);q=json.loads(d.get('qr_raw') or '{}')
                if not isinstance(q,dict) or q.get('no')!=d.get('evrak_no'):continue
                if str(q.get('tip','SATIS')).upper() not in ('SATIS','ISTISNA'):continue
                total=Decimal(str(d.get('toplam') or 0));old_tax=sum(Decimal(str(l['kdv'])) for l in d.get('kalemler',[]))
                if total<=0 or old_tax<=total*100:continue
                def dec(v):
                    s=str(v).strip()
                    if not re.fullmatch(r'\d+(?:\.\d+)?',s):raise ValueError('Not an unambiguous QR decimal')
                    return Decimal(s).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
                if dec(q.get('odenecek',q.get('vergidahil')))!=total:continue
                groups={};has_long=False
                for key,value in q.items():
                    m=re.fullmatch(r'(kdvmatrah|hesaplanankdv)\((\d+(?:\.\d+)?)\)',key.lower())
                    if not m:continue
                    rate=Decimal(m[2])
                    if rate not in (0,1,8,10,18,20):raise ValueError('Unknown rate')
                    has_long|=bool(re.fullmatch(r'\d+\.\d{4,}',str(value).strip()))
                    groups.setdefault(rate,{})[m[1]]=dec(value)
                if not groups or not has_long:continue
                rows=[]
                for rate,g in groups.items():
                    base,tax=g['kdvmatrah'],g['hesaplanankdv']
                    if abs(base*rate/100-tax)>Decimal('.03'):raise ValueError('Tax mismatch')
                    rows.append(dict(oran=str(rate),matrah=str(base),kdv=str(tax)))
                if sum(Decimal(l['matrah'])+Decimal(l['kdv']) for l in rows)!=total:continue
                d['kalemler']=rows;d['qr_warnings']=[];d['amount_repaired']='qr-decimals-1.0.144';updated=json.dumps(d,ensure_ascii=False)
                db.execute('INSERT OR IGNORE INTO import_repairs VALUES (?,?,?,?)',(rid,'qr-decimals-1.0.144',raw,updated))
                db.execute('UPDATE receipts SET data=? WHERE id=? AND approved=0 AND exported=0',(updated,rid))
            except (ValueError,TypeError,KeyError,InvalidOperation):continue
