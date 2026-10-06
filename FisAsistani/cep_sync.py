"""Fiş Asistanı Cep: ayrı SQLite bağlantısıyla, sürüm kontrollü aktarım.
Canlı uygulamaya kurulmadan önce test veritabanıyla çalıştırılmalıdır.
"""
import json,hashlib,uuid,sqlite3,time,threading,urllib.request,urllib.error,mimetypes
from pathlib import Path
from datetime import datetime
from decimal import Decimal

def digest(data):
    return hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def clean(data):
    return {k:v for k,v in data.items() if not k.startswith('_cep') and k not in ('vendor_source','ocr_identity')}
class Api:
    def __init__(self,config):self.url=config['url'].rstrip('/');self.token=config['token']
    def request(self,path,payload=None,method=None,raw=None,content_type=None):
        body=raw if raw is not None else json.dumps(payload,ensure_ascii=False).encode() if payload is not None else None
        req=urllib.request.Request(self.url+path,data=body,method=method or ('POST' if body is not None else 'GET'),headers={'User-Agent':'ApexFisAsistani/0.1 (Windows desktop sync)','Authorization':'Bearer '+self.token,**({'Content-Type':content_type or 'application/json'} if body is not None else {})})
        try:
            with urllib.request.urlopen(req,timeout=50) as r:
                content=r.read()
                return json.loads(content) if 'json' in r.headers.get('Content-Type','') else content
        except urllib.error.HTTPError as e:
            try:message=json.loads(e.read()).get('error',str(e))
            except Exception:message=str(e)
            raise RuntimeError(message) from None
    def upload(self,doc,image):
        boundary='cep'+uuid.uuid4().hex;mime=mimetypes.guess_type(str(image))[0] or 'image/jpeg'
        image_bytes=Path(image).read_bytes()
        if len(image_bytes)>10*1024*1024:raise ValueError('Fotoğraf/PDF 10 MB sınırını aşıyor.')
        body=(f'--{boundary}\r\nContent-Disposition: form-data; name="document"\r\n\r\n'.encode()+json.dumps(doc,ensure_ascii=False).encode()+f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="document{Path(image).suffix}"\r\nContent-Type: {mime}\r\n\r\n'.encode()+image_bytes+f'\r\n--{boundary}--\r\n'.encode())
        return self.request('/api/documents',raw=body,content_type='multipart/form-data; boundary='+boundary)
class Bridge:
    def __init__(self,home,config,api=None):
        from core import Store
        self.home=Path(home);self.config=config;self.api=api or Api(config);self.store=Store(self.home/'kayitlar.sqlite3');self.db=self.store.db
        self.db.executescript('CREATE TABLE IF NOT EXISTS cep_clients(local_id INTEGER PRIMARY KEY,remote_id TEXT UNIQUE NOT NULL); CREATE TABLE IF NOT EXISTS cep_documents(remote_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,fingerprint TEXT NOT NULL);')
        self.errors=[]
        self.db.execute('CREATE TABLE IF NOT EXISTS cep_deleted_archive(remote_id TEXT PRIMARY KEY,payload TEXT NOT NULL)')
    def close(self):self.db.close()
    def catalog(self):
        from accounting import profile,save_profile
        remote=self.api.request('/api/catalog');names={c['name'].strip().casefold():c for c in remote['clients']};new=[]
        for cid,name in self.store.clients():
            found=self.db.execute('SELECT remote_id FROM cep_clients WHERE local_id=?',(cid,)).fetchone()
            if found:rid=found[0]
            else:
                rid=names.get(name.strip().casefold(),{}).get('id') or str(uuid.uuid4())
                with self.db:self.db.execute('INSERT INTO cep_clients VALUES (?,?)',(cid,rid))
            if not any(x['id']==rid for x in remote['clients']):new.append({'id':rid,'name':name,'profile':profile(self.store,cid)})
        vendors=[{'vkn':v,'name':n} for v,n in self.store.vendor_rows()]
        if new or vendors:self.api.request('/api/catalog',{'clients':new,'vendors':vendors})
        self.db.execute('CREATE TABLE IF NOT EXISTS cep_profile_sync(remote_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL)')
        for c in remote['clients']:
            row=self.db.execute('SELECT local_id FROM cep_clients WHERE remote_id=?',(c['id'],)).fetchone()
            rp=c.get('profile') or {'mode':'isletme'}
            if row is None:
                cid=self.store.client(c['name']);save_profile(self.store,cid,rp)
                with self.db:self.db.execute('INSERT OR IGNORE INTO cep_clients VALUES (?,?)',(cid,c['id']))
                localp=profile(self.store,cid)
                with self.db:self.db.execute('INSERT OR REPLACE INTO cep_profile_sync VALUES (?,?)',(c['id'],digest({'name':c['name'],'profile':localp})))
                continue
            cid=row[0];name=self.db.execute('SELECT name FROM clients WHERE id=?',(cid,)).fetchone()[0];lp=profile(self.store,cid)
            normalized=dict(rp)
            for k,v in {'income_code':'ML','income_closing':'','income_rates':{},'descriptions':['Z RAPORU','PERAKENDE SATIŞ FİŞİ','GİDER PUSULASI'],'income_description':'Z RAPORU','closing':'','rates':{}}.items():normalized.setdefault(k,v)
            lh=digest({'name':name,'profile':lp});rh=digest({'name':c['name'],'profile':normalized})
            prev=self.db.execute('SELECT fingerprint FROM cep_profile_sync WHERE remote_id=?',(c['id'],)).fetchone()
            base=prev[0] if prev else None
            if lh!=rh:
                if base and lh!=base and rh!=base:
                    self.errors.append(name+': hesap ayarları iki cihazda değişmiş; üzerine yazılmadı.')
                    continue
                if (base and lh==base) or (not base and c.get('revision',1)>1):
                    save_profile(self.store,cid,normalized)
                    with self.db:self.db.execute('UPDATE clients SET name=? WHERE id=?',(c['name'],cid))
                    lh=rh
                else:
                    self.api.request('/api/clients/'+c['id'],{'name':name,'profile':lp,'revision':c.get('revision',1)},method='PATCH')
            with self.db:self.db.execute('INSERT OR REPLACE INTO cep_profile_sync VALUES (?,?)',(c['id'],lh))
        with self.db:
            for v in remote['vendors']:self.db.execute('INSERT OR IGNORE INTO vendors VALUES (?,?)',(v['vkn'],v['name']))
    def groups(self):
        groups={}
        for rid,cid,image,payload,approved,exported,period in self.db.execute('SELECT id,client,image,data,approved,exported,period FROM receipts ORDER BY id'):
            d=json.loads(payload);key=(cid,image or 'manual:'+str(rid))
            groups.setdefault(key,[]).append({'id':rid,'client':cid,'image':image,'data':d,'approved':approved,'exported':exported,'period':period})
        return list(groups.values())
    def combine(self,rows):
        d=clean(dict(rows[0]['data']))
        if len(rows)>1:
            d['kalemler']=[x for r in rows for x in r['data'].get('kalemler',[])];d['toplam']=str(sum(Decimal(r['data'].get('toplam','0')) for r in rows));d.pop('vat_partition',None);d.pop('source_receipt_total',None)
        approved=all(r['approved'] for r in rows)
        # Older desktop versions saved the user's approval in the SQLite column,
        # before the mobile review_ack field existed. Preserve that approval.
        if approved:d['review_ack']=True
        return {'data':d,'state':'approved' if approved else 'draft'}
    def link(self,remote_id,revision,rows,state_override=None):
        combined=self.combine(rows)
        if state_override:combined["state"]=state_override
        with self.db:
            for r in rows:
                d=dict(r['data'],_cep_id=remote_id);self.db.execute('UPDATE receipts SET data=? WHERE id=?',(json.dumps(d,ensure_ascii=False),r['id']))
            self.db.execute('INSERT OR REPLACE INTO cep_documents VALUES (?,?,?)',(remote_id,revision,digest(combined)))
    def fetch_all(self):
        items=[];offset=0
        while offset is not None:
            p=self.api.request('/api/documents?offset='+str(offset));items.extend(p['items']);offset=p['next']
        return items
    def delivery(self,remote_id,revision,error=''):
        self.api.request('/api/documents/'+remote_id+'/delivery',{'device':self.config['device'],'revision':revision,'error':error})
    def import_document(self,r,rows):
        from core import validate,vat_records,actual_period,posting_period,identity
        from accounting import apply_defaults,profile,resolve
        cid=self.db.execute('SELECT local_id FROM cep_clients WHERE remote_id=?',(r['client'],)).fetchone()
        if not cid:raise ValueError('Mükellef eşitlemesi eksik.')
        cid=cid[0];d=dict(r['data'],kind=r['kind']);d.setdefault('kod','ML' if r['kind']=='gelir' else 'MS');d['tarih']=d.get('evrak_tarihi','');d=apply_defaults(self.store,cid,d);d['_cep_id']=r['id']
        approve=r['state']=='approved'
        if approve:
            validate(d)
            p=profile(self.store,cid)
            if p['mode']=='genel':
                for line in d['kalemler']:resolve(d,p,line['oran'])
        if any(x['exported'] for x in rows):raise ValueError('Excel’e çıkarılan kayıt kilitli; otomatik üzerine yazılmadı.')
        parts=vat_records(d);period=None
        try:
            selected=d.get('selected_period','')
            period=datetime.strptime(selected,'%Y-%m').strftime('%m-%Y') if selected and r['kind']=='gider' and not d.get('is_z_report') else datetime.strptime(d.get('evrak_tarihi',''),'%d.%m.%Y').strftime('%m-%Y')
        except ValueError:
            if approve:raise
        folder=self.home/'fotograflar'/'cep';folder.mkdir(parents=True,exist_ok=True)
        extension={'application/pdf':'.pdf','image/png':'.png'}.get(r.get('mime'),'.jpg')
        image=Path(rows[0]['image']) if rows else folder/(r['id']+extension)
        if not image.exists():
            body=self.api.request('/api/documents/'+r['id']+'/image')
            if hashlib.sha256(body).hexdigest()!=r['sha256']:raise ValueError('Fotoğraf sağlama değeri uyuşmuyor.')
            image.write_bytes(body)
        existing_ids=[x['id'] for x in rows]
        # Alan değişimleri ile KDV bölümleri aynı SQLite işlemi içinde yazılır.
        with self.db:
            for i,part in enumerate(parts):
                part=posting_period(part,period) if period else part;key=identity(part) if approve else None
                if approve:
                    for oid,payload in self.db.execute('SELECT id,data FROM receipts WHERE client=? AND approved=1',(cid,)):
                        if oid in existing_ids:continue
                        other=json.loads(payload)
                        if identity(dict(other,vat_partition=None))==identity(dict(part,vat_partition=None)) and {x['oran'] for x in other.get('kalemler',[])} & {x['oran'] for x in part.get('kalemler',[])}:raise ValueError('Bu belge zaten onaylı; ikinci kayıt eklenmedi.')
                values=(str(image),r['sha256'] if i==0 else None,json.dumps(part,ensure_ascii=False),int(approve),key,period)
                if i<len(rows):self.db.execute('UPDATE receipts SET image=?,hash=?,data=?,approved=?,identity=?,period=? WHERE id=?',(*values,rows[i]['id']))
                else:self.db.execute('INSERT INTO receipts(image,hash,data,approved,identity,period,client) VALUES(?,?,?,?,?,?,?)',(*values,cid))
            for old in rows[len(parts):]:self.db.execute('DELETE FROM receipts WHERE id=?',(old['id'],))
        new=[x for group in self.groups() for x in group if x['data'].get('_cep_id')==r['id']]
        self.link(r['id'],r['revision'],new)
        if approve and period:
            try:self.store.sync_month(cid,period)
            except Exception as e:raise ValueError('Belge kaydedildi; aylık Excel güncellenemedi: '+str(e)) from e
    def cycle(self):
        self.errors=[];self.catalog();remote={r['id']:r for r in self.fetch_all()};groups=self.groups();mapped={g[0]['data'].get('_cep_id'):g for g in groups if g[0]['data'].get('_cep_id')}
        # Recover the upload/link crash window before treating it as a new remote document.
        for rows in groups:
            if rows[0]['data'].get('_cep_id') or not rows[0]['image'] or not Path(rows[0]['image']).is_file():continue
            cid=self.db.execute('SELECT remote_id FROM cep_clients WHERE local_id=?',(rows[0]['client'],)).fetchone()
            if not cid:continue
            combined=self.combine(rows);kind=combined['data'].get('kind','gider')
            file_hash=hashlib.sha256(Path(rows[0]['image']).read_bytes()).hexdigest()
            rid=str(uuid.uuid5(uuid.NAMESPACE_URL,cid[0]+':'+kind+':'+file_hash))
            if rid in remote and remote[rid]['data']==combined['data']:
                self.link(rid,remote[rid]['revision'],rows,state_override=remote[rid]['state']);mapped[rid]=rows
        for rid,r in remote.items():
            rows=mapped.get(rid,[]);link=self.db.execute('SELECT revision,fingerprint FROM cep_documents WHERE remote_id=?',(rid,)).fetchone()
            try:
                if link and link[0]==r['revision'] and not (r.get('deleted') and rows):continue
                if r.get('deleted'):
                    if any(x['exported'] for x in rows):raise ValueError('Excel’e çıkarılan kayıt kilitli; telefon silme isteği uygulanmadı.')
                    if link and rows and digest(self.combine(rows))!=link[1]:raise ValueError('Kayıt bilgisayarda değişmiş; silinmedi. Önce değişikliği kontrol edin.')
                    with self.db:
                        if rows:self.db.execute('INSERT OR REPLACE INTO cep_deleted_archive VALUES (?,?)',(rid,json.dumps(rows,ensure_ascii=False)))
                        for row in rows:self.db.execute('DELETE FROM receipts WHERE id=?',(row['id'],))
                        self.db.execute('INSERT OR REPLACE INTO cep_documents VALUES (?,?,?)',(rid,r['revision'],digest({'deleted':True})))
                    self.delivery(rid,r['revision']);continue
                if link and rows and digest(self.combine(rows))!=link[1]:raise ValueError('Telefon ve bilgisayar aynı belgeyi değiştirdi; otomatik üzerine yazılmadı.')
                self.import_document(r,rows);self.delivery(rid,r['revision'])
            except Exception as e:
                self.errors.append(rid+': '+str(e));self.delivery(rid,r['revision'],str(e))
        uploaded=0
        for rows in self.groups():
            try:
                rid=rows[0]['data'].get('_cep_id');combined=self.combine(rows);link=self.db.execute('SELECT revision,fingerprint FROM cep_documents WHERE remote_id=?',(rid,)).fetchone() if rid else None
                if link:
                    if digest(combined)==link[1]:continue
                    if rid in remote and remote[rid]['revision']!=link[0]:continue
                    result=self.api.request('/api/documents/'+rid,{'revision':link[0],**combined},method='PATCH');self.link(rid,result['revision'],rows);uploaded+=1
                elif not rid:
                    if not rows[0]['image'] or not Path(rows[0]['image']).is_file():continue
                    cid=self.db.execute('SELECT remote_id FROM cep_clients WHERE local_id=?',(rows[0]['client'],)).fetchone()
                    if not cid:continue
                    # Stable across a crash after upload but before saving the local link.
                    file_hash=hashlib.sha256(Path(rows[0]['image']).read_bytes()).hexdigest()
                    kind=combined['data'].get('kind','gider')
                    rid=str(uuid.uuid5(uuid.NAMESPACE_URL,cid[0]+':'+kind+':'+file_hash))
                    p={'id':rid,'client':cid[0],'kind':kind,'data':combined['data']};result=self.api.upload(p,rows[0]['image'])
                    if result.get('duplicate'):
                        saved=self.api.request('/api/documents/'+result['id'])
                        if result['id']!=rid or saved['data']!=combined['data']:
                            self.errors.append('Aynı fotoğraf bulutta mevcut; otomatik birleştirilmedi: '+result['id']);continue
                        self.link(rid,result['revision'],rows,state_override=saved['state'])
                        if saved['state']==combined['state']:
                            self.delivery(rid,result['revision']);continue
                    self.link(rid,result['revision'],rows,state_override='draft')
                    if combined['state']=='approved':
                        result=self.api.request('/api/documents/'+rid,{'revision':result['revision'],**combined},method='PATCH');self.link(rid,result['revision'],rows)
                    self.delivery(rid,result['revision']);uploaded+=1
                if uploaded>=20:break
            except Exception as e:self.errors.append(str(e))
        status={'time':datetime.now().isoformat(),'uploaded':uploaded,'errors':self.errors,'device':self.config['device']}
        (self.home/'cep-durum.json').write_text(json.dumps(status,ensure_ascii=False,indent=2),encoding='utf8');return status

def run(home,stop=None):
    home=Path(home);cfg=json.loads((home/'cep-baglanti.json').read_text(encoding='utf8'));stop=stop or threading.Event()
    while not stop.is_set():
        bridge=None
        try:bridge=Bridge(home,cfg);bridge.cycle()
        except Exception as e:(home/'cep-durum.json').write_text(json.dumps({'time':datetime.now().isoformat(),'errors':[str(e)]},ensure_ascii=False),encoding='utf8')
        finally:
            if bridge:bridge.close()
        stop.wait(45)
if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('home');p.add_argument('--once',action='store_true');args=p.parse_args()
    if args.once:
        b=Bridge(args.home,json.loads((Path(args.home)/'cep-baglanti.json').read_text(encoding='utf8')))
        try:print(json.dumps(b.cycle(),ensure_ascii=False))
        finally:b.close()
    else:run(args.home)
