import fs from 'node:fs/promises';import path from 'node:path';import QRCode from 'qrcode';
import {launcherPage} from './launcher-page.mjs';
export async function buildConnectionPage({addresses,port,accessKey,secure=null}){
 const covered=secure?addresses.filter(a=>secure.addresses.includes(a)):[];
 const phoneURLs=(covered.length?covered:addresses).map(address=>(covered.length?'https://':'http://')+address+':'+(covered.length?secure.port:port)+'/#access='+accessKey);
 const cards=await Promise.all(phoneURLs.map(async url=>({url,qr:await QRCode.toDataURL(url,{width:400,margin:4,errorCorrectionLevel:'M',color:{dark:'#000000',light:'#ffffff'}})})));
 let setup=null;if(secure&&addresses.length){const url='http://'+addresses[0]+':'+port+'/setup/';setup={url,fingerprint:secure.fingerprint,qr:await QRCode.toDataURL(url,{width:240,margin:4,color:{dark:'#000000',light:'#ffffff'}}),needsRenewal:covered.length===0};}
 return {html:launcherPage(cards,'http://127.0.0.1:'+port+'/#access='+accessKey,setup),phoneCount:cards.length,secure:covered.length>0};
}
export async function writeConnectionPage(options){
 const {directory,visibleDirectory=null}=options,{html:page,...result}=await buildConnectionPage(options);
 for(const folder of new Set([directory,visibleDirectory].filter(Boolean))){await fs.mkdir(folder,{recursive:true,mode:0o700});const file=path.join(folder,'Open Remote.html'),temporary=file+'.'+process.pid+'.tmp';try{await fs.writeFile(temporary,page,{mode:0o600});await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(()=>{});}}
 return result;
}
