import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {randomBytes,createHash} from 'node:crypto';
import {createMediaRelay} from './cast-relay.mjs';
import {MovieSource,movieURL,vttToSrt} from './cast-source.mjs';
import {localAddress,RemoteError} from './protocol.mjs';
import {wakeTargets} from './wake.mjs';
import {watchMedia} from './watch-library.mjs';
import {subtitleDelay} from './subtitles.mjs';
import {PlaybackTrace} from './cast-diagnostics.mjs';

export const xmlEscape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const unescape=value=>value.replace(/&(?:amp|lt|gt|quot|apos);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[x]));
export const xmlValue=(xml,name)=>unescape(xml.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([^<]*)</'+name+'>'))?.[1]||'');
export function seconds(value){if(typeof value!=='string'||!/^\d{1,3}:\d{2}:\d{2}(\.\d+)?$/.test(value))return null;return value.split(':').reduce((n,v)=>n*60+Number(v),0);}
export const timeText=value=>{const s=Math.max(0,Math.floor(value));return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');};

export class TVPlayer{
  constructor(address,{fetcher=fetch}={}){this.address=localAddress(address);this.fetcher=fetcher;}
  async soap(action,args={}){
    const service='urn:schemas-upnp-org:service:AVTransport:1';
    let response;try{response=await this.fetcher('http://'+this.address+':9197/upnp/control/AVTransport1',{method:'POST',redirect:'error',signal:AbortSignal.timeout(6000),headers:{'Content-Type':'text/xml; charset="utf-8"',SOAPAction:'"'+service+'#'+action+'"'},body:'<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:'+action+' xmlns:u="'+service+'"><InstanceID>0</InstanceID>'+Object.entries(args).map(([key,value])=>'<'+key+'>'+xmlEscape(value)+'</'+key+'>').join('')+'</u:'+action+'></s:Body></s:Envelope>'});}catch{throw new RemoteError('Cannot reach the TV player. Turn the TV on and try again.');}
    const reader=response.body.getReader();const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw new RemoteError('The TV player returned an invalid response.');}chunks.push(value);}
    const text=Buffer.concat(chunks).toString();
    if(!response.ok||text.includes('<s:Fault>')||text.includes('<errorCode>')){const error=new RemoteError('The TV could not '+({Pause:'pause this video',Play:'play this video',Stop:'stop this video',SetAVTransportURI:'open this video'}[action]||'complete this playback action')+'. Try again.');error.tvCode=xmlValue(text,'errorCode');error.tvAction=action;throw error;}
    return text;
  }
  async load({uri,title,duration,caption,previousURI,isCurrent=()=>true,onReady=()=>{}}){
    const check=()=>{if(!isCurrent())throw new RemoteError('This playback session has ended.',409);};
    check();const current=await this.status();check();
    if(previousURI&&current.uri&&current.uri!==previousURI&&current.uri!==uri)throw new RemoteError('Another video is now open on the TV.');
    if(['PLAYING','PAUSED_PLAYBACK','TRANSITIONING'].includes(current.transport)){
      await this.soap('Stop');check();
      let stopped=false;
      for(let attempt=0;attempt<8;attempt++){
        const state=xmlValue(await this.soap('GetTransportInfo'),'CurrentTransportState');check();
        if(['STOPPED','NO_MEDIA_PRESENT'].includes(state)){stopped=true;break;}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!stopped)throw new RemoteError('The TV is still stopping the previous video. Try again.');
    }

    const metadata='<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:sec="http://www.sec.co.kr/"><item id="movie" parentID="0" restricted="1"><dc:title>'+xmlEscape(title)+'</dc:title><upnp:class>object.item.videoItem</upnp:class><res duration="'+timeText(duration)+'" protocolInfo="http-get:*:video/mpeg:DLNA.ORG_OP=00;DLNA.ORG_CI=1">'+xmlEscape(uri)+'</res>'+(caption?'<sec:CaptionInfoEx sec:type="srt">'+xmlEscape(caption)+'</sec:CaptionInfoEx>':'')+'</item></DIDL-Lite>';
    check();onReady();check();await this.soap('SetAVTransportURI',{CurrentURI:uri,CurrentURIMetaData:metadata});check();
    for(let attempt=0;attempt<8;attempt++){
      check();try{await this.soap('Play',{Speed:1});return;}catch(error){
        check();if(error.tvCode!=='701')throw error;
        const state=await this.status();check();if(state.transport==='PLAYING'&&(!state.uri||state.uri===uri))return;
        if(attempt===7)throw error;await new Promise(resolve=>setTimeout(resolve,250));
      }
    }
  }
  async status(){const t=await this.soap('GetTransportInfo'),p=await this.soap('GetPositionInfo');return {transport:xmlValue(t,'CurrentTransportState'),time:seconds(xmlValue(p,'RelTime')),uri:xmlValue(p,'TrackURI')};}
}
const idle=()=>({id:null,state:'idle',title:'',message:'',position:0,duration:0,subtitles:[],subtitleStatus:'unknown',subtitle:'off',subtitleDelay:0,busy:false,transitionError:''});
async function removeCaptions(directory){
  for(let attempt=0;attempt<6;attempt++){
    try{await fs.unlink(path.join(directory,'captions.srt')).catch(error=>{if(error.code!=='ENOENT')throw error;});await fs.rmdir(directory).catch(error=>{if(error.code!=='ENOENT')throw error;});return;}
    catch{await new Promise(resolve=>setTimeout(resolve,200));}
  }
}
export class CastManager{
  constructor({store,port=48765,addresses=[],sourceFactory=()=>new MovieSource(),playerFactory=address=>new TVPlayer(address),adapter=address=>wakeTargets(address).map(t=>t.local).find(a=>addresses.includes(a)),spawnProcess=spawn,relayFactory=createMediaRelay,mediaKey=null,library=null,subtitleStore=null,journal=null}={}){
    Object.assign(this,{store,port,addresses,sourceFactory,playerFactory,adapter,spawnProcess,relayFactory,mediaKey,library,subtitleStore,journal});this.data=idle();this.connections=new Set();this.generation=0;
  }
  snapshot(){const m=this.watch;return {...this.data,qualities:[...new Set([...(this.source?.qualities||[]),this.data.quality].filter(h=>Number.isInteger(h)&&h>0&&h<=1080))].sort((a,b)=>a-b),diagnostics:this.trace?.snapshot()||null,historyKey:m?.key||null,subtitleMedia:m?{id:m.id,type:m.type,title:m.title||this.data.title,year:m.year,season:m.season,episode:m.episode}:null,subtitles:this.data.subtitles.map(s=>({...s}))};}
  subtitleKey(){return this.watch?.key||'session:'+this.data.id;}
  requireSession(id){if(!this.active()||id!==this.data.id||!this.source)throw new RemoteError('This playback session has ended. Open the current movie again.',409);}
  syncSubtitles(){this.data.subtitles=this.source.subtitles.map(({id,label,origin='source',language='',release=''})=>({id,label,origin,language,release}));}
  addSubtitle(id,input){this.requireSession(id);if(!this.subtitleStore)throw new RemoteError('Subtitle storage is unavailable.',503);const track=this.subtitleStore.add(this.subtitleKey(),input);const saved=this.subtitleStore.get(this.subtitleKey()).tracks;this.source.subtitles=[...this.source.subtitles.filter(t=>!t.id.startsWith('ext-')),...saved];this.syncSubtitles();this.data.subtitleStatus='ready';return {id:track.id,label:track.label};}
  active(){return ['loading','buffering','playing','paused'].includes(this.data.state);}
  start(input,{actor='client'}={}){
    const url=movieURL(input.url),quality=input.quality??480;
    if(![480,720,1080].includes(quality))throw new RemoteError('Choose 480p, 720p or 1080p video quality.');
    if(this.active())throw new RemoteError('Stop the current movie before opening another.',409);
    if(!this.store.data.profile)throw new RemoteError('Connect a TV first.');
    const address=this.store.data.profile.address,local=this.adapter(address);
    if(!local)throw new RemoteError('The PC and TV need to be on the same home network.');
    const media=watchMedia(input.media,url),saved=media?this.library?.entries.get(media.key):null;
    this.watch=media;this.library?.begin(media);this.confirmed=null;this.freshCheckpoint=true;this.lastCheckpoint=0;this.checkpointFingerprint='';
    this.resume=input.restart?null:saved&&!saved.completed?saved:null;
    const id=randomBytes(12).toString('hex'),generation=++this.generation;
    this.trace=new PlaybackTrace();this.transition=null;this.rendition=null;this.abort=new AbortController();this.source=this.sourceFactory();this.player=this.playerFactory(address);this.address=address;this.local=local;
    this.data={...idle(),id,state:'loading',message:'Opening video…',subtitleStatus:'loading',busy:true};
    this.requestedQuality=quality;this.controlRequests=[];this.completedMediaBytes=0;this.lastDiagnosticWrite=0;this.auditControl('start',actor);
    this.job=this.prepare(url,generation,quality).catch(error=>this.fail(error,generation));
  }
  async prepare(url,generation,quality){
    const source=this.source;
    const trace=this.trace;
    await source.open(url,{quality,position:this.resume?.position||0,signal:this.abort.signal,onTiming:e=>trace.sourcePhase(e),onDiagnostic:e=>trace.event(e),onFetch:e=>trace.fetched(e),onStage:message=>{if(generation===this.generation)this.data.message=message;},onSubtitles:()=>{if(generation===this.generation){this.syncSubtitles();this.data.subtitleStatus=source.subtitleStatus;}}});
    if(generation!==this.generation)return;
    const preferences=this.subtitleStore?.get(this.subtitleKey());
    if((preferences?preferences.selected!=='off'&&!preferences.selected.startsWith('ext-'):Boolean(this.resume?.subtitleLabel)))await source.subtitlesReady;
    if(generation!==this.generation)return;
    if(preferences)source.subtitles.push(...preferences.tracks.filter(t=>!source.subtitles.some(s=>s.id===t.id)));
    Object.assign(this.data,{title:source.title,quality:source.quality||quality,duration:source.playlist.duration,subtitleStatus:source.subtitles.length?'ready':source.subtitleStatus||'unavailable'});this.syncSubtitles();
    const position=this.resume?Math.min(this.resume.position,Math.max(0,this.data.duration-1)):0,track=this.resume?.subtitleLabel?source.subtitles.find(s=>s.label.toLowerCase()===this.resume.subtitleLabel.toLowerCase()):null;
    const selected=preferences?(preferences.selected==='off'?'off':source.subtitles.find(t=>preferences.selected.startsWith('ext-')?t.id===preferences.selected:preferences.sourceLabel&&t.label===preferences.sourceLabel)?.id||track?.id||'off'):track?.id||'off';
    await this.loadAt(position,selected,generation,preferences?.delay||0);
    if(generation!==this.generation)return;
    this.data.busy=false;this.startedAt=Date.now();this.timer=setInterval(()=>{void this.refresh(generation);},1500);this.timer.unref?.();
  }
  async loadAt(position,subtitle,generation=this.generation,delay=this.data.subtitleDelay||0,kind='start',source=this.rendition||this.source){
    const trace=this.trace,row=trace?.begin(kind),transitionStarted=performance.now();let phaseStarted=transitionStarted;
    const phase=name=>{const now=performance.now();trace?.phase(row,name,now-phaseStarted);phaseStarted=now;};
    const previousURI=this.uri,previousState=this.data.state,previousPosition=this.data.position;
    const index=Math.max(0,source.playlist.segments.findLastIndex(s=>s.start<=position));
    const offset=source.playlist.segments[index].start,token=randomBytes(24).toString('hex');
    const uri='http://'+this.local+':'+this.port+'/media/'+token+'/video.ts';
    let directory=null,captionText=null,committed=false,relay=null;
    Object.assign(this.data,{state:'buffering',message:'Preparing video…',position:offset,transitionError:''});
    // Keep the active token, encoder and TCP connection alive during all preparation.
    try{
      // Two chunks plus actual converter output are the handoff barrier. Waiting
      // for six made cached short skips depend on distant, uncached chunks.
      await source.buffer(index,2);
      phase('bufferMs');
      if(generation!==this.generation)return;
      const track=source.subtitles.find(s=>s.id===subtitle);captionText=track?vttToSrt(track.text,offset,delay):null;
      if(!captionText?.trim())captionText=null;
      if(captionText){
        directory=await fs.mkdtemp(path.join(os.tmpdir(),'tv-remote-captions-'));
        await fs.writeFile(path.join(directory,'captions.srt'),captionText,{mode:0o600});
      }
      relay=this.relayFactory({source,index,offset,subtitleDirectory:directory,spawnProcess:this.spawnProcess,onDiagnostic:e=>trace?.event(e)});this.preparingRelay=relay;
      await relay.ready;
      phase('converterMs');
      if(generation!==this.generation){relay.close();return;}
      if(relay.closed)throw new RemoteError('The replacement converter stopped before the video was ready.');
    }catch(error){
      relay?.close();if(this.preparingRelay===relay)this.preparingRelay=null;
      if(directory){await removeCaptions(directory);directory=null;}
      if(generation===this.generation&&previousURI){
        Object.assign(this.data,{state:previousState,position:previousPosition,message:'',transitionError:'Could not prepare that change. Your current video was kept '+(previousState==='paused'?'paused.':'playing.')+' Try again.'});
        error.preservePlayback=true;
      }
      throw error;
    }
    try{
      if(generation!==this.generation)return;
      await this.player.load({uri,title:this.data.title,duration:this.data.duration-offset,caption:null,previousURI,isCurrent:()=>generation===this.generation,onReady:()=>{
        if(generation!==this.generation)throw new RemoteError('This playback session has ended.',409);
        if(relay.closed)throw new RemoteError('The replacement converter stopped before the video was ready.');
        // TVPlayer invokes this only after the receiver has confirmed STOPPED.
        this.stopStreams();
        Object.assign(this,{token,index,offset,uri,captionText,subtitleDirectory:directory,warmRelay:relay,rendition:source});Object.assign(this.data,{quality:source.quality||this.data.quality,duration:source.playlist.duration});if(kind==='quality')this.requestedQuality=source.quality;if(this.preparingRelay===relay)this.preparingRelay=null;committed=true;
      }});
      if(generation!==this.generation)return;
      phase('handoffMs');this.transition={row,started:transitionStarted,trace};
      this.data.subtitle=subtitle;this.data.subtitleDelay=delay;this.startedAt=Date.now();this.data.message='Waiting for the TV player…';
      if(this.subtitleStore)try{this.subtitleStore.select(this.subtitleKey(),subtitle,delay,this.source.subtitles.find(t=>t.id===subtitle)?.label||'');this.data.subtitleWarning='';}catch{this.data.subtitleWarning='Subtitles were applied, but the choice could not be saved for next time.';}
    }finally{
      if(!committed)relay?.close();if(this.preparingRelay===relay)this.preparingRelay=null;
      if(!committed&&directory)await removeCaptions(directory);
    }
  }
  async playback(action,generation=this.generation){
    const player=this.player,expected=action==='pause'?'PAUSED_PLAYBACK':'PLAYING';
    if(this.mediaKey)await this.mediaKey(action==='pause'?'KEY_PAUSE':'KEY_PLAY');
    else await player.soap(action==='pause'?'Pause':'Play',action==='play'?{Speed:1}:{});
    for(let attempt=0;attempt<5;attempt++){
      if(generation!==this.generation)throw new RemoteError('This playback session has ended.',409);
      const result=await player.status();
      if(generation!==this.generation)throw new RemoteError('This playback session has ended.',409);
      if(result.transport===expected)return result;
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    throw new RemoteError('The TV has not confirmed this action. Try again.');
  }
  async refresh(generation=this.generation){
    if(this.refreshing||this.data.busy||generation!==this.generation||!this.active())return;
    this.refreshing=true;
    try{
      const result=await this.player.status();if(generation!==this.generation||this.data.busy)return;
      if(result.uri&&result.uri!==this.uri){await this.finish('stopped','Playback ended on the TV.',false);return;}
      if(result.transport==='PLAYING'&&this.pauseAfterLoad){this.pauseAfterLoad=false;const paused=await this.playback('pause',generation);if(generation===this.generation){this.data.state='paused';if(paused.time!==null)this.data.position=this.offset+paused.time;this.observeProgress(true);}return;}
      if(result.transport==='PLAYING'||result.transport==='PAUSED_PLAYBACK'){
        if(this.transition){const t=this.transition;t.trace?.phase(t.row,'confirmedMs',performance.now()-t.started);this.transition=null;}
        this.data.state=result.transport==='PLAYING'?'playing':'paused';this.data.message='';
        if(result.time!==null)this.data.position=Math.min(this.data.duration,this.offset+result.time);
        this.lastHealthy=Date.now();this.observeProgress();this.recordDiagnostics('status');
      }else if(result.transport==='STOPPED'&&this.data.state!=='buffering'){
        const ended=this.data.position>=this.data.duration-8;await this.finish(ended?'ended':'error',ended?'Movie finished.':'The TV stopped playback. Try the link again.',false);
      }else if(Date.now()-this.startedAt>45000){throw new RemoteError('The TV did not start this movie. Stop playback and try the link again.');}
    }catch(error){const deadline=this.data.state==='buffering'?45000:15000;if(generation===this.generation&&Date.now()-Math.max(this.lastHealthy||0,this.startedAt)>deadline)await this.fail(error,generation);}
    finally{this.refreshing=false;}
  }
  async control(input,{actor='client'}={}){
    if(typeof input.id!=='string'||input.id!==this.data.id)throw new RemoteError('This playback session has ended. Open Play on TV again.',409);
    if(['stop','pause','play','seek','subtitle','quality'].includes(input.action))this.auditControl(input.action,actor);
    if(input.action==='stop'){await this.finish('stopped','Playback stopped.');return;}
    if(!['pause','play','seek','subtitle','quality'].includes(input.action))throw new RemoteError('Choose a supported playback action.');
    if(this.data.busy||!['playing','paused'].includes(this.data.state))throw new RemoteError('Wait for the movie to be ready.',409);
    const generation=this.generation;let deferred=false;this.data.busy=true;
    try{
      // Refuse to control a different video that was opened with another remote.
      const current=await this.player.status();if(generation!==this.generation)throw new RemoteError('This playback session has ended.',409);if(current.uri&&current.uri!==this.uri)throw new RemoteError('This movie is no longer open on the TV.');
      if(input.action==='quality'){
        if(!Number.isInteger(input.quality)||!this.snapshot().qualities.includes(input.quality))throw new RemoteError('Choose a quality available for this video.');
        if(input.quality===this.data.quality)return;
        if(!this.source.prepareQuality)throw new RemoteError('This source does not offer another video quality.');
        const paused=this.data.state==='paused',previousMessage=this.data.message;
        this.data.message='Preparing '+input.quality+'p video…';this.data.transitionError='';
        deferred=true;this.job=(async()=>{
          let next;
          try{next=await this.source.prepareQuality(input.quality,Number.isFinite(current.time)?this.offset+current.time:this.data.position);}
          catch(error){if(generation===this.generation){this.data.message=previousMessage;this.data.transitionError='Could not load that quality. Your current video was kept '+(paused?'paused.':'playing.')+' Try again.';}error.preservePlayback=true;throw error;}
          if(generation!==this.generation)return;
          const latest=await this.player.status();if(generation!==this.generation)return;if(latest.uri&&latest.uri!==this.uri)throw new RemoteError('This movie is no longer open on the TV.');
          const position=Number.isFinite(latest.time)?this.offset+latest.time:this.data.position;
          await this.loadAt(Math.min(position,Math.max(0,next.playlist.duration-1)),this.data.subtitle,generation,this.data.subtitleDelay||0,'quality',next);
          if(generation===this.generation)this.pauseAfterLoad=paused;
        })().catch(error=>{if(!error.preservePlayback)return this.fail(error,generation);}).finally(()=>{if(generation===this.generation)this.data.busy=false;});return;
      }else if(input.action==='seek'){
        if(typeof input.position!=='number'||!Number.isFinite(input.position)||input.position<0||input.position>this.data.duration)throw new RemoteError('Choose a time within this movie.');
        const paused=this.data.state==='paused';this.job=this.loadAt(Math.min(input.position,Math.max(0,this.data.duration-1)),this.data.subtitle,generation,this.data.subtitleDelay||0,'seek').then(()=>{if(generation===this.generation)this.pauseAfterLoad=paused;}).catch(error=>{if(!error.preservePlayback)return this.fail(error,generation);}).finally(()=>{if(generation===this.generation)this.data.busy=false;});return;
      }else if(input.action==='subtitle'){
        if(input.subtitle!=='off'&&!this.data.subtitles.some(s=>s.id===input.subtitle))throw new RemoteError('Choose an available subtitle track.');
        const delay=input.delay===undefined?(input.subtitle===this.data.subtitle?this.data.subtitleDelay||0:0):subtitleDelay(input.delay);
        const paused=this.data.state==='paused';this.job=this.loadAt(Number.isFinite(current.time)?this.offset+current.time:this.data.position,input.subtitle,generation,delay,'subtitle').then(()=>{if(generation===this.generation)this.pauseAfterLoad=paused;}).catch(error=>{if(!error.preservePlayback)return this.fail(error,generation);}).finally(()=>{if(generation===this.generation)this.data.busy=false;});return;
      }else{
        const result=await this.playback(input.action,generation);if(generation!==this.generation)return;
        const expected=input.action==='pause'?'PAUSED_PLAYBACK':'PLAYING';if(result.transport!==expected)throw new RemoteError('The TV has not confirmed this action. Try again.');
        this.data.state=input.action==='pause'?'paused':'playing';if(result.time!==null)this.data.position=this.offset+result.time;this.observeProgress(true);
      }
    }finally{if(generation===this.generation&&!deferred&&this.data.state!=='buffering')this.data.busy=false;}
  }
  observeProgress(force=false){
    if(!['playing','paused'].includes(this.data.state)||!this.watch)return;
    this.confirmed={...this.data,subtitleLabel:this.data.subtitles.find(s=>s.id===this.data.subtitle)?.label||''};this.saveProgress(force);
  }
  saveProgress(force=false,ended=false){
    if(!this.library||!this.confirmed||(!force&&Date.now()-this.lastCheckpoint<10000))return;
    const fingerprint=[Math.floor(this.confirmed.position),this.confirmed.duration,this.confirmed.subtitleLabel,this.confirmed.quality].join(':');if(!force&&fingerprint===this.checkpointFingerprint)return;this.checkpointFingerprint=fingerprint;
    this.library.record(this.watch,this.confirmed,{fresh:this.freshCheckpoint,ended});this.freshCheckpoint=false;this.lastCheckpoint=Date.now();
  }
  auditControl(action,actor){
    this.controlRequests??=[];this.controlRequests.push({action,actor:['phone','browser','pc-client','client'].includes(actor)?actor:'client',at:new Date().toISOString()});if(this.controlRequests.length>16)this.controlRequests.shift();this.recordDiagnostics('control-request',true);
  }
  recordDiagnostics(cause,force=false,state=this.data.state){
    if(!this.journal||!this.data.id||(!force&&Date.now()-(this.lastDiagnosticWrite||0)<10000))return;
    this.lastDiagnosticWrite=Date.now();
    try{this.journal.record({session:createHash('sha256').update(this.data.id).digest('hex').slice(0,12),at:new Date().toISOString(),state,cause,title:String(this.watch?.title||this.data.title||'').replace(/https?:\/\/\S+/g,'[link]').slice(0,120),provider:this.watch?.provider||null,quality:this.data.quality||this.requestedQuality||null,requestedQuality:this.requestedQuality||null,position:this.data.position,subtitleOn:this.data.subtitle!=='off',controlRequests:(this.controlRequests||[]).map(r=>({...r})),media:{connections:this.connections.size,bytesWritten:(this.completedMediaBytes||0)+[...this.connections].reduce((n,c)=>n+Math.max(0,(c.socket?.bytesWritten||0)-(c.startBytes||0)),0),queuedBytes:[...this.connections].reduce((n,c)=>n+(c.relay?.output?.readableLength||0),0),sourceRequests:this.source?.jobs?.size||0,cacheBytes:this.source?.size||0},diagnostics:this.trace?.snapshot()||null});}catch{}
  }
  stopStreams(){
    this.warmRelay?.close();this.warmRelay=null;
    for(const {child,res,relay} of this.connections){res.destroy();if(relay)relay.close();else child.kill();}this.connections.clear();
    const directory=this.subtitleDirectory;this.subtitleDirectory=null;
    if(directory)void removeCaptions(directory);
  }
  async finish(state='stopped',message='',stopTV=true){
    if(this.active())this.saveProgress(true,state==='ended');
    const cause=message==='Playback ended on the TV.'?'receiver-uri-changed':message==='The TV stopped playback. Try the link again.'?'receiver-stopped':state==='error'?'playback-error':this.controlRequests?.at(-1)?.action==='stop'?'requested-stop':state;
    this.recordDiagnostics(cause,true,state);
    const player=this.player,uri=this.uri,generation=++this.generation;clearInterval(this.timer);this.preparingRelay?.close();this.preparingRelay=null;this.abort?.abort();this.stopStreams();this.token=null;this.uri=null;
    this.data={...this.data,state,message,busy:false};
    await this.source?.close();
    if(stopTV&&player&&uri&&generation===this.generation)try{const result=await player.status();if(generation===this.generation&&result.uri===uri)await player.soap('Stop');}catch{}
  }
  async fail(error,generation=this.generation){if(generation!==this.generation)return;this.trace?.event({event:error.tvCode?'receiver-error':'playback-error',code:Number(error.tvCode)||undefined});await this.finish('error',error instanceof RemoteError?error.message:'Playback could not start. Try the movie link again.');}
  async close(){await this.finish('stopped','Playback stopped.');}
  async handle(req,res,url){
    const ip=req.socket.remoteAddress?.replace(/^::ffff:/,'');
    if(!this.token||ip!==this.address||this.store.data.profile?.address!==this.address||url.pathname!=='/media/'+this.token+'/video.ts'||!['GET','HEAD'].includes(req.method)){if(this.token&&ip===this.address&&this.store.data.profile?.address===this.address&&url.pathname.startsWith('/media/'))this.trace?.event({event:'media-stale-request'});res.writeHead(404).end();return;}
    if(req.headers.range&&!/^bytes=0-\d*$/.test(req.headers.range)){this.trace?.event({event:'media-rejected-range'});res.writeHead(416).end();return;}
    const headers={'Content-Type':'video/mpeg','transferMode.dlna.org':'Streaming','contentFeatures.dlna.org':'DLNA.ORG_OP=00;DLNA.ORG_CI=1;DLNA.ORG_FLAGS=01700000000000000000000000000000','Connection':'close'};
    if(req.method==='HEAD'){this.trace?.event({event:'media-head'});res.writeHead(200,headers).end();return;}
    if(this.connections.size>=2){this.trace?.event({event:'media-rejected-limit'});res.writeHead(503).end();return;}
    const trace=this.trace,warm=this.warmRelay&&!this.warmRelay.closed;
    trace?.event({event:warm?'media-get-warm':'media-get-cold'});
    const relay=warm?this.warmRelay:this.relayFactory({source:this.rendition||this.source,index:this.index,offset:this.offset,subtitleDirectory:this.subtitleDirectory,spawnProcess:this.spawnProcess,onDiagnostic:e=>trace?.event(e)});
    if(this.warmRelay===relay)this.warmRelay=null;
    const connection={child:relay.child,res,relay,socket:res.socket,startBytes:res.socket?.bytesWritten||0};this.connections.add(connection);
    const close=()=>{if(this.connections.delete(connection)){this.completedMediaBytes=(this.completedMediaBytes||0)+Math.max(0,(connection.socket?.bytesWritten||0)-connection.startBytes);trace?.event({event:res.writableFinished?'media-complete':'media-disconnected'});this.recordDiagnostics('media-closed',true);}relay.close();};res.on('close',close);
    try{await relay.ready;if(res.destroyed)return;res.writeHead(200,headers);await pipeline(relay.output,res);}
    catch{trace?.event({event:'media-pipe-failed'});if(!res.destroyed)res.destroy();}
    finally{close();}
  }
}
