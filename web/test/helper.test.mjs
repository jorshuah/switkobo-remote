import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, createHelper } from '../server.mjs';
import { SamsungTV } from '../tv.mjs';
import { localAddress, textPayloads, keyPayload, parseApps, wakePacket } from '../protocol.mjs';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class FakeSocket extends EventEmitter {
  constructor(){super();this.sent=[];this.testCertificate='a'.repeat(64);this.closed=false;}
  send(data,cb){this.sent.push(JSON.parse(data));queueMicrotask(()=>cb());}
  ping(){this.emit('pong');}
  terminate(){this.closed=true;this.emit('close');}
}
function setup(t,options={}){
  const directory=mkdtempSync(path.join(os.tmpdir(),'switkobo-test-'));
  const store=new Store(directory);store.update({profile:{name:'Test TV',address:'192.168.0.20',mac:''}});
  const sockets=[];
  const tv=new SamsungTV(store,{wakeConnectTimeout:0,powerStatus:async()=>'on',socketFactory:(url)=>{const socket=new FakeSocket();socket.testURL=String(url);sockets.push(socket);return socket;},...options});
  t.after(()=>{tv.disconnect();rmSync(directory,{recursive:true,force:true});});
  return {store,tv,sockets,directory};
}
function authorize(socket){socket.emit('message',Buffer.from(JSON.stringify({event:'ms.channel.connect',data:{token:'TV-token'}})));}
test('only literal private IPv4 destinations can reach the TV transport',()=>{
  for(const input of ['8.8.8.8','127.0.0.1','localhost','192.168.0.1:8002','192.168.0.01','192.168.0.255','http://192.168.0.2','169.254.1.2','224.0.0.1']) assert.throws(()=>localAddress(input));
  assert.equal(localAddress(' 192.168.0.20 '),'192.168.0.20');
  assert.throws(()=>keyPayload('KEY_FACTORY'));
});
test('Unicode typing is base64 UTF-8 and never submits the TV search form',()=>{
  const payloads=textPayloads('Ẹ káàrọ̀ 世界 📺');
  assert.equal(Buffer.from(payloads[1].params.Cmd,'base64').toString('utf8'),'Ẹ káàrọ̀ 世界 📺');
  assert.equal(payloads.length,2);assert.throws(()=>textPayloads('x'.repeat(2001)));
});
test('app responses discard malformed and duplicate entries',()=>{
  assert.deepEqual(parseApps({data:[{name:'Video',appId:'valid.id',app_type:2},{name:'Duplicate',appId:'valid.id'},{name:'Bad',appId:'https://evil.com'}]}),[{name:'Video',appID:'valid.id',deepLink:true}]);
});
test('wake packet contains one valid unicast MAC repeated 16 times',()=>{
  const packet=wakePacket('a0:b1:c2:d3:e4:f5');
  assert.equal(packet.length,102);assert.equal(packet.subarray(0,6).toString('hex'),'ffffffffffff');
  assert.throws(()=>wakePacket('FF:FF:FF:FF:FF:FF'));
});
test('TV commands stay disabled until approval and pairing survives restart',async t=>{
  const {tv,store,sockets,directory}=setup(t);
  tv.connect();await assert.rejects(tv.key('KEY_HOME'),/Connect to the TV/);
  assert.equal(store.data.pairing,null);
  authorize(sockets[0]);await tv.key('KEY_HOME');
  assert.equal(sockets[0].sent[0].params.DataOfCmd,'KEY_HOME');
  const reopened=new Store(directory);
  assert.equal(reopened.data.pairing.token,'TV-token');assert.equal(reopened.data.accessKey,store.data.accessKey);
});
test('rejected pairing and pairing timeout never report connected',async t=>{
  const {tv,sockets}=setup(t,{pairingTimeout:25});
  tv.connect();sockets[0].emit('message',Buffer.from('{"event":"ms.channel.unauthorized"}'));
  assert.equal(tv.state,'failed');
  tv.connect();await wait(40);assert.equal(tv.state,'failed');assert.match(tv.message,/timed out/);
});
test('queued commands cannot cross reconnects',async t=>{
  const {tv,sockets}=setup(t);tv.connect();authorize(sockets[0]);
  const first=tv.key('KEY_UP'),second=tv.key('KEY_DOWN');
  const results=Promise.allSettled([first,second]);await wait(15);
  tv.connect();authorize(sockets[1]);await results;
  assert.equal(sockets[0].sent.length,1);assert.equal(sockets[1].sent.length,0);
  await tv.key('KEY_ENTER');assert.equal(sockets[1].sent[0].params.DataOfCmd,'KEY_ENTER');
});
test('HTTP API rejects missing access, foreign origins, rebinding, oversized input and unsupported commands',async t=>{
  const {store,tv,sockets}=setup(t);
  const helper=createHelper({store,tv,port:48887,addresses:[]});
  await new Promise(resolve=>helper.server.listen(0,'127.0.0.1',resolve));
  const port=helper.server.address().port;helper.hosts.add('127.0.0.1:'+port);
  t.after(()=>new Promise(resolve=>helper.server.close(resolve)));
  const url='http://127.0.0.1:'+port;
  const auth={Authorization:'Bearer '+store.data.accessKey,'Content-Type':'application/json'};
  assert.equal((await fetch(url+'/api/state')).status,401);
  assert.equal((await fetch(url+'/api/state',{headers:{...auth,Origin:'http://evil.example'}})).status,403);
  const badHostStatus = await new Promise((resolve,reject) => { const req = http.get(url+'/api/state',{headers:{...auth,Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject); });
  assert.equal(badHostStatus,403);
  const state=await (await fetch(url+'/api/state',{headers:auth})).json();
  assert.equal('pairing' in state,false);assert.equal('accessKey' in state,false);
  assert.equal((await fetch(url+'/api/profile',{method:'POST',headers:auth,body:JSON.stringify({name:'Bad',address:'127.0.0.1'})})).status,400);
  assert.equal((await fetch(url+'/api/text',{method:'POST',headers:auth,body:JSON.stringify({text:'x'.repeat(17000)})})).status,413);
  tv.connect();authorize(sockets[0]);
  assert.equal((await fetch(url+'/api/key',{method:'POST',headers:auth,body:'{"key":"KEY_FACTORY"}'})).status,400);
  assert.equal((await fetch(url+'/api/key',{method:'POST',headers:auth,body:'{"key":"KEY_POWEROFF"}'})).status,400);
  assert.equal((await fetch(url+'/api/key',{method:'POST',headers:auth,body:'{"key":"KEY_VOLUP"}'})).status,200);
  const saved=await fetch(url+'/api/shortcuts',{method:'POST',headers:auth,body:JSON.stringify({shortcuts:[{name:'Video',appID:'video.id',deepLink:true}]})});
  assert.equal(saved.status,200);assert.equal(new Store(store.directory).data.shortcuts[0].appID,'video.id');
  assert.equal((await fetch(url+'/api/preferences',{method:'POST',headers:auth,body:'{"autoReconnect":"yes"}'})).status,400);
  assert.equal((await fetch(url+'/api/preferences',{method:'POST',headers:auth,body:'{"autoReconnect":false}'})).status,200);
  assert.equal(new Store(store.directory).data.autoReconnect,false);
  assert.equal((await fetch(url+'/server.mjs')).status,404);
  assert.equal((await fetch(url+'/')).headers.get('x-frame-options'),'DENY');
});

async function until(check,timeout=500){const end=Date.now()+timeout;while(!check()){if(Date.now()>end)assert.fail('Timed out waiting for reconnect');await wait(5);}}
test('paired TV reconnects after power off with backoff, without replaying commands',async t=>{
 const {tv,sockets}=setup(t,{reconnectDelays:[10,20],pairingTimeout:200});
 tv.connect();authorize(sockets[0]);await tv.key('KEY_POWEROFF');
 assert.equal(tv.state,'reconnecting');assert.ok(tv.snapshot().reconnectAt);
 await assert.rejects(tv.key('KEY_UP'),/Connect to the TV/);
 await until(()=>sockets.length===2);
 sockets[1].emit('error',new Error('ECONNREFUSED'));
 assert.equal(tv.state,'reconnecting');assert.equal(tv.retryCount,2);
 await until(()=>sockets.length===3);authorize(sockets[2]);
 assert.equal(tv.state,'connected');assert.equal(tv.retryCount,0);assert.equal(tv.reconnectAt,null);
 assert.deepEqual(sockets[2].sent,[]);
 sockets[2].emit('close');await until(()=>sockets.length===4);authorize(sockets[3]);
 assert.equal(tv.state,'connected');assert.deepEqual(sockets[3].sent,[]);
});
test('manual disconnect, disabled preference and forgotten pairing stop retries',async t=>{
 const {tv,store,sockets}=setup(t,{reconnectDelays:[15]});
 tv.connect();authorize(sockets[0]);sockets[0].emit('close');tv.disconnect();
 await wait(35);assert.equal(sockets.length,1);
 tv.resume();authorize(sockets[1]);sockets[1].emit('close');
 store.update({autoReconnect:false});tv.configureReconnect(false);
 await wait(35);assert.equal(sockets.length,2);assert.equal(tv.state,'disconnected');
 tv.resume();assert.equal(sockets.length,2);
 store.update({autoReconnect:true});tv.configureReconnect(true);authorize(sockets[2]);
 sockets[2].emit('close');store.update({pairing:null});tv.disconnect();
 await wait(35);assert.equal(sockets.length,3);tv.resume();assert.equal(sockets.length,3);
});
test('permission refusal and changed certificate never trigger automatic retry',async t=>{
 const {tv,sockets}=setup(t,{reconnectDelays:[10]});
 tv.connect();authorize(sockets[0]);sockets[0].emit('close');
 await until(()=>sockets.length===2);
 sockets[1].emit('message',Buffer.from('{"event":"ms.channel.unauthorized"}'));
 await wait(35);assert.equal(sockets.length,2);assert.equal(tv.state,'failed');
 tv.connect();sockets[2].emit('error',Object.assign(new Error('Certificate changed'),{code:'CERT_CHANGED'}));
 await wait(35);assert.equal(sockets.length,3);assert.equal(tv.state,'failed');
});
test('unpaired transports do not retry; saved pairing resumes on helper startup',async t=>{
 const {tv,sockets,store}=setup(t,{reconnectDelays:[10]});
 tv.resume();assert.equal(sockets.length,0);
 tv.connect();sockets[0].emit('error',new Error('offline'));
 await wait(30);assert.equal(sockets.length,1);
 tv.connect();authorize(sockets[1]);tv.disconnect();tv.resume();
 assert.equal(sockets.length,3);authorize(sockets[2]);assert.equal(tv.state,'connected');
 assert.ok(store.data.pairing.token);
});
test('app-list timeout has its own state and cannot overwrite connection status',async t=>{
 const {tv,sockets}=setup(t,{appTimeout:10});
 tv.connect();authorize(sockets[0]);await tv.fetchApps();await wait(25);
 assert.equal(tv.state,'connected');assert.equal(tv.message,'');assert.equal(tv.appStatus,'unavailable');
 await tv.fetchApps();sockets[0].emit('message',Buffer.from(JSON.stringify({event:'ed.installedApp.get',data:{data:[{name:'Video',appId:'test.video',app_type:2}]}})));
 assert.equal(tv.appStatus,'available');assert.equal(tv.apps.length,1);
});

test('a reachable TV awaiting permission stops after the approval timeout',async t=>{
 const {tv,sockets}=setup(t,{reconnectDelays:[10],pairingTimeout:30});
 tv.connect();authorize(sockets[0]);tv.disconnect();tv.resume();
 sockets[1].emit('open');
 await wait(70);assert.equal(tv.state,'failed');assert.equal(sockets.length,2);
 assert.match(tv.message,/Pairing timed out/);
});

test('discovery API requires access and shares a bounded scan across repeated requests',async t=>{
  const {store,tv}=setup(t);let scans=0;
  const helper=createHelper({store,tv,port:48888,addresses:[],discover:async()=>{
    scans++;await wait(20);return [{name:'TV',address:'192.168.0.20',model:'Q65B',mac:''}];
  }});
  await new Promise(resolve=>helper.server.listen(0,'127.0.0.1',resolve));
  const port=helper.server.address().port;helper.hosts.add('127.0.0.1:'+port);
  t.after(()=>new Promise(resolve=>helper.server.close(resolve)));
  const url='http://127.0.0.1:'+port+'/api/discover';
  const options={method:'POST',headers:{'Content-Type':'application/json'},body:'{}'};
  assert.equal((await fetch(url,options)).status,401);assert.equal(scans,0);
  options.headers.Authorization='Bearer '+store.data.accessKey;
  const replies=await Promise.all([fetch(url,options),fetch(url,options)]);
  for(const reply of replies){assert.equal(reply.status,200);assert.equal((await reply.json()).devices.length,1);}
  assert.equal(scans,1);
});

test('wake sends to the saved TV and reconnects without claiming TV approval',async t=>{
 let awakened=null;
 const {tv,store,sockets}=setup(t,{wakeTransport:async profile=>{awakened=profile;}});
 store.update({profile:{...store.data.profile,mac:'1C:AF:4A:13:2B:DE'}});
 tv.connect();authorize(sockets[0]);tv.disconnect();
 await tv.wake();
 assert.equal(awakened.address,'192.168.0.20');
 assert.equal(tv.state,'connecting');
 assert.equal(sockets.length,2);
 authorize(sockets[1]);assert.equal(tv.state,'connected');
});
test('a disconnect during wake prevents a late reconnection',async t=>{
 let release;
 const {tv,store,sockets}=setup(t,{wakeTransport:()=>new Promise(resolve=>{release=resolve;})});
 store.update({profile:{...store.data.profile,mac:'1C:AF:4A:13:2B:DE'}});
 tv.connect();authorize(sockets[0]);
 const waking=tv.wake();tv.disconnect();release();await waking;
 assert.equal(tv.state,'disconnected');assert.equal(sockets.length,1);
});

test('power-off sends one modern Samsung toggle only after confirming the TV is on',async t=>{
 let release;
 const {tv,sockets}=setup(t,{powerStatus:()=>new Promise(resolve=>{release=resolve;})});
 tv.connect();authorize(sockets[0]);
 const turningOff=tv.key('KEY_POWEROFF');
 await assert.rejects(tv.key('KEY_POWEROFF'),/already in progress/);
 assert.equal(sockets[0].sent.length,0);
 release('on');await turningOff;
 assert.equal(sockets[0].sent.length,1);
 assert.equal(sockets[0].sent[0].params.DataOfCmd,'KEY_POWER');
 assert.equal(tv.state,'reconnecting');
});
test('standby and unknown power states never send a toggle',async t=>{
 for(const state of ['off','standby','unknown']){
   const {tv,sockets}=setup(t,{powerStatus:async()=>state});
   tv.connect();authorize(sockets[0]);
   await assert.rejects(tv.key('KEY_POWEROFF'),/standby|verify/);
   assert.equal(sockets[0].sent.length,0);
 }
});
test('power check cannot send a toggle after the connection changes',async t=>{
 let release;
 const {tv,sockets}=setup(t,{powerStatus:()=>new Promise(resolve=>{release=resolve;})});
 tv.connect();authorize(sockets[0]);
 const turningOff=tv.key('KEY_POWEROFF');tv.disconnect();release('on');
 await assert.rejects(turningOff,/connection changed/);
 assert.equal(sockets[0].sent.length,0);
});

test('wake sends one power press for confirmed standby, and none for on or unknown',async t=>{
 for(const state of ['standby','off','on','unknown']){
   const {tv,sockets}=setup(t,{wakeTransport:async()=>{},powerStatus:async()=>state});
   tv.connect();authorize(sockets[0]);
   await tv.wake();
   assert.equal(sockets[0].sent.length,['standby','off'].includes(state)?1:0);
   if(sockets[0].sent.length)assert.equal(sockets[0].sent[0].params.DataOfCmd,'KEY_POWER');
 }
});
test('wake refuses overlapping power requests while checking standby',async t=>{
 let release;
 const {tv,sockets}=setup(t,{wakeTransport:()=>new Promise(resolve=>{release=resolve;})});
 tv.connect();authorize(sockets[0]);
 const waking=tv.wake();
 await assert.rejects(tv.wake(),/already in progress/);
 await assert.rejects(tv.key('KEY_POWEROFF'),/already in progress/);
 release();await waking;assert.equal(sockets[0].sent.length,0);
});

test('new pairings identify as TV Remote while legacy pairings keep their saved identity',async t=>{
 const {tv,store,sockets}=setup(t);
 tv.connect();
 assert.equal(Buffer.from(new URL(sockets[0].testURL).searchParams.get('name'),'base64').toString(),'TV Remote');
 authorize(sockets[0]);assert.equal(store.data.pairing.clientName,'TV Remote');
 tv.disconnect();tv.connect();
 assert.equal(Buffer.from(new URL(sockets[1].testURL).searchParams.get('name'),'base64').toString(),'TV Remote');
 tv.disconnect();
 const {clientName,...legacy}=store.data.pairing;store.update({pairing:legacy});
 tv.connect();
 assert.equal(Buffer.from(new URL(sockets[2].testURL).searchParams.get('name'),'base64').toString(),'Switkobo Remote');
});
