'use strict';
const {app,BrowserWindow,BrowserView,ipcMain,dialog,shell}=require('electron');
const path=require('path'),fs=require('fs'),{spawn}=require('child_process'),readline=require('readline');
const authorized=new Set(),services=new Map(),imports=new Map();let registered=false;
function configuration(){const external=path.join(path.dirname(process.execPath),'resources','receipt-integration.json');const c=JSON.parse(fs.readFileSync(fs.existsSync(external)?external:path.join(__dirname,'receipt-integration.json'),'utf8'));if(c.portable){const root=path.dirname(process.execPath);return {python:path.join(root,'Runtime/Python/python.exe'),source:path.join(root,'FisAsistani'),data:path.join(app.getPath('documents'),'Apex','FisAsistani')};}return c;}
class Worker{
 constructor(config,heavy=false){this.config=config;this.heavy=heavy;this.pending=new Map();this.seq=0;this.child=null;this.timer=null;}
 start(){if(this.child)return;const c=this.config;
  if(!fs.existsSync(c.python)||!fs.existsSync(path.join(c.source,'desktop_service.py')))throw Error('Fiş Asistanı çalışma dosyaları bulunamadı. Kurulum paketini çalıştırın.');
  const child=spawn(c.python,['-X','utf8',path.join(c.source,'desktop_service.py'),c.data],{cwd:c.source,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUNBUFFERED:'1',OMP_NUM_THREADS:'2',OPENBLAS_NUM_THREADS:'2'}});this.child=child;
  const fail=()=>{if(this.child!==child)return;this.child=null;for(const [id,p]of this.pending){clearTimeout(p.timer);p.reject(Error('Fiş Asistanı işlemi tamamlanamadı. Veriler korunuyor; yeniden deneyin.'));}this.pending.clear();};
  readline.createInterface({input:child.stdout}).on('line',line=>{let r;try{r=JSON.parse(line);}catch{return;}const p=this.pending.get(r.id);if(!p)return;if(r.progress!=null){p.timer.refresh();if(p.onProgress)p.onProgress(r.progress);return;}this.pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(r.error)):p.resolve(r.result);this.schedule();});
  child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.on('error',fail);child.on('exit',fail);
 }
 schedule(){clearTimeout(this.timer);if(!this.pending.size)this.timer=setTimeout(()=>this.stop(),this.heavy?1000:30000);}
 call(data,onProgress){clearTimeout(this.timer);this.start();const id=++this.seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('İşlem zaman sınırını aştı; kaynak dosyalar korunuyor.'));this.stop();},this.heavy?600000:120000);this.pending.set(id,{resolve,reject,timer,onProgress});this.child.stdin.write(JSON.stringify({id,...data})+'\n');});}
 stop(reason='İşlem durduruldu; kaydedilen veriler korundu.'){clearTimeout(this.timer);for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(Error(reason));}this.pending.clear();if(this.child){const child=this.child;this.child=null;child.stdin.end();if(this.heavy){child.kill();return;}setTimeout(()=>{if(child.exitCode===null)child.kill();},2000).unref();}}
}
function service(){const c=configuration();if(!services.has(c.data))services.set(c.data,new Worker(c));return services.get(c.data);}
function guard(event){if(!authorized.has(event.sender.id))throw Error('Bu işlem yalnız Fiş Asistanı ekranında kullanılabilir.');const url=event.senderFrame?.url||'';if(event.senderFrame!==event.sender.mainFrame||!url.startsWith('file:')||!url.includes('/fis-desktop/index.html'))throw Error('Geçersiz Fiş Asistanı ekranı.');}
function register(){if(registered)return;registered=true;
 ipcMain.handle('fis:request',async(e,q)=>{guard(e);if(!q||typeof q.path!=='string'||!/^\/(api|desktop)\//.test(q.path)||JSON.stringify(q).length>40000000)throw Error('İstek geçersiz.');if(process.env.FIS_DESKTOP_TEST==='1'&&['/desktop/cloud-sync','/desktop/connection'].includes(q.path))throw Error('Testte bulut yazımı kapalı.');if(q.path==='/desktop/cloud-sync'){const c=configuration(),key=c.data+':cloud';if(!services.has(key))services.set(key,new Worker(c));return services.get(key).call(q);}return service().call(q,q.path==='/desktop/approve-many'?progress=>{if(!e.sender.isDestroyed())e.sender.send('fis:approve-progress',{jobId:q.body?.jobId,...progress});}:undefined);});
 ipcMain.handle('fis:import',async(e)=>{
  guard(e);const id=e.sender.id;if(imports.has(id))throw Error('Önceki yükleme sürüyor.');
  const state={cancelled:false,worker:null};imports.set(id,state);
  try{const owner=BrowserWindow.fromWebContents(e.sender)||BrowserWindow.getFocusedWindow();
   const choice=await dialog.showOpenDialog(owner,{title:'Fiş, fatura veya PDF seçin',properties:['openFile','multiSelections'],filters:[{name:'Belgeler',extensions:['jpg','jpeg','png','webp','bmp','tif','tiff','pdf','zip']}]});
   if(choice.canceled||state.cancelled)return {canceled:true,items:[],notes:[]};
   state.worker=new Worker(configuration(),true);
   return await state.worker.call({command:'ocr',paths:choice.filePaths,metadataOnly:true},n=>{if(!e.sender.isDestroyed()&&!state.cancelled)e.sender.send('fis:import-progress',{read:n});});
  }catch(error){if(state.cancelled)return {canceled:true,items:[],notes:[]};throw error;}
  finally{state.worker?.stop();imports.delete(id);}
 });
 ipcMain.handle('fis:cancel-import',async e=>{guard(e);const state=imports.get(e.sender.id);if(state){state.cancelled=true;state.worker?.stop('Yükleme iptal edildi.');}return {canceled:true};});
 ipcMain.handle('fis:import-image',async(e,ref)=>{guard(e);if(typeof ref!=='string'||!/^[a-f0-9-]+\.jpg$/i.test(ref))throw Error('Geçersiz belge görüntüsü.');const folder=path.resolve(configuration().data,'fotograflar','okuma'),file=path.resolve(folder,ref);if(path.dirname(file)!==folder)throw Error('Geçersiz dosya yolu.');const stat=await fs.promises.lstat(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>25*1024*1024)throw Error('Görüntü okunamıyor.');return {base64:(await fs.promises.readFile(file)).toString('base64')};});
 ipcMain.handle('fis:ocr-blob',async(e,q)=>{guard(e);if(typeof q.base64!=='string'||q.base64.length>30000000)throw Error('Görsel çok büyük.');const c=configuration(),folder=path.join(c.data,'fotograflar','okuma');fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,require('crypto').randomUUID()+'.png');fs.writeFileSync(file,Buffer.from(q.base64,'base64'));const worker=new Worker(c,true);try{return await worker.call({command:'ocr',paths:[file]});}finally{worker.stop();}});
 ipcMain.handle('fis:save-file',async(e,q)=>{guard(e);if(typeof q.base64!=='string'||q.base64.length>140000000)throw Error('Dosya çok büyük.');const name=path.basename(String(q.name||'fis-yedek.zip'));const result=await dialog.showSaveDialog({defaultPath:path.join(app.getPath('documents'),name)});if(result.canceled)return {canceled:true};fs.writeFileSync(result.filePath,Buffer.from(q.base64,'base64'));return {saved:true};});
 ipcMain.handle('fis:export',async(e,q)=>{guard(e);const result=await dialog.showSaveDialog({title:'Zirve aktarımı için aylık Excel',defaultPath:path.join(app.getPath('documents'),'Fis-'+String(q.period||'').replace(/[^0-9-]/g,'')+'.xlsx'),filters:[{name:'Excel',extensions:['xlsx']}]});if(result.canceled)return {canceled:true};const out=await service().call({path:'/desktop/export',method:'POST',body:{client:q.client,period:q.period,path:result.filePath}});return {saved:true,records:out.records};});
 app.on('before-quit',()=>{for(const state of imports.values()){state.cancelled=true;state.worker?.stop();}for(const w of services.values())w.stop();});
}
function setup(contents){register();authorized.add(contents.id);contents.once('destroyed',()=>{authorized.delete(contents.id);const state=imports.get(contents.id);if(state){state.cancelled=true;state.worker?.stop();imports.delete(contents.id);}});contents.setWindowOpenHandler(()=>({action:'deny'}));contents.on('will-navigate',e=>e.preventDefault());}
function options(){return {preload:path.join(__dirname,'receipt-desktop-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,partition:'persist:fis-desktop'};}
class ReceiptHost{
 constructor(win){this.win=win;this.view=null;this.starting=null;}
 start(){if(this.starting)return this.starting;this.view=new BrowserView({webPreferences:options()});setup(this.view.webContents);this.view.setBackgroundColor('#f6f8fb');this.starting=this.view.webContents.loadFile(path.join(__dirname,'app/fis-desktop/index.html'));this.win.once('closed',()=>{if(this.view&&!this.view.webContents.isDestroyed())this.view.webContents.close();});return this.starting;}
 async layout(rect,visible,scale){if(!visible&&!this.view)return true;await this.start();if(!visible){this.win.removeBrowserView(this.view);return true;}const factor=this.win.webContents.getZoomFactor();const bounds={};for(const key of ['x','y','width','height']){const v=Number(rect?.[key]||0)*factor;if(!Number.isFinite(v)||Math.abs(v)>20000)throw Error('Geçersiz pencere boyutu.');bounds[key]=Math.round(v);}if(bounds.width<1||bounds.height<1)return true;if(!this.win.getBrowserViews().includes(this.view))this.win.addBrowserView(this.view);this.view.setBounds(bounds);return true;}
 async close(){if(!this.view||this.view.webContents.isDestroyed())return true;return !await this.view.webContents.executeJavaScript('!!window.fisHasUnsaved?.()');}
}
let standaloneWindow=null;
function standalone(){register();if(standaloneWindow&&!standaloneWindow.isDestroyed()){if(standaloneWindow.isMinimized())standaloneWindow.restore();standaloneWindow.focus();return standaloneWindow;}const win=new BrowserWindow({width:1250,height:900,minWidth:540,minHeight:620,title:'Fiş Asistanı',backgroundColor:'#f6f8fb',webPreferences:options()});standaloneWindow=win;setup(win.webContents);win.setMenuBarVisibility(false);win.webContents.on('will-prevent-unload',()=>dialog.showMessageBox(win,{type:'info',message:'Açık belgeyi kaydedin veya Geri düğmesiyle kapatın.',detail:'Dosya yükleniyorsa Yüklemeyi iptal et düğmesini kullanabilirsiniz.'}));win.on('closed',()=>{standaloneWindow=null;});win.loadFile(path.join(__dirname,'app/fis-desktop/index.html'));return win;}
module.exports={ReceiptHost,standalone,Worker};
