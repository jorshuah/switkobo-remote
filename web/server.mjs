import http from 'node:http';
import https from 'node:https';
import {loadHTTPS,phoneSetupPage,appleCertificateProfile} from './https-config.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {networkAddresses} from './network-addresses.mjs';
export {networkAddresses} from './network-addresses.mjs';
import {writeConnectionPage,buildConnectionPage} from './connection-page.mjs';
import {discoverTVs} from './discovery.mjs';
import {wakeTargets} from './wake.mjs';
import {CastManager} from './cast.mjs';
import {MovieCatalog} from './catalog.mjs';
import {WatchLibrary} from './watch-library.mjs';
import {SubtitleStore,SubtitleService} from './subtitles.mjs';
import {UpdatePush} from './push.mjs';
import {PlaybackJournal} from './playback-journal.mjs';
import { SamsungTV } from './tv.mjs';
import { RemoteError, profile, shortcut } from './protocol.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export class Store {
  constructor(directory) {
    this.directory = directory; fs.mkdirSync(directory,{recursive:true,mode:0o700});
    this.file = path.join(directory,'settings.json');
    try {
      this.data = JSON.parse(fs.readFileSync(this.file,'utf8'));
      if (this.data.version !== 1 || !/^[a-f0-9]{64}$/.test(this.data.accessKey)) throw new Error('Invalid saved settings.');
      if (this.data.autoReconnect !== undefined && typeof this.data.autoReconnect !== 'boolean') throw new Error('Invalid reconnect setting.');
      if (this.data.profile) this.data.profile = profile(this.data.profile);
      if (!Array.isArray(this.data.shortcuts) || this.data.shortcuts.length > 40) throw new Error('Invalid saved shortcuts.');
      this.data.shortcuts = this.data.shortcuts.map(shortcut);
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Cannot read helper settings. Back up and check '+this.file+'. '+error.message);
      this.data = {version:1,accessKey:randomBytes(32).toString('hex'),profile:null,pairing:null,shortcuts:[]};
      this.update({});
    }
  }
  update(patch) {
    const next = {...this.data,...patch};
    const temporary = this.file+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify(next,null,2),{mode:0o600});
    fs.renameSync(temporary,this.file);
    this.data = next;
  }
}
function safeEqual(left,right) {
  const a=Buffer.from(left),b=Buffer.from(right); return a.length === b.length && timingSafeEqual(a,b);
}
async function body(request,limit=16384) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new RemoteError('Use JSON for this request.',415);
  let length = 0; const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new RemoteError('The request is too large.',413);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try { const data=JSON.parse(text); if(!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
  catch { throw new RemoteError('The request must contain a JSON object.'); }
}
const contentTypes = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'};
export function createHelper({store,tv = new SamsungTV(store),port = 48765,addresses = networkAddresses(),addressProvider=networkAddresses, discover = discoverTVs,cast=null,catalog=null,library=null,subtitles=null,push=null,tlsOptions=null,secureConfig=null,onShutdown=null,isReady=()=>true} = {}) {
  const hosts = new Set(['localhost','127.0.0.1',...addresses].map(host => host+':'+port));
  const rates = new Map();
  let discoveryJob=null,discoveryAt=0;
  const send = (res,status,value) => {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify(value));
  };
  const state = () => ({notifications:push?{version:1}:null,subtitles:subtitles?.status()||null,installation:{secure:Boolean(tlsOptions),httpsPort:secureConfig?.port||null},profile:store.data.profile,shortcuts:store.data.shortcuts,paired:Boolean(store.data.pairing),autoReconnect:store.data.autoReconnect !== false,cast:cast?.snapshot()||{state:'idle'},catalog:catalog?{version:3}:null,library:library?.status()||null,...tv.snapshot()});
  const protocol=tlsOptions?'https:':'http:';
  const handler=async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const host = req.headers.host;
      // Wi-Fi/DHCP can finish after startup. Accept newly assigned private
      // interface addresses without accepting arbitrary Host names or ports.
      // HTTPS additions must also be covered by this helper's certificate.
      if (!hosts.has(host)&&!addressProvider().some(address=>host===address+':'+port&&(!tlsOptions||secureConfig?.addresses?.includes(address)))) throw new RemoteError('Use the local address shown by the helper.',403);
      if (req.headers.origin && req.headers.origin !== protocol+'//'+host) throw new RemoteError('Requests from another website are not allowed.',403);
      if (req.headers['sec-fetch-site'] === 'cross-site' && req.url?.startsWith('/api/')) throw new RemoteError('Open the remote directly from its private link.',403);
      const url = new URL(req.url,protocol+'//'+host);
      if(url.pathname==='/connect/'||url.pathname==='/connect'){
        // The QR embeds the private remote key. Serve it only to this PC via
        // loopback, never through a LAN Host, proxy Host or remote socket.
        if(tlsOptions||!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress)||!['127.0.0.1:'+port,'localhost:'+port].includes(host))throw new RemoteError('Not found.',404);
        if(req.method!=='GET'&&req.method!=='HEAD')throw new RemoteError('Open this page in your PC browser.',405);
        if(req.headers['sec-fetch-site']==='cross-site'&&(req.headers['sec-fetch-mode']!=='navigate'||req.headers['sec-fetch-dest']!=='document'))throw new RemoteError('Open this page directly in your PC browser.',403);
        const nonce=randomBytes(18).toString('base64');
        res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; img-src data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; connect-src 'none'");
        res.setHeader('Cross-Origin-Opener-Policy','same-origin');
        res.setHeader('Content-Type','text/html; charset=utf-8');
        if(req.method==='HEAD'){res.writeHead(200).end();return;}
        const current=addressProvider();if(store.data.profile){const preferred=wakeTargets(store.data.profile.address).map(t=>t.local);current.sort((a,b)=>(preferred.includes(b)?1:0)-(preferred.includes(a)?1:0));}
        const {html}=await buildConnectionPage({addresses:current,port,accessKey:store.data.accessKey,secure:secureConfig});
        res.writeHead(200);res.end(html.replace('<style>','<style nonce="'+nonce+'">').replace('<script>','<script nonce="'+nonce+'">'));return;
      }
      if(url.pathname.startsWith('/media/')){if(cast)return await cast.handle(req,res,url);throw new RemoteError('Not found.',404);}
      if (url.pathname.startsWith('/api/')) {
        const supplied = req.headers.authorization ?? '';
        if (!safeEqual(supplied,'Bearer '+store.data.accessKey)) throw new RemoteError('Open the private link shown on your PC to unlock this remote.',401);
        if (req.method === 'GET' && url.pathname === '/api/state') return isReady()?send(res,200,{...state(),installation:{secure:Boolean(tlsOptions),httpsPort:secureConfig?.port||null}}):send(res,503,{error:'The helper is finishing startup. Try again in a moment.'});
        if(req.method==='GET'&&url.pathname==='/api/push/config'){if(!push)throw new RemoteError('Restart the PC helper after watching to enable update notifications.',503);return send(res,200,push.config());}
        if(req.method==='GET'&&url.pathname==='/api/library'){if(!library)throw new RemoteError('Restart the PC helper to enable viewing history.',503);for(const e of library.entries.values())catalog?.remember?.(e.media);return send(res,200,library.snapshot());}
        if (req.method !== 'POST') throw new RemoteError('This request method is not supported.',405);
        const now=Date.now(), address=req.socket.remoteAddress;
        let rate=rates.get(address);
        if (!rate || now-rate.start > 1000) {
          rate={start:now,count:0}; rates.set(address,rate);
          if (rates.size > 512) for(const [key,val] of rates) if(now-val.start>1000) rates.delete(key);
        }
        if (++rate.count>25) throw new RemoteError('Too many requests. Wait a moment.',429);
        const input = await body(req,url.pathname==='/api/subtitles/import'?4100000:16384);
        const playbackActor=/iPhone|iPad|Android|Mobile/i.test(req.headers['user-agent']||'')?'phone':/^(?:node|undici)/i.test(req.headers['user-agent']||'')?'pc-client':'browser';
        if(url.pathname.startsWith('/api/push/')){
          if(!push)throw new RemoteError('Restart the PC helper after watching to enable update notifications.',503);
          if(!tlsOptions&&!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress))throw new RemoteError('Open the secure app address to manage notifications.',403);
          const origin=protocol+'//'+host;
          if(url.pathname==='/api/push/subscribe')return send(res,200,push.subscribe(input.subscription,origin));
          if(url.pathname==='/api/push/unsubscribe')return send(res,200,push.remove(input.id,origin));
          if(url.pathname==='/api/push/test')return send(res,200,await push.test(input.id,origin));
          throw new RemoteError('This notification action does not exist.',404);
        }
        switch(url.pathname) {
          case '/api/subtitles/settings':
            if(!subtitles)throw new RemoteError('Subtitle tools need a PC helper update after watching.',503);
            if(input.key&&!tlsOptions&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))throw new RemoteError('Open the secure app address or use this PC to save your API key.',403);
            if(input.key!==undefined||input.removeKey!==undefined||input.language!==undefined)return send(res,200,subtitles.configure(input));
            return send(res,200,subtitles.status());
          case '/api/subtitles/search':
            if(!subtitles||!cast)throw new RemoteError('Subtitle tools need a PC helper update after watching.',503);
            cast.requireSession(input.id);return send(res,200,await subtitles.search(cast.watch,input.id,input.language));
          case '/api/subtitles/download':{
            if(!subtitles||!cast)throw new RemoteError('Subtitle search is unavailable.',503);cast.requireSession(input.id);
            const track=await subtitles.download(input.result,input.id);const added=cast.addSubtitle(input.id,track);return send(res,200,{...state(),added});}
          case '/api/subtitles/import':
            if(!cast)throw new RemoteError('Subtitle tools are unavailable.',503);cast.requireSession(input.id);
            if(typeof input.name!=='string'||! /\.(srt|vtt)$/i.test(input.name))throw new RemoteError('Choose an SRT or VTT subtitle file.');
            {const added=cast.addSubtitle(input.id,{text:input.text,label:input.name,origin:'import'});return send(res,200,{...state(),added});}
          case '/api/library/manage':
            if(!library)throw new RemoteError('Viewing history is unavailable.',503);return send(res,200,library.manage(input));
          case '/api/catalog/browse':
            if(!catalog)throw new RemoteError('Discovery is unavailable.',503);return send(res,200,await catalog.browse({source:input.source,type:input.type,history:library?[...library.entries.values()]:[]}));
          case '/api/catalog/search':
            if(!catalog)throw new RemoteError('Restart the PC helper to enable movie search.',503);
            return send(res,200,await catalog.search(input.query,{source:input.source,type:input.type}));
          case '/api/catalog/details':
            if(!catalog)throw new RemoteError('Movie details are unavailable.',503);
            return send(res,200,await catalog.details(input.id,{source:input.source,type:input.type}));
          case '/api/catalog/episodes':
            if(!catalog)throw new RemoteError('Episodes are unavailable.',503);
            return send(res,200,await catalog.episodes(input.id,input.season,{source:input.source,type:input.type}));
          case '/api/catalog/poster':
            if(!catalog)throw new RemoteError('Posters are unavailable.',503);
            if(library&&catalog.items&&!catalog.items.has((input.source||'cinejoy')+'-'+(input.type||'movie')+'-'+input.id)){const saved=[...library.entries.values()].find(e=>e.media.id===input.id&&e.media.source===(input.source||'cinejoy')&&e.media.type===(input.type||'movie'));if(saved)catalog.remember(saved.media);}
            return send(res,200,await catalog.poster(input.id,input.size||'small',{source:input.source,type:input.type}));
          case '/api/cast/start':
            if(!cast)throw new RemoteError('Restart the PC helper to enable playback.',503);
            if(tv.snapshot().state!=='connected')throw new RemoteError('Connect to your TV before playing a movie.');
            {
              let start=input;
              if(input.libraryKey!==undefined){if(!library)throw new RemoteError('Viewing history is unavailable.',503);const entry=library.get(input.libraryKey);start={url:entry.media.page,quality:entry.quality,media:entry.media,restart:input.restart===true};}
              if(start.media&&catalog){const cached=catalog.items?.get((start.media.source||'cinejoy')+'-'+start.media.type+'-'+start.media.id);if(cached)start={...start,media:{...start.media,title:cached.title,year:cached.year,synopsis:cached.synopsis,genres:cached.genres,rating:cached.rating,posterURL:cached.posterURL}};}
              cast.start(start,{actor:playbackActor});break;
            }
          case '/api/cast/control':
            if(!cast)throw new RemoteError('Playback is unavailable.',503);
            await cast.control(input,{actor:playbackActor});break;
          case '/api/discover': {
            if(!discoveryJob || Date.now()-discoveryAt>10000){
              discoveryAt=Date.now();
              discoveryJob=discover({addresses,savedAddress:store.data.profile?.address}).then(devices=>({devices})).catch(error=>{discoveryJob=null;throw error;});
            }
            return send(res,200,await discoveryJob);
          }
          case '/api/profile': {
            const next=profile(input);
            const changed=store.data.profile?.address!==next.address;
            if(changed)await cast?.close();
            store.update({profile:next,...(changed?{pairing:null,shortcuts:[]}:{})});
            tv.disconnect();
            if(input.connect === true) tv.connect();
            break;
          }
          case '/api/shutdown':
            if (!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress)) throw new RemoteError('Stop the helper from your PC.',403);
            tv.disconnect(); setImmediate(() => onShutdown?onShutdown():server.close()); break;
          case '/api/preferences':
            if (typeof input.autoReconnect !== 'boolean') throw new RemoteError('Choose whether to reconnect automatically.');
            store.update({autoReconnect:input.autoReconnect}); tv.configureReconnect(input.autoReconnect); break;
          case '/api/connect': tv.connect(); break;
          case '/api/disconnect': tv.disconnect(); break;
          case '/api/forget':
            if(input.confirm !== true) throw new RemoteError('Confirm forgetting the TV pairing.');
            await cast?.close();store.update({pairing:null}); tv.disconnect('Pairing forgotten. Connect again and approve on the TV.'); break;
          case '/api/key':
            if(input.key === 'KEY_POWEROFF' && input.confirm !== true) throw new RemoteError('Confirm turning off the TV.');
            if(input.key==='KEY_POWEROFF')await cast?.close();
            await tv.key(input.key); break;
          case '/api/text': await tv.text(input.text); break;
          case '/api/apps': await tv.fetchApps(); break;
          case '/api/launch': { const launchResult=await tv.launch(input); return send(res,200,{...state(),launchResult}); }
          case '/api/wake': await tv.wake(); break;
          case '/api/shortcuts': {
            if(!Array.isArray(input.shortcuts) || input.shortcuts.length>40) throw new RemoteError('Save no more than 40 shortcuts.');
            const shortcuts=input.shortcuts.map(shortcut);
            if(new Set(shortcuts.map(a=>a.appID)).size!==shortcuts.length) throw new RemoteError('Each app ID must be unique.');
            store.update({shortcuts}); break;
          }
          default: throw new RemoteError('This action does not exist.',404);
        }
        return send(res,200,state());
      }
      if(req.method !== 'GET' && req.method !== 'HEAD') throw new RemoteError('This request method is not supported.',405);
      if(secureConfig&&['/setup/','/setup/root.cer','/setup/iphone.mobileconfig'].includes(url.pathname)){
        if(url.pathname.endsWith('.mobileconfig')){
          res.writeHead(200,{'Content-Type':'application/x-apple-aspen-config','Content-Disposition':'attachment; filename="TV-Remote.mobileconfig"'});
          res.end(req.method==='HEAD'?undefined:appleCertificateProfile(secureConfig));
        }else if(url.pathname.endsWith('.cer')){
          res.writeHead(200,{'Content-Type':'application/x-x509-ca-cert','Content-Disposition':'attachment; filename="TV-Remote-CA.cer"'});
          res.end(req.method==='HEAD'?undefined:secureConfig.certificate);
        }else{
          const nonce=randomBytes(18).toString('base64');
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; img-src data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; connect-src 'none'"});
          const page=phoneSetupPage(secureConfig,url.hostname,{checked:Boolean(tlsOptions)&&url.searchParams.get('check')==='1'});
          res.end(req.method==='HEAD'?undefined:page.replace('<style>','<style nonce="'+nonce+'">').replace('<script>','<script nonce="'+nonce+'">'));
        }
        return;
      }
      const name=url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if(!/^[a-zA-Z0-9._/-]+$/.test(name) || name.split('/').some(p=>p==='..' || p.startsWith('.'))) throw new RemoteError('Not found.',404);
      const file=path.join(here,'public',name);
      let bytes; try { bytes=fs.readFileSync(file); } catch { throw new RemoteError('Not found.',404); }
      res.writeHead(200,{'Content-Type':contentTypes[path.extname(file)]??'application/octet-stream'});
      res.end(req.method === 'HEAD'?undefined:bytes);
    } catch(error) {
      if (!res.headersSent) send(res,error instanceof RemoteError?error.status:500,{error:error instanceof RemoteError?error.message:'The helper could not complete this action. Check the PC and try again.'});
      else res.end();
      if(!(error instanceof RemoteError)) console.error('Helper action failed:',error.code ?? error.name);
    }
  };
  const server=tlsOptions?https.createServer(tlsOptions,handler):http.createServer(handler);
  server.requestTimeout=10000; server.headersTimeout=10000;
  return {server,tv,hosts,state,cast,library};
}
export async function start() {
  const directory=process.env.SWITKOBO_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'.local','share'),'SwitkoboRemote');
  const port=Number(process.env.PORT || 48765);
  if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('PORT must be between 1024 and 65535.');
  const store=new Store(directory),addresses=networkAddresses(),secure=loadHTTPS(directory);
  if(store.data.profile){
    const preferred=wakeTargets(store.data.profile.address).map(target=>target.local);
    addresses.sort((a,b)=>(preferred.includes(b)?1:0)-(preferred.includes(a)?1:0));
  }
  if(secure){
    secure.port=Number(process.env.HTTPS_PORT||port+1);
    if(!Number.isInteger(secure.port)||secure.port<1024||secure.port>65535||secure.port===port)throw new Error('Choose a distinct valid HTTPS_PORT.');
  }
  const catalog=new MovieCatalog(),library=new WatchLibrary(directory),subtitleStore=new SubtitleStore(directory,{envFile:path.join(here,'.env')}),subtitles=new SubtitleService(subtitleStore);
  let push=null;try{push=new UpdatePush(directory);}catch{console.warn('Update notifications are unavailable. Check notifications.json in the private helper data folder.');}
  const cast=new CastManager({store,port,addresses,library,subtitleStore,journal:new PlaybackJournal(directory),mediaKey:key=>helper.tv.key(key)});
  const servers=[];let ready=false,networkTimer=null,closing=false;
  const shutdown=()=>{closing=true;ready=false;clearInterval(networkTimer);push?.close();void cast.close();void catalog.close();helper.tv.disconnect();for(const server of servers)server.close();};
  const helper=createHelper({store,port,addresses,cast,catalog,library,subtitles,push,secureConfig:secure,onShutdown:shutdown,isReady:()=>ready});
  servers.push(helper.server);
  if(secure){
    const secureHelper=createHelper({store,tv:helper.tv,cast,catalog,port:secure.port,addresses:addresses.filter(a=>secure.addresses.includes(a)),library,subtitles,push,tlsOptions:secure.tlsOptions,secureConfig:secure,onShutdown:shutdown,isReady:()=>ready});
    servers.push(secureHelper.server);
  }
  try{
    await Promise.all(servers.map((server,i)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(i?secure.port:port,'0.0.0.0',resolve);})));
    const visibleDirectory=process.env.SWITKOBO_DATA_DIR?null:path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.local','share'),'TVRemote');
    let signature='',updating=false,reportedPageError=false;
    const refreshConnection=async(force=false)=>{
      if(closing||updating)return;updating=true;
      try{const current=networkAddresses();if(store.data.profile){const preferred=wakeTargets(store.data.profile.address).map(t=>t.local);current.sort((a,b)=>(preferred.includes(b)?1:0)-(preferred.includes(a)?1:0));}
        const next=JSON.stringify(current);if(!force&&next===signature)return;
        // CastManager shares this array; late Wi-Fi must also become usable for video.
        addresses.splice(0,addresses.length,...current);
        await writeConnectionPage({directory,visibleDirectory,addresses,port,accessKey:store.data.accessKey,secure});signature=next;reportedPageError=false;
      }finally{updating=false;}
    };
    await refreshConnection(true);
    networkTimer=setInterval(()=>{void refreshConnection().catch(()=>{if(!reportedPageError){console.warn('Could not refresh the private connection page. Run Start Remote to retry.');reportedPageError=true;}});},5000);networkTimer.unref();
    ready=true;helper.tv.resume();push?.start();
  }catch(error){closing=true;clearInterval(networkTimer);for(const server of servers)server.close();helper.tv.disconnect();throw error;}
  console.log('TV Remote is running on port '+port+(secure?' and HTTPS '+secure.port:'')+'.');
  console.log('Open this private launcher: '+path.join(directory,'Open Remote.html'));
  console.log('Keep this PC awake. Press Ctrl+C to stop.');
  const close=()=>{shutdown();setTimeout(()=>process.exit(0),1000).unref();};
  process.on('SIGINT',close);process.on('SIGTERM',close);
  return helper;

}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) start().catch(error=>{console.error(error.code==='EADDRINUSE'?'The helper is already running, or port 48765 is in use.':error.message);process.exitCode=1;});
