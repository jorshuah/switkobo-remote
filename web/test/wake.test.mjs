import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {wakeTargets,sendWake} from '../wake.mjs';
const interfaces={wifi:[{family:'IPv4',internal:false,address:'192.168.0.151',netmask:'255.255.255.0'}],vpn:[{family:'IPv4',internal:false,address:'10.0.0.2',netmask:'255.255.255.0'}]};
test('wake targets use the actual matching subnet, including non-/24 masks',()=>{
 assert.deepEqual(wakeTargets('192.168.0.123',interfaces),[{local:'192.168.0.151',address:'192.168.0.255'},{local:'192.168.0.151',address:'192.168.0.123'}]);
 assert.equal(wakeTargets('192.168.1.20',{lan:[{family:'IPv4',internal:false,address:'192.168.0.5',netmask:'255.255.254.0'}]})[0].address,'192.168.1.255');
 assert.throws(()=>wakeTargets('8.8.8.8',interfaces));
});
test('wake repeats magic packets to broadcast and unicast, then closes every socket',async()=>{
 const sent=[],sockets=[];
 class Socket extends EventEmitter{
  bind(port,address,cb){this.local=address;queueMicrotask(cb);}
  setBroadcast(value){this.broadcast=value;}
  send(packet,port,address,cb){assert.equal(this.broadcast,true);sent.push({packet,port,address});queueMicrotask(()=>cb(null));}
  close(){this.closed=true;}
 }
 await sendWake({address:'192.168.0.123',mac:'1C:AF:4A:13:2B:DE'},{interfaces,pause:async()=>{},socketFactory:()=>{const s=new Socket();sockets.push(s);return s;}});
 assert.equal(sent.length,4);assert.equal(sent.filter(s=>s.address==='192.168.0.255').length,2);
 for(const s of sent){assert.equal(s.port,9);assert.equal(s.packet.length,102);assert.equal(s.packet.subarray(6,12).toString('hex'),'1caf4a132bde');}
 assert.ok(sockets.every(s=>s.closed));
});
test('wake reports total transport failure rather than claiming a request was sent',async()=>{
 class Socket extends EventEmitter{bind(){queueMicrotask(()=>this.emit('error',new Error('blocked')));}close(){}}
 await assert.rejects(sendWake({address:'192.168.0.123',mac:'1C:AF:4A:13:2B:DE'},{interfaces,pause:async()=>{},socketFactory:()=>new Socket()}),/Could not send/);
});
