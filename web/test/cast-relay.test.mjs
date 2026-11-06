import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {PassThrough,Readable} from 'node:stream';import http from 'node:http';import {createMediaRelay} from '../cast-relay.mjs';import {CastManager} from '../cast.mjs';
function fixture(t,{timeout=20000,onDiagnostic}={}){
 const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),stdio:[],kill(){this.killed=true;}});child.stdio[3]=new PassThrough();
 let options,args;const source={playlist:{init:'init',segments:[{start:0}]},async *trackStream(){yield Buffer.from('synthetic input');}};
 const relay=createMediaRelay({source,index:0,offset:0,timeout,onDiagnostic,spawnProcess:(_file,a,o)=>{args=a;options=o;return child;}});t.after(()=>relay.close());return {child,relay,args,options};
}
test('prepared output remains paused and intact until the receiver consumes it',async t=>{
 const f=fixture(t);let ready=false;f.relay.ready.then(()=>ready=true);await Promise.resolve();assert.equal(ready,false);f.child.stdout.write(Buffer.alloc(188,0x47));await f.relay.ready;assert.equal(f.relay.output.readableLength,188);assert.notEqual(f.relay.output.readableFlowing,true);assert.equal(f.relay.output.read(188).length,188);assert.equal(f.options.windowsHide,true);assert.ok(f.args.includes('-readrate_initial_burst'));
});

test('startup permits a twelve-second burst and converter errors expose only safe categories',async t=>{
 const events=[],f=fixture(t,{onDiagnostic:e=>events.push(e)});assert.equal(f.args[f.args.indexOf('-readrate_initial_burst')+1],'12');
 f.child.stdout.write(Buffer.alloc(188,0x47));await f.relay.ready;f.child.stderr.write('Invalid data found at https://private.example/?token=secret caption dialogue');f.child.emit('exit',1);assert.equal(f.relay.closed,true);assert.ok(events.some(e=>e.event==='invalid-media'));assert.doesNotMatch(JSON.stringify(events),/private|secret|https|dialogue/);
});
test('converter failure and cancellation reject preparation and release the child',async t=>{
 for(const event of ['error','exit','cancel']){const f=fixture(t),rejected=assert.rejects(f.relay.ready,/converter|replacement/i);if(event==='error')f.child.emit('error',new Error('private media detail'));else if(event==='exit')f.child.emit('exit',1);else f.relay.close();await rejected;assert.equal(f.child.killed,true);assert.equal(f.relay.closed,true);}
});
test('a stalled converter has a bounded preparation deadline',async t=>{
 const f=fixture(t,{timeout:15});await Promise.race([assert.rejects(f.relay.ready,/replacement video/),new Promise((_,reject)=>setTimeout(()=>reject(Error('Preparation did not time out')),100))]);assert.equal(f.child.killed,true);
});
test('TV HEAD probes preserve prepared output and GET serves it without a cold converter',async t=>{
 let conversions=0,closed=0;const cast=new CastManager({store:{data:{profile:{address:'192.168.0.20'}}},relayFactory:()=>{conversions++;throw Error('Unexpected cold converter');}}),bytes=Buffer.alloc(188*3,0x47);
 Object.assign(cast,{address:'192.168.0.20',token:'test-relay',warmRelay:{ready:Promise.resolve(),closed:false,output:Readable.from([bytes]),close(){closed++;}}});
 const server=http.createServer((req,res)=>{void cast.handle({method:req.method,headers:req.headers,socket:{remoteAddress:'192.168.0.20'}},res,new URL(req.url,'http://127.0.0.1')).catch(()=>res.destroy());});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port+'/media/test-relay/video.ts';
 assert.equal((await fetch(url,{method:'HEAD'})).status,200);assert.ok(cast.warmRelay);assert.equal(conversions,0);const response=await fetch(url);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(cast.warmRelay,null);assert.equal(conversions,0);assert.ok(closed>0);
});
