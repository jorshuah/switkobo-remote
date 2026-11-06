import {RemoteError} from './protocol.mjs';
export function mediaAddress(value,base){
 let u;try{u=new URL(value,base);}catch{throw new RemoteError('The video contains an invalid media address.');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.href.length>8192)throw new RemoteError('The video contains an unsupported media address.');return u.href;
}
export function attributes(line){
 const result={};const value=line.slice(line.indexOf(':')+1);let end=0;
 for(const m of value.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)(?:,|$)/g)){if(m.index!==end||m[1] in result)throw new RemoteError('The stream playlist is invalid.');result[m[1]]=m[2].replace(/^"|"$/g,'');end=m.index+m[0].length;}
 if(end!==value.length)throw new RemoteError('The stream playlist is invalid.');return result;
}
function safePlaylist(text){
 if(typeof text!=='string'||text.length>1000000||!text.replace(/^\uFEFF/,'').startsWith('#EXTM3U'))throw new RemoteError('This source is not a supported video stream.');
 for(const line of text.split(/\r?\n/))if(/^#EXT-X-(KEY|SESSION-KEY):/.test(line)&&attributes(line).METHOD!=='NONE')throw new RemoteError('Protected streams are not supported.');
}
export function parseMaster(text,base,quality=480){
 safePlaylist(text);const variants=[],media=[];let pending=null;
 for(const line of text.split(/\r?\n/).map(s=>s.trim())){
  if(line.startsWith('#EXT-X-MEDIA:'))media.push(attributes(line));
  else if(line.startsWith('#EXT-X-STREAM-INF:'))pending=attributes(line);
  else if(pending&&line&&!line.startsWith('#')){const height=Number(pending.RESOLUTION?.split('x')[1])||0;variants.push({...pending,height,url:mediaAddress(line,base)});pending=null;}
 }
 if(!variants.length||variants.length>100)throw new RemoteError('The video playlist has no usable quality.');
 const supported=variants.filter(v=>!v.CODECS||v.CODECS.split(',').some(c=>/^avc[13]\./i.test(c.trim())));
 if(!supported.length)throw new RemoteError('This video uses an unsupported codec.');
 supported.sort((a,b)=>a.height-b.height||Number(a.BANDWIDTH||0)-Number(b.BANDWIDTH||0));
 const video=supported.filter(v=>!v.height||v.height<=quality).at(-1)||supported[0];
 const audio=media.filter(m=>m.TYPE==='AUDIO'&&m['GROUP-ID']===video.AUDIO&&m.URI);
 const chosen=audio.find(m=>m.DEFAULT==='YES')||audio.find(m=>/^en(g)?$/i.test(m.LANGUAGE||''))||audio[0];
 return {video:{...video,url:video.url},audio:chosen?{...chosen,url:mediaAddress(chosen.URI,base)}:null,qualities:[...new Set(supported.map(v=>v.height).filter(h=>Number.isInteger(h)&&h>0&&h<=1080))].sort((a,b)=>a-b)};
}
export function parsePlaylist(text,base){
 safePlaylist(text);
 if(!text.includes('#EXT-X-ENDLIST'))throw new RemoteError('Live streams are not supported yet. Use an on-demand video.');
 if(/#EXT-X-(BYTERANGE|DISCONTINUITY)(:|\r?\n)/.test(text))throw new RemoteError('This stream format cannot be relayed yet.');
 let init=null,length=null,time=0;const segments=[];
 for(const line of text.split(/\r?\n/).map(s=>s.trim())){
  if(line.startsWith('#EXT-X-MAP:')){const a=attributes(line);if(!a.URI||a.BYTERANGE)throw new RemoteError('This initialization format is unsupported.');const next=mediaAddress(a.URI,base);if(init&&init!==next)throw new RemoteError('Changing video formats are not supported.');init=next;}
  else if(line.startsWith('#EXTINF:')){length=Number(line.slice(8).split(',')[0]);if(!Number.isFinite(length)||length<=0||length>30)throw new RemoteError('The video playlist is invalid.');}
  else if(line&&!line.startsWith('#')){if(length===null||segments.length>=20000)throw new RemoteError('The video playlist is invalid.');segments.push({url:mediaAddress(line,base),start:time,duration:length});time+=length;length=null;}
 }
 if(!segments.length||time>28800||length!==null)throw new RemoteError('The video playlist is invalid.');return {init,segments,duration:time,format:init?'mp4':'mpegts'};
}
