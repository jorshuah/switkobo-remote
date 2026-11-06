import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {Store,createHelper} from '../server.mjs';

test('an adapter coming online after helper startup gains access without opening foreign hosts or origins',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tv-address-change-'));let live=[];
 const store=new Store(directory),helper=createHelper({store,tv:{snapshot:()=>({state:'disconnected'})},port:48765,addresses:[],addressProvider:()=>live});
 await new Promise(r=>helper.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>helper.server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
 const request=(host,headers={})=>new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port:helper.server.address().port,path:'/api/state',headers:{Host:host,...headers}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);});
 const host='192.168.0.151:48765',auth={Authorization:'Bearer '+store.data.accessKey};
 assert.equal(await request(host,auth),403);live=['192.168.0.151'];assert.equal(await request(host),401);assert.equal(await request(host,auth),200);
 assert.equal(await request(host,{...auth,Origin:'http://other.example'}),403);
 assert.equal(await request(host,{...auth,Origin:'http://'+host}),200);
 for(const bad of ['other.example:48765','192.168.0.152:48765','192.168.0.151:9999','192.168.0.151.other.example:48765'])assert.equal(await request(bad,auth),403);
 live=[];assert.equal(await request(host,auth),403,'removed dynamic addresses must not remain trusted');
});
