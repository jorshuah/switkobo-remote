import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,createHelper} from '../server.mjs';
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tv-pc-connection-')),store=new Store(directory);t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));let addresses=[];
 const helper=createHelper({store,tv:{snapshot:()=>({state:'disconnected'})},addresses:[],addressProvider:()=>addresses,port:48765,secureConfig:{port:48766,addresses:['192.168.0.151'],fingerprint:'fixture-ca'}});
 const request=({remote='127.0.0.1',host='127.0.0.1:48765',method='GET',headers={},url='/connect/'}={})=>new Promise(resolve=>{
  const res={headers:{},status:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},writeHead(status,extra={}){this.status=status;for(const[k,v]of Object.entries(extra))this.setHeader(k,v);return this;},end(body=''){resolve({status:this.status,headers:this.headers,body:String(body)});return this;}};
  helper.server.emit('request',{url,method,headers:{host,...headers},socket:{remoteAddress:remote}},res);
 });return {store,request,setAddresses(value){addresses=value;}};
}
test('the PC connection URL renders a fresh QR when Wi-Fi appears without file access or restart',async t=>{
 const f=fixture(t),empty=await f.request();assert.equal(empty.status,200);assert.match(empty.body,/Waiting for Wi-Fi/);
 f.setAddresses(['192.168.0.151']);const ready=await f.request();assert.equal(ready.status,200);assert.match(ready.body,/readonly value="https:\/\/192\.168\.0\.151:48766\/#access=/);assert.ok(ready.body.includes(f.store.data.accessKey));assert.doesNotMatch(ready.body,/Waiting for Wi-Fi/);assert.equal(ready.headers['cache-control'],'no-store');
 const nonce=ready.body.match(/<script nonce="([^"]+)"/)[1];assert.ok(ready.body.includes('<style nonce="'+nonce+'">'));assert.ok(ready.headers['content-security-policy'].includes("'nonce-"+nonce+"'"));assert.ok(!ready.body.includes('style="'));assert.equal(ready.headers['x-frame-options'],'DENY');assert.equal(ready.headers['cross-origin-opener-policy'],'same-origin');
 f.setAddresses([]);assert.match((await f.request()).body,/Waiting for Wi-Fi/);assert.equal((await f.request({method:'HEAD'})).body,'');
});
test('private connection QR is denied to LAN clients, foreign origins, forged hosts and cross-site fetches',async t=>{
 const f=fixture(t);f.setAddresses(['192.168.0.151']);
 for(const options of [{remote:'192.168.0.50'},{remote:'::ffff:192.168.0.50'},{host:'192.168.0.151:48765'},{host:'other.example:48765'},{headers:{origin:'http://other.example'}},{headers:{'sec-fetch-site':'cross-site','sec-fetch-mode':'cors','sec-fetch-dest':'empty'}},{headers:{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'iframe'}}]){const response=await f.request(options);assert.ok([403,404].includes(response.status));assert.ok(!response.body.includes(f.store.data.accessKey));}
 assert.equal((await f.request({headers:{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}})).status,200,'an ordinary top-level user navigation can open the PC page');
 assert.equal((await f.request({method:'POST'})).status,405);assert.equal((await f.request({host:'localhost:48765',remote:'::1'})).status,200);
});
