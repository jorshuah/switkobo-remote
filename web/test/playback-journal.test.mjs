import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import vm from 'node:vm';import {PlaybackJournal} from '../playback-journal.mjs';import {MovieSource,browserBytes} from '../cast-source.mjs';
test('browser read failures preserve partial-transfer evidence without response text or URLs',async()=>{
 const frame={evaluate:async(fn,args)=>vm.runInNewContext('('+fn.toString()+')',{AbortController,setTimeout,clearTimeout,fetch:async()=>{let reads=0;return {ok:true,status:200,headers:{get:()=>8192},body:{getReader:()=>({read:async()=>{if(!reads++)return {done:false,value:new Uint8Array(4096)};throw Error('private signed URL and response text');}})}};}})(args)};
 await assert.rejects(browserBytes(frame,'https://private.example/?token=secret'),error=>{assert.equal(error.sourceKind,'network');assert.equal(error.sourceResponseStatus,200);assert.equal(error.sourceBytesRead,4096);assert.equal(error.sourceExpectedBytes,8192);assert.doesNotMatch(error.message,/private|secret|signed/);return true;});
});
test('oversized media responses fail once rather than being retried as transient network errors',async()=>{
 let calls=0;const events=[],source=new MovieSource({fetchBytes:async()=>{calls++;const error=Error('Source read too-large');error.sourceKind='too-large';error.sourceBytesRead=0;error.sourceExpectedBytes=17000000;throw error;}});source.onDiagnostic=e=>events.push(e);await assert.rejects(source.read('https://source.example/chunk'));assert.equal(calls,1);assert.equal(events[0].kind,'too-large');assert.equal(events[0].expectedBytes,17000000);await source.close();
});
test('cancelled source downloads do not masquerade as source failures',async()=>{
 let rejectFetch;const events=[],fetches=[],source=new MovieSource({fetchBytes:()=>new Promise((_,reject)=>rejectFetch=reject)});source.onDiagnostic=e=>events.push(e);source.onFetch=e=>fetches.push(e);
 const pending=source.read('https://source.example/segment'),rejected=assert.rejects(pending,/session has ended/);await source.close();rejectFetch(Error('Source HTTP 503 at private URL'));await rejected;assert.deepEqual(events,[]);assert.deepEqual(fetches,[]);
});
test('a genuine source refusal still records its sanitized status',async()=>{
 const events=[],fetches=[],source=new MovieSource({fetchBytes:async()=>{throw Error('Source HTTP 403 at private URL');}});source.onDiagnostic=e=>events.push(e);source.onFetch=e=>fetches.push(e);await assert.rejects(source.read('https://source.example/segment'),/stream stopped responding/);assert.equal(fetches[0].failed,true);assert.equal(events[0].status,403);assert.doesNotMatch(JSON.stringify({events,fetches}),/private|https/);await source.close();
});
test('the first failure survives later Stop/Resume cleanup and diagnostic history is bounded',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tv-journal-'));t.after(()=>{assert.equal(path.dirname(directory),os.tmpdir());fs.unlinkSync(path.join(directory,'playback-diagnostics.json'));fs.rmdirSync(directory);});const journal=new PlaybackJournal(directory);
 const row={session:'000000000001',at:new Date().toISOString(),state:'error',cause:'playback-error',position:60,media:{bytesWritten:100},diagnostics:{events:[{event:'source-timeout',atMs:1000}]}};journal.record(row);
 for(let i=0;i<20;i++)journal.record({...row,state:'stopped',cause:'requested-stop',position:60+i,diagnostics:{events:[]}});
 assert.equal(journal.rows[0].failure.cause,'playback-error');assert.equal(journal.rows[0].failure.diagnostics.events[0].event,'source-timeout');assert.equal(journal.rows[0].samples.length,12);
 for(let i=2;i<=12;i++)journal.record({...row,session:String(i).padStart(12,'0')});assert.equal(journal.rows.length,8);const reloaded=new PlaybackJournal(directory);assert.equal(reloaded.rows.length,8);assert.ok(fs.statSync(reloaded.file).size<=262144);
});
