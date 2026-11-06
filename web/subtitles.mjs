import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {RemoteError} from './protocol.mjs';
import {vttToSrt} from './cast-source.mjs';
import {subtitleEnvironment} from './subtitle-environment.mjs';

export const subtitleLanguages={en:'English',fr:'French',es:'Spanish',pt:'Portuguese',ar:'Arabic',hi:'Hindi',de:'German',it:'Italian',ru:'Russian',ja:'Japanese',ko:'Korean',zh:'Chinese',yo:'Yoruba'};
const clean=(value,max=140)=>String(value||'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max);
const validKey=key=>typeof key==='string'&&(!key||/^[\x21-\x7e]{8,512}$/.test(key));
const mediaKey=key=>typeof key==='string'&&/^(?:movie:\d{1,10}|tv:\d{1,10}:\d{1,3}:\d{1,4}|session:[a-zA-Z0-9-]{1,60})$/.test(key);
export function subtitleDelay(value){if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>120)throw new RemoteError('Choose a subtitle adjustment between −120 and 120 seconds.');return Math.round(value*1000)/1000;}
export function normalizeSubtitle(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>2000000)throw new RemoteError('Choose an SRT or VTT file smaller than 2 MB.');
 if(text.includes('\0'))throw new RemoteError('This subtitle encoding is unsupported. Use UTF-8 or UTF-16 text.');
 const normalized=vttToSrt(text.replace(/^\uFEFF/,'').replace(/\{\\[^}]*\}/g,''));
 if(!normalized.trim())throw new RemoteError('No timed subtitle lines were found. Choose an SRT or VTT file.');
 return normalized;
}
export class SubtitleStore{
 constructor(directory,{environment=process.env,envFile=path.join(directory,'.env')}={}){
  this.environment=environment;this.envFile=envFile;
  this.file=path.join(directory,'subtitles.json');this.data={version:1,key:'',language:'en',entries:{}};
  try{const bytes=fs.readFileSync(this.file);if(bytes.length>18000000)throw Error();const data=JSON.parse(bytes);if(data.version!==1||!validKey(data.key)||!subtitleLanguages[data.language]||!data.entries||Array.isArray(data.entries)||Object.keys(data.entries).length>100)throw Error();
   for(const [key,e]of Object.entries(data.entries)){if(!mediaKey(key)||!Array.isArray(e.tracks)||e.tracks.length>5||!Number.isFinite(e.updatedAt))throw Error();subtitleDelay(e.delay);if(typeof e.selected!=='string'||e.selected.length>80)throw Error();for(const t of e.tracks){if(!/^ext-[a-f0-9]{24}$/.test(t.id)||typeof t.label!=='string'||!['import','search'].includes(t.origin)||typeof t.text!=='string')throw Error();t.text=normalizeSubtitle(t.text);}}
   this.data=data;
  }catch(error){if(error.code!=='ENOENT')this.warning='Saved subtitle settings could not be read. Your existing file has been kept.';}
 }
 credentials(){const external=subtitleEnvironment(this.envFile,this.environment);if(external.managed){if(external.key&&!validKey(external.key))return {key:'',managed:true,warning:'WYZIE_API_KEY on the PC is invalid. Check the environment setting.'};return external;}return {key:this.data.key,managed:false,warning:''};}
 status(){const credential=this.credentials();return {version:1,configured:Boolean(credential.key),managed:credential.managed,keySource:credential.managed?'environment':credential.key?'saved':null,language:this.data.language,warning:credential.warning||this.warning||''};}
 save(next){if(this.warning)throw new RemoteError(this.warning,503);const temporary=this.file+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(next),{mode:0o600});fs.renameSync(temporary,this.file);this.data=next;}catch{throw new RemoteError('Subtitle changes could not be saved. Check the PC storage and try again.',503);}}
 configure(input){if(this.credentials().managed&&(input.key!==undefined||input.removeKey!==undefined))throw new RemoteError('The subtitle key is managed on the PC. Update the PC environment setting to replace it.',409);const key=input.removeKey===true?'':input.key===undefined?this.data.key:input.key,language=input.language??this.data.language;if(!validKey(key)||!subtitleLanguages[language])throw new RemoteError('Enter a valid API key and subtitle language.');this.save({...this.data,key,language});return this.status();}
 get(key){return this.data.entries[key]||null;}
 put(key,patch){if(!mediaKey(key))throw new RemoteError('This playback session cannot save subtitle changes.');const entries={...this.data.entries},entry={tracks:[],selected:'off',delay:0,...entries[key],...patch,updatedAt:Date.now()};entries[key]=entry;
  const oldest=Object.keys(entries).filter(k=>k!==key).sort((a,b)=>entries[a].updatedAt-entries[b].updatedAt);while(Object.keys(entries).length>100||Buffer.byteLength(JSON.stringify(entries))>16000000){const remove=oldest.shift();if(!remove)throw new RemoteError('Saved subtitle storage is full for this title. Use a smaller file.');delete entries[remove];}this.save({...this.data,entries});return entry;
 }
 add(key,{text,label,origin='import',language='',release=''}){const normalized=normalizeSubtitle(text),id='ext-'+createHash('sha256').update(normalized).digest('hex').slice(0,24),entry=this.get(key),tracks=(entry?.tracks||[]).filter(t=>t.id!==id);if(tracks.length>=5){const remove=tracks.findIndex(t=>t.id!==entry?.selected);tracks.splice(Math.max(0,remove),1);}const track={id,text:normalized,label:clean(label)||'Imported subtitles',origin:origin==='search'?'search':'import',language:clean(language,8),release:clean(release,240)};tracks.push(track);this.put(key,{tracks});return track;}
 select(key,selected,delay,sourceLabel=''){if(typeof selected!=='string'||selected.length>80)throw new RemoteError('Choose a subtitle track.');return this.put(key,{selected,sourceLabel:clean(sourceLabel,100),delay:subtitleDelay(delay)});}
}

async function responseBytes(response,limit){let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new RemoteError('The subtitle service returned too much data.');chunks.push(chunk);}return Buffer.concat(chunks);}
function serviceError(status){return new RemoteError(status===429?'The subtitle search allowance is used up. Try later or import a file.':status===403||status===401?'The subtitle key was not accepted or is on hold. Check it in Subtitle settings.':status===402?'The subtitle provider cannot serve more downloads with this key. You can still import a file.':'The subtitle service is unavailable. Try again or import a file.',status===429?429:502);}
export class SubtitleService{
 constructor(store,{fetcher=fetch,now=Date.now}={}){this.store=store;this.fetcher=fetcher;this.now=now;this.results=new Map();this.cache=new Map();this.jobs=new Map();this.generation=0;}
 syncKey(){const credential=this.store.credentials();if(this.currentKey!==credential.key){this.currentKey=credential.key;this.generation++;this.cache.clear();this.results.clear();this.jobs.clear();}return credential;}
 status(){this.syncKey();return this.store.status();}
 configure(input){const result=this.store.configure(input);this.generation++;this.cache.clear();this.results.clear();this.jobs.clear();return result;}
 async search(media,session,language=this.store.data.language){
  const credential=this.syncKey();if(credential.warning)throw new RemoteError(credential.warning,503);
  if(!credential.key)throw new RemoteError('Add your Wyzie key once on the PC or in Subtitle settings to search online.',409);
  if(!media||!/^\d{1,10}$/.test(media.id)||!['movie','tv'].includes(media.type))throw new RemoteError('This video has no movie details for subtitle search. Import a file instead.');
  if(media.type==='tv'&&(!Number.isInteger(media.season)||media.season<0||!Number.isInteger(media.episode)||media.episode<1))throw new RemoteError('Choose a specific episode before searching for subtitles.');
  if(!subtitleLanguages[language])throw new RemoteError('Choose a supported subtitle language.');
  const cacheKey=JSON.stringify([session,media.id,media.type,media.season,media.episode,language]),cached=this.cache.get(cacheKey);if(cached&&cached.expires>this.now())return cached.value;if(this.jobs.has(cacheKey))return this.jobs.get(cacheKey);
  const job=this.performSearch(media,session,language,credential.key).then(value=>{this.cache.set(cacheKey,{value,expires:this.now()+300000});while(this.cache.size>20)this.cache.delete(this.cache.keys().next().value);return value;}).finally(()=>{if(this.jobs.get(cacheKey)===job)this.jobs.delete(cacheKey);});this.jobs.set(cacheKey,job);return job;
 }
 async performSearch(media,session,language,key){
  const generation=this.generation;
  const url=new URL('https://sub.wyzie.io/search');for(const [k,v]of Object.entries({id:media.id,language,format:'srt,vtt',source:'all',sort:'downloads',limit:30,key,...(media.type==='tv'?{season:media.season,episode:media.episode}:{})}))url.searchParams.set(k,String(v));
  let response;try{response=await this.fetcher(url,{redirect:'error',signal:AbortSignal.timeout(25000)});}catch{throw serviceError(503);}if(!response.ok)throw serviceError(response.status);
  let rows;try{const data=JSON.parse((await responseBytes(response,2000000)).toString('utf8'));rows=Array.isArray(data)?data:Array.isArray(data.results)?data.results:null;}catch{throw serviceError(502);}if(!rows)throw serviceError(502);
  this.syncKey();if(generation!==this.generation)throw new RemoteError('Subtitle settings changed. Search again.',409);
  const results=[];for(const row of rows.slice(0,100)){let download;try{download=new URL(row.url);}catch{continue;}if(download.origin!=='https://sub.wyzie.io'||!download.pathname.startsWith('/c/')||download.username||download.password||download.href.length>8192||!['srt','vtt'].includes(String(row.format).toLowerCase()))continue;
   const id=randomBytes(16).toString('hex'),item={id,label:clean(row.display)||subtitleLanguages[language],language:clean(row.language,8),release:clean(row.release||row.fileName,240),hearingImpaired:row.isHearingImpaired===true,provider:clean(row.source,40),downloads:Number.isSafeInteger(row.downloadCount)&&row.downloadCount>=0?row.downloadCount:null};this.results.set(id,{url:download.href,session,item,expires:this.now()+600000});results.push(item);if(results.length===30)break;
  }while(this.results.size>300)this.results.delete(this.results.keys().next().value);return {results,language};
 }
 async download(id,session){this.syncKey();const generation=this.generation;const entry=this.results.get(id);if(!entry||entry.session!==session||entry.expires<this.now())throw new RemoteError('This subtitle result expired. Search again.',409);let response;const url=new URL(entry.url);url.searchParams.set('to','srt');url.searchParams.set('plain','1');try{response=await this.fetcher(url,{redirect:'error',signal:AbortSignal.timeout(25000)});}catch{throw serviceError(503);}if(!response.ok)throw serviceError(response.status);const bytes=await responseBytes(response,2000000);this.syncKey();if(generation!==this.generation)throw new RemoteError('Subtitle settings changed. Search again.',409);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new RemoteError('This subtitle encoding is unsupported. Try another result.');}return {text:normalizeSubtitle(text),...entry.item,origin:'search'};}
}
