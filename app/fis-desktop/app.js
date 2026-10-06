import {parseDraft,parseQr,vatLine,matchVendor,money,mergeQr,checkDoc,isValidVkn,looksLikeProduct,normalizeTitle,excludeAutomaticZero} from './parser.js';
var series={active:false,n:0,dup:0},capMode='',dupStack=[],dupTimer;
var MON=['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'],MONL=['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const $=id=>document.getElementById(id),uuid=()=>crypto.randomUUID();

const processingCards=new Map();
let batchQueue=[],batchRunning=false,syncAgain=false;
let selecting=false,selected=new Set(),shown=[],pendingDelete=[];
// Private APK pairing default; preserve an existing office connection.
if(!window.FisDesktop&&!localStorage.getItem('connection')){
 try{const c=window.Native?.defaultConnection?JSON.parse(Native.defaultConnection()):await (await fetch('./office-connection.json')).json();const u=new URL(c.url);
 if(u.protocol==='https:'&&typeof c.token==='string'&&c.token.length>=32)localStorage.setItem('connection',JSON.stringify({url:u.origin,token:c.token}));}catch{}
}
let cfg=JSON.parse(localStorage.getItem('connection')||'{}'),catalog=mergeLocal(JSON.parse(localStorage.getItem('catalog')||'{"clients":[],"vendors":[]}')),kind='gider',editing=null,remote=[],busy=false,previewUrl=null;
const db=await new Promise((ok,bad)=>{const r=indexedDB.open('fis-cep',1);r.onupgradeneeded=()=>r.result.createObjectStore('queue',{keyPath:'id'});r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error);});
const store=(mode,fn)=>new Promise((ok,bad)=>{const tx=db.transaction('queue',mode),r=fn(tx.objectStore('queue'));tx.oncomplete=()=>ok(r.result);tx.onerror=()=>bad(tx.error);});
const all=()=>store('readonly',s=>s.getAll()),put=x=>store('readwrite',s=>s.put(x)),del=id=>store('readwrite',s=>s.delete(id));
let sayTimer;function say(s,err){const n=$('notice');clearTimeout(sayTimer);n.textContent=(s||'').length>170?s.slice(0,167)+'…':(s||'');n.classList.toggle('show',!!s);n.classList.toggle('err',!!err);if(s)sayTimer=setTimeout(()=>n.classList.remove('show'),err?9000:5000);}
function page(id){for(const n of ['home','editor','settings','vendors','clients'])$(n).hidden=n!==id;$('tabbar').hidden=id==='editor';$('topbar').hidden=id!=='home';document.body.classList.toggle('nohead',id!=='home');for(const b of document.querySelectorAll('[data-tab]'))b.classList.toggle('on',b.dataset.tab===id);scrollTo(0,0);}
function caught(fn){return async(...args)=>{try{await fn(...args);}catch(e){say(e.message||'İşlem tamamlanamadı.',true);}};}
function configured(){return !!window.FisDesktop||(cfg.url&&cfg.token);}
const netFail=e=>e instanceof TypeError||e?.name==='TimeoutError'||e?.name==='AbortError'||/Failed to fetch|NetworkError|Load failed/i.test(e?.message||'');
const netError=()=>Object.assign(Error('Ofise ulaşılamadı (internet ya da sunucu adresi engeli olabilir). Belgeler cihazda güvende; bağlantı gelince gönderilir. Ayarlar › Bağlantıyı test et.'),{network:true});
async function api(path,options={}){
 if(window.FisDesktop){
  let body=options.body;
  if(body instanceof FormData){const image=body.get('image');body={document:JSON.parse(body.get('document')),imageBase64:await blobB64(image)};}
  else if(typeof body==='string')body=JSON.parse(body);
  const result=await window.FisDesktop.request({path,method:options.method||'GET',body});
  if(path.endsWith('/image'))return new Response(Uint8Array.from(atob(result.base64||''),c=>c.charCodeAt(0)),{headers:{'Content-Type':result.mime||'image/jpeg'}});
  if(result.warning)say(result.warning,true);
  return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
 }

 if(!configured())throw Error('Önce Bağlantı ekranından ofise bağlanın.');
 const bases=[cfg.url,...(cfg.alt?[cfg.alt]:[])].map(u=>String(u).replace(/\/+$/,''));
 for(let k=0;k<bases.length;k++){
  try{
   const headers={Authorization:'Bearer '+cfg.token,...options.headers};
   const r=await fetch(bases[k]+path,{...options,headers,signal:AbortSignal.timeout(options.body instanceof FormData?90000:30000)});
   if(!r.ok){const d=await r.json().catch(()=>({}));throw Error(d.error||'Sunucuya ulaşılamadı ('+r.status+').');}
   return r;
  }catch(e){if(netFail(e)){if(k<bases.length-1)continue;throw netError();}throw e;}
 }
}
async function jsonApi(path,p,method='POST'){return (await api(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(p)})).json();}
function renderClients(){const selected=$('client').value||localStorage.getItem('client');$('client').replaceChildren();for(const c of alphabetic(catalog.clients)){const o=new Option(c.name,c.id);$('client').add(o);}if(!catalog.clients.length)$('client').add(new Option('Mükellef listesi henüz eşitlenmedi',''));if(catalog.clients.some(c=>c.id===selected))$('client').value=selected;updatePicker();}
function clientName(id){return catalog.clients.find(c=>c.id===id)?.name||'Mükellef';}
function toggle(k){kind=k;loadMonth();document.documentElement.dataset.kind=k;$('expense').classList.toggle('active',k==='gider');$('income').classList.toggle('active',k==='gelir');render();}
async function render(){updatePicker();const local=await all(),ids=new Set(local.map(x=>x.id));const rows=[...local,...remote.filter(x=>!ids.has(x.id)&&!isPurged(x.id))].filter(x=>!phoneHidden().includes(x.id)).filter(x=>Boolean(x.deleted)===$('showDeleted').checked).filter(x=>(!$('client').value||x.client===$('client').value)&&x.kind===kind).filter(x=>recordMonth(x)===$('workMonth').value).sort((a,b)=>Number(a.state==='approved')-Number(b.state==='approved')||(b.created||'').localeCompare(a.created||''));shown=rows;for(const id of selected)if(!rows.some(r=>r.id===id))selected.delete(id);$('selectionBar').hidden=!selecting;updateSelection();$('documents').replaceChildren();$('summary').textContent=`${rows.length} belge · ${rows.reduce((n,r)=>n+vatCards(r).length,0)} KDV kaydı · ${local.length} gönderim bekliyor`;updateStats(rows,local);updateQuick(rows);
 for(const v of processingCards.values()){const b=document.createElement('div');b.className='document processing';const text=document.createElement('strong');text.textContent=v.title||'Fiş okunuyor…';const progress=document.createElement('progress');progress.removeAttribute('value');const fields=document.createElement('small');fields.textContent=[v.data?.vkn,v.data?.evrak_no,v.data?.toplam?formatAmount(v.data.toplam)+' ₺':'',...(v.data?.kalemler||[]).map(l=>'%'+Number(l.oran)+': '+formatAmount(Number(l.matrah)+Number(l.kdv)))].filter(Boolean).join(' · ');b.append(text,fields,progress);$('documents').append(b);}
 for(const r of rows){for(const vat of vatCards(r)){const b=document.createElement('button');b.className='document';const tag=document.createElement('i');tag.className='badge '+(r.deleted?'del':r.image?'wait':r.state==='approved'?'ok':'chk');tag.textContent=vat&&!r.deleted&&r.state!=='approved'&&(r.data.vat_reviewed_rates||[]).includes(vat.rate)?'Bu KDV kontrol edildi':r.deleted?'Silindi · geri alınabilir':r.image?'Cihazda · gönderim bekliyor':r.state==='approved'?'Onaylı':'Kontrol bekliyor';const t=document.createElement('strong');t.textContent=(r.data.aciklama||'Ünvanı kontrol edin')+(vat?' · KDV %'+vat.rate:'');const sub=document.createElement('p');sub.className='sub';sub.textContent=[r.data.evrak_tarihi||'Tarih eksik',clientName(r.client)].join(' · ');const av=document.createElement('div');av.className='av';av.textContent=((r.data.aciklama||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('')||'?').toLocaleUpperCase('tr-TR');const dm=document.createElement('div');dm.className='dm';dm.append(t,sub);const am=document.createElement('div');am.className='am';const amt=document.createElement('b');amt.textContent=(vat?vat.gross:r.data.toplam)?Number(vat?vat.gross:r.data.toplam).toLocaleString('tr-TR',{minimumFractionDigits:2})+' ₺':'—';am.append(amt,tag);b.append(av,dm,am);b.onclick=caught(()=>openDocument(r,vat?.rate??null));
 if(selecting){const wrapper=document.createElement('div');wrapper.className='document-select';const check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label','Belgeyi seç: '+t.textContent);check.checked=selected.has(r.id);check.disabled=false;check.onchange=()=>{check.checked?selected.add(r.id):selected.delete(r.id);render();};wrapper.append(check,b);$('documents').append(wrapper);}else $('documents').append(b);}}
 if(!rows.length&&!processingCards.size){const e=document.createElement('div');e.className='empty';e.innerHTML='<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg><b>Henüz belge yok</b>Yukarıdan fiş veya fatura çekerek başlayın.';$('documents').append(e);}
}
function addVat(rate=20,gross=''){const row=document.createElement('div');row.className='vat-row';const select=document.createElement('select');select.setAttribute('aria-label','KDV oranı');for(const n of [0,1,10,20])select.add(new Option('%'+n,n));if(![0,1,10,20].includes(+rate)&&gross!=='')select.add(new Option('%'+rate+' (belgeden)',rate));select.value=+rate;const value=document.createElement('input');value.inputMode='decimal';value.placeholder='KDV dahil tutar';value.setAttribute('aria-label','KDV dahil tutar');value.value=formatAmount(gross);value.lang='tr';value.maxLength=24;value.addEventListener('blur',()=>{value.value=formatAmount(value.value);});const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Satırı kaldır');remove.onclick=()=>row.remove();row.append(select,value,remove);$('vatRows').append(row);}
async function openDocument(r){editing={...r,data:structuredClone(r.data)};let offlineOpen=false;if(!r.image&&(!!window.FisDesktop||navigator.onLine)){try{const latest=await (await api('/api/documents/'+r.id)).json();editing={...latest};}catch(e){if(!e.network)throw e;offlineOpen=true;}}editing.data=resolveVendor(editing.data);const d=editing.data;const visibleLines=d.kalemler||[];if(!editing.orig)editing.orig=snap(editing.data);$('deleteDoc').innerHTML=editing.deleted?IC.restore:IC.trash;$('deleteDoc').setAttribute('aria-label',editing.deleted?'Geri al':'Sil');$('deleteDoc').classList.toggle('danger',!editing.deleted);$('deleteDoc').disabled=false;$('saveDraft').disabled=!!editing.deleted;$('approveDoc').disabled=!!editing.deleted;$('reanalyze').disabled=!!editing.deleted;for(const [id,key] of [['title','aciklama'],['vkn','vkn'],['date','evrak_tarihi'],['number','evrak_no'],['total','toplam']])$(id).value=id==='total'?formatAmount(d[key]):d[key]||'';$('docType').value=d.is_z_report?'z':d.is_invoice?'invoice':'receipt';$('raw').textContent=[d.qr_raw?'KAREKOD VERİSİ:\n'+d.qr_raw:'',d.ocr||''].filter(Boolean).join('\n\n');$('vatRows').replaceChildren();for(const l of visibleLines)addVat(l.oran,(Number(l.matrah)+Number(l.kdv)).toFixed(2));if(!visibleLines.length)addVat();if(previewUrl)URL.revokeObjectURL(previewUrl);let blob=editing.image;if(!blob){try{blob=await (await api('/api/documents/'+r.id+'/image')).blob();}catch(e){if(!e.network)throw e;offlineOpen=true;}}if(blob){previewUrl=URL.createObjectURL(blob);$('preview').src=previewUrl;}else{$('preview').removeAttribute('src');}if(offlineOpen)say('Ofise ulaşılamadı; belge son kayıtlı bilgilerle açıldı, fotoğraf yüklenemedi. Değişiklikler bağlantı gelince kaydedilebilir.',true);$('editImage').hidden=window.FisDesktop?(editing.state==='approved'||!!editing.data.qr_only):(!editing.image||!!editing.data.qr_only);$('aiRead').hidden=$('editImage').hidden;$('preview').style.transform='';inlineScale=1;page('editor');}
function formData(approve){const d={...editing.data,aciklama:$('title').value.trim(),vkn:$('vkn').value.trim(),evrak_tarihi:$('date').value.trim(),evrak_no:$('number').value.trim(),toplam:Number.isFinite(money($('total').value))?money($('total').value).toFixed(2):'',is_z_report:$('docType').value==='z',is_invoice:$('docType').value==='invoice',review_ack:!!approve,vat_manually_reviewed:!!approve,kind:editing.kind};d.tarih=d.evrak_tarihi;assignMonth(d,{period:d.selected_period||editing.period||$('workMonth').value,kind:editing.kind});d.kalemler=[...$('vatRows').children].filter(row=>row.querySelector('input').value.trim()!=='').map(row=>vatLine(row.querySelector('select').value,row.querySelector('input').value));if(d.is_z_report){if(d.kind!=='gelir')throw Error('Z raporunu Gelir bölümüne yükleyin.');d.vkn='';d.aciklama='Z RAPORU';}if(approve&&d.qr_currency&&!['TRY','TRL','TL'].includes(d.qr_currency))throw Error('Dövizli kodlar otomatik TL olarak onaylanamaz. Bilgisayarda kur ve tutarları kontrol edin.');if(d.kalemler.some(l=>!Number.isFinite(+l.matrah)||!Number.isFinite(+l.kdv)))throw Error('KDV tutarlarını kontrol edin.');d.aciklama=normalizeTitle(d.aciklama);if(approve)d.vendor_confirmed_at=new Date().toISOString();return d;}
let saving=false;
async function save(approve){if(saving)return;saving=true;$('approveDoc').disabled=true;try{return await saveOnce(approve);}finally{saving=false;$('approveDoc').disabled=false;}}
async function saveOnce(approve){const d=formData(approve),complete=true,state=approve&&complete?'approved':'draft';
 if(approve){const w=checkDoc({type:$('docType').value,vkn:d.vkn,date:d.evrak_tarihi,total:d.toplam,gross:d.kalemler.reduce((a,l)=>a+Number(l.matrah)+Number(l.kdv),0),title:d.aciklama}),sig=w.join('|')+JSON.stringify(d);$('warnBox').replaceChildren(...w.map(t=>{const x=document.createElement('div');x.textContent='⚠ '+t;return x;}));}if(editing.image&&!editing.desktop){editing={...editing,data:d,state};await put(editing);if(approve){try{void logCorrection(editing).catch(()=>{});}catch(e){console.warn('düzeltme kaydı',e);}}}else{await jsonApi('/api/documents/'+editing.id,{revision:editing.revision,state,data:d,...(editing.imageEdited?{imageBase64:await blobB64(editing.image)}:{})},'PATCH');if(approve){try{void logCorrection({...editing,data:d}).catch(()=>{});}catch(e){console.warn('Düzeltme kaydı alınamadı');}}}if(approve)rememberApprovedVendors([{...editing,data:d,state}]);say(approve?(complete?'Onay kaydedildi. Bilgisayar aktarım durumu eşitlemede kontrol edilir.':'Bu KDV kaydı onaylandı. Diğer KDV kartını da kontrol edip onaylayın.'):'Taslak kaydedildi.');page('home');await render();void sync().catch(e=>say(e.message,true));}
function alphabetic(items){return items.slice().sort((a,b)=>String(a.name||'').trim().normalize('NFC').localeCompare(String(b.name||'').trim().normalize('NFC'),'tr',{sensitivity:'base',numeric:true})||String(a.vkn||a.id||'').localeCompare(String(b.vkn||b.id||'')));}
function rememberApprovedVendors(records){
 const l=localCat(),digits=v=>String(v||'').replace(/\D/g,''),known=new Set([...catalog.vendors,...l.vendors].map(v=>digits(v.vkn)));let count=0;const seen=new Set();
 for(const r of [...records].sort((a,b)=>String(b.data?.vendor_confirmed_at||b.updated_at||b.created||'').localeCompare(String(a.data?.vendor_confirmed_at||a.updated_at||a.created||'')))){const d=r.data||{},vkn=digits(d.vkn),name=String(d.aciklama||'').replace(/\s+/g,' ').trim();
 if(r.deleted||r.state!=='approved'||d.is_z_report||!/^\d{10,11}$/.test(vkn)||!name||/^(Z RAPORU|PERAKENDE SATIŞ FİŞİ|GİDER PUSULASI)$/i.test(name))continue;
 if(seen.has(vkn))continue;seen.add(vkn);const existing=l.vendors.find(v=>digits(v.vkn)===vkn),stamp=d.vendor_confirmed_at||r.updated_at||r.created||'';const current=catalog.vendors.find(v=>digits(v.vkn)===vkn);if(existing&&existing.confirmedAt&&stamp<=existing.confirmedAt)continue;if(current?.name===name&&!existing)continue;if(existing){if(existing.name===name)continue;Object.assign(existing,{name:normalizeTitle(name),autoPending:true,confirmedAt:stamp});}else l.vendors.push({vkn,name:normalizeTitle(name),autoPending:true,confirmedAt:stamp});known.add(vkn);count++;
 }if(count){saveLocal(l);catalog=mergeLocal(catalog);}return count;
}
async function sendRememberedVendors(){
 const pending=localCat().vendors.filter(v=>v.autoPending);if(!pending.length)return;
 try{const fresh=await (await api('/api/catalog')).json();const known=new Set((fresh.vendors||[]).map(v=>String(v.vkn).replace(/\D/g,'')));
 for(const v of pending){await jsonApi('/api/vendors',{vkn:v.vkn,name:v.name},'POST');known.add(v.vkn);const l=localCat();const saved=l.vendors.find(x=>x.vkn===v.vkn);if(saved&&saved.name===v.name){saved.autoPending=false;saveLocal(l);}}
 }catch(e){console.warn('Cari yerelde korundu; sonraki eşitlemede tekrar denenecek.');}
}
function resolveVendor(d){return matchVendor(d,catalog.vendors);}
async function qrSummary(d){
 const canvas=document.createElement('canvas');canvas.width=1100;canvas.height=1500;const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,1100,1500);c.fillStyle='#163248';c.font='bold 35px sans-serif';c.fillText('KAREKODDAN OKUNAN BELGE BİLGİLERİ',45,70);c.font='22px sans-serif';c.fillText('Bu özet, asıl faturanın fotoğrafı değildir.',45,115);
 const rows=[['Ünvan',d.aciklama||'Eksik — tamamlanmalı'],['VKN/TCKN',d.vkn],['Fatura no',d.evrak_no],['Tarih',d.evrak_tarihi],['Ödenecek',d.toplam+' '+(d.qr_currency||'TRY')],...d.kalemler.map(l=>['KDV %'+Number(l.oran),'Matrah: '+l.matrah+' / KDV: '+l.kdv]),...(d.qr_warnings||[]).map(w=>['Kontrol',w])];let y=180;
 for(const [label,value] of rows){c.font='bold 24px sans-serif';c.fillText(label,45,y);y+=34;c.font='24px sans-serif';let line='';for(const word of String(value||'Eksik').split(' ')){if(c.measureText(line+word).width>990){c.fillText(line,45,y);y+=32;line='';}line+=word+' ';}c.fillText(line,45,y);y+=55;}
 return await new Promise(ok=>canvas.toBlob(ok,'image/png'));
}
async function qrDocument(text,ctx){
 if(!ctx)throw Error('Mükellef seçimi bulunamadı. Yeniden seçip kodu okutun.');
 const data=excludeAutomaticZero(resolveVendor(parseQr(text,ctx.kind)||parseDraft('',ctx.kind,[text])));
 localStorage.setItem('lastQr',text);if(!data.evrak_no&&!data.vkn)throw Error('Kod okundu ancak desteklenen fatura bilgileri bulunamadı.');
 data.qr_raw=text;data.qr_only=true;data.app_version='0.13.7';
 if(ctx.target){const record=(await all()).find(x=>x.id===ctx.target)||await (await api('/api/documents/'+ctx.target)).json();if(record.data.evrak_no&&data.evrak_no&&record.data.evrak_no!==data.evrak_no)throw Error('Bu karekod farklı bir faturaya ait; kayıt değiştirilmedi.');const next={...record,data:{...mergeQr(record.data,data),ocr:record.data.ocr,qr_only:record.data.qr_only}};await openDocument({...next,image:record.image||await (await api('/api/documents/'+record.id+'/image')).blob()});if(!record.image)delete editing.image;say('Karekod alanları tamamlandı. Kontrol edip kaydedin.');return;}

 const hex=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ctx.client+'|'+ctx.kind+'|'+text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const id=hex.slice(0,8)+'-'+hex.slice(8,12)+'-5'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);
 const existing=(await all()).find(x=>x.id===id)||remote.find(x=>x.id===id);
 if(existing){dupNotice(existing.data||data,null);return;}
 assignMonth(data,ctx);const dq=await findDup(data,ctx,'');if(dq){dupNotice(data,null);return;}const record={id,...ctx,data,state:'draft',image:await qrSummary(data),filename:id+'.png'};
 await put(record);await openDocument(record);say('Kod bilgileri forma aktarıldı. '+(!data.aciklama?'Ünvan kodda/cari listesinde yok; ünvanı yazın. ':'')+(data.qr_warnings||[]).join(' '));
}
let captureBusy=false;document.addEventListener('visibilitychange',()=>{if(!document.hidden&&captureBusy)setTimeout(()=>{captureBusy=false;},8000);});

function capture(mode,target=null){if(!configured()){page('settings');say('Önce ofis bağlantısını kaydedin.');return;}const client=$('client').value;if(!client)throw Error('Önce mükellef seçin.');if(batchRunning)throw Error('Seri çekim işleniyor; bitmesini bekleyin.');if(captureBusy)throw Error('Önceki fotoğraf işleniyor; lütfen bekleyin.');capMode=mode;if(['camera','scan'].includes(mode)&&localStorage.getItem('series')==='1'&&!target){if(!series.active){series.active=true;series.n=0;series.dup=0;}}else series.active=false;const id=uuid();localStorage.setItem('capture:'+id,JSON.stringify({client:target?.client||client,kind:target?.kind||kind,target:target?.id,period:$('workMonth').value,created:new Date().toISOString()}));if(window.Native){captureBusy=true;Native.capture(series.active&&['camera','scan'].includes(mode)?'queue:'+mode:mode,id);say(mode==='qr'?'QR tarayıcısı açılıyor…':'Kamera açılıyor…');}else{$('fallbackFiles').dataset.requestId=id;$('fallbackFiles').click();}}
const handleNativeEvent=event=>caught(async()=>{const ctx=JSON.parse(localStorage.getItem('capture:'+event.requestId)||'null');
 if(event.type==='reading'){const reading=event.text?resolveVendor(parseDraft(event.text,ctx?.kind||kind)):{};processingCards.set(event.requestId,{title:reading.aciklama||'Fiş okunuyor…',data:reading});await render();return;}
 if(event.type==='splitComplete'){Native.acknowledge(event.filename);batchQueue=batchQueue.filter(q=>q.filename!=='q-'+event.filename);renderBatch();return;}
 if(event.type==='queued'){if(!batchQueue.some(q=>q.filename===event.filename))batchQueue.push(event);renderBatch();return;}
 if(event.type==='batchDone'){processingCards.clear();series.active=false;series.n=0;series.dup=0;updSeries();batchRunning=false;captureBusy=false;renderBatch();await render();say(batchQueue.length?'Bazı fotoğraflar işlenemedi; kuyrukta korundu.':'Seri çekim işlendi. Belgeleri kontrol edip onaylayabilirsiniz.',!!batchQueue.length);return;}
 if(event.type==='error'){processingCards.delete(event.requestId);await render();captureBusy=false;say(event.message,true);renderBatch();return;}
 if(event.type==='done'){processingCards.delete(event.requestId);captureBusy=false;if(event.approvedBatch){const files=batchQueue.filter(q=>q.requestId===event.requestId).map(q=>q.filename);if(files.length){batchRunning=true;renderBatch();Native.processQueue(JSON.stringify(files));}return;}if(series.active||batchQueue.length){renderBatch();return;}say('Çekimler kaydedildi.');void sync().catch(e=>say(e.message,true));return;}
 if(event.type==='qr'){captureBusy=false;if(event.requestId==='pair'){let p;try{p=JSON.parse(event.text);}catch{throw Error('Bu bir Fiş Asistanı eşleştirme kodu değil.');}if(!p.url||!p.token)throw Error('Eşleştirme kodu eksik.');$('server').value=p.url;$('token').value=p.token;page('settings');say('Bilgiler alındı. Kaydet ve bağlan düğmesine basın.');return;}await qrDocument(event.text||'',ctx);return;}
 if(event.type==='image'){processingCards.delete(event.requestId);let dupHit=false;if(!ctx)throw Error('Çekimin mükellef seçimi bulunamadı; fotoğraf cihazda korundu.');const id=event.filename.replace('.jpg','');const old=(await all()).find(x=>x.id===id);if(!old){const bytes=Uint8Array.from(atob(event.base64),c=>c.charCodeAt(0));const blob=new Blob([bytes],{type:'image/jpeg'});let data={...resolveVendor(parseDraft(event.text,ctx.kind,event.qr||[])),app_version:event.appVersion||'unknown',qr_candidates:event.qr||[]};const ih=await dHash(blob).catch(()=>'');assignMonth(data,ctx);let dup=await findDup(data,ctx,ih);if(!dup){processingCards.set(event.requestId,{title:data.aciklama||'KDV ve ünvan tamamlanıyor…',data});await render();data=excludeAutomaticZero(resolveVendor(await aiAssist(blob,data,ctx.kind,false)));assignMonth(data,ctx);dup=await findDup(data,ctx,ih);}if(dup){dupHit=true;series.dup++;dupNotice(data,{id,ctx,data,blob,filename:event.filename,ih});}else{await put({id,...ctx,data,orig:snap(data),state:'draft',image:blob,filename:event.filename,ihash:ih});series.n++;}}processingCards.delete(event.requestId);Native.acknowledge(event.filename);batchQueue=batchQueue.filter(q=>q.filename!=='q-'+event.filename);renderBatch();await render();if(!dupHit){updSeries();say(series.active?'Seri çekim: '+series.n+' belge eklendi.':'Fotoğraf cihazda kaydedildi; okunan bilgileri kontrol edin.');}}
})();
let nativeEvents=Promise.resolve();window.nativeEvent=event=>{nativeEvents=nativeEvents.then(()=>handleNativeEvent(event)).catch(e=>say(e.message,true));return nativeEvents;};
async function sync(quiet){if(batchRunning)return;if(busy){syncAgain=true;return;}busy=true;$('refresh').disabled=true;try{rememberApprovedVendors([...(await all()),...remote]);if(configured()&&(!!window.FisDesktop||navigator.onLine)){let failed=0,lastErr;for(const r of (await all()).sort((a,b)=>Number(b.state==='approved')-Number(a.state==='approved'))){if(r.deleted)continue;try{if(String(r.client).startsWith('local-'))throw Error('«'+clientName(r.client)+'» mükellefi yalnız telefonda; ofise tanıtılana kadar gönderilemez.');const form=new FormData();form.append('image',r.image,r.filename||r.id+'.jpg');form.append('document',JSON.stringify({id:r.id,client:r.client,kind:r.kind,data:r.data}));const result=await (await api('/api/documents',{method:'POST',body:form})).json();if(!result.duplicate||(result.id===r.id&&result.revision===1)){if(r.state==='approved'||result.duplicate)await jsonApi('/api/documents/'+result.id,{revision:result.revision,data:r.data,state:r.state},'PATCH');}else{const saved=await (await api('/api/documents/'+result.id)).json();if(saved.state!==r.state||JSON.stringify(saved.data)!==JSON.stringify({...r.data,kind:r.kind}))throw Error('Belge sunucuda değişmiş. Cihazdaki düzenleme korundu; mevcut kaydı kontrol edin.');}const latest=(await all()).find(x=>x.id===r.id);if(latest&&latest.state===r.state&&JSON.stringify(latest.data)===JSON.stringify(r.data))await del(r.id);else if(latest)syncAgain=true;}catch(e){failed++;lastErr=e;}}if(failed&&!(quiet&&lastErr?.network))say(failed+' belge gönderilemedi: '+(lastErr.message||'bağlantıyı kontrol edin'),true);try{catalog=await (await api('/api/catalog')).json();}catch(e){if(e.network){if(!quiet)say(e.message,true);await render();return;}throw e;}localStorage.setItem('catalog',JSON.stringify(catalog));catalog=mergeLocal(catalog);renderClients();const fresh=[];let offset=0;try{do{const p=await (await api('/api/documents?offset='+offset)).json();fresh.push(...p.items);offset=p.next;}while(offset!==null);remote=fresh;}catch(e){if(!e.network)throw e;}localStorage.setItem('remote',JSON.stringify(remote));rememberApprovedVendors([...(await all()),...remote]);await sendRememberedVendors();}await render();}finally{busy=false;$('refresh').disabled=false;if(syncAgain){syncAgain=false;queueMicrotask(()=>sync(true).catch(e=>say(e.message,true)));}}}
$('completeQr').onclick=caught(()=>capture('qr',editing));
$('showDeleted').onchange=()=>{selected.clear();render();};
$('deleteDoc').onclick=caught(async()=>{
 if(busy)throw Error('Gönderim sürüyor; tamamlanınca tekrar deneyin.');
 if(editing.deleted){await removeOrRestore(true);return;}
 pendingDelete=[editing];$('deleteConfirm').showModal();
});
$('cancelDelete').onclick=()=>$('deleteConfirm').close();
$('confirmDelete').onclick=caught(async()=>{
 $('deleteConfirm').close();if(busy)throw Error('Gönderim sürüyor; tamamlanınca tekrar deneyin.');
 let count=0;try{for(const r of pendingDelete){await deleteRecord(r);selected.delete(r.id);count++;}}finally{localStorage.setItem('remote',JSON.stringify(remote));page('home');await render();say(count+' belge kaldırıldı. Onaylı kayıtlar ofiste korundu; taslaklar Silinenler bölümünde.');}
});
const selPool=()=>{const d=$('showDeleted').checked;return shown.filter(r=>d?r.deleted:!r.deleted);};
function updateSelection(){const d=$('showDeleted').checked,pool=selPool();$('selectAllTxt').textContent='Tümünü seç';$('deleteSelected').textContent=(d?'Kalıcı sil (':'Seçilenleri sil (')+selected.size+')';$('deleteSelected').disabled=!selected.size;$('restoreSelected').hidden=!d;$('restoreSelected').textContent='Geri yükle ('+selected.size+')';$('restoreSelected').disabled=!selected.size;$('selectAll').checked=pool.length>0&&pool.every(r=>selected.has(r.id));}
$('selectDocs').onclick=()=>{selecting=!selecting;selected.clear();$('selectDocs').textContent=selecting?'Vazgeç':'Seç';render();};
$('selectAll').onchange=()=>{selected=new Set($('selectAll').checked?selPool().map(r=>r.id):[]);render();};
$('deleteSelected').onclick=caught(async()=>{if(busy)throw Error('Gönderim sürüyor; tamamlanınca tekrar deneyin.');pendingDelete=shown.filter(r=>selected.has(r.id));if(!pendingDelete.length)return;if($('showDeleted').checked){$('purgeText').textContent=pendingDelete.length+' belgenin silinenler kaydı kaldırılacak. Kurtarma için görüntü dosyaları diskte korunur. Telefon değişiklikleri Telefonla eşitle düğmesiyle gönderilir.';$('purgeConfirm').showModal();}else $('deleteConfirm').showModal();});
$('cancelPurge').onclick=()=>$('purgeConfirm').close();
$('confirmPurge').onclick=caught(async()=>{$('purgeConfirm').close();if(busy)throw Error('Gönderim sürüyor; tamamlanınca tekrar deneyin.');
 const localOnly=pendingDelete.filter(r=>r.image&&!remote.some(x=>x.id===r.id)),server=pendingDelete.filter(r=>!localOnly.includes(r));let n=0,skipped=0;
 if(server.length&&!online())throw Error('Sunucudaki belgeleri kalıcı silmek için internet gerekir.');
 for(const r of localOnly){await del(r.id);n++;}
 for(let i=0;i<server.length;i+=100){const ids=server.slice(i,i+100).map(r=>r.id),res=await jsonApi('/api/documents/purge',{ids},'POST').catch(e=>{throw fixErr(e);});skipped+=(res.skipped||[]).length;const gone=ids.filter(id=>!(res.skipped||[]).includes(id));n+=gone.length;remote=remote.filter(x=>!gone.includes(x.id));for(const id of gone)await del(id).catch(()=>{});}
 selected.clear();localStorage.setItem('remote',JSON.stringify(remote));await render();say(n+' belge kalıcı olarak silindi'+(skipped?', '+skipped+' belge silinemedi (onaylı olabilir).':'.'),!!skipped);});
$('restoreSelected').onclick=caught(async()=>{if(busy)throw Error('Gönderim sürüyor; tamamlanınca tekrar deneyin.');const rows=shown.filter(r=>selected.has(r.id));let n=0;try{for(const r of rows){const server=remote.find(x=>x.id===r.id)||(!r.image?r:null);if(server){const res=await jsonApi('/api/documents/'+r.id+'/restore',{revision:server.revision},'POST');remote=remote.map(x=>x.id===r.id?{...x,deleted:false,revision:res.revision}:x);}else await put({...r,deleted:false});n++;}}finally{selected.clear();localStorage.setItem('remote',JSON.stringify(remote));await render();}say(n+' belge geri yüklendi.');});
async function deleteRecord(record){
 if(record.state==='approved'&&!window.FisDesktop){if(record.image)throw Error('Belge henüz gönderilmedi. Önce eşitleyin; fotoğraf korundu.');localStorage.setItem(phoneHiddenKey(),JSON.stringify([...new Set([...phoneHidden(),record.id])]));await lstore('readwrite',q=>q.delete(record.id));if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;$('preview').removeAttribute('src');}return;}
 const server=remote.find(r=>r.id===record.id)||(!record.image?record:null);
 if(server){const r=await jsonApi('/api/documents/'+record.id,{revision:server.revision},'DELETE');remote=remote.map(x=>x.id===record.id?{...x,deleted:true,revision:r.revision}:x);await del(record.id);}else await put({...record,deleted:true});
}

async function removeOrRestore(restore){
 if(busy)throw Error('Eşitleme sürüyor; tekrar deneyin.');
 if(editing.state==='approved'&&!window.FisDesktop)throw Error('Onaylı belgeyi önce bilgisayardan kontrol edin.');
 const id=editing.id;let latest=remote.find(r=>r.id===id);
 if(!latest&&!editing.image)latest=editing;
 if(latest){const r=await jsonApi('/api/documents/'+id+(restore?'/restore':''),{revision:latest.revision},restore?'POST':'DELETE');remote=remote.map(x=>x.id===id?{...x,deleted:r.deleted,revision:r.revision}:x);await del(id);}
 else {await put({...editing,deleted:!restore});}
 localStorage.setItem('remote',JSON.stringify(remote));page('home');await render();say(restore?'Belge geri alındı.':'Taslak silindi. Silinenler bölümünden geri alabilirsiniz.');
}
$('reanalyze').onclick=caught(async()=>{
 if(editing.state==='approved')throw Error('Onaylı belgeyi değiştirmeden önce onayını kaldırın.');
 const old=editing.data;const reading=parseDraft(old.ocr||'',editing.kind,old.qr_raw?[old.qr_raw]:(old.qr_candidates||[]));const entered=$('vkn').value.replace(/\D/g,'');const parsed=resolveVendor({...reading,vkn:entered||reading.vkn||old.vkn||''});
 editing.data={...old,...parsed,qr_only:old.qr_only,vat_reviewed_rates:[]};
 const record={...editing};await openDocument({...record,image:editing.image||await (await api('/api/documents/'+editing.id+'/image')).blob()});
 // Keep existing server-backed records on revision-controlled PATCH when saved.
 if(!record.image)delete editing.image;
 say('Kaydedilmiş okuma yeniden analiz edildi. Değişiklikleri kontrol edip kaydedin.');
});
$('settingsBtn').onclick=()=>{page('settings');$('server').value=cfg.url||'';$('token').value=cfg.token||'';$('altServer').value=cfg.alt||'';};$('connect').onclick=caught(async()=>{const url=new URL($('server').value.trim());if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('HTTPS sunucu ana adresini girin.');const token=$('token').value.trim();if(token.length<32)throw Error('Bağlantı anahtarı eksik.');let alt='';const altRaw=$('altServer').value.trim();if(altRaw){const au=new URL(altRaw);if(au.protocol!=='https:'||au.username||au.password||au.pathname!=='/'||au.search||au.hash)throw Error('Yedek adres de HTTPS ana adresi olmalı.');alt=au.origin;}const old=cfg;cfg={url:url.origin,token,...(alt?{alt}:{})};try{catalog=await (await api('/api/catalog')).json();}catch(e){cfg=old;throw e;}localStorage.setItem('connection',JSON.stringify(cfg));localStorage.setItem('catalog',JSON.stringify(catalog));catalog=mergeLocal(catalog);renderClients();page('home');say('Ofise bağlandı.');await sync();});
$('pairQr').onclick=()=>{if(window.Native)Native.capture('qr','pair');else say('QR eşleştirme Android uygulamasında kullanılabilir.');};$('expense').onclick=()=>toggle('gider');$('income').onclick=()=>toggle('gelir');$('client').onchange=()=>{localStorage.setItem('client',$('client').value);loadMonth();render();};for(const b of document.querySelectorAll('[data-capture]'))b.onclick=caught(()=>capture(b.dataset.capture));for(const b of document.querySelectorAll('.back'))b.onclick=()=>{page('home');render();};window.goHome=()=>{for(const id of ['bulkSheet','monthSheet','clientSheet'])if($(id).open){$(id).close();return;}if($('scanEditor').open){$('scanEditor').close();return;}if($('imageViewer').open){$('imageViewer').close();return;}page('home');};$('refresh').onclick=caught(sync);$('addVat').onclick=()=>addVat();$('saveDraft').onclick=caught(()=>save(false));$('editForm').onsubmit=caught(async e=>{e.preventDefault();await save(true);});$('docType').onchange=()=>{if($('docType').value==='z'){$('vkn').value='';$('title').value='Z RAPORU';}};
function vendors(){const q=$('vendorSearch').value.toLocaleLowerCase('tr-TR');$('vendorList').replaceChildren();const list=alphabetic(catalog.vendors).filter(x=>(x.name+' '+x.vkn).toLocaleLowerCase('tr-TR').includes(q));for(const v of list.slice(0,200)){const b=document.createElement('button');b.className='vrow';const d=document.createElement('div');d.textContent=v.name;const sm=document.createElement('small');sm.textContent=String(v.vkn);d.append(sm);b.append(d);if(v.local||v.edited){const t=document.createElement('i');t.className='tagl';t.textContent=v.local?'Yalnız telefonda':'Düzenlendi';b.append(t);}b.onclick=()=>openEntry('vendor',v);$('vendorList').append(b);}const p=document.createElement('p');p.className='muted';p.textContent=list.length>200?list.length+' kayıttan ilk 200 gösteriliyor. Aramayı daraltın.':(list.length?'':'Kayıt yok. Sağ üstten yeni cari ekleyebilirsiniz.');if(p.textContent)$('vendorList').append(p);}$('vendorsBtn').onclick=()=>{page('vendors');vendors();};$('vendorSearch').oninput=vendors;
$('fallbackFiles').onchange=caught(async()=>{const ctx=JSON.parse(localStorage.getItem('capture:'+$('fallbackFiles').dataset.requestId));for(const file of $('fallbackFiles').files){if(file.size>10*1024*1024)throw Error('Fotoğraf 10 MB sınırını aşıyor.');await put({id:uuid(),...ctx,data:assignMonth(parseDraft('',ctx.kind),ctx),state:'draft',image:file,filename:file.name});}$('fallbackFiles').value='';await sync();});
remote=JSON.parse(localStorage.getItem('remote')||'[]');renderClients();await render();if(window.Native){Native.recover();Native.recoverQueue?.();}if(configured())caught(sync)();else page('settings');window.addEventListener('online',caught(sync));

let zoom=1,fitWidth=1,points=new Map(),gesture=null;
function setZoom(value,anchor){const vp=$('zoomViewport'),old=zoom;zoom=Math.max(1,Math.min(8,value));const x=anchor?.x??vp.clientWidth/2,y=anchor?.y??vp.clientHeight/2;const left=(vp.scrollLeft+x)/old,top=(vp.scrollTop+y)/old;$('zoomImage').style.width=(fitWidth*zoom)+'px';vp.scrollLeft=left*zoom-x;vp.scrollTop=top*zoom-y;$('zoomLevel').textContent='%'+Math.round(zoom*100);}
$('zoomPreview').onclick=()=>{const img=$('zoomImage');img.src=$('preview').src;$('imageViewer').showModal();requestAnimationFrame(()=>{fitWidth=$('zoomViewport').clientWidth;zoom=1;setZoom(1);$('zoomViewport').scrollTo(0,0);});};
$('closeViewer').onclick=()=>$('imageViewer').close();$('zoomIn').onclick=()=>setZoom(zoom*1.5);$('zoomOut').onclick=()=>setZoom(zoom/1.5);$('zoomFit').onclick=()=>setZoom(1);
const vp=$('zoomViewport');
vp.onpointerdown=e=>{points.set(e.pointerId,{x:e.clientX,y:e.clientY});vp.setPointerCapture(e.pointerId);gesture=null;};
vp.onpointermove=e=>{if(!points.has(e.pointerId))return;const previous=points.get(e.pointerId);points.set(e.pointerId,{x:e.clientX,y:e.clientY});if(points.size===2){const [a,b]=[...points.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(gesture){const rect=vp.getBoundingClientRect();setZoom(zoom*distance/gesture,{x:(a.x+b.x)/2-rect.left,y:(a.y+b.y)/2-rect.top});}gesture=distance;}else{vp.scrollLeft-=e.clientX-previous.x;vp.scrollTop-=e.clientY-previous.y;}};
vp.onpointerup=vp.onpointercancel=e=>{points.delete(e.pointerId);gesture=null;};
vp.ondblclick=()=>setZoom(zoom>1?1:3);vp.onwheel=e=>{e.preventDefault();setZoom(zoom*(e.deltaY<0?1.15:1/1.15));};

for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{const t=b.dataset.tab;if(t==='home'){page('home');render();}else if(t==='vendors'){page('vendors');vendors();}else if(t==='clients'){page('clients');clientsView();}};

document.documentElement.dataset.kind=kind;
async function clientsView(){const q=$('clientSearch').value.toLocaleLowerCase('tr-TR'),local=await all(),cnt={};for(const r of [...local,...remote.filter(x=>!local.some(l=>l.id===x.id)&&!isPurged(x.id))])if(!r.deleted)cnt[r.client]=(cnt[r.client]||0)+1;$('clientList').replaceChildren();for(const c of alphabetic(catalog.clients).filter(x=>x.name.toLocaleLowerCase('tr-TR').includes(q))){const row=document.createElement('div');row.className='clrow';const b=document.createElement('button');b.className='cl'+(c.id===$('client').value?' on':'');const d=document.createElement('div');d.textContent=c.name;const sm=document.createElement('small');sm.textContent=(cnt[c.id]||0)+' belge'+(c.local?' · yalnız telefonda':'');d.append(sm);b.append(d);if(c.id===$('client').value){const i=document.createElement('i');i.textContent='Seçili';b.append(i);}b.onclick=()=>{$('client').value=c.id;localStorage.setItem('client',c.id);page('home');render();say(c.name+' seçildi.');};const e=document.createElement('button');e.className='ib';e.setAttribute('aria-label','Düzenle');e.innerHTML=IC.pen;e.onclick=()=>openEntry('client',c);row.append(b,e);$('clientList').append(row);}if(!catalog.clients.length){const e=document.createElement('p');e.className='muted';e.textContent='Mükellef listesi henüz eşitlenmedi. Ayarlardan ofise bağlanın ya da yeni mükellef ekleyin.';$('clientList').append(e);}}
$('clientSearch').oninput=clientsView;

// ===== Belge tarayıcı: kırp (perspektif), döndür, sihirli/gri/siyah-beyaz =====
const SC={mode:'crop',filter:'magic',drag:-1,k:1,ox:0,oy:0},sv=$('scanView'),sctx=sv.getContext('2d');
const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
async function loadBitmap(blob){
 const cap=(w,h,draw)=>{const k=Math.min(1,2600/Math.max(w,h)),c=mk(Math.max(1,Math.round(w*k)),Math.max(1,Math.round(h*k)));draw(c.getContext('2d'),c.width,c.height);return c;};
 const url=URL.createObjectURL(blob);
 try{const img=new Image();img.src=url;await new Promise((ok,bad)=>{img.onload=ok;img.onerror=()=>bad(Error('görüntü çözülemedi'));});if(!img.naturalWidth)throw Error('boş görüntü');return cap(img.naturalWidth,img.naturalHeight,(x,w,h)=>x.drawImage(img,0,0,w,h));}
 catch(e1){try{const bmp=await createImageBitmap(blob);const c=cap(bmp.width,bmp.height,(x,w,h)=>x.drawImage(bmp,0,0,w,h));bmp.close?.();return c;}catch(e2){throw Error(String(e1.message||e1));}}
 finally{URL.revokeObjectURL(url);}
}
function autoQuad(c){
 const w=160,h=Math.max(8,Math.round(160*c.height/c.width)),s=mk(w,h),x=s.getContext('2d');x.drawImage(c,0,0,w,h);
 const d=x.getImageData(0,0,w,h).data,g=new Uint8Array(w*h),hist=new Array(256).fill(0);
 for(let i=0;i<w*h;i++){const v=(d[i*4]*.3+d[i*4+1]*.59+d[i*4+2]*.11)|0;g[i]=v;hist[v]++;}
 let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let sb=0,wb=0,best=0,th=128;const tot=w*h;
 for(let t=0;t<256;t++){wb+=hist[t];if(!wb)continue;const wf=tot-wb;if(!wf)break;sb+=t*hist[t];const mb=sb/wb,mf=(sum-sb)/wf,v=wb*wf*(mb-mf)**2;if(v>best){best=v;th=t;}}
 const rows=new Array(h).fill(0),cols=new Array(w).fill(0);
 for(let y=0;y<h;y++)for(let i=0;i<w;i++)if(g[y*w+i]>th){rows[y]++;cols[i]++;}
 const first=(a,n)=>a.findIndex(v=>v>n*.25),last=(a,n)=>{for(let i=a.length-1;i>=0;i--)if(a[i]>n*.25)return i;return -1;};
 let x0=first(cols,h),x1=last(cols,h),y0=first(rows,w),y1=last(rows,w);
 if(x0<0||y0<0||x1-x0<w*.3||y1-y0<h*.3){x0=w*.04;x1=w*.96-1;y0=h*.04;y1=h*.96-1;}
 const kx=c.width/w,ky=c.height/h,X0=x0*kx,X1=Math.min(c.width,(x1+1)*kx),Y0=y0*ky,Y1=Math.min(c.height,(y1+1)*ky);
 return [[X0,Y0],[X1,Y0],[X1,Y1],[X0,Y1]];
}
function fullQuad(c){return [[0,0],[c.width,0],[c.width,c.height],[0,c.height]];}
function fitView(){const r=sv.parentElement.getBoundingClientRect(),dpr=devicePixelRatio||1;sv.width=Math.round(r.width*dpr);sv.height=Math.round(r.height*dpr);sv.style.width=r.width+'px';sv.style.height=r.height+'px';}
function drawScan(){
 const cur=SC.mode==='crop'?SC.src:SC.out;if(!cur)return;const dpr=devicePixelRatio||1,W=sv.width,H=sv.height,pad=(SC.mode==='crop'?26:10)*dpr;
 const k=Math.min((W-2*pad)/cur.width,(H-2*pad)/cur.height);SC.k=k;SC.ox=(W-cur.width*k)/2;SC.oy=(H-cur.height*k)/2;
 sctx.clearRect(0,0,W,H);sctx.imageSmoothingQuality='high';sctx.drawImage(cur,SC.ox,SC.oy,cur.width*k,cur.height*k);
 if(SC.mode!=='crop')return;
 const P=SC.quad.map(([x,y])=>[SC.ox+x*k,SC.oy+y*k]);
 sctx.save();sctx.fillStyle='rgba(8,16,24,.55)';sctx.beginPath();sctx.rect(0,0,W,H);sctx.moveTo(...P[0]);for(let i=3;i>=0;i--)sctx.lineTo(...P[i]);sctx.closePath();sctx.fill('evenodd');sctx.restore();
 sctx.lineWidth=2*dpr;sctx.strokeStyle='#3ddc97';sctx.beginPath();sctx.moveTo(...P[0]);for(let i=1;i<4;i++)sctx.lineTo(...P[i]);sctx.closePath();sctx.stroke();
 for(const [x,y] of P){sctx.beginPath();sctx.arc(x,y,11*dpr,0,7);sctx.fillStyle='rgba(255,255,255,.92)';sctx.fill();sctx.strokeStyle='#2fbf8a';sctx.lineWidth=3*dpr;sctx.stroke();}
}
const spt=e=>{const r=sv.getBoundingClientRect();return {x:(e.clientX-r.left)*sv.width/r.width,y:(e.clientY-r.top)*sv.height/r.height};};
sv.onpointerdown=e=>{if(SC.mode!=='crop')return;const p=spt(e);let bi=-1,bd=1e9;SC.quad.forEach(([x,y],i)=>{const d=Math.hypot(SC.ox+x*SC.k-p.x,SC.oy+y*SC.k-p.y);if(d<bd){bd=d;bi=i;}});if(bd<64*(devicePixelRatio||1)){SC.drag=bi;sv.setPointerCapture(e.pointerId);}};
sv.onpointermove=e=>{if(SC.drag<0)return;const p=spt(e);SC.quad[SC.drag]=[Math.max(0,Math.min(SC.src.width,(p.x-SC.ox)/SC.k)),Math.max(0,Math.min(SC.src.height,(p.y-SC.oy)/SC.k))];drawScan();};
sv.onpointerup=sv.onpointercancel=()=>{SC.drag=-1;};
function rotateCanvas(c){const o=mk(c.height,c.width),x=o.getContext('2d');x.translate(c.height,0);x.rotate(Math.PI/2);x.drawImage(c,0,0);return o;}
function warp(src,q){
 const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);let w=(dist(q[0],q[1])+dist(q[3],q[2]))/2,h=(dist(q[0],q[3])+dist(q[1],q[2]))/2;
 const k=Math.min(1,2200/Math.max(w,h));w=Math.max(60,Math.round(w*k));h=Math.max(60,Math.round(h*k));
 const out=mk(w,h),o=out.getContext('2d'),od=o.createImageData(w,h),o8=od.data,sw=src.width,sh=src.height,sd=src.getContext('2d').getImageData(0,0,sw,sh).data;
 for(let y=0;y<h;y++){const v=y/(h-1),ax=q[0][0]+(q[3][0]-q[0][0])*v,ay=q[0][1]+(q[3][1]-q[0][1])*v,bx=q[1][0]+(q[2][0]-q[1][0])*v,by=q[1][1]+(q[2][1]-q[1][1])*v;
  for(let x=0;x<w;x++){const u=x/(w-1),sx=Math.min(sw-1.001,Math.max(0,ax+(bx-ax)*u)),sy=Math.min(sh-1.001,Math.max(0,ay+(by-ay)*u)),x0=sx|0,y0=sy|0,fx=sx-x0,fy=sy-y0,i00=(y0*sw+x0)*4,i10=i00+4,i01=i00+sw*4,i11=i01+4,oi=(y*w+x)*4;
   for(let c=0;c<4;c++)o8[oi+c]=(sd[i00+c]*(1-fx)+sd[i10+c]*fx)*(1-fy)+(sd[i01+c]*(1-fx)+sd[i11+c]*fx)*fy;}}
 o.putImageData(od,0,0);return out;
}
function background(c){const w=c.width,h=c.height,sm=mk(Math.max(2,Math.round(w/24)),Math.max(2,Math.round(h/24))),sx=sm.getContext('2d');sx.imageSmoothingQuality='high';sx.drawImage(c,0,0,sm.width,sm.height);const bg=mk(w,h),bx=bg.getContext('2d');bx.imageSmoothingQuality='high';bx.drawImage(sm,0,0,w,h);return bx.getImageData(0,0,w,h).data;}
function applyFilter(){
 const b=SC.base,w=b.width,h=b.height,out=mk(w,h),o=out.getContext('2d');
 if(SC.filter==='orig'){o.drawImage(b,0,0);SC.out=out;return;}
 const img=b.getContext('2d').getImageData(0,0,w,h),d=img.data,bg=background(b),f=SC.filter;
 const gm=v=>255*Math.pow(Math.min(255,Math.max(0,v))/255,1.3);
 for(let i=0;i<d.length;i+=4){
  const r=d[i]*255/Math.max(40,bg[i]*.94),g=d[i+1]*255/Math.max(40,bg[i+1]*.94),bl=d[i+2]*255/Math.max(40,bg[i+2]*.94);
  if(f==='magic'){d[i]=gm(r);d[i+1]=gm(g);d[i+2]=gm(bl);}
  else{const l=Math.min(255,.3*r+.59*g+.11*bl);if(f==='gray'){const v=gm(l);d[i]=d[i+1]=d[i+2]=v;}else{const v=Math.max(0,Math.min(255,(l-115)*255/75));d[i]=d[i+1]=d[i+2]=v;}}
  d[i+3]=255;}
 o.putImageData(img,0,0);SC.out=out;
}
function scBusy(on){$('scBusy').hidden=!on;}
function scMode(m){SC.mode=m;$('scCropBar').hidden=m!=='crop';$('scFilterBar').hidden=m!=='filter';$('scTitle').textContent=m==='crop'?'Kırp':'İyileştir';$('scNext').innerHTML=m==='crop'?IC.right:IC.ok;$('scNext').setAttribute('aria-label',m==='crop'?'İleri':'Bitti');$('scCancel').innerHTML=m==='crop'?IC.x:IC.left;$('scCancel').setAttribute('aria-label',m==='crop'?'İptal':'Geri');for(const b of document.querySelectorAll('#scFilterBar [data-f]'))b.classList.toggle('on',b.dataset.f===SC.filter);}
const later=fn=>{scBusy(true);setTimeout(()=>{try{fn();}finally{scBusy(false);}},30);};
async function openScan(blob){
 let step='görüntü yükleme';
 try{
  if(!(blob instanceof Blob))throw Error('görüntü bulunamadı');
  SC.filter='magic';SC.src=await loadBitmap(blob);
  step='kenar algılama';try{SC.quad=autoQuad(SC.src);}catch{SC.quad=fullQuad(SC.src);}
  step='ekran açma';scMode('crop');if(!$('scanEditor').open)$('scanEditor').showModal();
  requestAnimationFrame(()=>{try{fitView();drawScan();}catch{}});
 }catch(e){throw Error('Kırpma ekranı açılamadı ('+step+'): '+String(e?.message||e).slice(0,80));}
}
window.openScan=openScan;
$('editImage').onclick=caught(()=>openScan(editing.image));
$('scAuto').onclick=()=>{SC.quad=autoQuad(SC.src);drawScan();};$('scFull').onclick=()=>{SC.quad=fullQuad(SC.src);drawScan();};
$('scRot').onclick=()=>{const h=SC.src.height;SC.quad=SC.quad.map(([x,y])=>[h-y,x]);SC.src=rotateCanvas(SC.src);drawScan();};
$('scRot2').onclick=()=>later(()=>{SC.base=rotateCanvas(SC.base);applyFilter();drawScan();});
$('scBack').onclick=()=>{scMode('crop');drawScan();};
for(const b of document.querySelectorAll('#scFilterBar [data-f]'))b.onclick=()=>{SC.filter=b.dataset.f;scMode('filter');later(()=>{applyFilter();drawScan();});};
$('scCancel').onclick=()=>{if(SC.mode==='filter'){scMode('crop');drawScan();}else $('scanEditor').close();};
async function scSave(){const blob=await new Promise(ok=>SC.out.toBlob(ok,'image/jpeg',.9));if(!blob)throw Error('Görüntü kaydedilemedi.');editing.image=blob;editing.imageEdited=true;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);$('preview').src=previewUrl;$('scanEditor').close();say('Görüntü güncellendi. Taslağı kaydedince cihaza yazılır.');}
$('scNext').onclick=caught(async()=>{if(SC.mode==='crop'){later(()=>{SC.base=warp(SC.src,SC.quad);scMode('filter');applyFilter();drawScan();});return;}await scSave();});
$('scGem').onclick=caught(async()=>{await scSave();$('aiRead').click();});
addEventListener('resize',()=>{if($('scanEditor').open){fitView();drawScan();}});

// ===== Yapay zeka desteği (Gemini, doğrudan cihazdan) =====
const AIH='https://generativelanguage.googleapis.com/v1beta/';
const aiCfg=()=>{try{return JSON.parse(localStorage.getItem('ai')||'{}');}catch{return {};}};
function docIssues(d){
 if(d.is_z_report)return !(Number(d.toplam)>0)||!/^\d{2}\.\d{2}\.\d{4}$/.test(d.evrak_tarihi||'');
 const gross=(d.kalemler||[]).reduce((a,l)=>a+Number(l.matrah)+Number(l.kdv),0),t=Number(d.toplam);
 return !d.aciklama||looksLikeProduct(d.aciklama)||!isValidVkn(d.vkn)||!/^\d{2}\.\d{2}\.\d{4}$/.test(d.evrak_tarihi||'')||!d.evrak_no||!(t>0)||!(d.kalemler||[]).length||Math.abs(gross-t)>0.05;
}
async function aiFetch(path,key,body,ms=30000){
 const r=await fetch(AIH+path,{method:body?'POST':'GET',headers:{'x-goog-api-key':key,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(ms)});
 if(!r.ok){let m='';try{m=(await r.json()).error?.message||'';}catch{}const e=Error(r.status===429?'Yapay zeka günlük/dakikalık ücretsiz sınıra ulaştı. Biraz sonra deneyin.':r.status===400&&/API key/i.test(m)||r.status===403?'Gemini anahtarı geçersiz ya da yetkisiz.':'Yapay zeka hatası ('+r.status+'): '+m.slice(0,140));e.status=r.status;throw e;}
 return r.json();
}
async function aiModels(key,cfg){
 if(!cfg.model&&cfg.lastModel)return ['models/'+cfg.lastModel];
 if(cfg.model)return ['models/'+cfg.model.replace(/^models\//,'')];
 const list=(await aiFetch('models?pageSize=200',key)).models||[];
 const c=list.filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')&&/^models\/gemini-[\d.]+-flash(-lite)?$/.test(m.name)).map(m=>m.name);
 const ver=n=>parseFloat(n.match(/gemini-([\d.]+)/)[1]),lite=n=>/lite/.test(n)?1:0;
 c.sort((a,b)=>ver(b)-ver(a)||lite(a)-lite(b));
 if(!c.length)throw Error('Anahtarla erişilebilen uygun Gemini modeli bulunamadı. Model alanına elle yazın.');
 return c.slice(0,3);
}
async function shrink(blob){const c=await loadBitmap(blob),k=Math.min(1,1800/Math.max(c.width,c.height)),o=mk(Math.round(c.width*k),Math.round(c.height*k));o.getContext('2d').drawImage(c,0,0,o.width,o.height);const b=await new Promise(ok=>o.toBlob(ok,'image/jpeg',.85));return await new Promise((ok,bad)=>{const f=new FileReader();f.onload=()=>ok(f.result.split(',')[1]);f.onerror=()=>bad(f.error);f.readAsDataURL(b);});}
function aiPrompt(kind){
 return `Bu bir Türkiye'de düzenlenmiş fiş, fatura veya Z raporu fotoğrafı. Yalnızca görselde açıkça okuyabildiğin bilgileri ver; okuyamadığını uydurma, boş bırak.
Belge kategorisi: ${kind==='gelir'?'GELİR':'GİDER'}.
Kurallar:
- unvan: ${kind==='gelir'?'Fatura ise ALICI (SAYIN) ünvanı; fiş/Z raporu ise belgeyi düzenleyen işyeri.':'Belgeyi düzenleyen (satıcı) işyerinin resmî ünvanı.'} Şirketse tam ticari ünvan (A.Ş., LTD. ŞTİ. dahil). Şahıs işletmesiyse (işletme adının altında kişi adı yazıyorsa) kişinin ad ve soyadı. ÜRÜN, hizmet, şube, adres, kasiyer adını ASLA ünvan yazma.
- vkn_tckn: yalnız rakam, 10 (VKN) ya da 11 (TCKN) hane. ${kind==='gelir'?'Faturada yalnız ALICININ numarasını yaz; Z raporunda boş bırak':'Yalnız SATICININ numarasını yaz; alıcı/müşteri numarasını yazma'}.
- tarih: GG.AA.YYYY. belge_no: fatura/fiş numarası (Z raporunda Z no). Sipariş, irsaliye, kasa, sicil numaralarını yazma.
- toplam: KDV dahil ödenecek genel toplam (sayı, nokta ondalık). Para üstü, ara toplam, indirim değildir.
- kdv: belgede görünen her KDV oranı için {oran, kdv_dahil_tutar}. Oranlar yalnız 0,1,8,10,18,20 olabilir.
- belge_turu: "fis", "fatura" veya "z_raporu".
Yalnızca şu JSON'u döndür: {"belge_turu":"","unvan":"","vkn_tckn":"","tarih":"","belge_no":"","toplam":0,"kdv":[{"oran":0,"kdv_dahil_tutar":0}]}`;
}
function mergeAi(d,a,force){
 const out={...d};if(out.zero_excluded){out.toplam=out.original_total;out.kalemler=[...(out.kalemler||[]),vatLine(0,out.zero_excluded)];delete out.zero_excluded;}const q=!!out.qr_raw,dateOk=x=>/^\d{2}\.\d{2}\.\d{4}$/.test(x||'');
 if(a.belge_turu==='z_raporu'){out.is_z_report=true;out.is_invoice=false;}else if(a.belge_turu==='fatura'&&!out.is_z_report)out.is_invoice=true;
 if(!out.is_z_report){
  const t=String(a.unvan||'').replace(/\s+/g,' ').trim();
  if(t.length>=3&&!looksLikeProduct(t)&&((force&&!q)||!out.aciklama))out.aciklama=t;
  const v=String(a.vkn_tckn||'').replace(/\D/g,'');
  if(((force&&!q)||!isValidVkn(out.vkn))&&isValidVkn(v))out.vkn=v;else if(!out.vkn&&/^\d{10,11}$/.test(v))out.vkn=v;
 }
 const m=String(a.tarih||'').match(/(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{4})/);
 if(m&&((force&&!q)||!dateOk(out.evrak_tarihi))){const dt=`${m[1].padStart(2,'0')}.${m[2].padStart(2,'0')}.${m[3]}`;out.evrak_tarihi=dt;out.tarih=dt;}
 const no=String(a.belge_no||'').trim();if(no&&((force&&!q)||!out.evrak_no))out.evrak_no=no.replace(/^0+(?=\d)/,'');
 const tot=typeof a.toplam==='number'?a.toplam:money(a.toplam);
 if(Number.isFinite(tot)&&tot>0&&((force&&!q)||!(Number(out.toplam)>0)))out.toplam=tot.toFixed(2);
 const rows=(Array.isArray(a.kdv)?a.kdv:[]).filter(r=>[0,1,8,10,18,20].includes(Number(r.oran))&&Number(r.kdv_dahil_tutar)>0).map(r=>vatLine(r.oran,r.kdv_dahil_tutar));
 if(rows.length){
  // Keep QR tax amounts; fill missing rates only when the combined total balances.
  const existing=q?(out.kalemler||[]):[],rates=new Set(existing.map(l=>Number(l.oran)));
  const merged=[...existing,...rows.filter(l=>!rates.has(Number(l.oran)))];
  const sum=merged.reduce((s,l)=>s+Number(l.matrah)+Number(l.kdv),0);
  if(Number(out.toplam)>0&&Math.abs(sum-Number(out.toplam))<=0.05){out.kalemler=merged;
   out.qr_warnings=(out.qr_warnings||[]).filter(w=>!w.startsWith('Kodda KDV dağılımı bulunamadı'));
  }
 }
 // Preserve explicit Z gross rows even if the AI confuses TOPKDV with revenue.
 if(out.ocr){const z=parseDraft(out.ocr,out.kind||'gelir');if(z.is_z_report&&z.kalemler.length){
  out.is_z_report=true;out.is_invoice=false;out.vkn='';out.aciklama='Z RAPORU';out.kalemler=z.kalemler;out.toplam=z.toplam;
 }}
 out.ai_used=true;return excludeAutomaticZero(out);
}
async function aiAssist(blob,d,kind,force){
 const cfg=aiCfg();
 if(!cfg.key||(cfg.mode==='off'&&!force)||(!force&&cfg.mode==='issues'&&!docIssues(d))){if(force)throw Error('Önce Bağlantı ayarlarından Gemini anahtarını girin.');return d;}
 try{
  say('Yapay zeka okuyor…');
  const b64=await shrink(blob),models=await aiModels(cfg.key,cfg);let last;
  for(const model of models){
   try{
    const res=await aiFetch(model+':generateContent',cfg.key,{contents:[{parts:[{text:aiPrompt(kind)},{inline_data:{mime_type:'image/jpeg',data:b64}}]}],generationConfig:{temperature:0,responseMimeType:'application/json'}},60000);
    const text=(res.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join(''),i=text.indexOf('{'),j=text.lastIndexOf('}');
    if(i<0)throw Error('Yapay zeka boş yanıt verdi.');
    const out=mergeAi(d,JSON.parse(text.slice(i,j+1)),force);out.ai_model=model.replace('models/','');localStorage.setItem('ai',JSON.stringify({...cfg,lastModel:out.ai_model}));
    say('Yapay zeka okumayı tamamladı. Bilgileri kontrol edin.');return resolveVendor(out);
   }catch(e){last=e;if(cfg.lastModel&&![429,401,403].includes(e.status)){const c2=aiCfg();delete c2.lastModel;localStorage.setItem('ai',JSON.stringify(c2));}if(e.status===429||e.status===401||e.status===403)break;}
  }
  throw last||Error('Yapay zeka yanıt vermedi.');
 }catch(e){if(force)throw e;say('Yapay zeka kullanılamadı, yerel okuma kullanıldı: '+e.message,true);return d;}
}
$('aiRead').onclick=caught(async()=>{
 if(editing.state==='approved')throw Error('Onaylı belgeyi değiştirmeden önce onayını kaldırın.');
 const data=await aiAssist(editing.image,{...editing.data},editing.kind,true);
 data.vat_reviewed_rates=[];editing={...editing,data};await openDocument({...editing,image:editing.image});say('Yapay zeka okumasını uyguladı. Değişiklikleri kontrol edip kaydedin.');
});
$('settingsBtn').addEventListener('click',()=>{const c=aiCfg();$('aiKey').value=c.key||'';$('aiMode').value=c.mode||'issues';$('aiModel').value=c.model||'';});
$('aiSave').onclick=caught(async()=>{
 const cfg={key:$('aiKey').value.trim(),mode:$('aiMode').value,model:$('aiModel').value.trim()};
 if(!cfg.key){localStorage.setItem('ai',JSON.stringify({...cfg,mode:'off'}));say('Yapay zeka kapatıldı.');return;}
 const models=await aiModels(cfg.key,cfg);localStorage.setItem('ai',JSON.stringify(cfg));say('Anahtar geçerli. Kullanılacak model: '+models[0].replace('models/',''));
});


// ===== v0.9: ikonlar, yerel cari/mükellef, kalıcı silme, tema =====
const IC={trash:'<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',restore:'<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 3-6.200M4 4v5h5"/></svg>',gem:'<svg viewBox="0 0 24 24"><path d="M12 2c.6 5.600 4.400 9.400 10 10-5.600.6-9.400 4.400-10 10-.6-5.600-4.400-9.400-10-10 5.600-.6 9.400-4.400 10-10z"/></svg>',crop:'<svg viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/></svg>',qr:'<svg viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v6h-4M14 18v2"/></svg>',check:'<svg viewBox="0 0 24 24"><path d="M4 6h10M4 12h8M4 18h6M15 16l2 2 4-5"/></svg>',rot:'<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.700M21 4v5h-5"/></svg>',auto:'<svg viewBox="0 0 24 24"><path d="M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3"/><path d="m9 12 2 2 4-4"/></svg>',full:'<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',pen:'<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/></svg>',x:'<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',left:'<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',right:'<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',ok:'<svg viewBox="0 0 24 24"><path d="M5 12.500l4.500 4.500L19 7"/></svg>',plus:'<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',sun:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.500 1.500M17.500 17.500 19 19M5 19l1.500-1.500M17.500 6.500 19 5"/></svg>',link:'<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1"/></svg>'};
var purgedCache=null;
function isPurged(id){if(!purgedCache){try{purgedCache=new Set(JSON.parse(localStorage.getItem('purged')||'[]'));}catch{purgedCache=new Set();}}return purgedCache.has(id);}
function purgedAdd(id){isPurged(id);purgedCache.add(id);localStorage.setItem('purged',JSON.stringify([...purgedCache]));}
function localCat(){let l={};try{l=JSON.parse(localStorage.getItem('local_catalog')||'{}');}catch{}return {vendors:l.vendors||[],clients:l.clients||[],vEdits:l.vEdits||{},cEdits:l.cEdits||{}};}
function saveLocal(l){localStorage.setItem('local_catalog',JSON.stringify(l));}
function mergeLocal(c){const l=localCat(),vendors=(c.vendors||[]).map(v=>l.vEdits[v.vkn]?{...v,...l.vEdits[v.vkn],edited:true,origVkn:v.vkn}:v);for(const v of l.vendors){const existing=vendors.find(x=>String(x.vkn)===String(v.vkn));if(!existing)vendors.push({...v,local:true});else if(v.autoPending||v.confirmedAt)Object.assign(existing,{name:v.name});}const clients=(c.clients||[]).map(x=>l.cEdits[x.id]?{...x,name:l.cEdits[x.id],edited:true}:x);for(const x of l.clients)if(!clients.some(y=>y.id===x.id))clients.push({...x,local:true});return {...c,vendors:alphabetic(vendors),clients:alphabetic(clients)};}
function refreshCatalog(){let raw={clients:[],vendors:[]};try{raw=JSON.parse(localStorage.getItem('catalog')||'')||raw;}catch{}catalog=mergeLocal(raw);renderClients();vendors();clientsView();resolveVendorsUi?.();}
var resolveVendorsUi=null;
let ENT=null,entWarned=false;
function openEntry(type,obj){ENT={type,obj};openProfile(type,obj);entWarned=false;const isV=type==='vendor';$('entryTitle').textContent=(obj?'Düzenle: ':'Yeni ')+(isV?'cari':'mükellef');$('entryName').value=obj?.name||'';$('entryVkn').value=obj?String(obj.vkn||''):'';$('entryVkn').disabled=!!(obj&&!obj.local);$('entryVknLbl').hidden=!isV;$('entryMsg').textContent=isV?'Ofise kaydedilir; bilgisayar programı bir sonraki eşitlemede alır. Bağlantı yoksa yalnız bu telefonda saklanır.':'Ofise kaydedilir. Bilgisayar programı mükellefi eşitlemede oluşturur; KDV hesap tanımlarını bilgisayarda girmeniz gerekir.';$('entryDel').hidden=!(obj&&(obj.local||obj.edited));$('entryDel').textContent=obj?.local?'Sil':'Orijinale dön';$('entryDlg').showModal();}
$('addVendor').onclick=()=>openEntry('vendor',null);$('addClient').onclick=()=>openEntry('client',null);$('entryCancel').onclick=()=>$('entryDlg').close();
const online=()=>configured()&&(!!window.FisDesktop||navigator.onLine);
const netErr=e=>!!e?.network||e instanceof TypeError||/Failed to fetch|NetworkError|Load failed|timeout/i.test(e?.message||'');
const oldServer=e=>/Bulunamadı|desteklenmiyor/.test(e?.message||'')||netErr(e);
const fixErr=e=>netErr(e)?Error('Ofise bağlanılamadı; internet bağlantısını kontrol edin.'):/Bulunamadı|desteklenmiyor/.test(e?.message||'')?needUpdate():e;
const needUpdate=()=>Error('Sunucu henüz güncellenmedi (Sunucu-Guncelleme paketi yayınlanmalı).');
async function pullCatalog(){const c=await (await api('/api/catalog')).json();localStorage.setItem('catalog',JSON.stringify(c));}
$('entrySave').onclick=caught(async()=>{
 let serverOld=false;const name=$('entryName').value.replace(/\s+/g,' ').trim(),isV=ENT.type==='vendor',vkn=$('entryVkn').value.replace(/\D/g,''),o=ENT.obj,l=localCat();
 if(name.length<2)throw Error('Ünvan / ad girin.');
 if(isV){
  if(!/^\d{10,11}$/.test(vkn))throw Error('VKN 10, TCKN 11 haneli olmalı.');
  if(!isValidVkn(vkn)&&!entWarned){entWarned=true;$('entryMsg').textContent='Bu numara doğrulama kontrolünden geçmiyor. Doğruysa Kaydet\'e tekrar basın.';return;}
  const dup=catalog.vendors.find(v=>String(v.vkn)===vkn&&!(o&&String(v.vkn)===String(o.vkn)));if(dup)throw Error('Bu VKN zaten kayıtlı: '+dup.name);
  if(online()){
   try{await jsonApi('/api/vendors',{vkn,name},'POST');}catch(e){if(!oldServer(e))throw e;serverOld=true;}
   if(serverOld){if(!o)l.vendors.push({vkn,name});else if(o.local){const t=l.vendors.find(v=>String(v.vkn)===String(o.vkn));if(t){t.vkn=vkn;t.name=name;}}else l.vEdits[o.origVkn??o.vkn]={vkn,name};saveLocal(l);}else{
   l.vendors=l.vendors.filter(v=>String(v.vkn)!==vkn&&!(o&&String(v.vkn)===String(o.vkn)));if(o)delete l.vEdits[o.origVkn??o.vkn];delete l.vEdits[vkn];saveLocal(l);await pullCatalog();}
  }else{
   if(!o)l.vendors.push({vkn,name});else if(o.local){const t=l.vendors.find(v=>String(v.vkn)===String(o.vkn));if(t){t.vkn=vkn;t.name=name;}}else l.vEdits[o.origVkn??o.vkn]={vkn,name};saveLocal(l);
  }
 }else{
  if(!online())throw Error('Mükellef eklemek/düzenlemek için ofis bağlantısı ve internet gerekir.');
  if(!o||o.local){let r;try{r=await jsonApi('/api/clients',{name,profile:readProfile()},'POST');}catch(e){throw fixErr(e);}if(o?.local){l.clients=l.clients.filter(c=>c.id!==o.id);saveLocal(l);}if(!o&&r.id){localStorage.setItem('client',r.id);}}
  else{try{await jsonApi('/api/clients/'+o.id,{name,profile:readProfile(),revision:o.revision},'PATCH');}catch(e){throw fixErr(e);}delete l.cEdits[o.id];saveLocal(l);}
  await pullCatalog();
 }
 $('entryDlg').close();refreshCatalog();say(online()&&!serverOld?'Kaydedildi ve ofise gönderildi.':'Kaydedildi (yalnız bu telefonda; bağlanınca eşitlemez).');
});
$('entryDel').onclick=caught(async()=>{const o=ENT.obj,l=localCat(),isV=ENT.type==='vendor';if(o.local){if(isV)l.vendors=l.vendors.filter(v=>String(v.vkn)!==String(o.vkn));else l.clients=l.clients.filter(c=>c.id!==o.id);}else if(isV)delete l.vEdits[o.origVkn??o.vkn];else delete l.cEdits[o.id];saveLocal(l);$('entryDlg').close();refreshCatalog();say(o.local?'Silindi.':'Orijinal kayda dönüldü.');});
function applyTheme(){const m=localStorage.getItem('theme')||'auto',d=m==='dark'||(m==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';for(const b of document.querySelectorAll('#themeOpts [data-th]'))b.classList.toggle('on',b.dataset.th===m);$('themeCardSub').textContent={auto:'Otomatik',light:'Aydınlık',dark:'Karanlık'}[m];}
for(const b of document.querySelectorAll('#themeOpts [data-th]'))b.onclick=()=>{localStorage.setItem('theme',b.dataset.th);applyTheme();};
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',applyTheme);applyTheme();
function settingsSubs(){let host='';try{host=new URL(cfg.url).host;}catch{}$('srvCardSub').textContent=host?'Bağlı: '+host:'Bağlı değil';const a=aiCfg();$('aiCardSub').textContent=!a.key||a.mode==='off'?'Kapalı':a.mode==='always'?'Her fişte':'Yalnız şüpheli fişlerde';}
$('settingsBtn').addEventListener('click',settingsSubs);$('aiSave').addEventListener('click',()=>setTimeout(settingsSubs,600));$('connect').addEventListener('click',()=>setTimeout(settingsSubs,1500));

// ===== Otomatik gönderim: bağlantı gelince / uygulama öne gelince / periyodik =====
let syncTimer;const scheduleSync=()=>{clearTimeout(syncTimer);syncTimer=setTimeout(()=>{if(configured()&&(!!window.FisDesktop||navigator.onLine)&&!document.hidden)sync(true).catch(()=>{});},2500);};
addEventListener('online',scheduleSync);document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleSync();});
setInterval(async()=>{try{if(document.hidden||!configured()||!(!!window.FisDesktop||navigator.onLine)||busy||!$('editor').hidden)return;const rows=await all();if(rows.some(r=>!r.deleted)||localCat().vendors.some(v=>v.autoPending))sync(true).catch(()=>{});}catch{}},60000);

const sleepMs=ms=>new Promise(r=>setTimeout(r,ms));
async function probe(url,opts={}){const t0=performance.now();try{const r=await fetch(url,{...opts,signal:AbortSignal.timeout(12000)});return {ok:true,status:r.status,type:r.type,ms:Math.round(performance.now()-t0)};}catch(e){return {ok:false,err:e?.name==='TimeoutError'?'zaman aşımı':'ağ hatası',ms:Math.round(performance.now()-t0)};}}
$('diagBtn').onclick=caught(async()=>{
 const out=$('diagOut');out.textContent='Test ediliyor…';
 const lines=[];const online=(!!window.FisDesktop||navigator.onLine);lines.push('Telefon çevrimiçi görünüyor: '+(online?'evet':'HAYIR'));
 const net=navigator.connection?.effectiveType;if(net)lines.push('Bağlantı türü: '+net+(navigator.connection.saveData?' (veri tasarrufu açık)':''));
 const g=await probe('https://www.gstatic.com/generate_204',{mode:'no-cors'});lines.push('Genel internet (gstatic): '+(g.ok?'erişilebilir ('+g.ms+' ms)':'ERİŞİLEMİYOR ('+g.err+')'));
 const targets=[['Ana adres',cfg.url],...(cfg.alt?[['Yedek adres',cfg.alt]]:[])];let primaryOk=false;
 for(const [label,u] of targets){if(!u)continue;const host=new URL(u).host;const a=await probe(u+'/',{mode:'no-cors'});lines.push(label+' ('+host+'): '+(a.ok?'ulaşıldı ('+a.ms+' ms)':'ULAŞILAMADI ('+a.err+')'));
  if(a.ok){const b=await probe(u+'/api/catalog',{headers:{Authorization:'Bearer '+cfg.token}});lines.push('  API yanıtı: '+(b.ok?(b.status===200?'tamam (200)':'HTTP '+b.status+(b.status===401?' – bağlantı anahtarı geçersiz':'')):'engellendi ('+b.err+')'));if(b.ok&&b.status===200&&label==='Ana adres')primaryOk=true;}}
 let hint='';
 if(!online||(!g.ok))hint='Telefonun interneti çalışmıyor görünüyor. Mobil veriyi/uçak modunu kontrol edin.';
 else if(!primaryOk&&!targets.slice(1).length)hint='İnternet var ama sunucu adresine ulaşılamıyor. Bu, Wi‑Fi\'da çalışıp mobil veride çalışmamasının tipik belirtisidir: operatör ya da DNS bu adresi engelliyor olabilir. Deneyin: Android Ayarlar › Özel DNS › dns.google (veya one.one.one.one). Olmazsa Cloudflare\'e kendi alan adınızı bağlayıp yukarıdaki "Yedek adres" alanına yazın.';
 else if(!primaryOk)hint='Ana adres bu ağda engelli olabilir; yedek adres denenecek.';
 else hint='Bağlantı sağlıklı görünüyor.';
 lines.push('');lines.push(hint);out.textContent=lines.join('\n');
});

// ===== Düzeltme kaydı: ne okundu, siz neyi düzelttiniz (fotoğrafla birlikte, yalnız bu telefonda) =====
const logDb=await new Promise((ok,bad)=>{const r=indexedDB.open('fis-cep-log',1);r.onupgradeneeded=()=>r.result.createObjectStore('corr',{keyPath:'id'});r.onsuccess=()=>ok(r.result);r.onerror=()=>bad(r.error);});
const lstore=(mode,fn)=>new Promise((ok,bad)=>{const tx=logDb.transaction('corr',mode),r=fn(tx.objectStore('corr'));tx.oncomplete=()=>ok(r.result);tx.onerror=()=>bad(tx.error);});
const logAll=()=>lstore('readonly',s=>s.getAll()),logPut=x=>lstore('readwrite',s=>s.put(x)),logClear=()=>lstore('readwrite',s=>s.clear());
function snap(d){return {aciklama:d.aciklama||'',vkn:d.vkn||'',evrak_no:d.evrak_no||'',evrak_tarihi:d.evrak_tarihi||'',toplam:d.toplam||'',is_z_report:!!d.is_z_report,is_invoice:!!d.is_invoice,kalemler:(d.kalemler||[]).map(l=>({oran:String(Number(l.oran)),matrah:String(l.matrah),kdv:String(l.kdv)})),ai_used:!!d.ai_used,ai_model:d.ai_model||'',vendor_source:d.vendor_source||''};}
function diffSnap(a,b){const ch=[];for(const k of ['aciklama','vkn','evrak_no','evrak_tarihi','is_z_report','is_invoice'])if(String(a[k])!==String(b[k]))ch.push({alan:k,okunan:a[k],dogru:b[k]});if(Math.abs(Number(a.toplam||0)-Number(b.toplam||0))>0.004)ch.push({alan:'toplam',okunan:a.toplam,dogru:b.toplam});if(JSON.stringify(a.kalemler)!==JSON.stringify(b.kalemler))ch.push({alan:'kalemler',okunan:a.kalemler,dogru:b.kalemler});return ch;}
async function shrinkBlob(blob,max=1500,q=.8){const c=await loadBitmap(blob),k=Math.min(1,max/Math.max(c.width,c.height)),o=mk(Math.round(c.width*k),Math.round(c.height*k));o.getContext('2d').drawImage(c,0,0,o.width,o.height);return await new Promise(ok=>o.toBlob(ok,'image/jpeg',q));}
async function logCorrection(r){
 if(!r.orig)return;const fin=snap(r.data),changes=diffSnap(r.orig,fin);
 const rec={id:r.id,at:new Date().toISOString(),client:clientName(r.client),kind:r.kind,app:'0.13.7',orig:r.orig,final:fin,changes,degisti:changes.length>0,ocr:String(r.data.ocr||'').slice(0,6000),qr_raw:r.data.qr_raw||'',image:null};
 if(changes.length){let image=r.image;if(!image){try{image=await (await api('/api/documents/'+r.id+'/image')).blob();}catch{}}if(image)rec.image=await shrinkBlob(image);}
 await logPut(rec);logSub();
}
async function logSub(){try{const rows=await logAll(),n=rows.filter(x=>x.degisti).length;$('logCardSub').textContent=rows.length?rows.length+' kayıt · '+n+' düzeltme':'Kayıt yok';$('logInfo').textContent=rows.length?('Toplam '+rows.length+' onaylı fiş kaydı; bunların '+n+' tanesinde bir alanı düzelttiniz (fotoğrafları da saklanır).'):'Henüz kayıt yok. Hatalı okunan bir fişi düzeltip Onayla ve gönder\'e basınca burada birikir.';}catch{}}
const crcT=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc32=u=>{let c=0xFFFFFFFF;for(let i=0;i<u.length;i++)c=crcT[(c^u[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;};
function zipStore(files){
 const enc=new TextEncoder(),chunks=[],central=[];let off=0;
 for(const f of files){const nm=enc.encode(f.name),crc=crc32(f.data),sz=f.data.length;
  const lh=new DataView(new ArrayBuffer(30));lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint16(12,0x21,true);lh.setUint32(14,crc,true);lh.setUint32(18,sz,true);lh.setUint32(22,sz,true);lh.setUint16(26,nm.length,true);
  chunks.push(new Uint8Array(lh.buffer),nm,f.data);
  const ch=new DataView(new ArrayBuffer(46));ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint16(14,0x21,true);ch.setUint32(16,crc,true);ch.setUint32(20,sz,true);ch.setUint32(24,sz,true);ch.setUint16(28,nm.length,true);ch.setUint32(42,off,true);
  central.push(new Uint8Array(ch.buffer),nm);off+=30+nm.length+sz;}
 const cd=central.reduce((a,c)=>a+c.length,0),end=new DataView(new ArrayBuffer(22));end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,cd,true);end.setUint32(16,off,true);
 return new Blob([...chunks,...central,new Uint8Array(end.buffer)],{type:'application/zip'});
}
const blobB64=b=>new Promise((ok,bad)=>{const f=new FileReader();f.onload=()=>ok(String(f.result).split(',')[1]);f.onerror=()=>bad(f.error);f.readAsDataURL(b);});
async function exportCorrections(){
 const rows=await logAll();if(!rows.length)throw Error('Henüz düzeltme kaydı yok.');
 const meta=rows.map(({image,...r})=>({...r,image_file:image?'images/'+r.id+'.jpg':null})),enc=new TextEncoder(),day=new Date().toISOString().slice(0,10);
 const files=[{name:'duzeltmeler.json',data:enc.encode(JSON.stringify({exported:new Date().toISOString(),app:'0.13.7',count:rows.length,records:meta},null,1))},{name:'OKU.txt',data:enc.encode('Fiş Asistanı düzeltme kayıtları. duzeltmeler.json: her fiş için uygulamanın okuduğu (orig) ve sizin onayladığınız (final) değerler, değişen alanlar (changes). images/: düzeltilen fişlerin fotoğrafları. Kişisel veri içerir; yalnız güvendiğiniz kişiyle paylaşın.')}];
 for(const r of rows)if(r.image)files.push({name:'images/'+r.id+'.jpg',data:new Uint8Array(await r.image.arrayBuffer())});
 const zip=zipStore(files),name='duzeltmeler-'+day+'.zip';
 if(window.FisDesktop){const r=await window.FisDesktop.saveFile({name,base64:await blobB64(zip)});return r.saved?'Düzeltme kayıtları kaydedildi.':'Kaydetme iptal edildi.';}
 if(window.Native&&typeof Native.shareFile==='function'){Native.shareFile(name,'application/zip',await blobB64(zip));return 'Paylaşım ekranı açıldı: '+name;}
 if(configured()&&(!!window.FisDesktop||navigator.onLine)){try{let n=0;for(const r of rows){const {image,...m}=r,fd=new FormData();fd.append('record',JSON.stringify(m));if(image)fd.append('image',image,r.id+'.jpg');await api('/api/corrections',{method:'POST',body:fd});n++;}return n+' kayıt ofis sunucusuna yüklendi. Bilgisayarda duzeltme_indir.py ile indirebilirsiniz.';}catch(e){if(!oldServer(e))throw e;}}
 try{const file=new File([zip],name,{type:'application/zip'});if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:name});return 'Paylaşım ekranı açıldı.';}}catch(e){if(e?.name==='AbortError')return 'Paylaşım iptal edildi.';}
 const text=JSON.stringify({exported:new Date().toISOString(),records:meta},null,1);
 try{await navigator.clipboard.writeText(text);return 'Fotoğraflı paylaşım bu cihazda/sunucuda henüz desteklenmiyor. Kayıtların METNİ panoya kopyalandı; WhatsApp\'ta kendinize yapıştırıp gönderin. (Fotoğraflar telefonda saklı kalır.)';}catch{throw Error('Dışa aktarma için sunucu güncellemesi ya da Android paylaşım desteği gerekiyor.');}
}
$('logExport').onclick=caught(async()=>{say('Hazırlanıyor…');say(await exportCorrections());});
let clearArmed=0;$('logClear').onclick=caught(async()=>{if(Date.now()-clearArmed>5000){clearArmed=Date.now();$('logClear').textContent='Emin misiniz? 5 sn içinde tekrar basın';setTimeout(()=>{$('logClear').textContent='Kayıtları sil';},5200);return;}clearArmed=0;await logClear();$('logClear').textContent='Kayıtları sil';await logSub();say('Düzeltme kayıtları silindi.');});
logSub();
// Mükellef paneli ve çalışma dönemi.
function currentMonth(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
function dateMonth(d){const m=/^\d{2}\.(\d{2})\.(\d{4})$/.exec(d||'');return m?m[2]+'-'+m[1]:'';}
function periodKey(){return 'work-month:'+($('client').value||'')+':'+kind;}
function loadMonth(){$('workMonth').dataset.key=periodKey();$('workMonth').value=localStorage.getItem(periodKey())||currentMonth();monthLabel();}
function assignMonth(d,ctx){const selected=/^\d{4}-(0[1-9]|1[0-2])$/.test(ctx.period||'')?ctx.period:currentMonth();d.selected_period=selected;d.period=(d.kind==='gelir'||d.is_z_report)?(dateMonth(d.evrak_tarihi)||selected):selected;return d;}
function recordMonth(r){return (r.kind==='gelir'||r.data.is_z_report)?dateMonth(r.data.evrak_tarihi)||(r.data.period||r.period):r.data.period||r.period||dateMonth(r.data.evrak_tarihi);}
function updatePicker(){if($('workMonth').dataset.key!==periodKey())loadMonth();const c=catalog.clients.find(x=>x.id===$('client').value);$('clientName').textContent=c?.name||'Mükellef seç';$('clientAv').textContent=initials(c?.name);monthLabel();}
function pickerRows(){const q=$('pickerSearch').value.toLocaleLowerCase('tr-TR');$('pickerList').replaceChildren();for(const c of alphabetic(catalog.clients).filter(x=>x.name.toLocaleLowerCase('tr-TR').includes(q))){const b=document.createElement('button');b.className='picker-row'+(c.id===$('client').value?' chosen':'');const name=document.createElement('b'),sub=document.createElement('small');name.textContent=c.name;sub.textContent=c.profile?.mode==='genel'?'Genel muhasebe':'İşletme defteri';b.append(name,sub);b.onclick=()=>{$('client').value=c.id;localStorage.setItem('client',c.id);loadMonth();$('clientSheet').close();render();};$('pickerList').append(b);}if(!$('pickerList').children.length)$('pickerList').textContent='Eşleşen mükellef yok.';}
$('clientPicker').onclick=()=>{$('pickerSearch').value='';pickerRows();$('clientSheet').showModal();fitClientSheet();$('closeClientSheet').focus({preventScroll:true});};$('pickerSearch').oninput=pickerRows;$('closeClientSheet').onclick=()=>$('clientSheet').close();$('pickerAdd').onclick=()=>{$('clientSheet').close();openEntry('client',null);};
$('workMonth').onchange=()=>{if(!$('workMonth').value)return;localStorage.setItem(periodKey(),$('workMonth').value);selected.clear();render();};
let profileDraft={},accountSide='gider';
function openProfile(type,obj){$('profileFields').hidden=type!=='client';profileDraft=structuredClone(obj?.profile||{mode:'isletme',income_code:'ML',rates:{},income_rates:{},closing:'',income_closing:''});accountSide='gider';$('bookMode').value=profileDraft.mode||'isletme';$('incomeCode').value=profileDraft.income_code||'ML';drawAccounts();profileVisibility();}
function keepAccounts(){const rates={...profileDraft[accountSide==='gelir'?'income_rates':'rates']};for(const row of $('rateAccounts').children){const v=[...row.querySelectorAll('input')].map(x=>x.value.trim());if(v.some(Boolean))rates[row.dataset.rate]=v;else delete rates[row.dataset.rate];}profileDraft[accountSide==='gelir'?'income_rates':'rates']=rates;profileDraft[accountSide==='gelir'?'income_closing':'closing']=$('closingAccount').value.trim();}
function drawAccounts(){const inc=accountSide==='gelir';$('expenseAccounts').classList.toggle('active',!inc);$('incomeAccounts').classList.toggle('active',inc);$('rateAccounts').replaceChildren();for(const rate of [1,10,20]){const row=document.createElement('div');row.className='account-row';row.dataset.rate=rate;const h=document.createElement('b');h.textContent='%'+rate;row.append(h);const codes=profileDraft[inc?'income_rates':'rates']?.[rate]||['',''];for(let i=0;i<2;i++){const label=document.createElement('label');label.textContent=i?(inc?'Hesaplanan KDV':'İndirilecek KDV'):(inc?'Satış / matrah':'Gider / matrah');const input=document.createElement('input');input.value=codes[i];input.autocomplete='off';input.placeholder=i?'KDV hesap kodu':'Hesap kodu';input.disabled=rate===0&&i===1;if(input.disabled)input.value='';label.append(input);row.append(label);}$('rateAccounts').append(row);}$('closingAccount').value=profileDraft[inc?'income_closing':'closing']||'';}
function profileVisibility(){$('incomeCodeField').hidden=$('bookMode').value==='genel';$('accountFields').hidden=$('bookMode').value!=='genel';}
$('bookMode').onchange=profileVisibility;for(const [id,side] of [['expenseAccounts','gider'],['incomeAccounts','gelir']])$(id).onclick=()=>{keepAccounts();accountSide=side;drawAccounts();};
function readProfile(){keepAccounts();profileDraft.mode=$('bookMode').value;profileDraft.income_code=$('incomeCode').value;for(const field of ['rates','income_rates'])for(const [rate,codes] of Object.entries(profileDraft[field]||{})){if(!codes[0]||(rate!=='0'&&!codes[1]))throw Error('%'+rate+' için matrah ve KDV hesabını birlikte doldurun.');}return profileDraft;}
loadMonth();updatePicker();render();

// ===== v0.13.7 tasarım: dönem seçici, mükellef çipi, özet kartı =====

function initials(n){return ((n||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('')||'?').toLocaleUpperCase('tr-TR');}
function monthLabel(){const v=$('workMonth').value||currentMonth(),[y,m]=v.split('-');$('monthLbl').textContent=MON[Number(m)-1]+' '+y;$('monthLbl').dataset.full=MONL[Number(m)-1]+' '+y;}
let msYear=2026;
function msRender(){const v=$('workMonth').value||currentMonth(),[sy,sm]=v.split('-').map(Number),cur=currentMonth().split('-').map(Number);$('yLbl').textContent=msYear;$('mGrid').replaceChildren();for(let m=1;m<=12;m++){const b=document.createElement('button');b.type='button';b.textContent=MON[m-1];b.className='mbtn'+(msYear===sy&&m===sm?' sel':'')+(msYear===cur[0]&&m===cur[1]?' now':'');b.onclick=()=>pickMonth(msYear+'-'+String(m).padStart(2,'0'));$('mGrid').append(b);}}
function pickMonth(v){$('workMonth').value=v;$('workMonth').onchange();monthLabel();if($('monthSheet').open)$('monthSheet').close();}
$('monthPicker').onclick=()=>{msYear=Number(($('workMonth').value||currentMonth()).slice(0,4));msRender();$('monthSheet').showModal();};
$('yPrev').onclick=()=>{if(msYear>2000){msYear--;msRender();}};$('yNext').onclick=()=>{if(msYear<2100){msYear++;msRender();}};
$('mToday').onclick=()=>pickMonth(currentMonth());$('mClose').onclick=()=>$('monthSheet').close();
function updateStats(rows,local){const del=$('showDeleted').checked,live=rows.filter(r=>del||!r.deleted),total=live.reduce((a,r)=>a+(Number(r.data?.toplam)||0),0);
 $('statTotal').textContent=total.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₺';
 $('statLbl').textContent=del?'Silinen belgeler':($('monthLbl').dataset.full||'')+' · '+(kind==='gelir'?'Gelir':'Gider');
 $('statCnt').textContent=live.length+' belge';updateTaxCard(live);
 const pend=local.filter(r=>!r.deleted&&r.kind===kind&&(!$('client').value||r.client===$('client').value)).length;$('statPend').hidden=!pend||del;$('statPend').textContent=pend+' gönderilmedi';}
monthLabel();

// Keep the search panel within the visible area, independently of result count.
function fitClientSheet(){const el=$('clientSheet');if(!el.open)return;const v=window.visualViewport,h=v?.height||innerHeight,top=v?.offsetTop||0;const size=Math.min(720,Math.max(0,h-16));el.style.height=size+'px';el.style.top=(top+h-size)+'px';}
window.visualViewport?.addEventListener('resize',fitClientSheet);window.visualViewport?.addEventListener('scroll',fitClientSheet);addEventListener('resize',fitClientSheet);

// ===== v0.13: seri çekim, mükerrer belge engeli, hızlı toplu onay =====
function updSeries(){const on=localStorage.getItem('series')==='1';$('seriesToggle').classList.toggle('on',on);$('seriesToggle').setAttribute('aria-pressed',on?'true':'false');$('seriesLbl').textContent=on?'Seri açık':'Seri çekim';}
$('seriesToggle').onclick=()=>{localStorage.setItem('series',localStorage.getItem('series')==='1'?'0':'1');updSeries();say(localStorage.getItem('series')==='1'?'Seri çekim açık. Fiş / Fatura çek veya Belge tara ile tarayıcıyı açın. Sayfaları art arda çekin; tarayıcıda onayladığınızda hepsi sırayla işlenir.':'Seri çekim kapalı.');};
function endSeries(extra){const n=series.n,d=series.dup;series.active=false;updSeries();if(!n&&!d&&!extra){say('Çekim iptal edildi.');return;}say('Seri çekim bitti: '+n+' belge eklendi'+(d?', '+d+' mükerrer belge eklenmedi':'')+'.'+(extra?' '+extra:''),!!extra);if(dupStack.length)dupNotice(dupStack[dupStack.length-1].pending.data,null,true);render();sync(true).catch(()=>{});}
const dnorm=x=>String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^0+(?=\d)/,''),ddig=x=>String(x||'').replace(/\D/g,'');
function hamming(a,b){if(!a||!b||a.length!==b.length)return 999;let n=0;for(let i=0;i<a.length;i++){let x=parseInt(a[i],16)^parseInt(b[i],16);while(x){n+=x&1;x>>=1;}}return n;}
async function dHash(blob){const c=await loadBitmap(blob),o=mk(17,16),x=o.getContext('2d');x.drawImage(c,0,0,17,16);const d=x.getImageData(0,0,17,16).data,g=(y,k)=>{const q=(y*17+k)*4;return d[q]*.3+d[q+1]*.59+d[q+2]*.11;};let bits='';for(let y=0;y<16;y++)for(let i=0;i<16;i++)bits+=g(y,i)>g(y,i+1)?'1':'0';let hex='';for(let i=0;i<256;i+=4)hex+=parseInt(bits.slice(i,i+4),2).toString(16);return hex;}
async function findDup(d,ctx,ih){
 if(!ctx)return null;const tot=Number(d.toplam)||0,date=d.evrak_tarihi||'',no=dnorm(d.evrak_no),v=ddig(d.vkn),seen=new Set();
 const pool=[...(await all()).filter(x=>!x.deleted),...remote.filter(x=>!x.deleted&&!isPurged(x.id))];
 for(const rec of pool){if(seen.has(rec.id))continue;seen.add(rec.id);if(rec.client!==ctx.client||rec.kind!==ctx.kind)continue;
  const rd=rec.data||{};
  const rt=Number(rd.toplam)||0;
  if(ih&&rec.ihash&&hamming(ih,rec.ihash)<=12){const contra=(tot>0&&rt>0&&Math.abs(tot-rt)>0.004)||(no&&dnorm(rd.evrak_no)&&no!==dnorm(rd.evrak_no))||(date&&rd.evrak_tarihi&&date!==rd.evrak_tarihi);if(!contra)return {rec,why:'aynı fotoğraf'};}
if(!(tot>0)||Math.abs(tot-rt)>0.004||!date||date!==rd.evrak_tarihi)continue;
  const rno=dnorm(rd.evrak_no),rv=ddig(rd.vkn);
  if(no&&rno){if(no===rno&&(!v||!rv||v===rv))return {rec,why:'aynı belge no, tarih ve tutar'};continue;}
  if(v&&v===rv){if(ih){let h=rec.ihash;if(!h&&rec.image){try{h=await dHash(rec.image);}catch{}}if(h&&hamming(ih,h)>60)continue;}return {rec,why:'aynı VKN, tarih ve tutar'};}
 }
 return null;
}
function dupNotice(d,pending,quiet){
 const t=[d.aciklama||'Ünvansız belge',d.evrak_tarihi||'',d.toplam?Number(d.toplam).toLocaleString('tr-TR',{minimumFractionDigits:2})+' ₺':''].filter(Boolean).join(' · ');
 if(pending)dupStack.push({pending,t});
 const last=dupStack.length?dupStack[dupStack.length-1]:null,txt=pending||!last?t:last.t;
 $('dupTxt').textContent='Bu belge mükerrer olduğu için eklenmedi: '+txt+(dupStack.length>1?'  (+'+(dupStack.length-1)+' belge daha)':'');
 $('dupAdd').hidden=!dupStack.length;$('dupBar').classList.add('show');clearTimeout(dupTimer);if(!dupStack.length)dupTimer=setTimeout(()=>$('dupBar').classList.remove('show'),9000);
}
$('dupAdd').onclick=caught(async()=>{const it=dupStack.pop();if(!it)return;const p=it.pending;await put({id:p.id,...p.ctx,data:p.data,orig:snap(p.data),state:'draft',image:p.blob,filename:p.filename,ihash:p.ih});await render();if(dupStack.length)dupNotice(dupStack[dupStack.length-1].pending.data,null,true);else $('dupBar').classList.remove('show');say('Belge yine de eklendi.');});
$('dupClose').onclick=()=>{dupStack.length=0;$('dupBar').classList.remove('show');};
function quickOk(r){const d=r.data||{},z=!!d.is_z_report;if(!z&&!String(d.aciklama||'').trim())return false;if((d.qr_warnings||[]).length)return false;const gross=(d.kalemler||[]).reduce((a,l)=>a+Number(l.matrah)+Number(l.kdv),0);return checkDoc({type:z?'z':d.is_invoice?'invoice':'receipt',vkn:d.vkn,date:d.evrak_tarihi,total:d.toplam,gross,title:d.aciklama}).length===0;}
function quickRows(rows){return rows.filter(r=>!r.deleted&&r.state!=='approved'&&r.data&&!String(r.client).startsWith('local-')&&quickOk(r));}
function updateQuick(rows){const n=$('showDeleted').checked||selecting?0:quickRows(rows).length;$('quickStrip').hidden=!n;if(n)$('quickTxt').textContent=n+' belge hızlı onaya hazır';}
let bulkSel=new Set();
function bulkRender(){const rows=quickRows(shown);$('bulkList').replaceChildren();for(const r of rows){const row=document.createElement('label');row.className='brow';const cb=document.createElement('input');cb.type='checkbox';cb.checked=bulkSel.has(r.id);cb.onchange=()=>{cb.checked?bulkSel.add(r.id):bulkSel.delete(r.id);bulkSum();};const d=document.createElement('div');d.className='bt';const b=document.createElement('b');b.textContent=r.data.is_z_report?'Z raporu':(r.data.aciklama||'');const sm=document.createElement('small');sm.textContent=[r.data.evrak_tarihi,r.data.evrak_no?'No '+r.data.evrak_no:''].filter(Boolean).join(' · ');d.append(b,sm);const am=document.createElement('span');am.className='ba';am.textContent=Number(r.data.toplam||0).toLocaleString('tr-TR',{minimumFractionDigits:2})+' ₺';row.append(cb,d,am);$('bulkList').append(row);}bulkSum();}
function bulkSum(){const all=quickRows(shown),rows=all.filter(r=>bulkSel.has(r.id)),tot=rows.reduce((a,r)=>a+(Number(r.data.toplam)||0),0);$('bulkOk').textContent='Onayla ('+rows.length+(rows.length?' · '+tot.toLocaleString('tr-TR',{minimumFractionDigits:2})+' ₺':'')+')';$('bulkOk').disabled=!rows.length;$('bulkAll').textContent=rows.length===all.length?'Hiçbiri':'Hepsi';}
$('quickStrip').onclick=()=>{bulkSel=new Set(quickRows(shown).map(r=>r.id));bulkRender();$('bulkSheet').showModal();};
$('bulkAll').onclick=()=>{const all=quickRows(shown);bulkSel=bulkSel.size===all.length?new Set():new Set(all.map(r=>r.id));bulkRender();};
$('bulkCancel').onclick=()=>$('bulkSheet').close();
$('bulkOk').onclick=caught(async()=>{
 if(busy)throw Error('Gönderim sürüyor; tamamlanınca tekrar deneyin.');
 const chosen=quickRows(shown).filter(r=>bulkSel.has(r.id));if(!chosen.length)return;$('bulkOk').disabled=true;let ok=0,fail=0;
 try{for(const r of chosen){try{const d={...r.data,review_ack:true,vat_manually_reviewed:true,kind:r.kind};d.tarih=d.evrak_tarihi;assignMonth(d,{period:d.selected_period||r.period||$('workMonth').value,kind:r.kind});
   if(r.image){const rec={...r,data:d,state:'approved'};await put(rec);try{void logCorrection(rec).catch(()=>{});}catch{}}else await jsonApi('/api/documents/'+r.id,{revision:r.revision,state:'approved',data:d},'PATCH');ok++;}catch(e){fail++;}}}
 finally{$('bulkOk').disabled=false;}
 $('bulkSheet').close();await render();say(ok+' belge onaylandı'+(fail?', '+fail+' belge onaylanamadı.':'.'),!!fail);await sync(true);
});
updSeries();

// Phone cleanup never deletes approved office records.
function phoneHiddenKey(){return 'phone-hidden:'+String(cfg.url||'');}
function phoneHidden(){try{return JSON.parse(localStorage.getItem(phoneHiddenKey())||'[]');}catch{return [];}}

let focusTimer;
function centerEditorField(){const e=document.activeElement;if(!e?.matches('input,textarea,select')||!e.closest('#editor,#entryDlg'))return;clearTimeout(focusTimer);const h=window.visualViewport?.height||innerHeight;document.documentElement.style.setProperty('--keyboard-gap',Math.max(0,innerHeight-h)+'px');focusTimer=setTimeout(()=>e.scrollIntoView({block:'center',behavior:'smooth'}),220);}
document.addEventListener('focusin',centerEditorField);window.visualViewport?.addEventListener('resize',centerEditorField);

function renderBatch(){
 let box=$('captureQueue');if(!box){box=document.createElement('aside');box.id='captureQueue';document.body.append(box);}
 box.hidden=!batchQueue.length;box.replaceChildren();if(!batchQueue.length)return;
 const image=document.createElement('img');image.src='data:image/jpeg;base64,'+batchQueue[batchQueue.length-1].thumb;image.alt='Son çekilen belge';box.append(image);
 const label=document.createElement('b');label.textContent=batchQueue.length+' fotoğraf';box.append(label);
 const next=document.createElement('button');next.textContent='Çek';next.disabled=batchRunning||captureBusy;next.onclick=caught(()=>capture(capMode==='scan'?'scan':'camera'));box.append(next);
 const run=document.createElement('button');run.textContent=batchRunning?'İşleniyor…':'İşle';run.disabled=batchRunning||captureBusy;
 run.onclick=caught(async()=>{if(busy)throw Error('Eşitleme sürüyor; kısa süre sonra tekrar deneyin.');batchRunning=true;renderBatch();Native.processQueue(JSON.stringify(batchQueue.map(q=>q.filename)));});box.append(run);if(!batchRunning){const edit=document.createElement('button');edit.textContent='Düzenle / İptal';edit.disabled=captureBusy;edit.onclick=showPendingBatch;box.append(edit);}
}

function formatAmount(v){if(v==null||String(v).trim()==='')return '';const n=money(v);return Number.isFinite(n)?n.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2}):String(v);}
$('date').inputMode='numeric';$('date').maxLength=10;
$('date').addEventListener('input',e=>{const el=e.target,pos=el.selectionStart,raw=el.value,digits=raw.replace(/\D/g,'').slice(0,8),before=raw.slice(0,pos).replace(/\D/g,'').length;el.value=[digits.slice(0,2),digits.slice(2,4),digits.slice(4,8)].filter(Boolean).join('.');const caret=Math.min(el.value.length,before+(before>2?1:0)+(before>4?1:0));el.setSelectionRange(caret,caret);});
$('total').lang='tr';$('total').maxLength=24;$('total').addEventListener('blur',()=>{$('total').value=formatAmount($('total').value);});
$('vkn').addEventListener('change',()=>{if($('docType').value==='z')return;const d=resolveVendor({vkn:$('vkn').value,aciklama:$('title').value,kind:editing?.kind});if(d.vendor_source?.includes('VKN'))$('title').value=d.aciklama;});

function vatCards(r){return [null];}


// Centered, theme-aware dialogs shared by selectors, reports and cleanup.
function uiNode(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;}
function panel(id,title){let d=$(id);if(!d){d=uiNode('dialog',null,'large-panel');d.id=id;document.body.append(d);}d.replaceChildren();const head=uiNode('div',null,'panel-head'),h=uiNode('h2',title),close=uiNode('button','Kapat','secondary');close.type='button';close.onclick=()=>d.close();head.append(h,close);d.append(head);return d;}
function showPanel(d){if(!d.open)d.showModal();}
function bars(host,items,formatter){const max=Math.max(1,...items.map(x=>x.value));for(const item of items){const row=uiNode('div',null,'chart-row'),label=uiNode('div',null,'chart-label');label.append(uiNode('span',item.label),uiNode('b',formatter(item.value)));const track=uiNode('div',null,'chart-track'),fill=uiNode('div',null,'chart-fill');fill.style.width=Math.max(0,item.value/max*100)+'%';track.append(fill);row.append(label,track);host.append(row);}}
var taxRows;
function updateTaxCard(rows){taxRows=rows;let box=$('taxSummary');if(!box){box=uiNode('div',null,'tax-summary');box.id='taxSummary';box.append(uiNode('small',''),uiNode('b',''));document.querySelector('.stat').append(box);const stat=document.querySelector('.stat');stat.tabIndex=0;stat.setAttribute('role','button');stat.setAttribute('aria-label','Tutar ve KDV dağılımını göster');stat.onclick=showTaxReport;stat.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showTaxReport();}};}box.children[0].textContent=kind==='gelir'?'Hesaplanan KDV':'İndirilecek KDV';const total=rows.reduce((a,r)=>a+(r.data.kalemler||[]).reduce((n,l)=>n+(Number(l.kdv)||0),0),0);box.children[1].textContent=formatAmount(total)+' ₺';}
function taxGroups(rows){const groups=new Map();for(const r of rows)for(const l of r.data.kalemler||[]){const rate=Number(l.oran);if(!Number.isFinite(rate))continue;const v=groups.get(rate)||{tax:0,gross:0,z:0};const k=Number(l.kdv)||0,g=(Number(l.matrah)||0)+k;v.tax+=k;v.gross+=g;if(r.data.is_z_report)v.z+=g;groups.set(rate,v);}return [...groups].sort((a,b)=>a[0]-b[0]);}
function showTaxReport(){const rows=taxRows||[],d=panel('taxReport',kind==='gelir'?'Gelir ve hesaplanan KDV':'Gider ve indirilecek KDV');d.append(uiNode('p',clientName($('client').value)+' · '+$('workMonth').value,'muted'));const pending=rows.filter(r=>r.state!=='approved').length;d.append(uiNode('p',rows.length+' belge'+(pending?' · '+pending+' belge henüz onaylanmadı':' · Tümü onaylı'),'muted'));const groups=taxGroups(rows);d.append(uiNode('h3','KDV dahil belge tutarı'));bars(d,groups.map(([r,v])=>({label:'KDV %'+r,value:v.gross})),v=>formatAmount(v)+' ₺');d.append(uiNode('h3',kind==='gelir'?'Hesaplanan KDV':'İndirilecek KDV'));bars(d,groups.map(([r,v])=>({label:'KDV %'+r,value:v.tax})),v=>formatAmount(v)+' ₺');if(kind==='gelir'&&groups.some(([,v])=>v.z)){d.append(uiNode('h3','Z raporları · KDV dahil'));bars(d,groups.filter(([,v])=>v.z).map(([r,v])=>({label:'KDV %'+r,value:v.z})),v=>formatAmount(v)+' ₺');}if(!groups.length)d.append(uiNode('p','Bu dönemde KDV satırı bulunmuyor.'));showPanel(d);}

async function discardPending(filename){if(batchRunning||captureBusy)throw Error('Çekim veya işleme sürerken silinemez.');if(!window.Native?.discardQueued||!Native.discardQueued(filename))throw Error('Fotoğraf kaldırılamadı; işlenmekte olan kopya korundu.');batchQueue=batchQueue.filter(q=>q.filename!==filename);renderBatch();}
function showPendingBatch(){const d=panel('pendingBatch','Bekleyen çekimler');d.append(uiNode('p','Bu fotoğraflar henüz işlenmedi. Silme yalnız bekleyen çekimleri kaldırır.','muted'));for(const q of batchQueue){const row=uiNode('div',null,'storage-row'),im=uiNode('img');im.src='data:image/jpeg;base64,'+q.thumb;im.alt='Bekleyen fotoğraf';const remove=uiNode('button','Sil','secondary');remove.onclick=caught(async()=>{await discardPending(q.filename);if(batchQueue.length)showPendingBatch();else d.close();});row.append(im,uiNode('span','Fotoğraf '+(batchQueue.indexOf(q)+1)),remove);d.append(row);}const cancel=uiNode('button','Tüm seriyi iptal et','dangerbtn wide');cancel.disabled=batchRunning||captureBusy;cancel.onclick=caught(async()=>{for(const q of [...batchQueue])await discardPending(q.filename);series.active=false;updSeries();d.close();say('Bekleyen seri çekim silindi.');});d.append(cancel);showPanel(d);}

// Replace visible Android select popups with the application's own choice panel.
function enhanceSelects(){for(const select of document.querySelectorAll('select:not([hidden])')){if(!select._choice){const button=uiNode('button',null,'choice-button');button.type='button';button.setAttribute('aria-haspopup','dialog');select.classList.add('modern-source');select.insertAdjacentElement('afterend',button);select._choice=button;button.onclick=()=>{const d=panel('choicePanel',select.getAttribute('aria-label')||select.closest('label')?.childNodes[0]?.textContent?.trim()||'Seçim yap');for(const option of select.options){const item=uiNode('button',option.textContent+(option.selected?' ✓':''),'choice-option'+(option.selected?' chosen':''));item.type='button';item.disabled=option.disabled;item.onclick=()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));syncChoice(select);d.close();};d.append(item);}showPanel(d);};}syncChoice(select);}}
function syncChoice(s){if(!s._choice)return;const text=(s.selectedOptions[0]?.textContent||'Seçiniz')+' ▾';if(s._choice.textContent!==text)s._choice.textContent=text;s._choice.disabled=s.disabled;}
let choicesQueued=false;new MutationObserver(()=>{if(!choicesQueued){choicesQueued=true;queueMicrotask(()=>{choicesQueued=false;enhanceSelects();});}}).observe(document.body,{childList:true,subtree:true});document.addEventListener('change',e=>{if(e.target.tagName==='SELECT')syncChoice(e.target);});enhanceSelects();
const previousBack=window.goHome;window.goHome=()=>{const opened=[...document.querySelectorAll('dialog[open]')];if(opened.length){opened.at(-1).close();return;}previousBack();};

function byteLabel(bytes){return bytes>=1048576?(bytes/1048576).toLocaleString('tr-TR',{maximumFractionDigits:2})+' MB':bytes>=1024?(bytes/1024).toLocaleString('tr-TR',{maximumFractionDigits:1})+' KB':Math.round(bytes)+' B';}
function objectBytes(r){const {image,...meta}=r;return (image?.size||0)+new Blob([JSON.stringify(meta)]).size;}
let storageRows=[],storageSelected=new Set(),storageFilter={client:'',month:'',sort:'desc'};
async function readStorage(){const rows=[],locals=await all(),logs=await logAll();for(const r of locals)rows.push({key:'doc:'+r.id,type:'doc',id:r.id,title:r.data?.aciklama||'Taslak',client:clientName(r.client),month:recordMonth(r)||'',bytes:objectBytes(r),protected:r.state==='approved',record:r});for(const r of logs)rows.push({key:'log:'+r.id,type:'log',id:r.id,title:r.final?.aciklama||'Düzeltme kaydı',client:r.client||'Mükellef',month:dateMonth(r.final?.evrak_tarihi)||r.at?.slice(0,7)||'',bytes:objectBytes(r),record:r});let native={bytes:0,items:[]};try{native=JSON.parse(window.Native?.captureStorage?.()||'{}');}catch{}for(const r of native.items||[]){let ctx={};try{ctx=JSON.parse(localStorage.getItem('capture:'+r.requestId)||'{}');}catch{}rows.push({key:'capture:'+r.filename,type:'capture',id:r.filename,title:'Bekleyen seri fotoğrafı',client:ctx.client?clientName(ctx.client):'Mükellef bilinmiyor',month:ctx.period||'',bytes:r.bytes||0});}storageRows=rows;return {rows,total:locals.reduce((a,r)=>a+objectBytes(r),0)+logs.reduce((a,r)=>a+objectBytes(r),0)+(native.bytes||0)};}
function storageVisible(){return storageRows.filter(r=>(!storageFilter.client||r.client===storageFilter.client)&&(!storageFilter.month||r.month===storageFilter.month)).sort((a,b)=>storageFilter.sort==='desc'?b.bytes-a.bytes:a.bytes-b.bytes);}
async function showStorage(){const {total}=await readStorage(),d=panel('storagePanel','Telefon depolaması');d.append(uiNode('b',byteLabel(total),'storage-total'),uiNode('p','Yerel belgeler, fotoğraflı düzeltme kayıtları ve bekleyen çekimler. Uygulama/Android önbelleği bu ölçüme dahil değildir. Ofisteki fotoğraflar telefonda tutulmadığında burada yer kaplamaz.','muted'));
const filters=uiNode('div',null,'storage-filters');for(const [field,label,values] of [['client','Mükellef',[...new Set(storageRows.map(r=>r.client))].sort()],['month','Ay',[...new Set(storageRows.map(r=>r.month))].sort()],['sort','Boyut',['desc','asc']]]){const l=uiNode('label',label),s=uiNode('select');s.setAttribute('aria-label',label);if(field!=='sort')s.add(new Option('Tümü',''));for(const v of values)s.add(new Option(field==='sort'?(v==='desc'?'Büyükten küçüğe':'Küçükten büyüğe'):v||'Bilinmiyor',v));s.value=storageFilter[field];s.onchange=()=>{storageFilter[field]=s.value;storageSelected.clear();showStorage().catch(e=>say(e.message,true));};l.append(s);filters.append(l);}d.append(filters);
const visible=storageVisible(),tools=uiNode('div',null,'storage-actions'),allButton=uiNode('button','Tümünü seç','secondary'),erase=uiNode('button','Seçilenleri sil ('+storageSelected.size+')','dangerbtn');allButton.onclick=()=>{storageSelected=new Set(visible.filter(r=>!r.protected).map(r=>r.key));showStorage().catch(e=>say(e.message,true));};erase.disabled=!storageSelected.size||busy||batchRunning||captureBusy;erase.onclick=()=>confirmStorageDelete();tools.append(allButton,erase);d.append(tools);
for(const r of visible){const row=uiNode('label',null,'storage-row'),cb=uiNode('input');cb.type='checkbox';cb.checked=storageSelected.has(r.key);cb.disabled=r.protected;cb.onchange=()=>{cb.checked?storageSelected.add(r.key):storageSelected.delete(r.key);erase.textContent='Seçilenleri sil ('+storageSelected.size+')';erase.disabled=!storageSelected.size||busy||batchRunning||captureBusy;};const text=uiNode('div');text.append(uiNode('b',r.title),uiNode('small',r.client+' · '+r.month+' · '+(r.type==='log'?'Düzeltme kopyası':r.protected?'Gönderim bekliyor · korundu':'Telefonda')));row.append(cb,text,uiNode('strong',byteLabel(r.bytes)));d.append(row);}
for(const [field,label] of [['month','Aya göre kullanım'],['client','Mükellefe göre kullanım']]){const groups=new Map();for(const r of visible)groups.set(r[field]||'Bilinmiyor',(groups.get(r[field]||'Bilinmiyor')||0)+r.bytes);d.append(uiNode('h3',label));bars(d,[...groups].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([label,value])=>({label,value})),byteLabel);}if(!visible.length)d.append(uiNode('p','Bu filtrelerde yerel dosya yok.'));showPanel(d);}
function confirmStorageDelete(){const selectedRows=storageRows.filter(r=>storageSelected.has(r.key)&&!r.protected),d=panel('storageDelete','Telefondan kalıcı sil');d.append(uiNode('p',selectedRows.length+' yerel kayıt silinecek. Seçilen gönderilmemiş taslak ve çekimler geri alınamaz. Ofis/bilgisayar kayıtları silinmez.'));const yes=uiNode('button','Seçilenleri kalıcı sil','dangerbtn wide');yes.onclick=caught(async()=>{if(busy||batchRunning||captureBusy)throw Error('İşlem sürerken dosyalar silinemez.');yes.disabled=true;try{for(const r of selectedRows){if(r.type==='capture')await discardPending(r.id);else if(r.type==='log')await lstore('readwrite',s=>s.delete(r.id));else{const latest=(await all()).find(x=>x.id===r.id);if(latest?.state==='approved')throw Error('Onaylı gönderim korundu; önce eşitleyin.');await del(r.id);await lstore('readwrite',s=>s.delete(r.id));localStorage.setItem(phoneHiddenKey(),JSON.stringify([...new Set([...phoneHidden(),r.id])]));}storageSelected.delete(r.key);}d.close();await render();await logSub();await showStorage();}finally{yes.disabled=false;}});d.append(yes);showPanel(d);}
const storageOpen=uiNode('button','Depolama ve fotoğraf temizliği','wide secondary');storageOpen.id='storageOpen';storageOpen.onclick=caught(async()=>{storageSelected.clear();await showStorage();});$('settings').append(storageOpen);

function showEditorVendors(){
 if($('docType').value==='z'){say('Z raporunda VKN boş bırakılır.');return;}
 const d=panel('editorVendors','Cariden tamamla'),search=uiNode('input'),list=uiNode('div');search.type='search';search.placeholder='Ünvan veya VKN / TCKN ara';search.setAttribute('aria-label','Cari ara');
 const digits=v=>String(v||'').replace(/\D/g,'');
 const current=digits($('vkn').value);
 function draw(){list.replaceChildren();const q=search.value.toLocaleLowerCase('tr-TR').trim();const items=catalog.vendors.filter(v=>(v.name+' '+v.vkn).toLocaleLowerCase('tr-TR').includes(q)).slice().sort((a,b)=>Number(digits(b.vkn)===current)-Number(digits(a.vkn)===current)||String(a.name).localeCompare(String(b.name),'tr'));
 for(const v of items.slice(0,200)){const button=uiNode('button',null,'choice-option');button.type='button';button.append(uiNode('b',v.name),uiNode('small',String(v.vkn)));button.onclick=()=>{$('vkn').value=digits(v.vkn);$('title').value=v.name;editing.data.vendor_source='Cari: elle seçildi';d.close();say('Ünvan ve vergi numarası cariden dolduruldu. Kaydederek uygulayın.');};list.append(button);}if(!items.length)list.append(uiNode('p','Eşleşen cari bulunamadı.'));}
 search.oninput=draw;d.append(search,list);draw();showPanel(d);
}
$('pickEditorVendor').onclick=showEditorVendors;
$('vkn').addEventListener('change',()=>{const digits=$('vkn').value.replace(/\D/g,'');const v=catalog.vendors.find(x=>String(x.vkn||'').replace(/\D/g,'')===digits&&digits&&x.name);if(v&&$('docType').value!=='z')$('title').value=v.name;});

rememberApprovedVendors([...(await all()),...remote]);

let inlineScale=1,inlineStart=0,inlineBase=1;
const imageBox=$('zoomPreview');
imageBox.addEventListener('touchstart',e=>{if(e.touches.length===2){e.preventDefault();inlineStart=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);inlineBase=inlineScale;}},{passive:false});
imageBox.addEventListener('touchmove',e=>{if(e.touches.length===2&&inlineStart){e.preventDefault();inlineScale=Math.max(1,Math.min(5,inlineBase*Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY)/inlineStart));$('preview').style.transform='scale('+inlineScale+')';}},{passive:false});
imageBox.addEventListener('touchend',()=>{inlineStart=0;});

document.addEventListener('focusout',()=>setTimeout(()=>{if(!document.activeElement?.matches('input,textarea,select'))document.documentElement.style.setProperty('--keyboard-gap','0px');},100));



// Desktop uses the exact Cep parser, cards, settings and editor over local SQLite.
const desktopChannel=new BroadcastChannel('fis-desktop-changes');
let desktopReading=false;
const desktopOriginalSync=sync;
sync=async function(quiet){const result=await desktopOriginalSync(quiet);return result;};
desktopChannel.onmessage=()=>{if(!document.hidden&&$('editor').hidden&&!busy)sync(true).catch(()=>{});};
async function desktopReadSelection(target=null){
 if(desktopReading)throw Error('Önceki okuma sürüyor; bitmesini bekleyin.');
 const client=target?.client||$('client').value;if(!client)throw Error('Önce mükellef seçin.');
 const ctx={client,kind:target?.kind||kind,period:$('workMonth').value,created:new Date().toISOString()};
 desktopReading=true;const progressId=uuid();processingCards.set(progressId,{title:'Dosyalar seçiliyor ve okunuyor…'});await render();
 try{
  const result=await window.FisDesktop.importFiles();let added=0,duplicates=0;
  for(const item of result.items){
   const blob=new Blob([Uint8Array.from(atob(item.base64),c=>c.charCodeAt(0))],{type:'image/jpeg'});
   let data=resolveVendor(parseDraft(item.text,ctx.kind,item.qr||[]));data.ocr=item.text;data.source=item.source;data.app_version='desktop-1.0.130';assignMonth(data,ctx);
   const ih=await dHash(blob).catch(()=>'');if(await findDup(data,ctx,ih)){duplicates++;continue;}
   processingCards.set(progressId,{title:data.aciklama||'Belge kontrol ediliyor…',data});await render();
   data=excludeAutomaticZero(resolveVendor(await aiAssist(blob,data,ctx.kind,false)));assignMonth(data,ctx);
   if(await findDup(data,ctx,ih)){duplicates++;continue;}
   await put({id:uuid(),...ctx,data,orig:snap(data),state:'draft',image:blob,filename:item.filename,ihash:ih});added++;
  }
  await sync();desktopChannel.postMessage('changed');
  say(added+' belge eklendi'+(duplicates?' · '+duplicates+' mükerrer atlandı':'')+(result.notes?.length?' · '+result.notes.length+' dosya okunamadı; kaynaklar korundu':''),!!result.notes?.length);
 }finally{processingCards.delete(progressId);desktopReading=false;await render();}
}
capture=function(mode,target=null){return caught(()=>desktopReadSelection(target))();};
const addDesktopButton=(text,id,handler,parent)=>{const b=document.createElement('button');b.type='button';b.id=id;b.textContent=text;b.className='secondary';b.onclick=caught(handler);parent.append(b);return b;};
const desktopBar=document.createElement('div');desktopBar.className='desktop-actions';$('home').insertBefore(desktopBar,$('home').firstChild);
addDesktopButton('Dosya / PDF yükle','desktopImport',()=>desktopReadSelection(),desktopBar);
addDesktopButton('Aylık Excel → Zirve','desktopExcel',async()=>{const r=await window.FisDesktop.exportExcel({client:$('client').value,period:$('workMonth').value});if(r.saved)say(r.records+' onaylı kayıt Excel’e yazıldı.');},desktopBar);
addDesktopButton('Telefonla eşitle','desktopCloudSync',async()=>{const button=$('desktopCloudSync');button.disabled=true;try{const r=await window.FisDesktop.request({path:'/desktop/cloud-sync',method:'POST'});await sync();say(r.errors?.length?'Eşitlemede '+r.errors.length+' kayıt inceleme bekliyor. '+r.errors[0]:'Telefon ve bilgisayar eşitlendi.',!!r.errors?.length);desktopChannel.postMessage('changed');}finally{button.disabled=false;}},desktopBar);
addDesktopButton('Elle belge ekle','desktopManual',async()=>{
 const client=$('client').value;if(!client)throw Error('Önce mükellef seçin.');const canvas=document.createElement('canvas');canvas.width=900;canvas.height=300;const x=canvas.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,900,300);x.fillStyle='#64748b';x.font='24px sans-serif';x.fillText('Elle eklenen muhasebe belgesi',30,60);x.font='12px sans-serif';x.fillText(uuid(),30,95);const blob=await new Promise(ok=>canvas.toBlob(ok,'image/png'));
 const d=assignMonth(parseDraft('',kind),{kind,period:$('workMonth').value});d.desktop_manual=true;
 const row={id:uuid(),client,kind,data:d,state:'draft',image:blob,filename:uuid()+'.png',created:new Date().toISOString()};await put(row);await openDocument(row);
},desktopBar);
$('connect').onclick=caught(async()=>{const url=$('server').value.trim(),token=$('token').value.trim();await window.FisDesktop.request({path:'/desktop/connection',method:'POST',body:{url,token}});cfg={url,token};localStorage.setItem('connection',JSON.stringify(cfg));settingsSubs();say('Ofis bağlantısı doğrulandı ve kaydedildi.');});
$('reanalyze').onclick=caught(async()=>{
 if(!editing||editing.deleted)return;const saved={...editing};const blob=editing.image||await(await api('/api/documents/'+editing.id+'/image')).blob();
 const result=await window.FisDesktop.readImage({base64:await blobB64(blob)});if(!result.items.length)throw Error('Görsel yeniden okunamadı; eski kayıt korundu.');
 const item=result.items[0];let d=resolveVendor(parseDraft(item.text,editing.kind,item.qr||[]));d.ocr=item.text;d=excludeAutomaticZero(d);assignMonth(d,{kind:editing.kind,period:editing.data.selected_period||$('workMonth').value});
 // Only unsaved form changes; preserving the persisted record until user saves.
 await openDocument({...saved,data:d,image:blob});editing={...editing,revision:saved.revision,desktop:saved.desktop,data:d};
 if(!saved.image)delete editing.image;
 for(const [id,key] of [['title','aciklama'],['vkn','vkn'],['date','evrak_tarihi'],['number','evrak_no'],['total','toplam']])$(id).value=id==='total'?formatAmount(d[key]):d[key]||'';
 $('vatRows').replaceChildren();for(const line of d.kalemler||[])addVat(line.oran,(Number(line.matrah)+Number(line.kdv)).toFixed(2));$('raw').textContent=d.ocr||'';say('Yeni okuma hazır. Kontrol edip kaydedin.');
});
// Capture-only phone controls become file import controls; processing stays local.
document.title='Fiş Asistanı';
for(const node of document.querySelectorAll('.about'))node.textContent='Fiş Asistanı 1.0.130 · Cep 0.13.7 arayüzü';
const originalSave=saveOnce;
saveOnce=async function(approve){const result=await originalSave(approve);desktopChannel.postMessage('changed');return result;};
window.fisHasUnsaved=()=>desktopReading||saving||(!$('editor').hidden&&editing!==null);
window.addEventListener('beforeunload',event=>{if(window.fisHasUnsaved()){event.preventDefault();event.returnValue='';}});
$('aiRead').onclick=caught(async()=>{
 if(!editing||editing.state==='approved')throw Error('Önce belgeyi taslak olarak kaydedin.');
 const previous={...editing};const blob=editing.image||await(await api('/api/documents/'+editing.id+'/image')).blob();
 const d=await aiAssist(blob,{...editing.data},editing.kind,true);d.vat_reviewed_rates=[];
 await openDocument({...previous,data:d,image:blob});editing={...editing,revision:previous.revision,desktop:previous.desktop,data:d};if(!previous.image)delete editing.image;
 for(const [id,key]of [['title','aciklama'],['vkn','vkn'],['date','evrak_tarihi'],['number','evrak_no'],['total','toplam']])$(id).value=id==='total'?formatAmount(d[key]):d[key]||'';
 $('vatRows').replaceChildren();for(const line of d.kalemler||[])addVat(line.oran,(Number(line.matrah)+Number(line.kdv)).toFixed(2));say('Gemini okuması hazır. Kontrol edip kaydedin.');
});
$('editImage').onclick=caught(async()=>{if(!editing||editing.state==='approved')return;const blob=editing.image||await(await api('/api/documents/'+editing.id+'/image')).blob();await openScan(blob);});
$('completeQr').onclick=caught(async()=>{
 if(!editing||editing.state==='approved')throw Error('Önce belgeyi taslağa alın.');
 const result=await window.FisDesktop.importFiles();const item=result.items.find(x=>x.qr?.length);
 if(!item)throw Error('Seçilen görselde karekod okunamadı; kayıt değişmedi.');
 const previous={...editing},d=resolveVendor(parseDraft(item.text,editing.kind,item.qr));assignMonth(d,{kind:editing.kind,period:editing.data.selected_period||$('workMonth').value});
 const blob=editing.image||await(await api('/api/documents/'+editing.id+'/image')).blob();
 await openDocument({...previous,data:d,image:blob});editing={...editing,revision:previous.revision,desktop:previous.desktop,data:d};if(!previous.image)delete editing.image;
 say('Karekod bilgileri hazır. Kontrol edip kaydedin.');
});
