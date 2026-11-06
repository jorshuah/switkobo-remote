import dgram from 'node:dgram';
import os from 'node:os';
import {localAddress,wakePacket,RemoteError} from './protocol.mjs';
const number=ip=>ip.split('.').reduce((n,b)=>(n*256+Number(b))>>>0,0);
const dotted=n=>[24,16,8,0].map(shift=>(n>>>shift)&255).join('.');
export function wakeTargets(address,interfaces=os.networkInterfaces()){
  localAddress(address);const tv=number(address),targets=[];
  for(const entry of Object.values(interfaces).flat()){
    if(!entry||entry.family!=='IPv4'||entry.internal)continue;
    try{localAddress(entry.address);}catch{continue;}
    if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(entry.netmask)||entry.netmask.split('.').some(n=>Number(n)>255))continue;
    const mask=number(entry.netmask),host=(~mask)>>>0;
    // Contiguous netmasks with room for a broadcast address only.
    if(host<3||host===0xffffffff||((host&(host+1))>>>0)!==0)continue;
    if(((number(entry.address)&mask)>>>0)!==((tv&mask)>>>0))continue;
    targets.push({local:entry.address,address:dotted((tv|host)>>>0)});
  }
  const distinct=[...new Map(targets.map(t=>[t.local+'|'+t.address,t])).values()].slice(0,4);
  return [...distinct,{local:distinct[0]?.local||'0.0.0.0',address}];
}
export async function sendWake(profile,{interfaces=os.networkInterfaces(),socketFactory=()=>dgram.createSocket('udp4'),pause=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const packet=wakePacket(profile.mac),targets=wakeTargets(profile.address,interfaces);
  const send=target=>new Promise(resolve=>{
    const socket=socketFactory();let done=false;
    const finish=ok=>{if(done)return;done=true;clearTimeout(deadline);try{socket.close();}catch{}resolve(ok);};
    const deadline=setTimeout(()=>finish(false),1800);
    socket.once('error',()=>finish(false));
    try{
      socket.bind(0,target.local,()=>{
        if(done)return;
        try{socket.setBroadcast(true);socket.send(packet,9,target.address,error=>finish(!error));}catch{finish(false);}
      });
    }catch{finish(false);}
  });
  let delivered=false;
  for(let attempt=0;attempt<2;attempt++){
    if(attempt)await pause(180);
    const results=await Promise.all(targets.map(send));
    delivered=delivered||results.some(Boolean);
  }
  if(!delivered)throw new RemoteError('Could not send a wake request. Check the PC’s network connection and try again.',502);
}
