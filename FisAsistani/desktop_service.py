"""Local desktop adapter. JSON over inherited pipes; no listening TCP port."""
import sys,json,pathlib,sqlite3,uuid,hashlib,base64,datetime,re,mimetypes,os
from decimal import Decimal
from urllib.parse import urlsplit,parse_qs
from core import Store,vat_records,validate,identity,actual_period,posting_period,storage_identity
from accounting import profile,save_profile,apply_defaults,resolve

class DesktopService:
 def __init__(self,home):
  self.home=pathlib.Path(home);self.home.mkdir(parents=True,exist_ok=True)
  self.store=Store(self.home/'kayitlar.sqlite3');self.db=self.store.db
  self.db.executescript('CREATE TABLE IF NOT EXISTS desktop_documents(id TEXT PRIMARY KEY,receipt_id INTEGER UNIQUE);CREATE TABLE IF NOT EXISTS desktop_trash(id TEXT PRIMARY KEY,payload TEXT NOT NULL,document TEXT NOT NULL);CREATE TABLE IF NOT EXISTS desktop_outbox(id TEXT PRIMARY KEY,operation TEXT NOT NULL,revision INTEGER);')
 def close(self):self.db.close()
 def configuration(self,name,default=None):
  try:return json.loads((self.home/name).read_text(encoding='utf-8-sig'))
  except (OSError,ValueError):return default or {}
 def config_write(self,name,value):
  p=self.home/name;tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8');tmp.replace(p)
 def groups(self):
  groups={}
  for row in self.db.execute('SELECT id,client,image,data,approved,exported,period,hash,identity FROM receipts ORDER BY id'):
   rid,cid,image,raw,approved,exported,period,digest,ident=row;d=json.loads(raw)
   key=(cid,image or 'manual:'+str(rid),d.get('kind','gider'))
   groups.setdefault(key,[]).append(dict(id=rid,client=cid,image=image,data=d,approved=approved,exported=exported,period=period,hash=digest,identity=ident))
  return list(groups.values())
 def document(self,rows):
  first=rows[0];d=dict(first['data'])
  if len(rows)>1:
   d['kalemler']=[line for row in rows for line in row['data'].get('kalemler',[])]
   d['toplam']=str(sum(Decimal(str(r['data'].get('toplam') or 0)) for r in rows));d.pop('vat_partition',None)
  key=self.db.execute('SELECT id FROM desktop_documents WHERE receipt_id=?',(first['id'],)).fetchone()
  if not key:
   key=(str(uuid.uuid4()),)
   with self.db:self.db.execute('INSERT INTO desktop_documents VALUES (?,?)',(key[0],first['id']))
  rev=int(hashlib.sha256(json.dumps(rows,sort_keys=True,ensure_ascii=False).encode()).hexdigest()[:12],16)
  period=first['period'];period=(period[3:]+'-'+period[:2]) if period and re.fullmatch(r'\d{2}-\d{4}',period) else d.get('period','')
  d['kind']=d.get('kind','gider');d.setdefault('selected_period',period);d['period']=period
  if all(r['approved'] for r in rows):d['review_ack']=True
  return dict(id=key[0],client=str(first['client']),kind=d['kind'],data=d,state='approved' if all(r['approved'] for r in rows) else 'draft',revision=rev,mime=mimetypes.guess_type(first['image'] or '')[0] or 'image/jpeg',created=str(first['id']).zfill(14),updated='',deleted=False,period=period,desktop=True,exported=any(r['exported'] for r in rows))
 def find(self,id):
  row=self.db.execute('SELECT r.id,r.client,r.image,r.data FROM receipts r JOIN desktop_documents d ON d.receipt_id=r.id WHERE d.id=?',(id,)).fetchone()
  if not row:return None
  rid,cid,image,raw=row;kind=json.loads(raw).get('kind','gider')
  candidates=self.db.execute('SELECT id,client,image,data,approved,exported,period,hash,identity FROM receipts WHERE client=? AND image=? ORDER BY id',(cid,image)).fetchall() if image else self.db.execute('SELECT id,client,image,data,approved,exported,period,hash,identity FROM receipts WHERE id=?',(rid,)).fetchall()
  names=('id','client','image','data','approved','exported','period','hash','identity');result=[]
  for values in candidates:
   item=dict(zip(names,values));item['data']=json.loads(item['data'])
   if item['data'].get('kind','gider')==kind:result.append(item)
  return result
 def delete_many(self,body):
  items=body.get('items',[])
  if not isinstance(items,list) or len(items)>10000:raise ValueError('Geçersiz belge listesi.')
  scope=body.get('scope');deleted=[];errors=[];months=set();warnings=[]
  with self.db:
   for item in items:
    id=item['id'];rows=self.find(id)
    if not rows:
     if self.db.execute('SELECT 1 FROM desktop_trash WHERE id=?',(id,)).fetchone():deleted.append(id)
     else:errors.append({'id':id,'error':'Belge bulunamadı.'})
     continue
    doc=self.document(rows)
    if scope and (doc['client']!=str(scope.get('client')) or doc['period']!=scope.get('period') or doc['kind']!=scope.get('kind')):
     errors.append({'id':id,'error':'Belge seçilen ay veya mükellefte değil.'});continue
    if doc['revision']!=item.get('revision'):
     errors.append({'id':id,'error':'Belge değişmiş; güncel kaydı kontrol edin.'});continue
    if doc['exported']:
     errors.append({'id':id,'error':'Excel’e aktarılan kayıt kilitli.'});continue
    doc['deleted']=True
    months.update((row['client'],row['period']) for row in rows if row['period'])
    self.db.execute('INSERT OR REPLACE INTO desktop_trash VALUES (?,?,?)',(id,json.dumps(rows,ensure_ascii=False),json.dumps(doc,ensure_ascii=False)))
    remoteid=rows[0]['data'].get('_cep_id')
    if remoteid:
     link=self.db.execute('SELECT revision FROM cep_documents WHERE remote_id=?',(remoteid,)).fetchone()
     if link:self.db.execute('INSERT OR REPLACE INTO desktop_outbox VALUES (?,?,?)',(remoteid,'delete',link[0]))
    self.db.executemany('DELETE FROM receipts WHERE id=?',[(r['id'],) for r in rows])
    self.db.execute('DELETE FROM desktop_documents WHERE id=?',(id,));deleted.append(id)
  for cid,period in months:
   try:self.store.sync_month(cid,period)
   except Exception as e:warnings.append('Belgeler silindi; aylık Excel güncellenemedi: '+str(e))
  return {'deleted':deleted,'errors':errors,'warnings':warnings}
 def catalog(self):
  return {'clients':[{'id':str(cid),'name':name,'profile':profile(self.store,cid),'revision':1} for cid,name in self.store.clients()], 'vendors':[{'vkn':v,'name':n} for v,n in self.store.vendor_rows()]}
 def save_group(self,rows,d,state,new_image=None):
  if any(r['exported'] for r in rows):raise ValueError('Excel’e aktarılan kayıt kilitli; mevcut kayıt değiştirilmedi.')
  cid=rows[0]['client'];d=apply_defaults(self.store,cid,dict(d));d['kind']=d.get('kind','gider');approve=state=='approved'
  if d.get('is_z_report'):d['vkn']='';d['aciklama']='Z RAPORU'
  for k in ('_cep_id',):
   if rows[0]['data'].get(k):d[k]=rows[0]['data'][k]
  selected=d.get('selected_period') or d.get('period','')
  selected=selected[5:]+'-'+selected[:4] if re.fullmatch(r'\d{4}-\d{2}',selected) else rows[0]['period']
  period=actual_period(d,selected);d=posting_period(d,period) if period and d.get('evrak_tarihi') else d
  if approve:
   d['review_ack']=True;validate(d)
   p=profile(self.store,cid)
   if p['mode']=='genel':
    for line in d['kalemler']:resolve(d,p,line['oran'])
  parts=vat_records(d);ids={r['id'] for r in rows}
  with self.db:
   for i,part in enumerate(parts):
    key=storage_identity(part) if approve else None
    if approve:
     for oid,raw in self.db.execute('SELECT id,data FROM receipts WHERE client=? AND approved=1',(cid,)):
      if oid in ids:continue
      other=json.loads(raw)
      if identity(dict(other,vat_partition=None))==identity(dict(part,vat_partition=None)) and {Decimal(str(x['oran'])) for x in other.get('kalemler',[])} & {Decimal(str(x['oran'])) for x in part.get('kalemler',[])}:raise ValueError('Bu belge ve KDV oranı zaten onaylı; ikinci kayıt eklenmedi.')
    raw=json.dumps(part,ensure_ascii=False)
    if i<len(rows):self.db.execute('UPDATE receipts SET data=?,approved=?,identity=?,period=?,image=? WHERE id=?',(raw,int(approve),key,period,str(new_image) if new_image else rows[i]['image'],rows[i]['id']))
    else:self.db.execute('INSERT INTO receipts(client,image,data,approved,identity,period) VALUES (?,?,?,?,?,?)',(cid,str(new_image) if new_image else rows[0]['image'],raw,int(approve),key,period))
   if new_image:self.db.execute('UPDATE receipts SET hash=? WHERE id=?',(hashlib.sha256(pathlib.Path(new_image).read_bytes()).hexdigest(),rows[0]['id']))
   for old in rows[len(parts):]:self.db.execute('DELETE FROM receipts WHERE id=?',(old['id'],))
   if approve and d.get('vkn') and d.get('kind')!='gelir' and not d.get('custom_description'):
    self.db.execute('INSERT OR REPLACE INTO vendors VALUES (?,?)',(d['vkn'],d['aciklama']));self.store.learn_vendor(d)
  warning=None
  if approve and period:
   try:
    for old_period in {row['period'] for row in rows if row['period'] and row['period']!=period}:self.store.sync_month(cid,old_period)
    self.store.sync_month(cid,period)
   except Exception:warning='Kayıt kaydedildi; aylık Excel güncellenemedi. Excel dosyasını kapatıp yeniden dışa aktarın.'
  return warning
 def image(self,rows):
  p=pathlib.Path(rows[0]['image'])
  if not rows[0]['image'] or not p.is_file():return {'base64':'','mime':'image/png'}
  return {'base64':base64.b64encode(p.read_bytes()).decode(),'mime':mimetypes.guess_type(str(p))[0] or 'image/jpeg'}
 def add_image(self,body):
  raw=base64.b64decode(body.get('imageBase64',''),validate=True)
  if not raw or len(raw)>25*1024*1024:raise ValueError('Görsel 25 MB sınırını aşıyor veya boş.')
  from PIL import Image
  import io
  with Image.open(io.BytesIO(raw)) as im:
   if im.width*im.height>40000000:raise ValueError('Görsel çok büyük.')
   ext='.png' if im.format=='PNG' else '.jpg'
   folder=self.home/'fotograflar'/'masaustu';folder.mkdir(parents=True,exist_ok=True)
   p=folder/(str(uuid.uuid4())+ext)
   if ext=='.png':im.save(p,'PNG')
   else:im.convert('RGB').save(p,'JPEG',quality=95)
  return p
 def request(self,path,method='GET',body=None):
  body=body or {};url=urlsplit(path);path=url.path;query=parse_qs(url.query)
  if path=='/desktop/bootstrap':return {'catalog':self.catalog(),'preferences':self.configuration('desktop-preferences.json'),'connection':self.configuration('cep-baglanti.json'),'version':'1.0.130'}
  if path=='/desktop/preferences':
   allowed={k:body[k] for k in ('theme','ai_key','ai_mode','ai_model','qr_profile') if k in body};v=self.configuration('desktop-preferences.json');v.update(allowed);self.config_write('desktop-preferences.json',v);return {'ok':True}
  if path=='/desktop/connection':
   u=urlsplit(body.get('url',''))
   if u.scheme!='https' or not u.netloc or u.username or u.path not in ('','/'):raise ValueError('Geçerli HTTPS ofis adresi gerekli.')
   token=body.get('token','')
   if len(token)<32:raise ValueError('Bağlantı anahtarı eksik.')
   v={'url':u.scheme+'://'+u.netloc,'token':token,'device':self.configuration('cep-baglanti.json').get('device') or 'desktop-'+str(uuid.uuid4())}
   from cep_sync import Api
   Api(v).request('/api/catalog');self.config_write('cep-baglanti.json',v);return {'ok':True}
  if path=='/desktop/cloud-sync':
   from cep_sync import Bridge
   c=self.configuration('cep-baglanti.json')
   if not c.get('url') or not c.get('token'):raise ValueError('Ofis bağlantısı ayarlardan tanımlanmalı.')
   b=Bridge(self.home,c)
   try:
    from concurrent.futures import ThreadPoolExecutor
    pending=self.db.execute('SELECT id,operation,revision FROM desktop_outbox').fetchall()
    with self.db:self.db.execute("UPDATE desktop_outbox SET operation='deleting'")
    def erase(item):
     id,operation,revision=item
     try:
      remote=b.api.request('/api/documents/'+id)
      if remote.get('deleted'):return id,None,None
      if remote['revision']!=revision:raise ValueError('Belge telefonda değişmiş; silme bekletildi.')
      if remote['state']=='approved':
       result=b.api.request('/api/documents/'+id,{'revision':revision,'state':'draft','data':remote['data']},method='PATCH');revision=result['revision']
      b.api.request('/api/documents/'+id,{'revision':revision},method='DELETE')
      return id,None,None
     except Exception as e:return id,revision,str(e)
    deletion_errors=[]
    with ThreadPoolExecutor(max_workers=4) as pool:
     for id,revision,error in pool.map(erase,pending):
      with self.db:
       if error:
        self.db.execute("UPDATE desktop_outbox SET revision=?,operation='delete' WHERE id=?",(revision,id));deletion_errors.append(id+': '+error)
       else:self.db.execute('DELETE FROM desktop_outbox WHERE id=?',(id,))
    result=b.cycle();details=list(getattr(b,'error_details',[]))
    for error in deletion_errors:
     remote_id=error.split(': ',1)[0]
     for payload,document in self.db.execute('SELECT payload,document FROM desktop_trash'):
      rows=json.loads(payload)
      if rows and rows[0]['data'].get('_cep_id')==remote_id:
       doc=json.loads(document);data=doc['data'];details.append({'error':error,'message':error.split(': ',1)[-1],'remoteId':remote_id,'localId':doc['id'],'title':data.get('aciklama',''),'date':data.get('evrak_tarihi',''),'number':data.get('evrak_no',''),'total':data.get('toplam','')});break
    return {'ok':True,'result':result,'errors':deletion_errors+b.errors,'errorDetails':details}
   finally:b.close()
  if path=='/desktop/sync-document':
   from cep_sync import Api
   id=str(body.get('id',''))
   if not re.fullmatch(r'[A-Za-z0-9-]+',id):raise ValueError('Belge numarası geçersiz.')
   api=Api(self.configuration('cep-baglanti.json'));doc=api.request('/api/documents/'+id)
   result={'document':doc}
   try:result['imageBase64']=base64.b64encode(api.request('/api/documents/'+id+'/image')).decode()
   except Exception:result['imageError']='Fotoğraf yüklenemedi; belge bilgileri gösteriliyor.'
   return result
  if path=='/desktop/export':
   cid=int(body['client']);period=body['period'];period=period[5:]+'-'+period[:4] if re.fullmatch(r'\d{4}-\d{2}',period) else period
   name=dict(self.store.clients()).get(cid)
   if not name:raise ValueError('Mükellef bulunamadı.')
   root=pathlib.Path(self.configuration('export-root.json').get('root',str(self.home/'excel')))
   filename=re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',name)+'.xlsx'
   p=self.store.sync_month(cid,period,body.get('path') or root/period/filename)
   return {'path':str(p),'records':len(self.store.monthly_records(cid,period))}
  if path=='/api/catalog':return self.catalog()
  if path=='/api/vendors' and method=='POST':
   vkn=str(body.get('vkn',''));name=body.get('name','').strip()
   if self.db.execute('SELECT 1 FROM vendors WHERE vkn=?',(vkn,)).fetchone():self.store.update_vendor(vkn,vkn,name)
   else:self.store.add_vendor(vkn,name)
   return {'vkn':vkn,'name':name}
  if path.startswith('/api/clients'):
   if method=='POST':cid=self.store.client(body['name'])
   elif method=='PATCH':cid=int(path.rsplit('/',1)[1]);self.store.rename_client(cid,body['name'])
   else:raise ValueError('Desteklenmeyen mükellef işlemi.')
   save_profile(self.store,cid,body.get('profile',{}));return {'id':str(cid),'revision':1}
  if path=='/api/documents' and method=='GET':
   docs=[self.document(g) for g in self.groups()]
   docs += [json.loads(r[0]) for r in self.db.execute('SELECT document FROM desktop_trash')]
   start=int(query.get('offset',['0'])[0]);end=start+200
   return {'items':docs[start:end],'next':end if end<len(docs) else None}
  if path=='/api/documents' and method=='POST':
   doc=body['document'];id=doc['id'];rows=self.find(id)
   if rows:return {'id':id,'revision':self.document(rows)['revision'],'duplicate':True}
   cid=int(doc['client'])
   if not self.db.execute('SELECT 1 FROM clients WHERE id=?',(cid,)).fetchone():raise ValueError('Mükellef bulunamadı.')
   p=self.add_image(body);digest=hashlib.sha256(p.read_bytes()).hexdigest()
   duplicate=self.db.execute('SELECT id FROM receipts WHERE client=? AND hash=?',(cid,digest)).fetchone()
   if duplicate:
    for g in self.groups():
     if any(r['id']==duplicate[0] for r in g):d=self.document(g);return {'id':d['id'],'revision':d['revision'],'duplicate':True}
   data=dict(doc['data'],kind=doc['kind']);period=data.get('selected_period') or data.get('period','')
   period=period[5:]+'-'+period[:4] if re.fullmatch(r'\d{4}-\d{2}',period) else datetime.datetime.now().strftime('%m-%Y')
   rid=self.store.add(cid,p,data,period)
   with self.db:self.db.execute('INSERT INTO desktop_documents VALUES (?,?)',(id,rid))
   return {'id':id,'revision':self.document(self.find(id))['revision'],'duplicate':False}
  if path=='/api/documents/delete-batch' and method=='POST':return self.delete_many(body)
  if path=='/api/documents/purge':
   skipped=[]
   for id in body.get('ids',[]):
    if not self.db.execute('SELECT 1 FROM desktop_trash WHERE id=?',(id,)).fetchone():skipped.append(id);continue
    with self.db:self.db.execute('DELETE FROM desktop_trash WHERE id=?',(id,))
   return {'skipped':skipped}
  m=re.fullmatch(r'/api/documents/([A-Za-z0-9-]+)(/image|/restore|/delivery)?',path)
  if m:
   id,action=m.groups();rows=self.find(id)
   if action=='/restore':
    saved=self.db.execute('SELECT payload FROM desktop_trash WHERE id=?',(id,)).fetchone()
    if not saved:raise ValueError('Silinen kayıt bulunamadı.')
    old=json.loads(saved[0])
    remoteid=old[0]['data'].get('_cep_id')
    if remoteid:
     pending=self.db.execute('SELECT operation FROM desktop_outbox WHERE id=?',(remoteid,)).fetchone()
     if pending and pending[0]=='deleting':raise ValueError('Silme eşitleniyor; tamamlandıktan sonra geri yükleyin.')
    with self.db:
     for r in old:
      rid=None if self.db.execute('SELECT 1 FROM receipts WHERE id=?',(r['id'],)).fetchone() else r['id']
      r['id']=self.db.execute('INSERT INTO receipts(id,client,image,data,approved,exported,period,hash,identity) VALUES (?,?,?,?,?,?,?,?,?)',(rid,r['client'],r['image'],json.dumps(r['data'],ensure_ascii=False),r['approved'],r['exported'],r['period'],r.get('hash'),r.get('identity'))).lastrowid
     self.db.execute('INSERT OR REPLACE INTO desktop_documents VALUES (?,?)',(id,old[0]['id']))
     remoteid=old[0]['data'].get('_cep_id')
     if remoteid:
      pending=self.db.execute('SELECT 1 FROM desktop_outbox WHERE id=?',(remoteid,)).fetchone()
      if pending:self.db.execute('DELETE FROM desktop_outbox WHERE id=?',(remoteid,))
      else:
       for r in old:
        data=dict(r['data']);data.pop('_cep_id',None)
        self.db.execute('UPDATE receipts SET data=? WHERE id=?',(json.dumps(data,ensure_ascii=False),r['id']))
     self.db.execute('DELETE FROM desktop_trash WHERE id=?',(id,))
    return {'id':id,'revision':self.document(self.find(id))['revision'],'deleted':False}
   if not rows:
    saved=self.db.execute('SELECT payload,document FROM desktop_trash WHERE id=?',(id,)).fetchone()
    if saved and method=='GET':return self.image(json.loads(saved[0])) if action=='/image' else json.loads(saved[1])
    raise ValueError('Belge bulunamadı.')
   doc=self.document(rows)
   if method=='GET':return self.image(rows) if action=='/image' else doc
   if action=='/delivery':return {'ok':True}
   if body.get('revision')!=doc['revision']:raise ValueError('Belge başka pencerede değişti; yenileyip tekrar deneyin.')
   if method=='PATCH':
    changed_image=None
    if body.get('imageBase64'):
     if any(r['approved'] or r['exported'] for r in rows):raise ValueError('Görüntüyü değiştirmek için önce belgeyi taslağa alın.')
     if rows[0]['data'].get('_cep_id'):raise ValueError('Telefonla eşitlenen görüntü korunuyor. Düzenlenmiş görüntüyü yeni belge olarak yükleyin.')
     changed_image=self.add_image(body)
     body['data']=dict(body['data'],original_image=rows[0]['data'].get('original_image') or rows[0]['image'],image_edited=True)
    warning=self.save_group(rows,body['data'],body.get('state','draft'),changed_image);result=self.document(self.find(id));return {'id':id,'revision':result['revision'],'warning':warning}
   if method=='DELETE':
    if any(r['exported'] for r in rows):raise ValueError('Excel’e aktarılan kayıt silinemez.')
    doc['deleted']=True
    with self.db:
     self.db.execute('INSERT OR REPLACE INTO desktop_trash VALUES (?,?,?)',(id,json.dumps(rows,ensure_ascii=False),json.dumps(doc,ensure_ascii=False)))
     remoteid=rows[0]['data'].get('_cep_id')
     if remoteid:
      link=self.db.execute('SELECT revision FROM cep_documents WHERE remote_id=?',(remoteid,)).fetchone()
      if link:self.db.execute('INSERT OR REPLACE INTO desktop_outbox VALUES (?,?,?)',(remoteid,'delete',link[0]))
     for r in rows:self.db.execute('DELETE FROM receipts WHERE id=?',(r['id'],))
     self.db.execute('DELETE FROM desktop_documents WHERE id=?',(id,))
    return {'id':id,'revision':doc['revision'],'deleted':True}
  raise ValueError('Desteklenmeyen yerel işlem: '+path)

def ocr_files(paths,folder):
 from import_documents import document_images
 from ocr_local import read_image
 from PIL import Image,ImageOps
 from qr_oku import oku_qr
 notes=[];items=[]
 for p,label in document_images(paths,folder,notes.append):
  try:
   with Image.open(p) as im:
    im=ImageOps.exif_transpose(im).convert('RGB')
    try:qr=oku_qr(im)
    except Exception:qr=[]
    im.thumbnail((3600,10000));target=p.with_suffix('.jpg');im.save(target,'JPEG',quality=93)
   invoice_qr=any('kdvmatrah' in q.lower() and ('odenecek' in q.lower() or 'vergidahil' in q.lower()) for q in qr)
   text='' if invoice_qr else read_image(target)
   items.append({'filename':target.name,'base64':base64.b64encode(target.read_bytes()).decode(),'text':text,'qr':qr if isinstance(qr,list) else [qr] if qr else [],'source':label})
  except Exception as e:notes.append(label+': '+type(e).__name__)
 return {'items':items,'notes':notes}

if __name__=='__main__':
 home=pathlib.Path(sys.argv[1]);service=None
 for line in sys.stdin:
  try:
   req=json.loads(line)
   if req.get('command')=='ocr':
    result=ocr_files(req['paths'],home/'fotograflar'/'okuma')
   else:
    if service is None:service=DesktopService(home)
    result=service.request(req['path'],req.get('method','GET'),req.get('body'))
   print(json.dumps({'id':req['id'],'result':result},ensure_ascii=False),flush=True)
  except Exception as e:print(json.dumps({'id':req.get('id'),'error':str(e)},ensure_ascii=False),flush=True)
 if service:service.close()
