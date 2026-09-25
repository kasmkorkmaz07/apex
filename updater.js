const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {spawn,execFile}=require('child_process');
const {promisify}=require('util');
const exec=promisify(execFile);
const version=v=>{const m=String(v||'').match(/^v?(\d+)\.(\d+)\.(\d+)(?:\.0)?$/);if(!m)throw Error('Geçersiz güncelleme sürümü.');return m.slice(1).map(Number).join('.')};
const compare=(a,b)=>{a=version(a).split('.').map(Number);b=version(b).split('.').map(Number);for(let i=0;i<3;i++)if(a[i]!==b[i])return Math.sign(a[i]-b[i]);return 0};
function normalize(remote){
 if(!remote||typeof remote!=='object')throw Error('Güncelleme bilgisi eksik.');
 const v=version(remote.tag_name||remote.latestVersion||remote.version);
 if(remote.tag_name){
  if(remote.draft||remote.prerelease)throw Error('Kararlı sürüm bulunamadı.');
  const names=[`apex-kurulum-v${v}.exe`,`apex-kurulum-${v}.exe`];
  const asset=(remote.assets||[]).find(a=>names.includes(String(a.name).toLowerCase()));
  if(!asset)throw Error(v+' sürümüne ait kurulum paketi bulunamadı.');
  return{version:v,latestVersion:v,downloadUrl:asset.browser_download_url,sha256:String(asset.digest||'').replace(/^sha256:/,''),size:asset.size,notes:remote.body?[remote.body]:[]};
 }
 return{...remote,version:v,latestVersion:v};
}
async function hashFile(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex')}
const quote=s=>"'"+String(s).replace(/'/g,"''")+"'";
const encoded=s=>Buffer.from(s,'utf16le').toString('base64');
async function verifyInstaller(file,release){
 if(!/^[a-f0-9]{64}$/i.test(release.sha256||''))throw Error('Paketin SHA-256 doğrulama bilgisi yok. Güncelleme kurulmadı.');
 if(release.size&&fs.statSync(file).size!==release.size)throw Error('Kurulum paketi eksik indirildi.');
 if(await hashFile(file)!==release.sha256.toLowerCase())throw Error('İndirilen paket beklenen sürümün doğrulama özetiyle eşleşmiyor.');
 const script=`(Get-Item -LiteralPath ${quote(file)}).VersionInfo.ProductVersion`;
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded(script)],{windowsHide:true,timeout:15000});
 if(version(stdout.trim())!==version(release.latestVersion))throw Error('Kurulum dosyasının iç sürümü beklenen sürümle eşleşmiyor.');
}
async function launch({root,installer,exe,version:expected,appPid,sha256}){
 const dir=path.join(root,'updates');fs.mkdirSync(dir,{recursive:true});
 const id=crypto.randomUUID(),configPath=path.join(dir,'install-'+id+'.json'),ready=path.join(dir,'ready-'+id+'.json');
 const runner=path.join(dir,'apex-update-runner-v2.ps1');
 fs.copyFileSync(path.join(__dirname,'update-runner.ps1'),runner);
 fs.writeFileSync(configPath,JSON.stringify({installer,exe,installDir:path.dirname(exe),expectedVersion:expected,appPid,sha256,ready,log:path.join(dir,'update.log'),result:path.join(dir,'update-result.json')}));
 const command=`& ${quote(runner)} -ConfigPath ${quote(configPath)}`;
 const args='-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand '+encoded(command);
 const elevate=/^[a-z]:\\Program Files(?: \(x86\))?\\/i.test(exe);
 const bootstrap=`$ErrorActionPreference='Stop';Start-Process -FilePath 'powershell.exe' -ArgumentList ${quote(args)} ${elevate?'-Verb RunAs ':''}-WindowStyle Hidden`;
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded(bootstrap)],{windowsHide:true,stdio:'ignore'});
 let failure=null;child.on('error',e=>failure=e);child.on('exit',code=>{if(code)failure=Error('Güncelleme izni verilmedi veya yardımcı başlatılamadı.')});
 const deadline=Date.now()+90000;
 while(Date.now()<deadline){if(fs.existsSync(ready)){const signal=JSON.parse(fs.readFileSync(ready,'utf8').replace(/^\uFEFF/,''));if(!signal.ok)throw Error(signal.error);return}if(failure)throw failure;await new Promise(r=>setTimeout(r,200))}
 throw Error('Güncelleme yardımcısı başlamadı. Apex açık bırakıldı.');
}
module.exports={normalize,compare,version,hashFile,verifyInstaller,launch,quote,encoded};
