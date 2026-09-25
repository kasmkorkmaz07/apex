'use strict';
const {spawn}=require('child_process');
const readline=require('readline');
const path=require('path');
const fs=require('fs');

class ReceiptHost {
  constructor(win,config){this.win=win;this.config=config;this.pending=new Map();this.sequence=0;this.child=null;this.starting=null;}
  start(){
    if(this.starting)return this.starting;
    this.starting=new Promise((resolve,reject)=>{
      const {python,source,data}=this.config;
      if(!fs.existsSync(python)||!fs.existsSync(path.join(source,'apex_embed.py'))){reject(new Error('Fiş Asistanı kurulumu eksik. Hazırlanan güncelleme paketini kurun.'));return;}
      const handle=this.win.getNativeWindowHandle();
      const hwnd=handle.length===8?handle.readBigUInt64LE().toString():String(handle.readUInt32LE());
      const child=spawn(python,['-X','utf8',path.join(source,'apex_embed.py'),data,hwnd],{cwd:source,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUNBUFFERED:'1'}});
      this.child=child;let ready=false;
      const timer=setTimeout(()=>{reject(new Error('Fiş Asistanı başlatılamadı.'));child.stdin.end();},30000);
      const fail=(error)=>{
        clearTimeout(timer);if(!ready)reject(error);
        for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.child=null;this.starting=null;
      };
      readline.createInterface({input:child.stdout}).on('line',line=>{
        let message;try{message=JSON.parse(line);}catch{return;}
        if(message.error&&!ready){clearTimeout(timer);reject(new Error(message.error));}
        if(message.ready){ready=true;clearTimeout(timer);resolve(this);}
        const pending=this.pending.get(message.id);
        if(pending){clearTimeout(pending.timer);this.pending.delete(message.id);pending.resolve(message.ok);}
      });
      // stderr tüketilir; OCR metinleri ve kişisel bilgiler Apex günlüğüne taşınmaz.
      child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
      child.on('error',fail);child.on('exit',()=>fail(new Error('Fiş Asistanı kapandı. Tekrar açabilirsiniz.')));
    });
    this.starting.catch(()=>{this.starting=null;});return this.starting;
  }
  async command(cmd,payload={}){
    await this.start();const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Fiş Asistanı yanıtı bekleniyor.'));},cmd==='close'?120000:15000);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,cmd,...payload})+'\n');
    });
  }
  async layout(rect,visible,scale){
    if(!visible&&!this.child)return;
    const safe={};for(const key of ['x','y','width','height']){
      const value=Number(rect?.[key]||0);if(!Number.isFinite(value)||Math.abs(value)>20000)throw new Error('Geçersiz pencere boyutu.');
      safe[key]=Math.round(value*scale);
    }
    return this.command('layout',{rect:safe,visible:!!visible});
  }
  async close(){if(!this.child)return true;const ok=await this.command('close');if(ok)this.child?.stdin.end();return ok;}
}
module.exports={ReceiptHost};
