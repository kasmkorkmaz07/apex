(()=>{
  const modal=document.getElementById('package-modal');
  const shell=modal.querySelector('.package-modal');
  const view=document.getElementById('smart-doc-view');
  const host=document.getElementById('receipt-native-host');
  const status=document.getElementById('receipt-launch-status');
  const retry=document.getElementById('receipt-retry');
  let last='',timer=0,failed=false,inFlight=false,again=false;
  // Windows, yerel çocuk pencere Chromium'u kapladığında document.hidden diyebilir.
  // Bu durumda asistanı gizlemek açılışı görünmezlik döngüsüne sokar.
  const visible=()=>modal.classList.contains('open')&&!view.classList.contains('package-hidden');
  async function layout(){
    clearTimeout(timer);const show=visible();shell.classList.toggle('receipt-mode',show);
    if(inFlight){again=true;return;}
    const r=host.getBoundingClientRect();const rect={x:r.x,y:r.y,width:r.width,height:r.height};
    const key=JSON.stringify({rect,show});if(key===last||failed&&show)return;last=key;
    if(!window.apexDesktop?.receiptLayout){status.textContent='Fiş Asistanı, güncel Apex masaüstü sürümünde açılır.';return;}
    inFlight=true;
    let deadline;
    try{
      await Promise.race([window.apexDesktop.receiptLayout({rect,visible:show}),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Fiş Asistanı açılamadı. Tekrar dene düğmesini kullanın. Bağımsız Fiş Asistanı açıksa önce onu kapatın.')),50000);})]);
      retry.hidden=true;if(show)status.textContent='Fiş Asistanı açıldı.';
    }
    catch(error){failed=true;status.textContent=error.message||String(error);retry.hidden=false;}
    finally{clearTimeout(deadline);inFlight=false;if(again){again=false;last='';schedule();}}
  }
  function schedule(){if(timer)return;timer=setTimeout(()=>{timer=0;layout();},40);}
  window.openReceiptAssistant=()=>{failed=false;last='';status.textContent='Fiş Asistanı hazırlanıyor…';schedule();};
  new MutationObserver(schedule).observe(modal,{attributes:true,attributeFilter:['class']});
  new MutationObserver(schedule).observe(view,{attributes:true,attributeFilter:['class']});
  new ResizeObserver(schedule).observe(host);
  window.addEventListener('resize',schedule);document.addEventListener('visibilitychange',schedule);
  window.addEventListener('scroll',schedule,true);
})();
