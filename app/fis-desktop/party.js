import {isReturn} from './special.js';
export function partyCheck(d,kind,taxId){
 if(!taxId||!d.is_invoice)return null;
 const seller=String(d.seller_vkn||''),buyer=String(d.buyer_vkn||'');
 const signature=JSON.stringify([taxId,seller,buyer,kind,isReturn(d)]);
 if(seller===taxId&&buyer===taxId)return {signature,message:'Mükellefin numarası iki tarafta da okunmuş. Alıcı ve satıcıyı kontrol edin.'};
 if(seller!==taxId&&buyer!==taxId){
  const found=d.party_blocks?.some(b=>b.vkn===taxId)||new RegExp('(?:^|[^0-9])'+taxId+'(?:[^0-9]|$)').test(String(d.ocr||''));
  return {signature,message:found?'Mükellefin VKN/TCKN’si belgede bulundu; alıcı mı satıcı mı olduğu kesin belirlenemedi. Seçtiğiniz gelir/gider bölümünü kontrol edin.':'Mükellefin VKN/TCKN’si okunan alıcı ve satıcı bilgilerinde bulunamadı. Belge başka mükellefe ait olabilir veya numara okunamamış olabilir.'};
 }
 const expected=seller===taxId?'gelir':'gider';
 return expected===kind?null:{signature,message:'Faturadaki VKN/TCKN ve fatura tipine göre bu belge '+(expected==='gelir'?'Gelir':'Gider')+' bölümüne ait görünüyor. Seçtiğiniz bölüm değiştirilmedi.'};
}
