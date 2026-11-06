import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
const exec=promisify(execFile),web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function fixture(t,reply){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'switkobo-launch-'));
 const key='b'.repeat(64);
 await fs.writeFile(path.join(directory,'settings.json'),JSON.stringify({accessKey:key}));
 const server=http.createServer((req,res)=>reply(req,res,key));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
 const run=()=>exec(process.execPath,[path.join(web,'launch.mjs'),'--no-open'],{cwd:web,env:{...process.env,PORT:String(port),SWITKOBO_DATA_DIR:directory},timeout:5000,windowsHide:true});
 return {directory,run,key};
}
test('starting again reuses an authenticated helper without spawning another server',async t=>{
 const {directory,run}=await fixture(t,(req,res,key)=>{assert.equal(req.headers.authorization,'Bearer '+key);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:'connected'}));});
 await fs.writeFile(path.join(directory,'Open Remote.html'),'stale connection page');
 const result=await run();assert.match(result.stdout,/already running; reusing/);
 assert.match(result.stdout,/Refreshed the private connection page/);assert.notEqual(await fs.readFile(path.join(directory,'Open Remote.html'),'utf8'),'stale connection page');
 await assert.rejects(fs.stat(path.join(directory,'helper.log')),error=>error.code==='ENOENT');
});
test('credential mismatch reports the real issue and does not launch a conflicting helper',async t=>{
 const {directory,run,key}=await fixture(t,(_req,res)=>{res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Open the private link.'}));});
 await assert.rejects(run(),error=>{assert.match(error.stderr,/access key does not match/);assert.ok(!error.stderr.includes(key));return true;});
 await assert.rejects(fs.stat(path.join(directory,'helper.log')),error=>error.code==='ENOENT');
});
test('a different service on the port is reported before spawning a helper',async t=>{
 const {directory,run}=await fixture(t,(_req,res)=>res.end('Another service'));
 await assert.rejects(run(),error=>{assert.match(error.stderr,/already in use/);return true;});
 await assert.rejects(fs.stat(path.join(directory,'helper.log')),error=>error.code==='ENOENT');
});

test('fresh startup creates its private page and can be reused and stopped',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'switkobo-boot-'));
 const reservation=http.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const env={...process.env,PORT:String(port),SWITKOBO_DATA_DIR:directory};
 const run=extra=>exec(process.execPath,[path.join(web,'launch.mjs'),...(extra||['--no-open'])],{cwd:web,env,timeout:20000,windowsHide:true});
 t.after(async()=>{
  try{
   const saved=JSON.parse(await fs.readFile(path.join(directory,'settings.json'),'utf8'));
   await fetch('http://127.0.0.1:'+port+'/api/shutdown',{method:'POST',headers:{Authorization:'Bearer '+saved.accessKey,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(1000)});
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,150));
  await fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 });
 const started=await run();assert.match(started.stdout,/Remote is running/);
 const saved=JSON.parse(await fs.readFile(path.join(directory,'settings.json'),'utf8'));
 const state=await(await fetch('http://127.0.0.1:'+port+'/api/state',{headers:{Authorization:'Bearer '+saved.accessKey}})).json();
 assert.equal(state.profile,null);
 assert.match(await fs.readFile(path.join(directory,'Open Remote.html'),'utf8'),/Copy private link/);
 assert.match((await run()).stdout,/already running; reusing/);
 assert.match((await run(['--stop'])).stdout,/Remote stopped/);
});

test('Wi-Fi appearing after startup automatically replaces the empty QR page and reusing Start refreshes it',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'switkobo-late-network-')),flag=path.join(directory,'network-online'),preloader=path.join(directory,'network-fixture.mjs');
 await fs.writeFile(preloader,"import os from 'node:os';import fs from 'node:fs';os.networkInterfaces=()=>fs.existsSync("+JSON.stringify(flag)+")?{wifi:[{address:'192.168.5.20',netmask:'255.255.255.0',family:'IPv4',internal:false,mac:'00:00:00:00:00:00',cidr:'192.168.5.20/24'}]}:{};");
 const reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const env={...process.env,PORT:String(port),SWITKOBO_DATA_DIR:directory,NODE_OPTIONS:((process.env.NODE_OPTIONS||'')+' --import='+pathToFileURL(preloader).href).trim()};
 const run=extra=>exec(process.execPath,[path.join(web,'launch.mjs'),...(extra||['--no-open'])],{cwd:web,env,timeout:20000,windowsHide:true});
 t.after(async()=>{try{await run(['--stop','--no-open']);}catch{}await new Promise(r=>setTimeout(r,150));await fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await run();const pageFile=path.join(directory,'Open Remote.html');assert.match(await fs.readFile(pageFile,'utf8'),/Waiting for Wi-Fi/);
 await fs.writeFile(flag,'online');let page='';const end=Date.now()+15000;
 while(Date.now()<end){page=await fs.readFile(pageFile,'utf8');if(page.includes('readonly value="http://192.168.5.20:'))break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(page.includes('readonly value="http://192.168.5.20:'),'The private connection page should include the simulated Wi-Fi address');
 assert.ok(!page.includes('Waiting for Wi-Fi'),'The waiting state should be replaced by the connection QR');
 await fs.unlink(flag);assert.match((await run()).stdout,/Refreshed the private connection page/);assert.match(await fs.readFile(pageFile,'utf8'),/Waiting for Wi-Fi/);
});
