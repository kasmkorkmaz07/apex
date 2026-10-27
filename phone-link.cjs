'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),https=require('https');
const SERVER='https://belge.apex-kasim-belgeler.workers.dev';
function request(route, token, data) {
  return new Promise((resolve,reject)=>{
    const body=data===undefined?null:Buffer.from(JSON.stringify(data));
    const req=https.request(SERVER+route,{method:body?'POST':'GET',headers:{'User-Agent':'ApexCepNative/2.0',...(token?{'X-Apex-App-Key':token}:{}),...(body?{'Content-Type':'application/json','Content-Length':body.length}:{})}},res=>{
      const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString());if(res.statusCode!==200)throw Error(value.error||`Bağlantı hatası (${res.statusCode})`);resolve(value)}catch(e){reject(e)}});
    });req.setTimeout(25000,()=>req.destroy(Error('Sunucuya ulaşılamadı. Yeniden deneyin.')));req.on('error',reject);req.end(body);
  });
}
function createPhoneLink({app,ipcMain,safeStorage,utilityProcess,dataRoot}) {
  let child=null,restart=null,closed=false,lastError='',starting=null;
  const file=()=>path.join(app.getPath('userData'),'phone-link.bin');
  function read(){try{return JSON.parse(safeStorage.decryptString(fs.readFileSync(file())))}catch(e){if(fs.existsSync(file()))throw Error('Telefon bağlantısı kaydı okunamadı');return null}}
  function save(value){if(!safeStorage.isEncryptionAvailable())throw Error('Windows güvenli kayıt alanı kullanılamıyor');const temp=file()+'.tmp';fs.mkdirSync(path.dirname(file()),{recursive:true});fs.writeFileSync(temp,safeStorage.encryptString(JSON.stringify(value)));fs.renameSync(temp,file())}
  const pauseFile=()=>path.join(app.getPath('userData'),'phone-sync-paused.json');
  const paused=()=>fs.existsSync(pauseFile());
  function stop(){clearTimeout(restart);restart=null;const old=child;child=null;old?.removeAllListeners('exit');old?.kill()}
  ipcMain.handle('apex:phone-pause',(_e,value)=>{if(value){fs.writeFileSync(pauseFile(),JSON.stringify({paused:true,at:new Date().toISOString()}));stop()}else{if(paused())fs.unlinkSync(pauseFile());start()}return{paused:paused()}});
  function start(){
    if(child||closed||paused())return;
    const cfg=read();if(!cfg?.desktopToken)return;
    const relay={enabled:true,relayServer:SERVER,desktopToken:cfg.desktopToken,prefix:cfg.prefix,encryptionKeyBase64:cfg.encryptionKey,fullArchive:{enabled:true,startYear:2023,hourly:true}};
    child=utilityProcess.fork(path.join(__dirname,'phone-collector.cjs'),[],{serviceName:'Apex Telefon Bağlantısı',stdio:'pipe',env:{...process.env,APEX_TAHAKKUK_DATA:dataRoot(),ZIRVE_ROOT:cfg.rootPath,APEX_PHONE_CONFIG:JSON.stringify(relay)}});
    child.on('message',v=>{if(v?.error)lastError=String(v.error).slice(0,500);if(v?.ready)lastError=''});
    child.on('exit',()=>{child=null;if(!closed)restart=setTimeout(()=>{try{start()}catch(e){lastError=e.message}},10000)});
    child.stderr?.on('data',()=>{});child.stdout?.on('data',()=>{});
  }
  async function setup(p){
    if(starting)return starting;
    starting=(async()=>{
      const rootPath=String(p?.rootPath||'').trim();
      if(!rootPath||!fs.statSync(rootPath).isDirectory())throw Error('Tahakkuk Gönder bölümündeki belge ana klasörüne erişilemiyor. Klasörü seçip yeniden deneyin.');
      let cfg=read();
      if(!cfg){
        let encryptionKey=crypto.randomBytes(32).toString('base64');
        try{const old=JSON.parse(fs.readFileSync(path.join(dataRoot(),'cloudflare-r2.json'),'utf8'));if(/^[A-Za-z0-9+/]{43}=$/.test(old.encryptionKeyBase64||''))encryptionKey=old.encryptionKeyBase64}catch{}
        cfg={installId:crypto.randomBytes(24).toString('hex'),secret:crypto.randomBytes(32).toString('hex'),encryptionKey,name:String(p?.name||require('os').hostname()).slice(0,80),rootPath};save(cfg);
      }
      if(!cfg.desktopToken){Object.assign(cfg,await request('/api/phone/register',null,cfg));save(cfg)}
      if(cfg.rootPath!==rootPath){cfg.rootPath=rootPath;save(cfg);const old=child;child=null;old?.removeAllListeners('exit');old?.kill()}
      start();return request('/api/phone/code',cfg.desktopToken,{});
    })();try{return await starting}finally{starting=null}
  }
  ipcMain.handle('apex:phone-code',(_e,p)=>setup(p));
  ipcMain.handle('apex:phone-status',async()=>{const cfg=read();if(!cfg?.desktopToken)return{configured:false,paused:paused()};if(paused())return{configured:true,paused:true,name:cfg.name,rootPath:cfg.rootPath,running:false};start();const status=await request('/api/sync-status',cfg.desktopToken);return{configured:true,name:cfg.name,rootPath:cfg.rootPath,running:!!child,lastError,...status}});
  ipcMain.handle('apex:phone-devices',async(_e,cursor)=>{if(paused())return{devices:[]};const cfg=read();return cfg?.desktopToken?request('/api/phone/devices'+(cursor?'?cursor='+encodeURIComponent(String(cursor)):''),cfg.desktopToken):{devices:[]}});
  ipcMain.handle('apex:phone-revoke',async(_e,id)=>{const cfg=read();if(!cfg?.desktopToken)throw Error('Ofis eşleştirilmedi');return request('/api/phone/revoke',cfg.desktopToken,{deviceId:id})});
  ipcMain.handle('apex:phone-sync',async()=>{if(paused())throw Error('Telefon bağlantısı duraklatıldı. Önce bağlantıyı açın.');const cfg=read();if(!cfg?.desktopToken)throw Error('Önce Telefon bağlantısı bölümünden eşleştirin');start();child?.postMessage({sync:true});return request('/api/sync-request',cfg.desktopToken,{})});
  app.on('before-quit',()=>{closed=true;clearTimeout(restart);child?.kill();child=null});
  return{start:()=>{try{start()}catch(e){lastError=e.message}}};
}
module.exports={createPhoneLink,request};
