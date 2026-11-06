import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {writeConnectionPage} from '../connection-page.mjs';

test('an empty connection page is replaced with a valid secure QR page after Wi-Fi appears',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tv-connection-page-')),visibleDirectory=path.join(directory,'visible');t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const options={directory,visibleDirectory,port:48765,accessKey:'a'.repeat(64),secure:{port:48766,addresses:['192.168.0.151'],fingerprint:'test-ca'}};
 await writeConnectionPage({...options,addresses:[]});const file=path.join(directory,'Open Remote.html');const empty=await fs.readFile(file,'utf8');assert.match(empty,/Waiting for Wi-Fi/);assert.match(empty,/id="refresh-connection"/);assert.match(empty,/location.reload/);assert.doesNotMatch(empty,/data-copy="link-/);
 const result=await writeConnectionPage({...options,addresses:['10.5.0.2','192.168.0.151']});assert.deepEqual(result,{phoneCount:1,secure:true});const page=await fs.readFile(file,'utf8');assert.match(page,/readonly value="https:\/\/192\.168\.0\.151:48766\/#access=/);assert.doesNotMatch(page,/readonly value="http:\/\/10\.5\.0\.2/);assert.doesNotMatch(page,/Waiting for Wi-Fi/);assert.match(page,/src="data:image\/png;base64,/);assert.equal(page,await fs.readFile(path.join(visibleDirectory,'Open Remote.html'),'utf8'));assert.deepEqual((await fs.readdir(directory)).filter(n=>n.endsWith('.tmp')),[]);
});

test('changing the PC address removes old private links and isolates custom data directories',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tv-connection-change-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const options={directory,port:48888,accessKey:'b'.repeat(64)};
 await writeConnectionPage({...options,addresses:['192.168.0.151']});await writeConnectionPage({...options,addresses:['192.168.1.20']});const page=await fs.readFile(path.join(directory,'Open Remote.html'),'utf8');assert.match(page,/readonly value="http:\/\/192\.168\.1\.20:48888/);assert.doesNotMatch(page,/192\.168\.0\.151/);assert.deepEqual(await fs.readdir(directory),['Open Remote.html']);
});
