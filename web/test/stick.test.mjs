import test from 'node:test';import assert from 'node:assert/strict';import {stickVector,createStickRepeater} from '../public/stick-controller.js';
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function clock(){let time=0,serial=0;const jobs=new Map();return {now:()=>time,schedule(fn,ms){const id=++serial;jobs.set(id,{at:time+ms,fn});return id;},cancel(id){jobs.delete(id);},async advance(ms){const target=time+ms;while(true){const entry=[...jobs].filter(([,j])=>j.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;time=entry[1].at;jobs.delete(entry[0]);entry[1].fn();await flush();}time=target;await flush();}};}
test('stick geometry has neutral hysteresis, cardinal directions and bounded travel',()=>{
 assert.equal(stickVector(10,10,140).direction,null);assert.equal(stickVector(0,-70,140).direction,'UP');assert.equal(stickVector(-60,0,140).direction,'LEFT');assert.equal(stickVector(60,0,140).direction,'RIGHT');assert.equal(stickVector(0,60,140).direction,'DOWN');
 assert.equal(stickVector(50,55,140,'RIGHT').direction,'RIGHT');assert.equal(stickVector(30,65,140,'RIGHT').direction,'DOWN');assert.equal(stickVector(18,0,140,'RIGHT').direction,'RIGHT');assert.equal(stickVector(10,0,140,'RIGHT').direction,null);const far=stickVector(1000,1000,140);assert.ok(Math.hypot(far.x,far.y)<=42.001);assert.equal(far.strength,1);
});
test('holding repeats after the initial pause and release cancels further commands',async()=>{
 const c=clock(),sent=[],r=createStickRepeater({...c,send:key=>{sent.push(key);return true;}});r.begin();r.update('RIGHT',1);await flush();assert.deepEqual(sent,['RIGHT']);await c.advance(319);assert.equal(sent.length,1);await c.advance(1);assert.equal(sent.length,2);await c.advance(160);assert.equal(sent.length,3);r.end();await c.advance(2000);assert.equal(sent.length,3);
});
test('slow requests never accumulate repeats and only the latest held direction is sent',async()=>{
 const c=clock(),sent=[],releases=[],r=createStickRepeater({...c,send:key=>{sent.push(key);return new Promise(resolve=>releases.push(resolve));}});r.begin();r.update('LEFT',1);await c.advance(1000);assert.deepEqual(sent,['LEFT']);r.update('UP',1);r.update('DOWN',1);assert.deepEqual(sent,['LEFT']);releases.shift()(true);await flush();assert.deepEqual(sent,['LEFT','DOWN']);r.end();releases.shift()(true);await flush();await c.advance(2000);assert.deepEqual(sent,['LEFT','DOWN']);
});
test('returning to neutral cancels the pending change and direction jitter is rate bounded',async()=>{
 const c=clock(),sent=[],r=createStickRepeater({...c,send:key=>{sent.push(key);return true;}});r.begin();r.update('UP',1);await flush();r.update('RIGHT',1);r.update('DOWN',1);await c.advance(124);assert.deepEqual(sent,['UP']);r.update(null);await c.advance(1000);assert.deepEqual(sent,['UP']);r.update('DOWN',1);await flush();assert.deepEqual(sent,['UP','DOWN']);r.end();
});
test('disconnects and failures halt without retries, including stale failures after another gesture',async()=>{
 const c=clock();let enabled=true,halted=0;const sent=[],releases=[],r=createStickRepeater({...c,enabled:()=>enabled,onHalt:()=>halted++,send:key=>{sent.push(key);return new Promise(resolve=>releases.push(resolve));}});
 r.begin();r.update('UP');r.end();r.begin();r.update('RIGHT');releases.shift()(false);await flush();assert.equal(halted,0);releases.shift()(true);await flush();enabled=false;await c.advance(400);assert.equal(halted,1);assert.deepEqual(sent,['UP','RIGHT']);enabled=true;r.begin();r.update('DOWN');releases.shift()(false);await flush();assert.equal(halted,2);await c.advance(3000);assert.deepEqual(sent,['UP','RIGHT','DOWN']);
});
