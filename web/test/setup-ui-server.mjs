import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,createHelper} from '../server.mjs';import {phoneSetupPage} from '../phone-setup-page.mjs';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tv-setup-ui-')),store=new Store(directory);store.update({accessKey:'a'.repeat(64)});let addresses=['192.168.0.151'];
const secureConfig={port:48766,addresses:['192.168.0.151','192.168.0.152'],fingerprint:'AA:BB:CC:DD:'.repeat(8).slice(0,-1),certificateName:'TV Remote Local CA',certificate:Buffer.from('synthetic test certificate')};
const helper=createHelper({store,port:48869,tv:{snapshot:()=>({state:'disconnected'})},addresses:[],addressProvider:()=>addresses,secureConfig});
const listener=helper.server.listeners('request')[0];helper.server.removeAllListeners('request');helper.server.on('request',(req,res)=>{
 if(req.url==='/__fixture/empty'){addresses=[];res.end('ok');return;}
 if(req.url==='/__fixture/ready'){addresses=['192.168.0.151'];res.end('ok');return;}
 if(req.url==='/__fixture/multiple'){addresses=['192.168.0.151','192.168.0.152'];res.end('ok');return;}
 if(req.url==='/__fixture/checked'){res.setHeader('Content-Type','text/html');res.end(phoneSetupPage(secureConfig,'192.168.0.151',{checked:true}));return;}
 listener(req,res);
});helper.server.listen(48869,'127.0.0.1');process.on('SIGTERM',()=>{helper.server.close();fs.rmSync(directory,{recursive:true,force:true});});
