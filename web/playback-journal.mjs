import fs from 'node:fs';import path from 'node:path';
// Private, bounded operational records. Callers supply only sanitized traces;
// never store source URLs, relay tokens, auth headers, captions or raw errors.
export class PlaybackJournal{
 constructor(directory){this.file=path.join(directory,'playback-diagnostics.json');this.rows=[];try{if(fs.statSync(this.file).size>262144)return;const raw=JSON.parse(fs.readFileSync(this.file,'utf8'));if(raw.version===1&&Array.isArray(raw.sessions))this.rows=raw.sessions.filter(r=>r&&/^[a-f0-9]{12}$/.test(r.session)).slice(-8);}catch{}}
 record(row){
  const old=this.rows.find(r=>r.session===row.session),failure=old?.failure||(['playback-error','receiver-uri-changed','receiver-stopped'].includes(row.cause)?row:null);
  const samples=[...(old?.samples||[]),{at:row.at,state:row.state,position:row.position,...row.media}].slice(-12);
  this.rows=this.rows.filter(r=>r.session!==row.session);this.rows.push({session:row.session,latest:row,failure,lastStreamClose:row.cause==='media-closed'?row:old?.lastStreamClose||null,samples});this.rows=this.rows.slice(-8);
  try{const bytes=JSON.stringify({version:1,sessions:this.rows});if(Buffer.byteLength(bytes)>262144)return;const temp=this.file+'.tmp';fs.writeFileSync(temp,bytes,{mode:0o600});fs.renameSync(temp,this.file);}catch{}
 }
}
