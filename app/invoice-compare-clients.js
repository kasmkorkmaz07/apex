/* Comparison directory: shared package records remain intact when removed here. */
(function(){
'use strict';
const sharedClients=window.packageClientsFlat;
let addingClient=false;
const nameKey=value=>String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('tr-TR');
function directory(){
 if(!packageStore.invoiceCompareDirectory)packageStore.invoiceCompareDirectory={clients:[],hiddenIds:[],selectedId:''};
 const d=packageStore.invoiceCompareDirectory;
 if(!Array.isArray(d.clients))d.clients=[];
 if(!Array.isArray(d.hiddenIds))d.hiddenIds=[];
 return d;
}
window.packageClientsFlat=function(){const d=directory();return [...sharedClients(),...d.clients].filter(c=>!d.hiddenIds.includes(c.id));};
function selected(){return document.getElementById('invoice-compare-client').value;}
function resetComparison(){invoiceCompareState={source:[],target:[],result:null};}
const originalRender=window.renderInvoiceCompare;
window.renderInvoiceCompare=function(){
 const select=document.getElementById('invoice-compare-client'),d=directory();
 if(select&&!select.value&&d.selectedId){select.replaceChildren(new Option('',d.selectedId));select.value=d.selectedId;}
 originalRender();
 const client=packageClientsFlat().find(c=>c.id===select?.value);
 document.getElementById('invoice-compare-vkn').value=client?.vkn||'';
 const info=document.getElementById('invoice-compare-selected-info');info.hidden=!client;info.style.display=client?'block':'none';
 const form=document.getElementById('invoice-compare-new-form');form.hidden=!!client&&!addingClient;form.style.display=form.hidden?'none':'grid';form.style.gap='8px';
 document.getElementById('invoice-compare-show-new').hidden=!form.hidden;
 document.getElementById('invoice-compare-cancel-new').hidden=!client;
 document.getElementById('invoice-compare-delete-client').disabled=!client;
};
window.showInvoiceCompareNewClient=function(){addingClient=true;renderInvoiceCompare();document.getElementById('invoice-compare-new-name').focus();};
window.hideInvoiceCompareNewClient=function(){addingClient=false;document.getElementById('invoice-compare-new-name').value='';document.getElementById('invoice-compare-new-vkn').value='';renderInvoiceCompare();};
// Selected identity is display-only; new identity entry cannot overwrite a shared client.
window.saveInvoiceCompareClientVkn=function(){};
const originalSync=window.syncInvoiceCompareClient;
window.syncInvoiceCompareClient=function(){originalSync();directory().selectedId=selected();savePackageStore();resetComparison();renderInvoiceCompare();invoiceCompareStatus('Mükellef seçildi. Karşılaştırılacak dosyaları ekleyin.','active');};
window.addInvoiceCompareClient=function(){
 const nameInput=document.getElementById('invoice-compare-new-name'),vknInput=document.getElementById('invoice-compare-new-vkn');
 const name=nameInput.value.trim(),vkn=vknInput.value.trim();
 if(!name){invoiceCompareStatus('Yeni mükellefin adını girin.','warn');nameInput.focus();return;}
 if(vkn&&!/^\d{10,11}$/.test(vkn)){invoiceCompareStatus('VKN 10, TCKN 11 rakam olmalı.','warn');vknInput.focus();return;}
 const d=directory(),visible=packageClientsFlat();
 const existing=visible.find(c=>nameKey(c.name)===nameKey(name)&&String(c.vkn||'')===vkn);
 const conflict=visible.find(c=>c!==existing&&((vkn&&c.vkn===vkn)||nameKey(c.name)===nameKey(name)));
 if(!existing&&conflict){invoiceCompareStatus('Bu ad veya VKN/TCKN farklı bir kayıtla çakışıyor. Yeni kayıt oluşturulmadı. Eski kayıt hatalıysa listeden silip tekrar ekleyin.','warn');return;}
 const client=existing||{id:'compare-'+crypto.randomUUID(),name,vkn};
 if(!existing)d.clients.push(client);
 d.selectedId=client.id;
 savePackageStore();resetComparison();
 const select=document.getElementById('invoice-compare-client');select.replaceChildren(new Option(client.name,client.id));select.value=client.id;
 nameInput.value='';vknInput.value='';addingClient=false;renderInvoiceCompare();
 invoiceCompareStatus(existing?'Mevcut mükellef seçildi.':'Mükellef eklendi. Dosyaları yükleyebilirsiniz.','ok');
};
window.deleteInvoiceCompareClient=async function(){
 const id=selected(),client=packageClientsFlat().find(c=>c.id===id);if(!client)return;
 if(!await appConfirm(`${client.name} karşılaştırma listesinden silinsin mi? Diğer paketlerdeki mükellef ve fatura kayıtları korunur.`,'Mükellefi listeden sil'))return;
 const d=directory();d.clients=d.clients.filter(c=>c.id!==id);
 if(sharedClients().some(c=>c.id===id)&&!d.hiddenIds.includes(id))d.hiddenIds.push(id);
 d.selectedId='';addingClient=false;savePackageStore();resetComparison();
 document.getElementById('invoice-compare-client').value='';renderInvoiceCompare();
 invoiceCompareStatus('Mükellef karşılaştırma listesinden silindi.','ok');
};
})();
