import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';import tls from 'node:tls';
import {readFileSync} from 'node:fs';
import {X509Certificate} from 'node:crypto';
import {tvAgent,certificateHash} from '../tv.mjs';
test('TLS pinning blocks changed certificates before sending HTTP credentials',async t=>{
 const key=readFileSync(new URL('./fixtures/tv-test-key.pem',import.meta.url));
 const cert=readFileSync(new URL('./fixtures/tv-test-cert.pem',import.meta.url));
 const fingerprint=certificateHash(new X509Certificate(cert).raw);
 let received=0,auth;
 const server=https.createServer({key,cert},(req,res)=>{received++;auth=req.headers.authorization;res.end('ok');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const connector=options=>tls.connect({...options,host:'127.0.0.1',port});
 const get=agent=>new Promise((resolve,reject)=>{
  const req=https.get({hostname:'192.168.0.20',port:8002,agent,headers:{Authorization:'TV-pairing-secret'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
  req.on('error',reject);
 });
 let seen;
 const first=tvAgent('192.168.0.20',null,hash=>seen=hash,connector);t.after(()=>first.destroy());
 assert.equal(await get(first),200);assert.equal(seen,fingerprint);
 const pinned=tvAgent('192.168.0.20',fingerprint,()=>{},connector);t.after(()=>pinned.destroy());
 assert.equal(await get(pinned),200);assert.equal(auth,'TV-pairing-secret');
 const changed=tvAgent('192.168.0.20','b'.repeat(64),()=>{},connector);t.after(()=>changed.destroy());
 await assert.rejects(get(changed),error=>error.code==='CERT_CHANGED');
 assert.equal(received,2,'changed certificate must not receive even HTTP headers');
});
