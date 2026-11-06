import dgram from 'node:dgram';
import http from 'node:http';
import {localAddress,macAddress} from './protocol.mjs';

// Only inspect fixed Samsung endpoints on private IPv4 responders.
// Never fetch the arbitrary LOCATION URLs supplied in SSDP messages.
export function parseTVInfo(data,address) {
  localAddress(address);
  const d=data?.device;
  if(!d || d.type!=='Samsung SmartTV' || (d.manufacturer && !/samsung/i.test(String(d.manufacturer)))) return null;
  let mac='';try{mac=macAddress(d.wifiMac||'');}catch{}
  return {address,name:String(d.name||data.name||'Samsung TV').slice(0,60),
    model:String(d.modelName||'Samsung TV').slice(0,80),mac};
}
export function inspectTV(address) {
  localAddress(address);
  return new Promise(resolve=>{
    let done=false;
    const finish=value=>{if(done)return;done=true;clearTimeout(deadline);resolve(value);};
    const req=http.get({hostname:address,port:8001,path:'/api/v2/',agent:false},res=>{
      if(res.statusCode!==200){res.resume();finish(null);return;}
      let size=0,raw='';
      res.on('data',chunk=>{size+=chunk.length;if(size>65536){req.destroy();finish(null);}else raw+=chunk;});
      res.on('end',()=>{try{finish(parseTVInfo(JSON.parse(raw),address));}catch{finish(null);}});
      res.on('error',()=>finish(null));
    });
    const deadline=setTimeout(()=>{req.destroy();finish(null);},1400);
    req.on('error',()=>finish(null));
  });
}
export function discoverTVs({addresses=[],savedAddress='',duration=2600,probe=inspectTV,socketFactory=()=>dgram.createSocket('udp4')}={}) {
  return new Promise(resolve=>{
    const sockets=[],seen=new Set(),tasks=[],found=[];
    let closed=false;
    const inspect=address=>{
      try{localAddress(address);}catch{return;}
      if(closed||seen.has(address)||seen.size>=24)return;
      seen.add(address);
      tasks.push(Promise.resolve().then(()=>probe(address)).then(tv=>{if(tv)found.push(tv);}).catch(()=>{}));
    };
    if(savedAddress)inspect(savedAddress);
    const packet=Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n');
    for(const address of addresses.slice(0,8)){
      try{
        localAddress(address);
        const socket=socketFactory();sockets.push(socket);
        socket.on('error',()=>{});
        socket.on('message',(message,remote)=>{
          if(message.length<=8192 && /^HTTP\/1\.[01] 200/i.test(message.toString()))inspect(remote.address);
        });
        socket.bind(0,address,()=>{
          if(closed)return;
          try{socket.setMulticastTTL(1);socket.setMulticastInterface(address);socket.send(packet,1900,'239.255.255.250',()=>{});}catch{}
        });
      }catch{}
    }
    setTimeout(async()=>{
      closed=true;
      for(const socket of sockets)try{socket.close();}catch{}
      await Promise.allSettled(tasks);
      resolve(found.sort((a,b)=>a.name.localeCompare(b.name)));
    },duration);
  });
}
