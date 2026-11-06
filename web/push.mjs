import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {createHash,createECDH,ECDH} from 'node:crypto';
import webpush from 'web-push';
import {RemoteError} from './protocol.mjs';

const versionPattern=/^[a-f0-9]{12}$/,idPattern=/^[a-f0-9]{64}$/;
const contact='https://github.com/jorshuah/switkobo-remote';
export function pushSubscription(value){
 let endpoint;try{endpoint=new URL(value?.endpoint);}catch{throw new RemoteError('This notification subscription is invalid. Enable notifications again.');}
 const host=endpoint.hostname,allowed=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com');
 if(!allowed||endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.port||endpoint.hash||endpoint.href.length>4096||endpoint.pathname==='/')throw new RemoteError('This notification service is not supported.');
 const read=(key,length)=>{const text=value?.keys?.[key];if(typeof text!=='string'||!new RegExp('^[A-Za-z0-9_-]{'+Math.ceil(length*4/3)+'}$').test(text))throw new RemoteError('This notification subscription is invalid. Enable notifications again.');const bytes=Buffer.from(text,'base64url');if(bytes.length!==length)throw new RemoteError('This notification subscription is invalid. Enable notifications again.');return bytes;};
 const publicKey=read('p256dh',65);read('auth',16);
 try{ECDH.convertKey(publicKey,'prime256v1',undefined,undefined,'uncompressed');}catch{throw new RemoteError('This notification subscription is invalid. Enable notifications again.');}
 if(value.expirationTime!==undefined&&value.expirationTime!==null&&(!Number.isFinite(value.expirationTime)||value.expirationTime<=0))throw new RemoteError('This notification subscription has an invalid expiry.');
 return {endpoint:endpoint.href,expirationTime:value.expirationTime??null,keys:{p256dh:value.keys.p256dh,auth:value.keys.auth}};
}
function vapidSubject(value){
 if(typeof value!=='string'||value.length>512)throw Error('Invalid Web Push contact setting.');
 if(/^mailto:[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value))return value;
 const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^localhost$/i.test(u.hostname))throw Error('Invalid Web Push contact setting.');return u.href;
}
export async function sendPush(subscription,payload,{vapidDetails}){
 const details=webpush.generateRequestDetails(subscription,JSON.stringify(payload),{vapidDetails,TTL:86400,urgency:'normal',topic:payload.kind==='update'?'tv-remote-update':'tv-remote-test'});
 await new Promise((resolve,reject)=>{
  const request=https.request(details.endpoint,{method:details.method,headers:details.headers,signal:AbortSignal.timeout(8000),maxHeaderSize:8192},response=>{
   let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>8192)response.destroy();});response.on('error',()=>reject(Error('Push service response interrupted.')));
   response.on('end',()=>{if(response.statusCode>=200&&response.statusCode<300)resolve();else{const error=Error('Push service rejected the notification.');error.statusCode=response.statusCode;reject(error);}});
  });request.on('error',()=>reject(Error('Push service unreachable.')));request.end(details.body);
 });
}
export class UpdatePush{
 constructor(directory,{build=()=>JSON.parse(fs.readFileSync(new URL('./public/app-version.json',import.meta.url),'utf8')).version,send=sendPush,now=Date.now,subject=process.env.WEB_PUSH_SUBJECT||contact}={}){
  this.file=path.join(directory,'notifications.json');this.build=build;this.send=send;this.now=now;this.subject=vapidSubject(subject);this.inFlight=new Set();this.checking=false;this.timer=null;
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  try{if(fs.statSync(this.file).size>262144)throw Error();this.data=JSON.parse(fs.readFileSync(this.file,'utf8'));
   if(this.data.version!==1||!Array.isArray(this.data.subscriptions)||this.data.subscriptions.length>32)throw Error();
   const key=createECDH('prime256v1');key.setPrivateKey(Buffer.from(this.data.keys.privateKey,'base64url'));if(key.getPublicKey().toString('base64url')!==this.data.keys.publicKey)throw Error();
   for(const record of this.data.subscriptions){record.subscription=pushSubscription(record.subscription);if(record.id!==this.id(record.subscription)||typeof record.origin!=='string'||new URL(record.origin).origin!==record.origin||!versionPattern.test(record.notifiedVersion)||!Number.isFinite(record.nextAttempt)||!Number.isInteger(record.attempts)||record.attempts<0||record.attempts>3)throw Error();}
  }catch(error){if(error.code!=='ENOENT')throw Error('Private notification settings could not be read. Check notifications.json in the helper data folder.');this.data={version:1,keys:webpush.generateVAPIDKeys(),subscriptions:[]};this.save();}
 }
 save(){const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.data),{mode:0o600});fs.renameSync(temp,this.file);}
 id(subscription){return createHash('sha256').update(subscription.endpoint).digest('hex');}
 config(){return {version:1,publicKey:this.data.keys.publicKey};}
 record(id,origin){return idPattern.test(id||'')?this.data.subscriptions.find(r=>r.id===id&&r.origin===origin):null;}
 subscribe(value,origin){
  const subscription=pushSubscription(value),id=this.id(subscription),build=this.build();if(!versionPattern.test(build))throw new RemoteError('The app update is still being prepared. Try again shortly.',503);
  if(subscription.expirationTime&&subscription.expirationTime<=this.now())throw new RemoteError('This notification subscription has expired. Enable notifications again.');
  const old=this.data.subscriptions.find(r=>r.id===id);if(old&&old.origin!==origin)throw new RemoteError('Use the app address where notifications were enabled.',409);
  if(!old&&this.data.subscriptions.length>=32)throw new RemoteError('The PC has reached its notification device limit. Turn notifications off on an unused device.',409);
  if(old)old.subscription=subscription;else this.data.subscriptions.push({id,origin,subscription,notifiedVersion:build,attemptVersion:build,attempts:0,nextAttempt:0,lastTestAt:null});
  this.save();return {id,registered:true};
 }
 remove(id,origin){const record=this.record(id,origin);if(record){this.data.subscriptions=this.data.subscriptions.filter(r=>r!==record);this.save();}return {registered:false};}
 async deliver(record,payload){
  if(this.inFlight.has(record.id))throw new RemoteError('A notification is already being sent. Try again shortly.',429);
  this.inFlight.add(record.id);
  try{await this.send(record.subscription,payload,{vapidDetails:{subject:this.subject,...this.data.keys}});}
  catch(error){if([404,410].includes(error.statusCode)){this.data.subscriptions=this.data.subscriptions.filter(r=>r!==record);this.save();throw new RemoteError('Notifications have expired on this device. Enable them again.',410);}throw new RemoteError('The push service could not accept the notification. Check the PC internet connection and try again.',503);}
  finally{this.inFlight.delete(record.id);}
 }
 async test(id,origin){
  const record=this.record(id,origin);if(!record)throw new RemoteError('Enable notifications on this device first.',404);
  if(record.lastTestAt!==null&&this.now()-record.lastTestAt<30000)throw new RemoteError('Wait 30 seconds before another test notification.',429);
  record.lastTestAt=this.now();this.save();await this.deliver(record,{kind:'test'});return {accepted:true};
 }
 async check(){
  if(this.checking)return;this.checking=true;
  try{const version=this.build();if(!versionPattern.test(version))return;
   for(const record of [...this.data.subscriptions]){
    if(!this.data.subscriptions.includes(record)||record.notifiedVersion===version)continue;
    if(record.subscription.expirationTime&&record.subscription.expirationTime<=this.now()){this.remove(record.id,record.origin);continue;}
    if(record.attemptVersion!==version){record.attemptVersion=version;record.attempts=0;record.nextAttempt=0;}
    if(record.attempts>=3||this.now()<record.nextAttempt||this.inFlight.has(record.id))continue;
    record.attempts++;record.nextAttempt=this.now()+[60000,300000,900000][record.attempts-1];this.save();
    try{await this.deliver(record,{kind:'update',version});record.notifiedVersion=version;record.attempts=0;record.nextAttempt=0;this.save();}catch{}
   }
  }finally{this.checking=false;}
 }
 start(){if(this.timer)return;void this.check().catch(()=>{});this.timer=setInterval(()=>void this.check().catch(()=>{}),60000);this.timer.unref?.();}
 close(){clearInterval(this.timer);this.timer=null;}
}
