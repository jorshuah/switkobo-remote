import test from 'node:test';
import assert from 'node:assert/strict';
import {launchApp,appCandidates,appRequest} from '../app-launch.mjs';
const base={address:'192.168.0.20',ensureCurrent(){},wait:async()=>{},fallback:async()=>({verified:false,fallback:true})};
test('app IDs resolve to installed variants and visible state confirms launch',async()=>{
 const calls=[];const app={name:'Netflix',appID:'11101200001',deepLink:true};let posted=false;
 const result=await launchApp(app,{...base,request:async(_address,id,method='GET')=>{
  calls.push([id,method]);if(id===app.appID)return {status:404};
  if(method==='POST'){posted=true;return {status:200,data:true};}
  return {status:200,data:{id,visible:posted}};
 }});
 assert.equal(result.verified,true);assert.equal(result.appID,'3201907018807');
 assert.deepEqual(calls,[['11101200001','GET'],['3201907018807','GET'],['3201907018807','POST'],['3201907018807','GET']]);
 assert.deepEqual(appCandidates('custom.id'),['custom.id']);
});
test('missing apps and rejected launches report failure without blind retries',async()=>{
 const app={name:'YouTube',appID:'111299001912',deepLink:true};
 await assert.rejects(launchApp(app,{...base,request:async()=>({status:404})}),/not available/);
 await assert.rejects(launchApp(app,{...base,request:async(_a,id,method)=>method==='POST'?{status:403}:{status:200,data:{id}}}),/rejected/);
});
test('an accepted request without visibility is never reported as opened',async()=>{
 const app={name:'YouTube',appID:'111299001912',deepLink:true};
 const result=await launchApp(app,{...base,request:async(_a,id,method)=>method==='POST'?{status:200,data:true}:{status:200,data:{id,visible:false}}});
 assert.equal(result.verified,false);assert.match(result.message,/not confirmed/);
});
test('REST-unavailable TVs retain explicitly unverified WebSocket fallback',async()=>{
 const result=await launchApp({name:'App',appID:'custom.id',deepLink:false},{...base,request:async()=>{throw new Error('timeout');}});
 assert.equal(result.fallback,true);assert.equal(result.verified,false);
});
test('connection changes during app lookup prevent the launch',async()=>{
 let connected=true,posts=0;
 await assert.rejects(launchApp({name:'App',appID:'custom.id',deepLink:false},{...base,
 ensureCurrent(){if(!connected)throw new Error('connection changed');},
 request:async(_a,id,method)=>{if(method==='POST')posts++;connected=false;return {status:200,data:{id}};}
 }),/connection changed/);
 assert.equal(posts,0);
});
test('app transport rejects nonlocal destinations before fetch',async()=>{
 await assert.rejects(appRequest('example.com','valid.id'),/IPv4/);
});
