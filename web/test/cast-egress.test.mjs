import test from 'node:test';import assert from 'node:assert/strict';import net from 'node:net';
import {browserEgress} from '../cast-egress.mjs';
test('a completed upstream tunnel flushes its entire response to a slow reader',async t=>{
 const bytes=Buffer.alloc(8*1024*1024,0x5a),upstream=net.createServer(socket=>socket.end(bytes));
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const sockets=new Set();upstream.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});});
 const tunnel=await browserEgress({resolve:async()=>[{address:'8.8.8.8'}],connect:options=>{assert.deepEqual(options,{host:'8.8.8.8',port:443});return net.connect({host:'127.0.0.1',port:upstream.address().port});}});
 t.after(async()=>{tunnel.close();for(const s of sockets)s.destroy();await new Promise(r=>upstream.close(r));});
 const client=net.connect({host:'127.0.0.1',port:Number(new URL(tunnel.proxy.server).port)});t.after(()=>client.destroy());
 const authorization=Buffer.from(tunnel.proxy.username+':'+tunnel.proxy.password).toString('base64');let header=Buffer.alloc(0),count=0,ready=false;
 const done=new Promise((resolve,reject)=>{client.on('error',reject);client.on('close',resolve);client.on('data',chunk=>{
  if(!ready){header=Buffer.concat([header,chunk]);const end=header.indexOf('\r\n\r\n');if(end<0)return;assert.match(header.subarray(0,end).toString(),/^HTTP\/1.1 200/);chunk=header.subarray(end+4);ready=true;client.pause();setTimeout(()=>client.resume(),100);}
  count+=chunk.length;
 });});
 client.write('CONNECT source.example:443 HTTP/1.1\r\nHost: source.example:443\r\nProxy-Authorization: Basic '+authorization+'\r\n\r\n');
 const timer=setTimeout(()=>client.destroy(Error('Tunnel did not finish')),10000);try{await done;}finally{clearTimeout(timer);}assert.equal(count,bytes.length);
});
