import test from 'node:test';import assert from 'node:assert/strict';
import {movieURL,publicIP,publicGuard,parsePlaylist,vttToSrt} from '../cast-source.mjs';
import {CastManager,TVPlayer,seconds,xmlEscape} from '../cast.mjs';
import {Store,createHelper} from '../server.mjs';import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
const playlist='#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\n1.m4s\n#EXTINF:4,\n2.m4s\n#EXT-X-ENDLIST';
test('video links preserve public pages and canonicalize supported site movie pages',()=>{
 assert.equal(movieURL('https://movy.sx/movie/157336?anything=yes#x'),'https://www.movy.sx/movie/157336?play=true');assert.equal(movieURL('https://cinejoy.pk/movie/157336-interstellar-2014'),'https://cinejoy.pk/watch/movie/157336');assert.equal(movieURL('https://videos.example/watch/1?lang=en#x'),'https://videos.example/watch/1?lang=en');assert.equal(movieURL('https://test-streams.mux.dev/sample.m3u8'),'https://test-streams.mux.dev/sample.m3u8');
 for(const u of ['http://movy.sx/movie/1','https://cinejoy.pk/','https://router.local/movie/1','https://u:p@movy.sx/movie/1','https://movy.sx:123/movie/1','https://127.0.0.1/movie/1','https://movy.sx/','https://movy.sx/tv/1','not a URL'])assert.throws(()=>movieURL(u));
});
test('browser requests deny private, mapped, reserved and mixed DNS destinations',async()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','192.168.0.1','172.20.0.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','::ffff:192.168.0.1','fd00::1','2001:db8::1'])assert.equal(publicIP(ip),false,ip);
 assert.equal(publicIP('8.8.8.8'),true);assert.equal(publicIP('2606:4700::1111'),true);
 const good=publicGuard(async()=>[{address:'8.8.8.8'},{address:'2606:4700::1111'}]);assert.equal(await good('https://source.example/video'),true);
 const bad=publicGuard(async()=>[{address:'8.8.8.8'},{address:'192.168.0.1'}]);assert.equal(await bad('https://source.example/video'),false);
 for(const u of ['http://source.example','file:///a','https://localhost/a','https://router.local/a','https://source.example:8002/a','https://u:p@source.example/a'])assert.equal(await good(u),false,u);
});
test('HLS parser keeps the full timeline and rejects protected or unsupported sources',()=>{
 const parsed=parsePlaylist(playlist,'https://source.example/movie/index.m3u8');assert.equal(parsed.duration,10);assert.deepEqual(parsed.segments.map(s=>s.start),[0,6]);assert.equal(parsed.init,'https://source.example/movie/init.mp4');
 for(const text of [playlist.replace('#EXT-X-ENDLIST',''),playlist.replace('#EXTINF:6,','#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:6,'),playlist.replace('#EXTINF:6,','#EXTINF:NaN,'),playlist.replace('1.m4s','http://private.test/1'),playlist.replace('#EXTINF:6,','#EXT-X-DISCONTINUITY\n#EXTINF:6,')])assert.throws(()=>parsePlaylist(text,'https://source.example/index.m3u8'));
});
test('subtitle conversion handles offsets, expired cues and formatting safely',()=>{
 const vtt='WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nOld\n\n2\n00:00:09.250 --> 00:00:12.500 align:start\n<c.green>Hello</c> &amp; welcome\n';
 assert.equal(vttToSrt(vtt,10),'1\n00:00:00,000 --> 00:00:02,500\nHello & welcome\n');assert.equal(seconds('0:20:03.754'),1203.754);assert.equal(seconds('NOT_IMPLEMENTED'),null);assert.equal(xmlEscape('<a&"'), '&lt;a&amp;&quot;');
});
function fixture(t,{opening}={}){
 const store={data:{profile:{address:'192.168.0.20'}}};let loaded=0,closed=0,transport='TRANSITIONING',uri='',time=0,actions=[];
 const source={title:'Test movie',playlist:{init:'https://source.example/init',duration:120,segments:Array.from({length:20},(_,i)=>({start:i*6,duration:6,url:'https://source.example/'+i}))},subtitles:[{id:'0',label:'English',text:'WEBVTT\n\n00:00:10.000 --> 00:00:13.000\nHello\n'}],open:async()=>{if(opening)await opening;},buffer:async()=>{},close:async()=>{closed++;}};
 const player={load:async value=>{loaded++;value.onReady?.();uri=value.uri;transport='TRANSITIONING';time=0;},status:async()=>({transport,uri,time}),soap:async action=>{actions.push(action);transport=action==='Pause'?'PAUSED_PLAYBACK':action==='Stop'?'STOPPED':'PLAYING';}};
 const cast=new CastManager({store,addresses:['192.168.0.10'],adapter:()=> '192.168.0.10',sourceFactory:()=>source,relayFactory:()=>({ready:Promise.resolve(),close(){}}),playerFactory:()=>player});
 t.after(()=>cast.close());return {cast,store,source,player,get loaded(){return loaded;},get closed(){return closed;},actions,setState(s,p=0){transport=s;time=p;}};
}

test('quality changes warm a separate rendition, retain captions and pause state, and subsequent seeks use it',async t=>{
 const f=fixture(t),c=f.cast;f.source.quality=720;f.source.qualities=[480,720];let release,prepared,relaySources=[];
 f.source.prepareQuality=async(height,position)=>{prepared={height,position};await new Promise(r=>release=r);return {...f.source,quality:height,playlist:{...f.source.playlist,segments:Array.from({length:30},(_,i)=>({start:i*4,duration:4,url:'https://source.example/low/'+i}))}};};
 c.relayFactory=o=>{relaySources.push(o.source);return {ready:Promise.resolve(),close(){}};};
 c.start({url:'https://movy.sx/movie/1',quality:720});await c.job;f.setState('PAUSED_PLAYBACK',37);await c.refresh();c.data.subtitle='0';c.data.subtitleDelay=1.5;
 const oldURI=c.uri,oldRendition=c.rendition;await c.control({id:c.data.id,action:'quality',quality:480},{actor:'phone'});const job=c.job;
 assert.deepEqual(prepared,{height:480,position:37});assert.equal(c.data.busy,true);assert.equal(c.data.quality,720);assert.equal(c.uri,oldURI);assert.equal(c.rendition,oldRendition);assert.equal(f.loaded,1);
 await assert.rejects(c.control({id:c.data.id,action:'seek',position:80}),/Wait/);release();await job;
 assert.equal(c.data.quality,480);assert.equal(c.data.subtitle,'0');assert.equal(c.data.subtitleDelay,1.5);assert.equal(c.offset,36);assert.notEqual(c.uri,oldURI);assert.equal(f.source.quality,720);assert.equal(relaySources.at(-1).quality,480);
 f.setState('PLAYING',1);await c.refresh();await c.refresh();assert.equal(c.data.state,'paused');assert.equal(c.data.position,37);assert.equal(f.actions.at(-1),'Pause');
 await c.control({id:c.data.id,action:'seek',position:53});await c.job;assert.equal(c.offset,52);assert.equal(relaySources.at(-1).quality,480);assert.equal(c.snapshot().diagnostics.transitions.some(t=>t.kind==='quality'),true);
});

test('unavailable quality is rejected and a failed preparation preserves the active stream',async t=>{
 const f=fixture(t),c=f.cast;f.source.quality=720;f.source.qualities=[480,720];c.start({url:'https://movy.sx/movie/1',quality:720});await c.job;f.setState('PLAYING',25);await c.refresh();const uri=c.uri,token=c.token;
 for(const quality of [1080,'480',null,0])await assert.rejects(c.control({id:c.data.id,action:'quality',quality}),/available/);
 f.source.prepareQuality=async()=>{throw Error('private upstream failure');};await c.control({id:c.data.id,action:'quality',quality:480});await c.job;
 assert.equal(c.uri,uri);assert.equal(c.token,token);assert.equal(f.loaded,1);assert.equal(c.data.quality,720);assert.equal(c.data.position,25);assert.equal(c.data.state,'playing');assert.equal(c.data.busy,false);assert.match(c.data.transitionError,/kept playing/);assert.doesNotMatch(c.data.transitionError,/private/);
 await c.control({id:c.data.id,action:'quality',quality:720});assert.equal(f.loaded,1);assert.equal(c.data.busy,false);
});

test('Stop during quality preparation prevents a late handoff',async t=>{
 const f=fixture(t),c=f.cast;f.source.quality=720;f.source.qualities=[480,720];let release;
 f.source.prepareQuality=()=>new Promise(r=>release=()=>r({...f.source,quality:480}));c.start({url:'https://movy.sx/movie/1',quality:720});await c.job;f.setState('PLAYING',12);await c.refresh();
 await c.control({id:c.data.id,action:'quality',quality:480});const job=c.job;await c.control({id:c.data.id,action:'stop'});release();await job;assert.equal(f.loaded,1);assert.equal(c.data.state,'stopped');assert.equal(c.token,null);
});

test('quality handoff follows the latest TV position and a failed converter leaves the original quality running',async t=>{
 const f=fixture(t),c=f.cast;f.source.quality=720;f.source.qualities=[480,720];let release;
 f.source.prepareQuality=()=>new Promise(r=>release=()=>r({...f.source,quality:480}));c.start({url:'https://movy.sx/movie/1',quality:720});await c.job;f.setState('PLAYING',20);await c.refresh();
 await c.control({id:c.data.id,action:'quality',quality:480});f.setState('PLAYING',49);release();await c.job;assert.equal(c.offset,48);assert.equal(c.data.quality,480);assert.equal(c.pauseAfterLoad,false);
 f.setState('PLAYING',3);await c.refresh();const uri=c.uri,loads=f.loaded;
 f.source.prepareQuality=async()=>({...f.source,quality:720});c.relayFactory=()=>({ready:Promise.reject(Error('private converter failure')),close(){}});
 await c.control({id:c.data.id,action:'quality',quality:720});await c.job;assert.equal(c.data.quality,480);assert.equal(c.rendition.quality,480);assert.equal(c.uri,uri);assert.equal(f.loaded,loads);assert.equal(c.data.state,'playing');assert.equal(c.data.busy,false);assert.match(c.data.transitionError,/kept playing/);
});

test('known HLS renditions can prepare quality without mutating the active timelines or browser',async()=>{
 const {MovieSource}=await import('../cast-source.mjs');const master={url:'https://source.example/master.m3u8',text:'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=640x480,CODECS="avc1.64001f,mp4a.40.2"\n480/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"\n720/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1920x1080,CODECS="hvc1.2"\n1080/index.m3u8\n'};
 let protectedMedia=false;const reads=[],source=new MovieSource({fetchBytes:async(_frame,url)=>{reads.push(url);return Buffer.from(url.endsWith('.m3u8')?playlist:url.endsWith('init.mp4')?'avc1 mp4a'+(protectedMedia?' pssh':''):'chunk');}});source.frame={};source.playlist=parsePlaylist(playlist,'https://source.example/720/index.m3u8');source.quality=720;source.rememberMaster(master);const original=source.playlist;
 assert.deepEqual(source.qualities,[480,720]);const view=await source.prepareQuality(480,7);assert.equal(source.playlist,original);assert.equal(source.quality,720);assert.equal(view.quality,480);assert.match(view.playlist.segments[0].url,/\/480\//);assert.equal(view.jobs,source.jobs);assert.equal(view.cache,source.cache);assert.ok(reads.some(u=>u.endsWith('/480/2.m4s')));assert.ok(!reads.some(u=>u.endsWith('/480/1.m4s')));
 await assert.rejects(source.prepareQuality(1080,0),/available/);protectedMedia=true;source.cache.clear();source.size=0;await assert.rejects(source.prepareQuality(480,0),/protected/);assert.equal(source.playlist,original);await source.close();assert.equal(view.closed,true);
});

test('playback records classify requested controls and preserve receiver-stop evidence before cleanup',async t=>{
 const f=fixture(t),rows=[];f.cast.journal={record:row=>rows.push(JSON.parse(JSON.stringify(row)))};f.cast.start({url:'https://movy.sx/movie/1',quality:720},{actor:'phone'});await f.cast.job;
 assert.equal(rows[0].requestedQuality,720);assert.equal(rows[0].controlRequests[0].action,'start');assert.equal(rows[0].controlRequests[0].actor,'phone');assert.match(rows[0].session,/^[a-f0-9]{12}$/);assert.doesNotMatch(JSON.stringify(rows),/https|source\.example|\/media\//);
 f.setState('PLAYING',15);await f.cast.refresh();f.setState('STOPPED',15);await f.cast.refresh();assert.equal(rows.at(-1).cause,'receiver-stopped');assert.equal(rows.at(-1).state,'error');
 f.cast.start({url:'https://movy.sx/movie/1',quality:480},{actor:'pc-client'});await f.cast.job;await f.cast.control({id:f.cast.data.id,action:'stop'},{actor:'phone'});assert.equal(rows.at(-1).cause,'requested-stop');assert.equal(rows.at(-1).controlRequests.at(-1).actor,'phone');
});
test('session starts asynchronously, confirms playback, controls pause and seeks without re-downloading the movie',async t=>{
 const f=fixture(t),c=f.cast;c.start({url:'https://movy.sx/movie/1'});assert.equal(c.snapshot().state,'loading');assert.throws(()=>c.start({url:'https://movy.sx/movie/2'}),/Stop the current/);await c.job;assert.equal(c.snapshot().state,'buffering');f.setState('PLAYING',12);await c.refresh();assert.equal(c.snapshot().position,12);
 const id=c.snapshot().id;await assert.rejects(c.control({id:'stale',action:'pause'}));await c.control({id,action:'pause'});assert.equal(c.snapshot().state,'paused');
 await c.control({id,action:'seek',position:49});await c.job;assert.equal(c.snapshot().position,48);assert.equal(c.snapshot().state,'buffering');f.setState('PLAYING',1);await c.refresh();assert.equal(f.actions.at(-1),'Pause');await c.refresh();assert.equal(c.snapshot().state,'paused');assert.equal(c.snapshot().position,49);
 await c.control({id,action:'subtitle',subtitle:'0'});await c.job;assert.equal(c.snapshot().subtitle,'0');assert.equal(c.subtitleDirectory,null);await assert.rejects(c.control({id,action:'seek',position:-1}));
 await c.control({id,action:'stop'});assert.equal(c.snapshot().state,'stopped');assert.equal(c.token,null);assert.ok(f.closed>0);
});
test('cancelling startup prevents a delayed movie from reaching the TV',async t=>{
 let release;const f=fixture(t,{opening:new Promise(r=>release=r)});f.cast.start({url:'https://movy.sx/movie/1'});const job=f.cast.job;await f.cast.control({id:f.cast.snapshot().id,action:'stop'});release();await job;assert.equal(f.loaded,0);assert.equal(f.cast.snapshot().state,'stopped');
});
test('media relay rejects other clients and expired tokens and keeps subtitle files private',async t=>{
 const f=fixture(t),c=f.cast;c.start({url:'https://movy.sx/movie/1'});await c.job;const pathname='/media/'+c.token+'/video.ts';
 async function request(ip,url,method='GET'){const out={};const res={writeHead(status,headers){out.status=status;out.headers=headers;return this;},end(bytes){out.bytes=bytes;return this;}};await c.handle({socket:{remoteAddress:ip},method,headers:{}},res,new URL(url,'http://192.168.0.10'));return out;}
 assert.equal((await request('192.168.0.21',pathname)).status,404);assert.equal((await request('192.168.0.20','/media/wrong/video.ts')).status,404);assert.equal((await request('192.168.0.20',pathname,'POST')).status,404);
 assert.equal((await request('192.168.0.20',pathname,'HEAD')).headers['Content-Type'],'video/mpeg');f.setState('PLAYING');await c.refresh();await c.control({id:c.snapshot().id,action:'subtitle',subtitle:'0'});await c.job;
 assert.equal((await request('::ffff:192.168.0.20','/media/'+c.token+'/captions.srt')).status,404);const captionText=await (await import('node:fs/promises')).readFile(path.join(c.subtitleDirectory,'captions.srt'),'utf8');assert.match(captionText,/Hello/);assert.ok(!JSON.stringify(c.snapshot()).includes(c.token));await c.close();assert.equal((await request('192.168.0.20',pathname)).status,404);
});
test('TV SOAP rejects redirects, oversized responses and receiver faults without leaking response text',async()=>{
 let request;
 const player=new TVPlayer('192.168.0.20',{fetcher:async(url,options)=>{request={url,options};return new Response('<CurrentTransportState>PLAYING</CurrentTransportState>');}});await player.soap('Play',{Speed:1});assert.equal(request.options.redirect,'error');assert.equal(request.url,'http://192.168.0.20:9197/upnp/control/AVTransport1');
 const faulty=new TVPlayer('192.168.0.20',{fetcher:async()=>new Response('<errorCode>701</errorCode>PRIVATE',{status:500})});await assert.rejects(faulty.soap('Play'),error=>!error.message.includes('PRIVATE'));
});
test('playback APIs require access and the connected TV, and expose no relay secret',async t=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'cast-api-')),store=new Store(directory);store.update({profile:{name:'TV',address:'192.168.0.20',mac:''}});let started=0,online=true;
 const cast={snapshot:()=>({state:'idle'}),start:()=>started++,control:async()=>{},close:async()=>{}};
 const tv={snapshot:()=>({state:online?'connected':'disconnected'})};const helper=createHelper({store,tv,cast,port:48888,addresses:[]});await new Promise(r=>helper.server.listen(0,'127.0.0.1',r));const port=helper.server.address().port;helper.hosts.add('127.0.0.1:'+port);t.after(async()=>{await new Promise(r=>helper.server.close(r));rmSync(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+port,options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://movy.sx/movie/1'})};assert.equal((await fetch(base+'/api/cast/start',options)).status,401);options.headers.Authorization='Bearer '+store.data.accessKey;assert.equal((await fetch(base+'/api/cast/start',options)).status,200);assert.equal(started,1);online=false;assert.equal((await fetch(base+'/api/cast/start',options)).status,400);
});

test('egress pins a checked public address and rejects rebinding/private CONNECT targets',async()=>{
 const {destination,browserEgress}=await import('../cast-egress.mjs');
 assert.deepEqual(await destination('source.example:443',async()=>[{address:'8.8.8.8'}]),{host:'source.example',address:'8.8.8.8'});
 for(const address of ['127.0.0.1:443','192.168.0.1:443','source.example:8001','source.example:443/path','u:p@source.example:443'])await assert.rejects(destination(address,async()=>[{address:'8.8.8.8'}]));
 await assert.rejects(destination('source.example:443',async()=>[{address:'192.168.0.1'}]));
 const proxy=await browserEgress();try{const r=await fetch(proxy.proxy.server);assert.equal(r.status,403);}finally{proxy.close();}
});

test('a control waiting for TV status cannot act on a replacement playback session',async t=>{
 const f=fixture(t),c=f.cast;c.start({url:'https://movy.sx/movie/1'});await c.job;f.setState('PLAYING');await c.refresh();
 let release;const original=f.player.status;f.player.status=()=>new Promise(r=>release=r);
 const pending=c.control({id:c.data.id,action:'pause'});const done=assert.rejects(pending,/session has ended/);
 c.generation++;release({transport:'PLAYING',uri:c.uri,time:0});await done;assert.deepEqual(f.actions,[]);f.player.status=original;
});

test('invalid quality is rejected and an exhausted subtitle track does not create an empty subtitle filter',async t=>{
 const f=fixture(t),c=f.cast;assert.throws(()=>c.start({url:'https://movy.sx/movie/1',quality:2160}),/quality/);c.start({url:'https://movy.sx/movie/1',quality:720});await c.job;f.setState('PLAYING',60);await c.refresh();await c.control({id:c.data.id,action:'subtitle',subtitle:'0'});await c.job;assert.equal(c.data.subtitle,'0');assert.equal(c.subtitleDirectory,null);assert.equal(c.captionText,null);
});

test('browser source quality selection uses the requested height rather than the menu locator',async()=>{
 const {chooseMovieQuality}=await import('../cast-source.mjs');
 for(const height of [480,720,1080]){const clicked=[];const page={getByRole(role,{name}){assert.equal(role,'button');return {async click(){clicked.push(name);}};}};await chooseMovieQuality(page,height);assert.ok(clicked[0].test('Quality1080p'));assert.ok(clicked[1].test(height+'pHD'));assert.equal(clicked[1].test('Quality'),false);assert.equal(clicked.length,2);}
});


test('Samsung media keys pause/resume only after the receiver confirms the actual state',async t=>{
 const f=fixture(t),c=f.cast,keys=[];c.mediaKey=async key=>{keys.push(key);f.setState(key==='KEY_PAUSE'?'PAUSED_PLAYBACK':'PLAYING',15);};c.start({url:'https://movy.sx/movie/1'});await c.job;f.setState('PLAYING',15);await c.refresh();await c.control({id:c.data.id,action:'pause'});assert.equal(c.data.state,'paused');await c.control({id:c.data.id,action:'play'});assert.equal(c.data.state,'playing');assert.deepEqual(keys,['KEY_PAUSE','KEY_PLAY']);assert.deepEqual(f.actions,[]);
});

test('replacing a Samsung movie stops the old stream before setting and playing the new URI',async()=>{
 const player=new TVPlayer('192.168.0.20');let transport='PLAYING',uri='http://pc/old';const actions=[];
 player.soap=async(action,args={})=>{actions.push(action);if(action==='GetTransportInfo')return '<CurrentTransportState>'+transport+'</CurrentTransportState>';if(action==='GetPositionInfo')return '<TrackURI>'+uri+'</TrackURI><RelTime>0:00:12</RelTime>';if(action==='Stop')transport='STOPPED';if(action==='SetAVTransportURI'){assert.equal(transport,'STOPPED');uri=args.CurrentURI;}if(action==='Play')transport='PLAYING';return '';};
 await player.load({uri:'http://pc/new',title:'Movie',duration:120,previousURI:'http://pc/old'});assert.deepEqual(actions.filter(x=>!x.startsWith('Get')),['Stop','SetAVTransportURI','Play']);assert.equal(uri,'http://pc/new');
 const before=actions.length;await assert.rejects(player.load({uri:'http://pc/other',title:'Movie',duration:120,previousURI:'http://pc/unrelated'}),/Another video/);assert.equal(actions.slice(before).some(a=>['Stop','Play','SetAVTransportURI'].includes(a)),false);
});

test('Samsung transition retries are bounded and cancellation prevents a delayed Play',async()=>{
 const player=new TVPlayer('192.168.0.20');let plays=0,uri='',state='STOPPED',current=true;const actions=[];
 player.soap=async(action,args={})=>{actions.push(action);if(action==='GetTransportInfo')return '<CurrentTransportState>'+state+'</CurrentTransportState>';if(action==='GetPositionInfo')return '<TrackURI>'+uri+'</TrackURI><RelTime>0:00:00</RelTime>';if(action==='SetAVTransportURI'){uri=args.CurrentURI;state='TRANSITIONING';}if(action==='Play'){plays++;if(plays===1){const e=new Error('Transition');e.tvCode='701';throw e;}state='PLAYING';}return '';};
 await player.load({uri:'http://pc/new',title:'Movie',duration:120,isCurrent:()=>current});assert.equal(plays,2);
 state='STOPPED';player.soap=async action=>{actions.push(action);if(action==='GetTransportInfo')return '<CurrentTransportState>STOPPED</CurrentTransportState>';if(action==='GetPositionInfo')return '<TrackURI></TrackURI>';if(action==='SetAVTransportURI')current=false;return '';};const count=actions.filter(a=>a==='Play').length;await assert.rejects(player.load({uri:'http://pc/next',title:'Movie',duration:120,isCurrent:()=>current}),/session has ended/);assert.equal(actions.filter(a=>a==='Play').length,count);
});

test('HLS masters select requested video quality and its matching separate audio rendition',async()=>{
 const {parseMaster}=await import('../cast-playlist.mjs');
 const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="audio/index.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="mp4a.40.2,avc1.4D001E",AUDIO="audio"\n360/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.64001F,mp4a.40.2",AUDIO="audio"\n720/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=3840x2160,CODECS="hvc1.2,mp4a.40.2",AUDIO="audio"\n2160/index.m3u8\n';
 const low=parseMaster(master,'https://media.example/master.m3u8',480);assert.equal(low.video.height,360);assert.equal(low.audio.url,'https://media.example/audio/index.m3u8');assert.equal(parseMaster(master,'https://media.example/master.m3u8',1080).video.height,720);
 assert.throws(()=>parseMaster(master.replace('audio/index.m3u8','http://127.0.0.1/audio'),'https://media.example/master.m3u8',480));
});
test('clear MPEG-TS playlists do not require an MP4 initialization segment',()=>{
 const parsed=parsePlaylist('#EXTM3U\n#EXTINF:6,\n1.ts\n#EXTINF:6,\n2.ts\n#EXT-X-ENDLIST','https://media.example/movie.m3u8');assert.equal(parsed.init,null);assert.equal(parsed.format,'mpegts');assert.equal(parsed.duration,12);
});

test('temporary segment errors retry within a bound, while access refusals do not retry',async()=>{
 const {MovieSource}=await import('../cast-source.mjs');let calls=0;
 const source=new MovieSource({fetchBytes:async()=>{if(++calls<3)throw Error('Source HTTP 503');return Buffer.from('segment');}});assert.equal((await source.read('https://media.example/1')).toString(),'segment');assert.equal(calls,3);await source.close();
 calls=0;const denied=new MovieSource({fetchBytes:async()=>{calls++;throw Error('Source HTTP 403');}});await assert.rejects(denied.read('https://media.example/1'),e=>e.sourceStatus===403);assert.equal(calls,1);await denied.close();
});

test('seek keeps the old media route and connection alive until buffering and clean TV Stop complete',async t=>{
 const f=fixture(t),c=f.cast;c.start({url:'https://movy.sx/movie/1'});await c.job;f.setState('PLAYING',12);await c.refresh();const token=c.token,uri=c.uri,events=[];let release;
 f.source.buffer=async()=>{await new Promise(r=>release=r);events.push('buffered');};
 c.connections.add({res:{destroy(){events.push('close-old');}},child:{kill(){events.push('kill-old');}}});
 const load=f.player.load;f.player.load=async value=>{events.push('TV-stopped');assert.equal(c.token,token);await load(value);events.push('new-loaded');};
 await c.control({id:c.data.id,action:'seek',position:60});assert.equal(c.token,token);assert.equal(c.uri,uri);assert.equal(c.offset,0);assert.deepEqual(events,[]);release();await c.job;
 assert.deepEqual(events,['buffered','TV-stopped','close-old','kill-old','new-loaded']);assert.notEqual(c.token,token);assert.equal(c.offset,60);
});
test('failed preparation leaves the current movie and media route running',async t=>{
 const f=fixture(t),c=f.cast;c.start({url:'https://movy.sx/movie/1'});await c.job;f.setState('PLAYING',12);await c.refresh();const token=c.token,uri=c.uri,closed=f.closed;let tornDown=false;
 c.connections.add({res:{destroy(){tornDown=true;}},child:{kill(){tornDown=true;}}});f.source.buffer=async()=>{throw Error('Temporary source failure');};
 await c.control({id:c.data.id,action:'subtitle',subtitle:'0'});await c.job;assert.equal(c.data.state,'playing');assert.equal(c.data.busy,false);assert.equal(c.token,token);assert.equal(c.uri,uri);assert.equal(f.closed,closed);assert.equal(tornDown,false);assert.match(c.data.transitionError,/current video was kept playing/);
});
test('TV Stop is confirmed before the old relay is retired or a new URI is sent',async()=>{
 const player=new TVPlayer('192.168.0.20');const events=[];let state='PLAYING',uri='http://pc/old';
 player.soap=async(action,args={})=>{if(action==='GetTransportInfo'){if(state==='STOPPED')events.push('confirmed-stop');return '<CurrentTransportState>'+state+'</CurrentTransportState>';}if(action==='GetPositionInfo')return '<TrackURI>'+uri+'</TrackURI>';if(action==='Stop'){events.push('stop');state='STOPPED';}if(action==='SetAVTransportURI'){events.push('set-uri');uri=args.CurrentURI;}if(action==='Play')events.push('play');return '';};
 await player.load({uri:'http://pc/new',title:'Movie',duration:120,previousURI:'http://pc/old',onReady:()=>events.push('retire-old-relay')});assert.deepEqual(events,['stop','confirmed-stop','retire-old-relay','set-uri','play']);
});

test('Movy, Cinejoy and Aether episode URLs preserve an explicit real episode selection',()=>{
 assert.equal(movieURL('https://www.movy.sx/tv/1396/1/2'),'https://www.movy.sx/tv/1396/1/2?play=true');
 assert.equal(movieURL('https://cinejoy.pk/watch/tv/1396/0/1'),'https://cinejoy.pk/watch/tv/1396/0/1');
 assert.equal(movieURL('https://aether.st/media/tmdb-tv-1396-breaking-bad/3572/62085'),'https://aether.st/media/tmdb-tv-1396-breaking-bad/3572/62085');
 for(const url of ['https://www.movy.sx/tv/1396','https://aether.st/','https://aether.st/media/tmdb-tv-1396-breaking-bad'])assert.throws(()=>movieURL(url));
});

test('subtitle metadata discovery accepts bounded public files and prioritizes English',async()=>{
 const {subtitleEntries}=await import('../cast-source.mjs');
 const result=subtitleEntries([{url:'https://captions.example/fr.vtt',lang:'fr',label:'French'},{SubDownloadLink:'https://captions.example/en.srt.gz',ISO639:'en',LanguageName:'English'},{url:'http://captions.example/plain.vtt'},{url:'https://user:password@captions.example/a.vtt'},{url:'file:///etc/passwd'}]);
 assert.equal(result.length,2);assert.equal(result[0].label,'English');assert.equal(result[0].lang,'en');assert.equal(subtitleEntries({subtitles:Array.from({length:500},(_,i)=>({url:'https://captions.example/'+i+'.vtt'}))}).length,20);
});

test('missing or failed subtitles do not stop video and remain distinct in playback state',async t=>{
 const f=fixture(t);f.source.subtitles=[];f.source.subtitleStatus='failed';f.cast.start({url:'https://movy.sx/movie/1'});await f.cast.job;f.setState('PLAYING',3);await f.cast.refresh();assert.equal(f.cast.snapshot().state,'playing');assert.equal(f.cast.snapshot().subtitleStatus,'failed');assert.deepEqual(f.cast.snapshot().subtitles,[]);
 await f.cast.close();f.source.subtitleStatus='unavailable';f.cast.start({url:'https://movy.sx/movie/1'});await f.cast.job;f.setState('PLAYING',3);await f.cast.refresh();assert.equal(f.cast.snapshot().state,'playing');assert.equal(f.cast.snapshot().subtitleStatus,'unavailable');
});

test('seek-preview sprite cues are not converted into dialogue subtitles',()=>{
 const preview='WEBVTT\n\n00:00:00.000 --> 00:00:05.000\npreview.jpg#xywh=0,0,160,90\n';assert.equal(vttToSrt(preview).trim(),'');
 const dialogue='WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nActual dialogue\n';assert.match(vttToSrt(dialogue),/Actual dialogue/);
});

test('a replacement converter is ready before the TV is stopped or the current relay is retired',async t=>{
 const f=fixture(t),c=f.cast;c.start({url:'https://movy.sx/movie/1'});await c.job;f.setState('PLAYING',12);await c.refresh();const oldURI=c.uri,events=[];let release;
 c.connections.add({res:{destroy(){events.push('retire-old');}},child:{kill(){}}});
 c.relayFactory=()=>({ready:new Promise(resolve=>release=()=>{events.push('ready');resolve();}),close(){events.push('close-new');}});
 const original=f.player.load;f.player.load=async options=>{events.push('stop-and-load');await original(options);};
 await c.control({id:c.data.id,action:'seek',position:60});assert.deepEqual(events,[]);assert.equal(c.uri,oldURI);release();await c.job;
 assert.deepEqual(events,['ready','stop-and-load','retire-old']);assert.notEqual(c.uri,oldURI);
});

test('a converter preparation failure leaves the current TV stream and checkpoint intact',async t=>{
 const f=fixture(t),c=f.cast;c.start({url:'https://movy.sx/movie/1'});await c.job;f.setState('PLAYING',30);await c.refresh();const oldURI=c.uri,oldToken=c.token,loads=f.loaded;let closed=false;
 c.relayFactory=()=>({ready:Promise.reject(new Error('Converter failed')),close(){closed=true;}});
 await c.control({id:c.data.id,action:'seek',position:90});await c.job;assert.equal(c.uri,oldURI);assert.equal(c.token,oldToken);assert.equal(f.loaded,loads);assert.equal(c.data.state,'playing');assert.equal(c.data.position,30);assert.equal(c.data.busy,false);assert.equal(closed,true);assert.match(c.data.transitionError,/kept playing/);
});

test('Stop cancels a converter warming up and prevents a late load on the TV',async t=>{
 const f=fixture(t),c=f.cast;c.start({url:'https://movy.sx/movie/1'});await c.job;f.setState('PLAYING',12);await c.refresh();const loads=f.loaded;let release,closed=false;
 c.relayFactory=()=>({ready:new Promise(resolve=>release=resolve),close(){closed=true;release();}});
 await c.control({id:c.data.id,action:'seek',position:60});const pending=c.job;await c.control({id:c.data.id,action:'stop'});await pending;assert.equal(closed,true);assert.equal(c.data.state,'stopped');assert.equal(f.loaded,loads);assert.equal(c.warmRelay,null);assert.equal(c.preparingRelay,null);
});

test('audio and video preparation overlap and speculative fetching never blocks cached playback',async()=>{
 const {MovieSource}=await import('../cast-source.mjs');const source=new MovieSource(),video={segments:[{start:0,url:'video-0'},{start:6,url:'video-1'},{start:12,url:'video-2'}]},audio={segments:[{start:0,url:'audio-0'}]};source.playlist=video;source.audioPlaylist=audio;
 const tracks=[],releases=[];source.bufferTrack=async playlist=>{tracks.push(playlist);await new Promise(r=>releases.push(r));};const buffering=source.buffer(0,2);assert.deepEqual(tracks,[video,audio]);for(const release of releases)release();await buffering;
 source.read=async url=>Buffer.from(url);let unblock;source.bufferTrack=()=>new Promise(r=>unblock=r);const stream=source.trackStream(video,0);assert.equal((await stream.next()).value.toString(),'video-0');assert.equal((await stream.next()).value.toString(),'video-1');await stream.return();unblock();await source.close();
});

test('resumed startup prepares the saved position and does not wait for optional subtitles', {timeout:1500},async t=>{
 const f=fixture(t),c=f.cast;let release,options;f.source.subtitles=[];f.source.subtitleStatus='loading';f.source.subtitlesReady=new Promise(r=>release=r);f.source.open=async(_url,o)=>{options=o;};
 c.library={entries:new Map([['movie:1',{position:49,completed:false}]]),begin(){},record(){}};
 c.start({url:'https://movy.sx/movie/1',media:{id:'1',type:'movie',source:'movy',title:'Test movie'}});await c.job;
 assert.equal(options.position,49);assert.equal(c.data.position,48);assert.equal(f.loaded,1);assert.equal(c.data.subtitleStatus,'loading');
 f.source.subtitles=[{id:'0',label:'English',text:'WEBVTT\n\n00:00:50.000 --> 00:00:52.000\nHello\n'}];f.source.subtitleStatus='ready';release();options.onSubtitles();assert.equal(c.data.subtitles[0].label,'English');assert.equal(f.loaded,1,'Late captions must not restart playback');
 f.setState('PLAYING',1);await c.refresh();const diagnostics=c.snapshot().diagnostics;assert.equal(diagnostics.transitions[0].kind,'start');assert.ok(diagnostics.transitions[0].confirmedMs>=0);
});

test('a saved source subtitle is restored before the first TV handoff', {timeout:1500},async t=>{
 const f=fixture(t),c=f.cast;let release;f.source.subtitles=[];f.source.subtitlesReady=new Promise(r=>release=r);
 c.subtitleStore={get:()=>({selected:'0',sourceLabel:'English',tracks:[],delay:0}),select(){}};
 c.start({url:'https://movy.sx/movie/1'});await new Promise(r=>setImmediate(r));assert.equal(f.loaded,0);
 f.source.subtitles.push({id:'0',label:'English',text:'WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nHello\n'});release();await c.job;assert.equal(c.data.subtitle,'0');assert.equal(f.loaded,1);
});

test('slow receiver status during initial buffering gets the full startup deadline without premature teardown',async t=>{
 const f=fixture(t),c=f.cast;c.start({url:'https://movy.sx/movie/1'});await c.job;f.player.status=async()=>{throw Error('Read-only receiver status timed out');};c.startedAt=Date.now()-30000;c.lastHealthy=0;await c.refresh();assert.equal(c.data.state,'buffering');assert.equal(f.closed,0);
 c.startedAt=Date.now()-46000;await c.refresh();assert.equal(c.data.state,'error');assert.ok(f.closed>0);
});

test('resuming validates media and buffers the target rather than downloading the beginning',async()=>{
 const {MovieSource}=await import('../cast-source.mjs');const requested=[],source=new MovieSource();source.playlist={duration:100,init:'init',segments:[{start:0,url:'beginning'},{start:40,url:'target'},{start:46,url:'next'}]};source.read=async url=>{requested.push(url);return Buffer.from('avc1 mp4a');};await source.prepareMedia(42);assert.deepEqual(requested,['init','target','next']);
 source.read=async()=>Buffer.from('avc1 mp4a pssh');await assert.rejects(source.prepareMedia(42),/unsupported codec or protected/);await source.close();
});

test('quality selection recognizes both source rendition URL layouts without matching other resolutions',async()=>{
 const {renditionMatches}=await import('../cast-source.mjs');for(const url of ['https://source.example/s720p/index.m3u8?token=private','https://source.example/movie/720p/index.m3u8','https://source.example/s720p.m3u8'])assert.equal(renditionMatches(url,720),true);assert.equal(renditionMatches('https://source.example/s720p2/index.m3u8',720),false);assert.equal(renditionMatches('https://source.example/1080p/index.m3u8',720),false);assert.equal(renditionMatches('https://source.example/2160p/index.m3u8',2160),false);
});

test('background subtitle discovery preserves imported IDs and discards late results after cancellation',async()=>{
 const {MovieSource}=await import('../cast-source.mjs');let release;const frame={locator:()=>({evaluateAll:async()=>[{url:'https://fixture.example/en.vtt',lang:'en',label:'English'}]}),evaluate:async()=>new Promise(r=>release=()=>r(Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n').toString('base64')))};
 const source=new MovieSource();source.page={frames:()=>[frame]};source.subtitles=[{id:'ext-stable',label:'Imported',text:'private cue'}];const loading=source.discoverSubtitles(new Map(),new Set());await new Promise(r=>setImmediate(r));release();await loading;assert.deepEqual(source.subtitles.map(t=>t.id),['0','ext-stable']);assert.equal(source.subtitleStatus,'ready');
 const late=source.discoverSubtitles(new Map(),new Set());await new Promise(r=>setImmediate(r));await source.close();release();await late;assert.deepEqual(source.subtitles.map(t=>t.id),['0','ext-stable']);
});
