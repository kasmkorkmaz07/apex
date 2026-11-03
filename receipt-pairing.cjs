'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function valid(c){const u=new URL(c?.url);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||typeof c.token!=='string'||c.token.length<32||c.token.length>4096)throw Error('Ofis bağlantı bilgileri geçersiz.');return {url:u.origin,token:c.token};}
function key(scope,secret){if(!/^\d+$/.test(String(scope))||typeof secret!=='string'||secret.length<20||secret.length>4096)throw Error('Apex senkron bağlantısı eksik.');return crypto.createHash('sha256').update('ApexReceiptPairing/v1\0'+scope+'\0'+secret).digest();}
function seal(c,scope,secret){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(scope,secret),iv);cipher.setAAD(Buffer.from(String(scope)));const data=Buffer.concat([cipher.update(JSON.stringify(valid(c)),'utf8'),cipher.final()]);return {version:1,iv:iv.toString('base64'),data:data.toString('base64'),tag:cipher.getAuthTag().toString('base64')};}
function open(e,scope,secret){if(e?.version!==1||JSON.stringify(e).length>20000)throw Error('Ofis bağlantı kaydı geçersiz.');const decipher=crypto.createDecipheriv('aes-256-gcm',key(scope,secret),Buffer.from(e.iv,'base64'));decipher.setAAD(Buffer.from(String(scope)));decipher.setAuthTag(Buffer.from(e.tag,'base64'));return valid(JSON.parse(Buffer.concat([decipher.update(Buffer.from(e.data,'base64')),decipher.final()]).toString('utf8')));}
async function exchange(home,p,probe){const file=path.join(home,'cep-baglanti.json');let current=null;try{current=valid(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')));}catch(e){if(fs.existsSync(file))throw Error('Mevcut ofis bağlantısı okunamadı; üzerine yazılmadı.');}
 if(p.envelope){const incoming=open(p.envelope,p.scope,p.secret);if(current){if(current.url!==incoming.url||current.token!==incoming.token)throw Error('Bu bilgisayar başka bir Fiş Asistanı ofisine bağlı; bağlantı değiştirilmedi.');return {status:'same'};}
 await probe(incoming);fs.mkdirSync(home,{recursive:true});const value={...incoming,device:'desktop-'+crypto.randomUUID()};fs.writeFileSync(file,JSON.stringify(value,null,2),{flag:'wx'});return {status:'connected'};
 }
 return current?{status:'publish',envelope:seal(current,p.scope,p.secret)}:{status:'unconfigured'};
}
module.exports={seal,open,exchange};
