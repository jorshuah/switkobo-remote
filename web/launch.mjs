import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {helperStatus,startupError} from './launcher-status.mjs';
import {networkAddresses} from './network-addresses.mjs';
import {loadHTTPS} from './https-config.mjs';
import {writeConnectionPage} from './connection-page.mjs';
import {wakeTargets} from './wake.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const directory=process.env.SWITKOBO_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'.local','share'),'SwitkoboRemote');
fs.mkdirSync(directory,{recursive:true});
const port=Number(process.env.PORT||48765),launcher=path.join(process.env.SWITKOBO_DATA_DIR?directory:path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.local','share'),'TVRemote'),'Open Remote.html'),log=path.join(directory,'helper.log');
if(!Number.isInteger(port)||port<1024||port>65535){console.error('PORT must be between 1024 and 65535.');process.exit(1);}
const key=()=>{try{return JSON.parse(fs.readFileSync(path.join(directory,'settings.json'),'utf8')).accessKey;}catch{return null;}};
const status=()=>helperStatus({port,key:key()});
async function run(){
 if(process.argv.includes('--stop')){
  const state=await status();
  if(state.kind==='unavailable'){console.log('TV Remote is already stopped.');return;}
  if(state.kind!=='ready')throw new Error(startupError(state,port,log));
  const response=await fetch('http://127.0.0.1:'+port+'/api/shutdown',{method:'POST',headers:{Authorization:'Bearer '+key(),'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw new Error('The helper could not be stopped. Check '+log);
  console.log('TV Remote stopped.');return;
 }
 const initial=await status();
 if(initial.kind!=='ready'){
  if(initial.kind!=='unavailable')throw new Error(startupError(initial,port,log));
  const out=fs.openSync(log,'a');let spawnError=null;
  const child=spawn(process.execPath,[path.join(here,'server.mjs')],{cwd:here,detached:true,windowsHide:true,stdio:['ignore',out,out],env:process.env});
  child.on('error',error=>{spawnError=error;});child.unref();fs.closeSync(out);
  let state=initial;
  const end=Date.now()+15000;
  while(Date.now()<end&&!spawnError){
   await new Promise(resolve=>setTimeout(resolve,250));
   state=await status();
   // Startup also generates the private QR page, so wait for that file.
   if(state.kind==='ready'&&fs.existsSync(launcher))break;
  }
  if(spawnError)throw new Error('Windows could not launch the helper ('+(spawnError.code||'startup error')+'). Check '+log);
  if(state.kind!=='ready'||!fs.existsSync(launcher))throw new Error(startupError(state,port,log));
 }else{
  const saved=JSON.parse(fs.readFileSync(path.join(directory,'settings.json'),'utf8')),addresses=networkAddresses(),secure=loadHTTPS(directory);
  if(saved.profile){const preferred=wakeTargets(saved.profile.address).map(t=>t.local);addresses.sort((a,b)=>(preferred.includes(b)?1:0)-(preferred.includes(a)?1:0));}
  if(secure)secure.port=Number(process.env.HTTPS_PORT||port+1);
  await writeConnectionPage({directory,visibleDirectory:process.env.SWITKOBO_DATA_DIR?null:path.dirname(launcher),addresses,port,accessKey:saved.accessKey,secure});
  console.log('The remote helper is already running; reusing it. Refreshed the private connection page.');
 }
 console.log('TV Remote is running. Keep this PC awake.');
 console.log('Private QR-code launcher: '+launcher);
 const connectionURL='http://127.0.0.1:'+port+'/connect/';console.log('PC connection page: '+connectionURL);
 if(!process.argv.includes('--no-open')&&process.platform==='win32')spawn('explorer.exe',[connectionURL],{detached:true,windowsHide:true,stdio:'ignore'}).unref();
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
