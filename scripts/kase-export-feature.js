    // Selected saved assets: export copies, never mutate the stored originals.
    const storedPngButton = document.createElement('button');
    storedPngButton.type = 'button'; storedPngButton.id = 'exportSavedTransparent';
    storedPngButton.textContent = 'Kayıtlı kaşe / imzayı şeffaf PNG kaydet';
    settingsPanel.append(storedPngButton);
    const pngDialog = document.createElement('dialog'); pngDialog.id = 'savedPngDialog';
    pngDialog.style.cssText = 'max-width:680px;width:calc(100% - 32px);max-height:85vh;border:1px solid #dbe2e9;border-radius:18px;padding:24px;color:#152536;background:#fff;overflow:auto';
    pngDialog.innerHTML = '<form method="dialog" style="display:flex;align-items:center;justify-content:space-between;gap:12px"><h2 style="margin:0;font-size:20px">Şeffaf kaşe ve imza</h2><button aria-label="Pencereyi kapat">Kapat</button></form><p>Kayıtlı görsellerden seçim yapın. Orijinalleriniz korunur; seçilenlerin arka plansız kopyası indirilir.</p><div id="savedPngChoices" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:16px 0"></div><label style="display:block">Arka plan temizliği <input id="savedPngTolerance" type="range" min="8" max="100" value="42" style="width:100%"></label><p style="font-size:13px;color:#5d6a78">Açık kâğıt rengi temizlenir. Önizlemede ince çizgiler kayboluyorsa temizliği azaltın.</p><div id="savedPngPreview" style="min-height:90px;border:1px solid #dbe2e9;border-radius:10px;background:repeating-conic-gradient(#e3e7ec 0% 25%,#fff 0% 50%) 50%/18px 18px;display:flex;align-items:center;justify-content:center;padding:12px"></div><p id="savedPngStatus" role="status"></p><button type="button" id="saveSelectedPng" style="width:100%;padding:12px;margin-top:10px">Seçilenleri kaydet</button>';
    document.body.append(pngDialog);
    const pngChoices=pngDialog.querySelector('#savedPngChoices'),pngTolerance=pngDialog.querySelector('#savedPngTolerance'),pngStatus=pngDialog.querySelector('#savedPngStatus'),pngSave=pngDialog.querySelector('#saveSelectedPng');
    const transparentAssetCanvas = async (asset,tolerance=42) => {
      const image=await loadImageElement(asset.src),canvas=document.createElement('canvas');
      canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      if(!canvas.width||!canvas.height||canvas.width*canvas.height>40000000)throw new Error('Görsel boyutu desteklenmiyor.');
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),d=pixels.data,samples=[];
      const step=Math.max(1,Math.floor(Math.min(canvas.width,canvas.height)/80));
      for(let y=0;y<canvas.height;y+=step)for(let x=0;x<canvas.width;x+=step){
        if(x>canvas.width*.07&&x<canvas.width*.93&&y>canvas.height*.07&&y<canvas.height*.93)continue;
        const i=(y*canvas.width+x)*4,r=d[i],g=d[i+1],b=d[i+2];
        if(d[i+3]>240&&(r+g+b)/3>185&&Math.max(r,g,b)-Math.min(r,g,b)<55)samples.push([r,g,b]);
      }
      const bg=samples.length?[0,1,2].map(k=>samples.map(p=>p[k]).sort((a,b)=>a-b)[Math.floor(samples.length/2)]):[255,255,255];
      for(let i=0;i<d.length;i+=4){
        if(!d[i+3])continue;
        const brightness=(d[i]+d[i+1]+d[i+2])/3,dist=Math.hypot(d[i]-bg[0],d[i+1]-bg[1],d[i+2]-bg[2]);
        if(brightness<160)continue;
        const factor=Math.max(0,Math.min(1,(dist-tolerance)/28));
        d[i+3]=Math.round(d[i+3]*factor);
      }
      ctx.putImageData(pixels,0,0);return canvas;
    };
    const pngSelected = () => new Set([...pngChoices.querySelectorAll('input:checked')].map(x=>x.value));
    let pngPreviewSequence=0;
    const previewSavedPng = async () => {
      const sequence=++pngPreviewSequence,ids=pngSelected(),asset=state.assets.find(a=>ids.has(a.id));
      pngSave.disabled=!ids.size;pngSave.textContent=ids.size>1?`${ids.size} görseli ZIP olarak kaydet`:'Şeffaf PNG kaydet';
      const box=pngDialog.querySelector('#savedPngPreview');box.replaceChildren();
      if(!asset){box.textContent='Önizleme için bir görsel seçin.';return;}
      try{const canvas=await transparentAssetCanvas(asset,Number(pngTolerance.value));if(sequence!==pngPreviewSequence)return;canvas.style.cssText='max-width:100%;max-height:180px;object-fit:contain';box.append(canvas);pngStatus.textContent=ids.size+' görsel seçildi.';}
      catch(e){pngStatus.textContent=e.message;}
    };
    const storedZip = files => {
      const enc=new TextEncoder(),parts=[],central=[];let offset=0,size=0;
      const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
      const header=(length)=>{let b=new Uint8Array(length);return [b,new DataView(b.buffer)];};
      for(const file of files){const name=enc.encode(file.name),data=file.data,c=crc(data),[h,v]=header(30);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,c,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);parts.push(h,name,data);
        const [ch,cv]=header(46);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint32(16,c,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);central.push(ch,name);size+=46+name.length;offset+=30+name.length+data.length;}
      const [end,ev]=header(22);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);ev.setUint32(12,size,true);ev.setUint32(16,offset,true);return new Blob([...parts,...central,end],{type:'application/zip'});
    };
    storedPngButton.onclick=()=>{
      pngChoices.replaceChildren();pngStatus.textContent='';
      for(const asset of state.assets){const label=document.createElement('label');label.style.cssText='display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #dbe2e9;border-radius:10px;cursor:pointer';const check=document.createElement('input');check.type='checkbox';check.value=asset.id;check.onchange=previewSavedPng;const image=document.createElement('img');image.src=asset.src;image.alt='';image.style.cssText='width:70px;height:50px;object-fit:contain';const name=document.createElement('span');name.textContent=asset.name;label.append(check,image,name);pngChoices.append(label);}
      if(!state.assets.length)pngChoices.textContent='Henüz kayıtlı kaşe veya imza yok. Önce bir görsel ekleyin.';
      settingsPanel.hidden=true;pngDialog.showModal();previewSavedPng();
    };
    pngTolerance.oninput=previewSavedPng;
    pngSave.onclick=async()=>{
      const selected=pngSelected(),assets=state.assets.filter(a=>selected.has(a.id));if(!assets.length)return;
      pngSave.disabled=true;pngStatus.textContent='Şeffaf kopyalar hazırlanıyor…';
      try{const files=[];for(const [i,asset] of assets.entries()){const canvas=await transparentAssetCanvas(asset,Number(pngTolerance.value));const blob=await new Promise(ok=>canvas.toBlob(ok,'image/png'));if(!blob)throw new Error('PNG oluşturulamadı.');const name=asset.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,90)||'kase-imza';files.push({name:`${name}${assets.length>1?'-'+(i+1):''}-seffaf.png`,data:new Uint8Array(await blob.arrayBuffer())});}
        downloadBlob(files.length===1?new Blob([files[0].data],{type:'image/png'}):storedZip(files),files.length===1?files[0].name:'Kase-Imza-Seffaf-PNG.zip');pngStatus.textContent=files.length+' görsel kaydedildi. Kayıtlı orijinalleriniz değişmedi.';
      }catch(e){pngStatus.textContent=e.message;}finally{pngSave.disabled=false;}
    };
