import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createECDH,randomBytes} from 'node:crypto';
import {UpdatePush,pushSubscription} from '../push.mjs';import {Store,createHelper} from '../server.mjs';
const a='111111111111',b='222222222222',c='333333333333',origin='https://192.168.0.2:48766';
function sub(name='one',host='fcm.googleapis.com'){const key=createECDH('prime256v1');key.generateKeys();return {endpoint:'https://'+host+'/push/'+name,expirationTime:null,keys:{p256dh:key.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};}
function fixture(t,options={}){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tv-push-'));t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('tv-push-'));fs.rmSync(directory,{recursive:true,force:true});});return {directory,push:new UpdatePush(directory,{build:()=>a,...options})};}

test('subscriptions accept browser push providers and reject SSRF destinations and invalid encryption keys',()=>{
 for(const host of ['fcm.googleapis.com','web.push.apple.com','updates.push.services.mozilla.com','wns2-test.notify.windows.com'])assert.equal(new URL(pushSubscription(sub('one',host)).endpoint).hostname,host);
 const good=sub();for(const endpoint of ['http://fcm.googleapis.com/push/one','https://127.0.0.1/push','https://192.168.0.1/push','https://fcm.googleapis.com.evil.test/push','https://evil.test/push','https://user:pass@fcm.googleapis.com/push','https://fcm.googleapis.com:443/push#fragment','https://fcm.googleapis.com:48765/push','https://push.apple.com.evil.test/push'])assert.throws(()=>pushSubscription({...good,endpoint}));
 for(const keys of [{},{p256dh:'x',auth:'y'},{p256dh:Buffer.alloc(65).toString('base64url'),auth:good.keys.auth},{...good.keys,auth:'a'.repeat(200)}])assert.throws(()=>pushSubscription({...good,keys}));
});

test('private VAPID keys persist once and registration deduplicates without re-alerting the same release',async t=>{
 let build=a;const sent=[],{directory,push}=fixture(t,{build:()=>build,send:async(s,p)=>sent.push(p)}),subscription=sub(),id=push.subscribe(subscription,origin).id;
 assert.equal(push.subscribe(subscription,origin).id,id);assert.equal(push.data.subscriptions.length,1);await push.check();assert.equal(sent.length,0);
 const keys=push.config();assert.deepEqual(Object.keys(keys).sort(),['publicKey','version']);assert.ok(!JSON.stringify(keys).includes(push.data.keys.privateKey));
 build=b;await push.check();await push.check();assert.deepEqual(sent,[{kind:'update',version:b}]);
 const next=new UpdatePush(directory,{build:()=>b,send:async(s,p)=>sent.push(p)});assert.deepEqual(next.config(),keys);await next.check();assert.equal(sent.length,1);
 assert.throws(()=>next.subscribe(subscription,'https://different.example'),/app address/);assert.deepEqual(next.remove(id,'https://different.example'),{registered:false});assert.equal(next.data.subscriptions.length,1);next.remove(id,origin);assert.equal(next.data.subscriptions.length,0);
});

test('transient failures have bounded retry and expired subscriptions are pruned',async t=>{
 let build=a,time=1000,calls=0;const {push}=fixture(t,{now:()=>time,build:()=>build,send:async()=>{calls++;throw Error('private endpoint and provider response must not leak');}});push.subscribe(sub(),origin);build=b;await push.check();await push.check();assert.equal(calls,1);time+=60000;await push.check();time+=300000;await push.check();time+=900000;await push.check();assert.equal(calls,3);
 build=c;push.send=async()=>{calls++;const e=Error('expired private endpoint');e.statusCode=410;throw e;};await push.check();assert.equal(calls,4);assert.equal(push.data.subscriptions.length,0);
});

test('test delivery is per device, rate limited and does not expose service responses',async t=>{
 let now=1000;const sent=[],{push}=fixture(t,{now:()=>now,send:async(s,p)=>sent.push(p)}),id=push.subscribe(sub(),origin).id;
 await assert.rejects(push.test(id,'https://other.example'),/Enable notifications/);assert.deepEqual(await push.test(id,origin),{accepted:true});assert.deepEqual(sent,[{kind:'test'}]);await assert.rejects(push.test(id,origin),e=>e.status===429);now+=30000;push.send=async()=>{throw Error('secret provider body');};await assert.rejects(push.test(id,origin),e=>e.status===503&&!e.message.includes('secret'));
});

test('concurrent checks cannot duplicate a release and subscription expiry prevents delivery',async t=>{
 let build=a,release,calls=0;const {push}=fixture(t,{build:()=>build,send:async()=>{calls++;await new Promise(r=>release=r);}});push.subscribe(sub(),origin);build=b;const first=push.check();await push.check();assert.equal(calls,1);release();await first;await push.check();assert.equal(calls,1);
 const expired=sub('expired');expired.expirationTime=Date.now()-1;assert.throws(()=>push.subscribe(expired,origin),/expired/);
});

test('notification APIs require authentication and same-origin access and never issue TV commands',async t=>{
 const {push,directory}=fixture(t),store=new Store(directory);let tvCommands=0;const tv={snapshot:()=>({state:'connected'}),disconnect(){},key(){tvCommands++;}};
 const helper=createHelper({store,tv,push,addresses:[]});await new Promise(r=>helper.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>helper.server.close(r)));const base='http://127.0.0.1:'+helper.server.address().port;helper.hosts.add(new URL(base).host);
 const headers={Authorization:'Bearer '+store.data.accessKey,'Content-Type':'application/json'},post=(route,data,extra=headers)=>fetch(base+'/api/push/'+route,{method:'POST',headers:extra,body:JSON.stringify(data)});
 assert.equal((await fetch(base+'/api/push/config')).status,401);assert.equal((await post('subscribe',{subscription:sub()},{})).status,401);assert.equal((await post('subscribe',{subscription:sub()},{...headers,Origin:'https://evil.test'})).status,403);
 const config=await(await fetch(base+'/api/push/config',{headers})).json();assert.deepEqual(Object.keys(config).sort(),['publicKey','version']);const registration=await(await post('subscribe',{subscription:sub()})).json();assert.match(registration.id,/^[a-f0-9]{64}$/);assert.equal(push.data.subscriptions.length,1);assert.equal((await post('subscribe',{subscription:sub('bad','127.0.0.1')})).status,400);
 const state=await(await fetch(base+'/api/state',{headers})).json();assert.deepEqual(state.notifications,{version:1});assert.ok(!JSON.stringify(state).includes(push.data.keys.privateKey));await post('unsubscribe',{id:registration.id});assert.equal(push.data.subscriptions.length,0);assert.equal(tvCommands,0);
});
