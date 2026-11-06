import {gunzipSync} from 'node:zlib';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {RemoteError} from './protocol.mjs';

export function movieURL(value){
 let url;try{url=new URL(typeof value==='string'?value.trim():'');}catch{throw new RemoteError('Paste a complete HTTPS video page or video link.');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.href.length>4096||url.hostname.startsWith('[')||!url.hostname.includes('.')||/\.(local|localhost|lan|internal)$/i.test(url.hostname)||(isIP(url.hostname)&&!publicIP(url.hostname)))throw new RemoteError('Use a public HTTPS video link. Local addresses and sign-in credentials are not accepted.');
 if(['movy.sx','www.movy.sx'].includes(url.hostname)){
  if(!/^\/(?:movie\/[1-9]\d{0,9}|tv\/[1-9]\d{0,9}\/\d{1,3}\/[1-9]\d{0,3})\/?$/.test(url.pathname))throw new RemoteError('Open a movie or choose an episode on Movy and copy its page link.');
  return 'https://www.movy.sx'+url.pathname.replace(/\/$/,'')+'?play=true';
 }
 if(['cinejoy.pk','www.cinejoy.pk'].includes(url.hostname)&&!/^\/(?:movie\/[1-9]\d*(?:-[^/]*)?|watch\/(?:movie\/[1-9]\d*|tv\/[1-9]\d*\/\d{1,3}\/[1-9]\d*))\/?$/.test(url.pathname))throw new RemoteError('Open a movie or episode on Cinejoy and copy that page link, rather than its home page.');
 if(['cinejoy.pk','www.cinejoy.pk'].includes(url.hostname)){const movie=url.pathname.match(/^\/movie\/([1-9]\d*)/);if(movie)return 'https://cinejoy.pk/watch/movie/'+movie[1];}
 if(url.hostname==='aether.st'&&!/^\/media\/tmdb-(?:movie-[1-9]\d{0,9}(?:-[^/]+)?|tv-[1-9]\d{0,9}(?:-[^/]+)?\/[1-9]\d{0,9}\/[1-9]\d{0,9})\/?$/.test(url.pathname))throw new RemoteError('Open a movie or choose an episode on Aether and copy its page link.');
 url.hash='';return url.href;
}
export function publicIP(ip){
  if(isIP(ip)===6)return /^[23][a-f0-9]{3}:/i.test(ip)&&!/^2001:(0{1,4}:|0?db8:)/i.test(ip)&&!/^2002:/i.test(ip);
  if(isIP(ip)!==4)return false;
  const [a,b]=ip.split('.').map(Number);
  return a>0&&a<224&&a!==10&&a!==127&&!(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&[0,168].includes(b))&&!(a===198&&[18,19,51].includes(b))&&!(a===203&&b===0);
}
export function publicGuard(resolve=lookup){
  const cache=new Map();
  return async value=>{
    if(typeof value!=='string'||value.length>8192)return false;
    let u;try{u=new URL(value);}catch{return false;}
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.hostname.length>253)return false;
    if(isIP(u.hostname))return publicIP(u.hostname);
    if(!u.hostname.includes('.')||/\.(localhost|local|internal|lan)$/i.test(u.hostname))return false;
    let job=cache.get(u.hostname);
    if(!job){if(cache.size>=128)return false;job=resolve(u.hostname,{all:true}).then(rs=>rs.length>0&&rs.every(r=>publicIP(r.address))).catch(()=>false);cache.set(u.hostname,job);}
    return job;
  };
}
export {parsePlaylist} from './cast-playlist.mjs';
import {parsePlaylist,parseMaster,mediaAddress} from './cast-playlist.mjs';
import {inspectManifests} from './cast-discovery.mjs';
export function vttToSrt(text,offset=0,delay=0){
  if(typeof text!=='string'||text.length>2000000)throw new RemoteError('The subtitle file is too large.');
  const stamp=s=>s.split(':').reduce((n,v)=>n*60+Number(v.replace(',','.')),0);
  const format=t=>{const ms=Math.round(Math.max(0,t)*1000),h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;return [h,m,s].map(x=>String(x).padStart(2,'0')).join(':')+','+String(ms%1000).padStart(3,'0');};
  const cues=[];
  for(const block of text.replaceAll('\r','').split(/\n\s*\n/)){
    const lines=block.split('\n'),i=lines.findIndex(x=>x.includes('-->'));if(i<0)continue;
    const match=lines[i].match(/^((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3})/);if(!match)continue;
    const start=stamp(match[1])+delay,end=stamp(match[2])+delay;if(!Number.isFinite(start)||!Number.isFinite(end)||end<=offset||end<=start)continue;
    const body=lines.slice(i+1).join('\n').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>'}[x]));if(!body.trim()||/#xywh=\d+,\d+,\d+,\d+/.test(body))continue;
    cues.push((cues.length+1)+'\n'+format(start-offset)+' --> '+format(end-offset)+'\n'+body.trim());if(cues.length>30000)throw new RemoteError('The subtitle file has too many cues.');
  }
  return cues.join('\n\n')+'\n';
}

// Requests stay in the isolated, normal player session. No copied credentials or security overrides.
export async function browserBytes(frame,url,limit=16000000,timeout=30000){
  let value;
  try{value=await frame.evaluate(async({url,limit,timeout})=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);let size=0,status=null,expected=null;
    try{const r=await fetch(url,{signal:controller.signal});status=r.status;expected=Number(r.headers.get('content-length'))||null;if(!r.ok)throw Error('http');if(expected>limit)throw Error('too-large');
      const reader=r.body.getReader(),chunks=[];
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('too-large');}chunks.push(value);}
      return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(new Blob(chunks));});
    }catch(error){const kind=controller.signal.aborted?'timeout':error.message==='too-large'?'too-large':error.message==='http'?'http':'network';throw Error('Source read details '+JSON.stringify({kind,status,bytesRead:size,expectedBytes:expected}));}
    finally{clearTimeout(timer);}
  },{url,limit,timeout});}
  catch(error){let details;try{details=JSON.parse(error.message.match(/Source read details (\{[^\n]+\})/)[1]);}catch{details={kind:/closed|detached|context.*destroyed/i.test(error.message)?'frame-closed':'network'};}
    const failure=Error(details.kind==='http'?'Source HTTP '+details.status:'Source read '+details.kind);failure.sourceKind=details.kind;failure.sourceStatus=details.kind==='http'?details.status:null;failure.sourceResponseStatus=details.status;failure.sourceBytesRead=details.bytesRead;failure.sourceExpectedBytes=details.expectedBytes;throw failure;
  }
  return Buffer.from(value,'base64');
}
export async function chooseMovieQuality(page,height){
  if(![480,720,1080].includes(height))throw new RemoteError('Choose a supported video quality.');
  await page.getByRole('button',{name:/^Quality/}).click({timeout:1500});
  await page.getByRole('button',{name:new RegExp('^'+height+'p')}).click({timeout:1500});
}
export const renditionMatches=(url,height)=>[480,720,1080].includes(height)&&new RegExp('(?:s|/)'+height+'p(?:[/?&#._-]|$)','i').test(url);
export function subtitleEntries(data){
 const rows=Array.isArray(data)?data:data?.subtitles||data?.data||[];
 if(!Array.isArray(rows))return [];
 return rows.slice(0,300).flatMap(row=>{
  try{const raw=row.url||row.file||row.src||row.SubDownloadLink,u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port||u.href.length>8192)return [];
   const code=String(row.lang||row.srclang||row.ISO639||'').toLowerCase(),label=String(row.label||row.language||row.LanguageName||code||'Subtitles').slice(0,40);
   return [{url:u.href,lang:/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(code)?code:'',label}];
  }catch{return [];}
 }).sort((a,b)=>(/^en(g)?$/.test(a.lang)||/^English/i.test(a.label)?-1:/^en(g)?$/.test(b.lang)||/^English/i.test(b.label)?1:0)).slice(0,20);
}
export class MovieSource{
  constructor({fetchBytes=browserBytes,onSubtitleEvent=()=>{}}={}){this.fetchBytes=fetchBytes;this.onSubtitleEvent=onSubtitleEvent;this.closed=false;this.cache=new Map();this.jobs=new Map();this.size=0;this.subtitles=[];}
  rememberMaster(master){
    this.renditions=new Map();
    for(const height of parseMaster(master.text,master.url).qualities){const choice=parseMaster(master.text,master.url,height);this.renditions.set(height,{video:choice.video.url,audio:choice.audio?.url||null});}
    this.qualities=[...this.renditions.keys()];
  }
  async prepareQuality(height,position){
    const choice=this.renditions?.get(height);
    if(!Number.isInteger(height)||!choice)throw new RemoteError('Choose a quality available for this video.');
    if(this.closed)throw new RemoteError('The video session has ended.',409);
    // A separate timeline keeps the active relay unchanged until handoff. Reads,
    // browser lifetime and bounded caches remain owned by the original source.
    const view=Object.create(this);view.read=this.read.bind(this);view.quality=height;
    const [video,audio]=await Promise.all([this.fetchBytes(this.frame,choice.video,1000000),choice.audio?this.fetchBytes(this.frame,choice.audio,1000000):null]);
    view.playlist=parsePlaylist(video.toString('utf8'),choice.video);
    view.audioPlaylist=audio?parsePlaylist(audio.toString('utf8'),choice.audio):null;
    if(Math.abs(view.playlist.duration-this.playlist.duration)>5||(view.audioPlaylist&&Math.abs(view.audioPlaylist.duration-view.playlist.duration)>5))throw new RemoteError('The video and audio timelines do not match.');
    await view.prepareMedia(position);
    if(this.closed)throw new RemoteError('The video session has ended.',409);
    return view;
  }
  async open(value,{signal,onStage=()=>{},onSubtitles=()=>{},onTiming=()=>{},onDiagnostic=()=>{},onFetch=()=>{},position=0,quality=480}={}){
    this.onDiagnostic=onDiagnostic;this.onFetch=onFetch;const started=performance.now();let phaseStarted=started;
    const timing=phase=>{const now=performance.now();onTiming({phase,ms:Math.round(now-phaseStarted)});phaseStarted=now;};
    const url=movieURL(value);if(!await publicGuard()(url))throw new RemoteError('This address is not a reachable public HTTPS video page.');const {chromium}=await import('playwright');
    if(signal?.aborted)throw new RemoteError('Playback cancelled.');
    const {browserEgress}=await import('./cast-egress.mjs');this.egress=await browserEgress();
    // The Windows headless-shell executable opens a console. Full Chromium's
    // headless mode uses a GUI-subsystem executable without showing a window.
    const options={headless:true,...(process.platform==='win32'?{channel:'chromium'}:{}),proxy:this.egress.proxy,args:['--force-webrtc-ip-handling-policy=disable_non_proxied_udp']};
    try{this.browser=await chromium.launch(options);}catch{try{this.browser=await chromium.launch({...options,channel:'msedge'});}catch{throw new RemoteError('The playback browser is missing. On your PC, run Setup Playback.cmd.');}}
    if(signal?.aborted||this.closed){await this.browser.close();throw new RemoteError('Playback cancelled.');}
    this.context=await this.browser.newContext({acceptDownloads:false,serviceWorkers:'block',viewport:{width:1280,height:720}});
    const allowed=publicGuard();
    await this.context.route('**/*',async route=>{try{await (await allowed(route.request().url())?route.continue():route.abort());}catch{}});
    await this.context.routeWebSocket('**/*',ws=>ws.close());
    this.page=await this.context.newPage();
    this.context.on('page',p=>{if(p!==this.page)p.close().catch(()=>{});});
    const candidates=[];const captions=new Map(),captionJobs=new Set(),playlistReads=new Map();
    const inspect=async candidate=>{
      if(!playlistReads.has(candidate.url)){
        if(playlistReads.size>=16)playlistReads.delete(playlistReads.keys().next().value);
        const read=browserBytes(candidate.frame,candidate.url,1000000).then(bytes=>bytes.toString('utf8')).catch(error=>{playlistReads.delete(candidate.url);throw error;});playlistReads.set(candidate.url,read);
      }
      return {...candidate,text:await playlistReads.get(candidate.url)};
    };
    await this.context.addInitScript(()=>{window.__tvRemoteProtected=false;document.addEventListener('encrypted',()=>{window.__tvRemoteProtected=true;},true);});
    this.page.on('response',r=>{
      try{if(!r.ok())return;const type=r.headers()['content-type']||'',address=r.url();
        if(type.includes('mpegurl')||/\.m3u8(?:\?|$)/i.test(address)){if(candidates.length>=64)candidates.shift();candidates.push({url:address,frame:r.frame()});}
        if(type.includes('json')&&/subtitle|caption|sub\.|opensubtitles/i.test(new URL(address).hostname+new URL(address).pathname)&&Number(r.headers()['content-length']||0)<2000000){
          const job=r.json().then(data=>{for(const item of subtitleEntries(data))if(captions.size<30)captions.set(item.url,{...item,frame:r.frame()});}).catch(()=>{}).finally(()=>captionJobs.delete(job));captionJobs.add(job);
        }
        if((type.includes('text/vtt')||/\.(vtt|srt)(?:\?|$)/i.test(address))&&!/thumb|sprite/i.test(address)&&captions.size<20)captions.set(address,{url:address,frame:r.frame()});
      }catch{}
    });
    signal?.addEventListener('abort',()=>{void this.close();},{once:true});
    timing('browser');onStage('Opening video…');
    await this.page.goto(url,{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
    timing('navigation');
    const isMovy=['movy.sx','www.movy.sx'].includes(new URL(url).hostname);
    const end=Date.now()+75000;let qualityChosen=false,qualityAttempts=0,qualityWaitUntil=0,playClicks=0,lastPlay=0,selected,lastError;
    while(Date.now()<end&&!this.closed){
      for(const frame of this.page.frames()){
        if(await frame.evaluate(()=>Boolean(window.__tvRemoteProtected)||[...document.querySelectorAll('video')].some(v=>v.mediaKeys)).catch(()=>false))throw new RemoteError('This website uses protected video playback, which is not supported.');
        await frame.locator('video').evaluateAll(videos=>videos.forEach(v=>{v.muted=true;void v.play().catch(()=>{});})).catch(()=>{});
      }
      if(playClicks<3&&!candidates.length&&Date.now()-lastPlay>8000){
        const play=this.page.getByRole('button',{name:/^(play|play video|watch now|watch movie)$/i}).first();
        if(await play.isVisible().catch(()=>false)){await play.click({timeout:1500}).catch(()=>{});playClicks++;lastPlay=Date.now();}
      }
      const preferred=isMovy&&candidates.some(x=>renditionMatches(x.url,quality));
      const ordered=isMovy?[...candidates.filter(x=>renditionMatches(x.url,quality)),...candidates]:candidates;
      if(ordered.length){
        // Prefer a master playlist so separate audio and requested quality stay together.
        const unique=[...new Map(ordered.map(c=>[c.url,c])).values()].slice(-10);
        const {master,inspected,error}=await inspectManifests(unique,inspect,{quality,isClosed:()=>this.closed});if(error)lastError=error;
        // A master already lists the requested rendition. Waiting for a site
        // quality-menu request adds eight seconds without improving selection.
        if(!master&&isMovy&&!preferred&&!qualityChosen&&qualityAttempts<3){qualityAttempts++;try{await chooseMovieQuality(this.page,quality);qualityChosen=true;qualityWaitUntil=Date.now()+8000;}catch{}}
        if(!master&&isMovy&&!preferred&&((!qualityChosen&&qualityAttempts<3)||Date.now()<qualityWaitUntil)){await this.page.waitForTimeout(500);continue;}
        try{
          if(master){
            const chosen=parseMaster(master.text,master.url,quality);this.frame=master.frame;
            const [videoBytes,audioBytes]=await Promise.all([browserBytes(this.frame,chosen.video.url,1000000),chosen.audio?browserBytes(this.frame,chosen.audio.url,1000000):null]);
            this.playlist=parsePlaylist(videoBytes.toString('utf8'),chosen.video.url);this.quality=chosen.video.height||quality;
            if(chosen.audio){this.audioPlaylist=parsePlaylist(audioBytes.toString('utf8'),chosen.audio.url);if(Math.abs(this.audioPlaylist.duration-this.playlist.duration)>5)throw new RemoteError('The video and audio timelines do not match.');}
            selected=master;
            this.rememberMaster(master);
          }else{
            const wanted=inspected.findLast(x=>isMovy&&renditionMatches(x.url,quality)&&x.text.includes('#EXTINF:'))||inspected.findLast(x=>x.text.includes('#EXTINF:'));
            if(wanted){this.playlist=parsePlaylist(wanted.text,wanted.url);this.frame=wanted.frame;this.quality=Number(wanted.url.match(/(?:s|\/)(\d{3,4})p/)?.[1])||quality;selected=wanted;this.renditions=new Map(inspected.filter(x=>x.frame===this.frame&&x.text.includes('#EXTINF:')).flatMap(x=>{const h=Number(x.url.match(/(?:s|\/)(\d{3,4})p/)?.[1]);return h>0&&h<=1080?[[h,{video:x.url,audio:null}]]:[];}));this.qualities=[...this.renditions.keys()].sort((a,b)=>a-b);}
          }
          if(this.playlist)break;
        }catch(error){lastError=error;if(error instanceof RemoteError&&/Protected|codec|timelines/.test(error.message))throw error;}
      }
      await this.page.waitForTimeout(500);
    }
    if(this.closed||signal?.aborted)throw new RemoteError('Playback cancelled.');
    if(!this.playlist)throw lastError instanceof RemoteError?lastError:new RemoteError('No supported video was found on this page. Use the page with the video player, or a direct HLS video link. Sites requiring login or protected playback are not supported.');
    timing('source-discovery');
    for(const frame of this.page.frames()){
      await frame.locator('video').evaluateAll(videos=>videos.forEach(v=>{v.pause();for(const t of v.textTracks)t.mode='disabled';})).catch(()=>{});
    }
    const rawTitle=await this.page.title();this.title=rawTitle.replace(/\s*[-|–]\s*(Movy|Cinejoy|Aether|Watch).*$/i,'').replace(/^Watch\s+/i,'').slice(0,120)||'Video';
    const episode=url.match(/\/(?:watch\/)?tv\/\d+\/(\d+)\/(\d+)/);if(episode&&!/\bS\d+\s*[:-]?\s*E\d+/i.test(this.title))this.title+=' · S'+episode[1]+' E'+episode[2];
    onStage('Buffering video…');
    await this.prepareMedia(position);
    timing('initial-buffer');
    // Optional subtitle servers must not delay a movie with subtitles off.
    // A saved source-subtitle selection is awaited explicitly by CastManager.
    this.subtitleStatus='loading';
    const captionStarted=performance.now();
    this.subtitlesReady=this.discoverSubtitles(captions,captionJobs).catch(()=>{if(!this.closed)this.subtitleStatus=this.subtitles.length?'ready':'failed';}).then(()=>{
      if(this.closed)return;onTiming({phase:'source-subtitles',ms:Math.round(performance.now()-captionStarted)});onSubtitles();
    });
    onTiming({phase:'source-open',ms:Math.round(performance.now()-started)});
    return this;
  }
  async prepareMedia(position=0){
    const target=Number.isFinite(position)?Math.max(0,Math.min(position,this.playlist.duration-1)):0;
    const index=Math.max(0,this.playlist.segments.findLastIndex(s=>s.start<=target));
    const [video,audio]=await Promise.all([this.read(this.playlist.init||this.playlist.segments[index].url),this.audioPlaylist?.init?this.read(this.audioPlaylist.init):null]);
    if(this.playlist.init){if(!video.includes(Buffer.from('avc1'))||(!this.audioPlaylist&&!video.includes(Buffer.from('mp4a')))||['encv','enca','pssh'].some(t=>video.includes(Buffer.from(t))))throw new RemoteError('This video uses an unsupported codec or protected format.');}
    else if(video[0]!==0x47||video[188]!==0x47)throw new RemoteError('This video segment format is not supported.');
    if(audio&&(!audio.includes(Buffer.from('mp4a'))||['enca','pssh'].some(t=>audio.includes(Buffer.from(t)))))throw new RemoteError('This audio format is not supported.');
    await this.buffer(index,2);
  }
  async discoverSubtitles(captions,captionJobs){
    if(captionJobs.size)await Promise.race([Promise.allSettled([...captionJobs]),new Promise(resolve=>setTimeout(resolve,2000))]);
    if(this.closed)return;const trackChoices=[];
    // Track elements may appear while the initial media buffer is loading.
    for(const frame of this.page.frames()){
      const tracks=await frame.locator('video track').evaluateAll(ts=>ts.filter(t=>['captions','subtitles'].includes(t.kind)).slice(0,500).map(t=>({url:t.src,label:t.label,lang:t.srclang}))).catch(()=>[]);
      for(const track of tracks)if(track.url.startsWith('https:'))trackChoices.push({...track,frame});
    }
    const names=new Intl.DisplayNames(['en'],{type:'language'}),languages=new Set(),loaded=[];
    const englishTrack=t=>/^en(?:g)?(?:-|$)/i.test(t.lang||'')||/^English(?:\b|$)/i.test(t.label||'');
    trackChoices.sort((a,b)=>Number(englishTrack(b))-Number(englishTrack(a))+(Number(englishTrack(a))===Number(englishTrack(b))?((b.label?.length<30?1:0)-(a.label?.length<30?1:0)):0));
    const captionChoices=[];
    for(const track of trackChoices){const lang=track.lang||'und';if(languages.has(lang)||captionChoices.length>=10)continue;languages.add(lang);captionChoices.push(track);}
    for(const item of captions.values())if(!captionChoices.some(t=>t.url===item.url)&&captionChoices.length<12)captionChoices.push(item);
    this.onSubtitleEvent({stage:'choices',domTracks:trackChoices.length,networkTracks:captions.size,choices:captionChoices.length});
    for(let n=0;n<captionChoices.length;n+=2)await Promise.all(captionChoices.slice(n,n+2).map(async item=>{
      if(this.closed)return;let stage='fetch';try{this.onSubtitleEvent({stage:'attempt',label:item.label||'',lang:item.lang||''});let bytes=await browserBytes(item.frame,item.url,2000000,5000);if(this.closed)return;stage='decode';if(bytes[0]===0x1f&&bytes[1]===0x8b)bytes=gunzipSync(bytes,{maxOutputLength:2000000});const body=bytes.toString('utf8');stage='parse';if(!vttToSrt(body).trim()){this.onSubtitleEvent({stage:'empty'});return;}stage='label';let label=item.label||(item.lang?names.of(item.lang):decodeURIComponent(new URL(item.url).pathname.split('/').at(-1).replace(/\.(vtt|srt)$/i,'')));if(/^eng?$/i.test(label))label='English';loaded.push({id:'',label:String(label||'Subtitles').slice(0,40),text:body});this.onSubtitleEvent({stage:'loaded',label:String(label).slice(0,40),bytes:bytes.length});}catch(error){this.onSubtitleEvent({stage:'failed',at:stage,error:error.name,status:Number(error.message?.match(/Source HTTP (\d+)/)?.[1])||null,timeout:/timeout|timed out|abort/i.test(error.message)});}
    }));
    if(this.closed)return;
    const tracks=loaded.filter((t,i,all)=>all.findIndex(x=>x.label.toLocaleLowerCase()===t.label.toLocaleLowerCase())===i);
    tracks.sort((a,b)=>(a.label==='English'?-1:b.label==='English'?1:a.label.localeCompare(b.label)));tracks.forEach((t,i)=>t.id=String(i));
    this.subtitles=[...tracks,...this.subtitles.filter(t=>t.id.startsWith('ext-'))];
    this.subtitleStatus=this.subtitles.length?'ready':captionChoices.length?'failed':'unavailable';
  }
  async read(url){
    if(this.closed)throw new RemoteError('The video session has ended.');
    if(this.cache.has(url)){const b=this.cache.get(url);this.cache.delete(url);this.cache.set(url,b);return b;}
    if(this.jobs.has(url))return this.jobs.get(url);
    const started=performance.now();
    const job=this.fetchSegment(url).then(bytes=>{
      if(this.closed)throw new RemoteError('The video session has ended.');
      this.onFetch?.({ms:performance.now()-started,bytes:bytes.length});
      this.cache.set(url,bytes);this.size+=bytes.length;
      for(const [key,b] of this.cache){if(this.size<=48000000)break;this.cache.delete(key);this.size-=b.length;}
      return bytes;
    }).catch(error=>{if(this.closed)throw new RemoteError('The video session has ended.');const failure=new RemoteError('The video stream stopped responding. Stop playback and try the link again.');failure.sourceStatus=error.sourceStatus||Number(error.message?.match(/Source HTTP (\d+)/)?.[1])||null;if(error.sourceKind)this.onDiagnostic?.({event:'source-read-failed',kind:error.sourceKind,status:failure.sourceStatus,responseStatus:error.sourceResponseStatus,bytesRead:error.sourceBytesRead,expectedBytes:error.sourceExpectedBytes});this.onFetch?.({ms:performance.now()-started,status:failure.sourceStatus,failed:true});this.onDiagnostic?.({event:'source-http-failed',status:failure.sourceStatus});throw failure;}).finally(()=>this.jobs.delete(url));
    this.jobs.set(url,job);return job;
  }
  async fetchSegment(url){
    for(let attempt=0;attempt<3;attempt++){
      try{return await this.fetchBytes(this.frame,url);}catch(error){
        const status=Number(error.message?.match(/Source HTTP (\d+)/)?.[1]);
        if(this.closed||['too-large','frame-closed'].includes(error.sourceKind)||attempt===2||(status&&status<500&&![408,429].includes(status)))throw error;
        this.onDiagnostic?.({event:/timeout|abort/i.test(error.message)?'source-timeout':'source-retry',status});
        this.onFetch?.({retry:true});
        await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));
        if(this.closed)throw error;
      }
    }
  }
  async bufferTrack(playlist,index,count){
    const items=playlist.segments.slice(index,index+count);
    for(let n=0;n<items.length;n+=2)await Promise.all(items.slice(n,n+2).map(s=>this.read(s.url)));
  }
  async buffer(index,count=4){
    const jobs=[this.bufferTrack(this.playlist,index,count)];
    if(this.audioPlaylist){const start=this.playlist.segments[Math.min(index,this.playlist.segments.length-1)]?.start||0;const audioIndex=Math.max(0,this.audioPlaylist.segments.findLastIndex(s=>s.start<=start));jobs.push(this.bufferTrack(this.audioPlaylist,audioIndex,count));}
    await Promise.all(jobs);
  }
  async *trackStream(playlist,index){
    if(playlist.init)yield await this.read(playlist.init);
    for(let i=index;i<playlist.segments.length&&!this.closed;i++){
      const bytes=await this.read(playlist.segments[i].url);
      // A slow speculative chunk must not hold up the next already-cached one.
      // read() deduplicates jobs; a required chunk still reports its own failure.
      void this.bufferTrack(playlist,i+1,3).catch(()=>{});
      yield bytes;
    }
  }
  async close(){if(this.closed)return;this.closed=true;this.cache.clear();this.size=0;this.egress?.close();await this.browser?.close().catch(()=>{});}
}
