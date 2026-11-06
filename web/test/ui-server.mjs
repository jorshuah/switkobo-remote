// Isolated test TV; never imported by the production helper.
import {mkdtempSync,rmSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {Store,createHelper} from '../server.mjs';
import {launcherPage} from '../launcher-page.mjs';
import QRCode from 'qrcode';
import {movieURL} from '../cast-source.mjs';
import {RemoteError} from '../protocol.mjs';
import {WatchLibrary,watchMedia} from '../watch-library.mjs';
import {recommend} from '../catalog-discovery.mjs';
import {SubtitleStore,SubtitleService} from '../subtitles.mjs';
import {UpdatePush} from '../push.mjs';
let subtitleFailure=false,legacySubtitles=false;
const uiPort=Number(process.env.REMOTE_UI_PORT||48866);
const testBuild=JSON.parse(readFileSync(new URL('../public/app-version.json',import.meta.url),'utf8')).version;let release=testBuild,brokenUpdate=false;

const testLauncher=launcherPage([{url:'http://192.168.0.151:48765/#access'+'='+'a'.repeat(64),qr:await QRCode.toDataURL('http://192.168.0.151:48765/#access'+'='+'a'.repeat(64),{width:400,margin:4})}],'http://127.0.0.1:'+uiPort+'/#access'+'='+'a'.repeat(64));
const directory=mkdtempSync(path.join(os.tmpdir(),'switkobo-ui-'));
const store=new Store(directory),library=new WatchLibrary(directory),subtitleStore=new SubtitleStore(directory,{environment:{}});
let pushEvents=[],pushFailure=false;const push=new UpdatePush(directory,{build:()=>release,send:async(_subscription,payload)=>{if(pushFailure)throw Error('Simulated push service outage');pushEvents.push(payload);}});
const subtitleService=new SubtitleService(subtitleStore,{fetcher:async url=>{if(subtitleFailure)return new Response('{}',{status:503});const u=new URL(url);if(u.pathname==='/search')return new Response(JSON.stringify([{id:'test',url:'https://sub.wyzie.io/c/test?tok=private-test-token',format:'srt',display:'English',language:'en',release:u.searchParams.get('id')==='1396'?'Breaking.Bad.S02E02.WEB':'Interstellar.2014.WEB.1080p',source:'test',downloadCount:123}]));return new Response('1\n00:00:40,000 --> 00:00:46,000\nSynthetic subtitle fixture\n');}});
const subtitleStatus=subtitleService.status.bind(subtitleService);subtitleService.status=()=>legacySubtitles?null:subtitleStatus();
store.update({accessKey:'a'.repeat(64),profile:{name:'Samsung Q65B',address:'192.168.0.20',mac:''}});
let status='connected',message='',commands=[],apps=[],loadingApps=false,appStatus='unknown',unavailableApps=false;
const tv={
 snapshot:()=>({state:status,message,apps,loadingApps,appStatus,keyboardActive:false}),
 connect(){status=store.data.profile?.address==='192.168.0.21'?'connecting':'connected';message='';},disconnect(){status='disconnected';},
 configureReconnect(enabled){if(!enabled&&status==='reconnecting')status='disconnected';},
 async key(key){commands.push({key});if(key==='KEY_POWEROFF')status='disconnected';},
 async text(text){commands.push({text});},async launch(app){commands.push({app});},
 async fetchApps(){apps=unavailableApps?[]:[{name:'YouTube',appID:'test.youtube',deepLink:true},{name:'Plex',appID:'test.plex',deepLink:true}];appStatus=unavailableApps?'unavailable':'available';},
 async wake(){commands.push({wake:true});}
};
let starts=[];let movie={state:'idle'},movieTimer,holdMovie=false;const cast={snapshot:()=>movie,start(input){movieURL(input.url);starts.push(input);const media=watchMedia(input.media,input.url);cast.watch=media;const saved=media?library.entries.get(media.key):null;movie={id:'test-movie',state:'loading',title:'',position:0,duration:0,busy:true,quality:input.quality||480,qualities:[480,720,1080],historyKey:media?.key||null,subtitleMedia:media?{id:media.id,type:media.type,title:media.title,year:media.year,season:media.season,episode:media.episode}:null,subtitleDelay:0,subtitles:[],subtitle:'off',message:'Opening video…'};clearTimeout(movieTimer);movieTimer=holdMovie?null:setTimeout(()=>{movie={...movie,state:'playing',title:'Interstellar',position:input.restart?0:saved&&!saved.completed?saved.position:42,duration:10142,busy:false,subtitles:[{id:'0',label:'English'}],message:''};},600);},async control(input){if(input.id!==movie.id)throw new RemoteError('Playback session ended.');commands.push({cast:input.action,...(input.quality!==undefined?{quality:input.quality}:{}),...(input.position!==undefined?{position:input.position}:{}),...(input.subtitle!==undefined?{subtitle:input.subtitle}:{}),...(input.delay!==undefined?{delay:input.delay}:{})});if(input.action==='stop'){clearTimeout(movieTimer);movie={...movie,state:'stopped',busy:false,message:'Playback stopped.'};}else if(input.action==='pause')movie={...movie,state:'paused'};else if(input.action==='play')movie={...movie,state:'playing'};else if(input.action==='seek')movie={...movie,position:input.position};else if(input.action==='quality'){if(!movie.qualities.includes(input.quality))throw new RemoteError('Choose a quality available for this video.');movie={...movie,quality:input.quality};}else if(input.action==='subtitle')movie={...movie,subtitle:input.subtitle,subtitleDelay:input.delay||0};},close:async()=>{clearTimeout(movieTimer);movie={state:'idle'};}};
cast.requireSession=id=>{if(id!==movie.id||!['playing','paused','loading','buffering'].includes(movie.state))throw new RemoteError('Playback session ended.',409);};
cast.addSubtitle=(id,input)=>{cast.requireSession(id);const track=subtitleStore.add(movie.historyKey||'session:'+id,input);movie.subtitles=[...(movie.subtitles||[]).filter(t=>t.id!==track.id),{id:track.id,label:track.label,origin:track.origin,language:track.language,release:track.release}];return {id:track.id,label:track.label};};
const catalog={
 async search(query,{source='cinejoy',type='all'}={}){if(query==='error')throw new RemoteError('The movie catalog is unavailable right now.',503);const tv=query.toLowerCase().includes('breaking')||type==='tv';const synopsis='A team of explorers travel beyond this galaxy to discover whether mankind has a future among the stars.';return {query,source,type,results:query==='nothing'?[]:tv?[{id:'1396',source,type:'tv',title:'Breaking Bad',year:'2008',rating:{source:'tmdb',value:9.1,votes:42},synopsis,poster:true,...(source==='aether'?{page:'https://aether.st/media/tmdb-tv-1396-breaking-bad'}:{})}]:[{id:'157336',source,type:'movie',title:'Interstellar',year:'2014',rating:{source:'tmdb',value:8.64,votes:12345},synopsis,poster:true,...(source==='aether'?{page:'https://aether.st/media/tmdb-movie-157336-interstellar'}:{})},{id:'529107',source,type:'movie',title:'Inside Interstellar: Exploring the Science of a Very Long Movie Title',year:'2015',synopsis,poster:false}]};},
 async details(id,{source='cinejoy',type='movie'}={}){return {id,source,type,title:type==='tv'?'Breaking Bad':id==='157336'?'Interstellar':'Inside Interstellar: Exploring the Science of a Very Long Movie Title',year:type==='tv'?'2008':'2014',poster:true,synopsis:'A team of explorers travel beyond this galaxy to discover whether mankind has a future among the stars.',seasons:type==='tv'?[{id:'3572',number:1,name:'Season 1',count:2},{id:'3573',number:2,name:'Season 2',count:2}]:[],...(source==='aether'?{page:'https://aether.st/media/tmdb-'+(type==='tv'?'tv-1396-breaking-bad':'movie-157336-interstellar')}:{})};},
 async episodes(id,season){return {season,episodes:season===1?[{id:'62085',number:1,title:'Pilot'},{id:'62086',number:2,title:"Cat's in the Bag..."}]:[{id:'972873',number:1,title:'Seven Thirty-Seven'},{id:'972874',number:2,title:'Grilled'}]};},
 async browse({source='aether',type='all',history=[]}={}){const items=[{id:'157336',source,type:'movie',title:'Interstellar',year:'2014',rating:{source:'tmdb',value:8.64,votes:12345},synopsis:'A team of explorers travel beyond this galaxy.',genres:[878,18],poster:true,...(source==='aether'?{page:'https://aether.st/media/tmdb-movie-157336-interstellar'}:{})},{id:'1',source,type:'movie',title:'New horizons',year:'2026',rating:{source:'tmdb',value:7.25,votes:3},synopsis:'A new science fiction film.',genres:[878],poster:false,...(source==='aether'?{page:'https://aether.st/media/tmdb-movie-1-new-horizons'}:{})},{id:'1396',source,type:'tv',title:'Breaking Bad',year:'2008',rating:{source:'tmdb',value:9.1,votes:42},synopsis:'An ordinary life changes.',genres:[18],poster:true,...(source==='aether'?{page:'https://aether.st/media/tmdb-tv-1396-breaking-bad'}:{})},{id:'2',source,type:'movie',title:'Recent comedy fixture',year:'2026',genres:[35],poster:false},{id:'3',source,type:'movie',title:'Classic comedy fixture',year:'2000',genres:[35],poster:false},{id:'4',source,type:'movie',title:'Another comedy fixture',year:'2001',genres:[35],poster:false}].filter(i=>type==='all'||i.type===type),r=recommend(items,history);return {source,type,popular:items,recent:items.filter(i=>i.year==='2026'),recommended:r.items,recommendationBasis:r.basis};},
 async poster(){return {image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='};}
};
const helper=createHelper({store,tv,cast,catalog,library,push,subtitles:subtitleService,port:uiPort,addresses:[],addressProvider:()=>['192.168.0.151'],discover:async()=>[{name:"Living room",address:"192.168.0.21",model:"Samsung Q65B",mac:""}]});
const listener=helper.server.listeners('request')[0];helper.server.removeAllListeners('request');
helper.server.on('request',(req,res)=>{
 const requestURL=new URL(req.url,'http://127.0.0.1');
 if(requestURL.pathname==='/__test/release'){const version=requestURL.searchParams.get('v');if(!/^[a-f0-9]{12}$/.test(version||'')){res.writeHead(400).end();return;}release=version;brokenUpdate=requestURL.searchParams.get('fail')==='1';res.end('ok');return;}
 if(requestURL.pathname==='/__test/push-events'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({events:pushEvents,registrations:push.data.subscriptions.length}));return;}
 if(requestURL.pathname==='/__test/push-fail'){pushFailure=true;res.end('ok');return;}
 if(requestURL.pathname==='/__test/push-check'){void push.check().then(()=>res.end('ok'));return;}
 if(requestURL.pathname==='/app-version.json'){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({version:release}));return;}
 if(requestURL.pathname==='/service-worker.js'){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');res.end(readFileSync(new URL('../public/service-worker.js',import.meta.url),'utf8').replace(/^const CACHE=.*;$/m,"const CACHE='switkobo-shell-"+release+"';"));return;}
 if(requestURL.pathname==='/'||requestURL.pathname==='/index.html'){res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');res.end(readFileSync(new URL('../public/index.html',import.meta.url),'utf8').replace(/(<meta name="app-build" content=")[^"]*(">)/,'$1'+release+'$2'));return;}
 if(brokenUpdate&&requestURL.pathname==='/icons/tv.svg'){res.writeHead(503).end();return;}
 if(req.url==='/__test/launcher'){res.setHeader('Content-Type','text/html');res.end(testLauncher);return;}
 if(req.url==='/__test/reset'){
   pushEvents=[];pushFailure=false;push.data.subscriptions=[];push.save();
   void cast.close();subtitleFailure=false;legacySubtitles=false;try{unlinkSync(path.join(directory,'.env'));}catch{}subtitleStore.data={version:1,key:'',language:'en',entries:{}};subtitleService.cache.clear();subtitleService.results.clear();holdMovie=false;release=testBuild;brokenUpdate=false;starts=[];library.entries.clear();library.suppressed.clear();library.save();status='connected';message='';commands=[];apps=[];loadingApps=false;appStatus='unknown';unavailableApps=false;
   store.update({profile:{name:'Samsung Q65B',address:'192.168.0.20',mac:''},shortcuts:[],pairing:null,autoReconnect:true});
   res.end('ok');return;
 }
 if(req.url==='/__test/unconfigured'){store.update({profile:null,pairing:null});status='disconnected';res.end('ok');return;}
 if(req.url==='/__test/denied'){status='failed';message='The TV declined this remote. Reconnect and select Allow.';res.end('ok');return;}
 if(req.url==='/__test/wake-ready'){store.update({profile:{...store.data.profile,mac:'1C:AF:4A:13:2B:DE'}});res.end('ok');return;}
 if(req.url==='/__test/paired'){store.update({pairing:{token:'test-pairing'}});res.end('ok');return;}
 if(req.url==='/__test/apps-unavailable'){unavailableApps=true;res.end('ok');return;}
 if(req.url==='/__test/reconnecting'){status='reconnecting';message='Waiting for your TV. The remote will reconnect when it is reachable.';res.end('ok');return;}
 if(req.url==='/__test/online'){status='connected';message='';res.end('ok');return;}
 if(req.url==='/__test/offline'){status='disconnected';message='The TV connection closed.';res.end('ok');return;}
 if(req.url==='/__test/subtitle-environment'){writeFileSync(path.join(directory,'.env'),'WYZIE_API_KEY=wyzie-environment-fixture\n');res.end('ok');return;}
 if(req.url==='/__test/subtitle-key'){subtitleService.configure({key:'wyzie-test-private-key',language:'en'});res.end('ok');return;}
 if(req.url==='/__test/subtitle-failure'){subtitleFailure=true;subtitleService.cache.clear();res.end('ok');return;}
 if(req.url==='/__test/subtitles-pending'){legacySubtitles=true;res.end('ok');return;}
 if(req.url==='/__test/cast-hold'){holdMovie=true;res.end('ok');return;}
 if(req.url==='/__test/cast-buffering'){clearTimeout(movieTimer);movie={...movie,state:'buffering',title:'Interstellar',duration:10142,busy:true,message:'Preparing video…'};res.end('ok');return;}
 if(req.url==='/__test/cast-ready'){clearTimeout(movieTimer);movie={...movie,state:'playing',title:'Interstellar',duration:10142,position:42,busy:false,message:'',subtitles:[{id:'0',label:'English'}]};res.end('ok');return;}
 if(req.url==='/__test/cast-no-subtitles'){movie={...movie,state:'playing',busy:false,subtitles:[],subtitleStatus:'unavailable'};res.end('ok');return;}
 if(req.url==='/__test/cast-subtitles-loading'){movie={...movie,state:'playing',busy:false,subtitles:[],subtitleStatus:'loading'};res.end('ok');return;}
 if(req.url==='/__test/cast-subtitles-failed'){movie={...movie,state:'playing',busy:false,subtitles:[],subtitleStatus:'failed'};res.end('ok');return;}
 if(req.url==='/__test/cast-prepare-failed'){movie={...movie,state:'playing',busy:false,transitionError:'Could not prepare that change. Your current video was kept playing. Try again.'};res.end('ok');return;}
 if(req.url==='/__test/cast-one-quality'){movie={...movie,qualities:[movie.quality]};res.end('ok');return;}
 if(req.url==='/__test/cast-error'){clearTimeout(movieTimer);movie={...movie,state:'error',busy:false,message:'No supported video was found on this page. Try a different video link.'};res.end('ok');return;}
 if(req.url==='/__test/history'){library.record(watchMedia({id:'157336',type:'movie',source:'cinejoy',title:'Interstellar',year:'2014',rating:{source:'tmdb',value:8.64,votes:12345},genres:[878,18],posterURL:'https://image.tmdb.org/t/p/w500/test.jpg'},'https://cinejoy.pk/movie/157336'),{position:1260,duration:10142,quality:720,title:'Interstellar'});library.record(watchMedia({id:'1396',type:'tv',source:'movy',title:'Breaking Bad',year:'2008',rating:{source:'tmdb',value:9.1,votes:42},season:2,episode:2,episodeTitle:'Grilled',genres:[18],posterURL:'https://image.tmdb.org/t/p/w500/test.jpg'},'https://www.movy.sx/tv/1396/2/2'),{position:600,duration:2800,quality:720,title:'Breaking Bad'});res.end('ok');return;}
 if(req.url==='/__test/starts'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(starts));return;}
 if(req.url==='/__test/commands'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(commands));return;}
 listener(req,res);
});
helper.server.listen(uiPort,'127.0.0.1');
process.on('SIGTERM',()=>{helper.server.close();rmSync(directory,{recursive:true,force:true});process.exit(0);});
