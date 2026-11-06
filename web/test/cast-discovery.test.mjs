import test from 'node:test';import assert from 'node:assert/strict';
import {inspectManifests} from '../cast-discovery.mjs';import {MovieSource} from '../cast-source.mjs';
const master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"\n720/index.m3u8\n';
const candidate=n=>({url:'https://source.example/'+n+'.m3u8',frame:{}});
const tick=()=>new Promise(r=>setImmediate(r));

test('a valid master is selected without waiting for unrelated slow playlist reads',async()=>{
 const started=[],releases=new Map();let settled=false;
 const result=inspectManifests(Array.from({length:8},(_,i)=>candidate(i)),c=>{started.push(c.url);return new Promise(resolve=>releases.set(c.url,text=>resolve({...c,text})));},{quality:720}).then(r=>{settled=true;return r;});
 assert.equal(started.length,3);releases.get(candidate(1).url)(master);await tick();assert.equal(settled,true);const selected=await result;assert.equal(selected.master.url,candidate(1).url);assert.equal(started.length,3,'no queued reads should start after selection');
 for(const [url,release]of releases)if(url!==candidate(1).url)release('#EXTM3U\n#EXTINF:6,\n1.ts\n#EXT-X-ENDLIST');await tick();assert.equal(started.length,3);
});

test('flat playlists finish with bounded concurrency and deterministic candidate order',async()=>{
 let active=0,peak=0;const started=[];
 const result=await inspectManifests(Array.from({length:6},(_,i)=>candidate(i)),async c=>{active++;peak=Math.max(peak,active);started.push(c.url);await tick();active--;return {...c,text:'#EXTM3U\n#EXTINF:6,\n1.ts\n#EXT-X-ENDLIST'};});
 assert.equal(result.master,null);assert.equal(peak,3);assert.equal(started.length,6);assert.deepEqual(result.inspected.map(r=>r.url),Array.from({length:6},(_,i)=>candidate(i).url));
});

test('unusable or protected masters cannot win over a validated clear master',async()=>{
 const result=await inspectManifests([candidate(0),candidate(1),candidate(2)],async c=>({...c,text:c.url===candidate(0).url?master.replace('avc1.64001f','hvc1.2'):c.url===candidate(1).url?master.replace('#EXTM3U','#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key"'):master}));assert.equal(result.master.url,candidate(2).url);
});

test('read failures and cancellation do not leave queued discovery work running',async()=>{
 const failed=await inspectManifests([candidate(0)],async()=>{throw Error('private response');});assert.equal(failed.master,null);assert.deepEqual(failed.inspected,[]);
 let closed=false,started=0;const releases=[];const pending=inspectManifests(Array.from({length:8},(_,i)=>candidate(i)),c=>{started++;return new Promise(r=>releases.push(()=>r({...c,text:master})));},{isClosed:()=>closed});closed=true;for(const release of releases)release();assert.equal((await pending).master,null);assert.equal(started,3);
});

test('video and audio initialization overlap but chunk buffering still waits for codec validation',async()=>{
 const source=new MovieSource();source.playlist={init:'video-init',duration:12,segments:[{start:0,url:'video-0'}]};source.audioPlaylist={init:'audio-init',duration:12,segments:[{start:0,url:'audio-0'}]};
 const requested=[],releases=new Map();let buffered=false;source.read=url=>{requested.push(url);return new Promise(r=>releases.set(url,r));};source.buffer=async()=>{buffered=true;};
 const pending=source.prepareMedia(0);assert.deepEqual(requested,['video-init','audio-init']);assert.equal(buffered,false);releases.get('video-init')(Buffer.from('avc1'));await tick();assert.equal(buffered,false);releases.get('audio-init')(Buffer.from('mp4a'));await pending;assert.equal(buffered,true);
 buffered=false;source.read=async url=>Buffer.from(url==='video-init'?'avc1 pssh':'mp4a');await assert.rejects(source.prepareMedia(0),/protected/);assert.equal(buffered,false);await source.close();
});
