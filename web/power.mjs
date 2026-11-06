import http from 'node:http';
import {localAddress} from './protocol.mjs';
export function readPowerState(address){
  localAddress(address);
  return new Promise(resolve=>{
    let done=false;
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
    const req=http.get({hostname:address,port:8001,path:'/api/v2/',agent:false},res=>{
      if(res.statusCode!==200){res.resume();finish('unknown');return;}
      let raw='',size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>65536){req.destroy();finish('unknown');}else raw+=chunk;});
      res.on('end',()=>{try{
        const device=JSON.parse(raw).device;
        const state=device?.type==='Samsung SmartTV'?String(device.PowerState).toLowerCase():'unknown';
        finish(['on','off','standby'].includes(state)?state:'unknown');
      }catch{finish('unknown');}});
      res.on('error',()=>finish('unknown'));
    });
    const timer=setTimeout(()=>{req.destroy();finish('unknown');},1500);
    req.on('error',()=>finish('unknown'));
  });
}
