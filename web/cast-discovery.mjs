import {parseMaster} from './cast-playlist.mjs';

// Stop discovery as soon as a validated master is available. Unrelated slow
// playlists must not hold the selected stream behind a Promise.all barrier.
// At most three reads are in flight; no new reads start after selection.
export function inspectManifests(candidates,inspect,{quality=480,isClosed=()=>false}={}){
 const queue=candidates.slice(-10),results=[];let cursor=0,workers=Math.min(3,queue.length),finished=false,lastError;
 return new Promise(resolve=>{
  const finish=master=>{if(finished)return;finished=true;resolve({master,inspected:results.slice().sort((a,b)=>a.index-b.index).map(r=>r.value),error:lastError});};
  if(!workers){finish(null);return;}
  const work=async()=>{
   try{
    while(!finished&&!isClosed()&&cursor<queue.length){
     const index=cursor++;let value;
     try{value=await inspect(queue[index]);}catch{continue;}
     if(finished||isClosed())break;if(!value||typeof value.text!=='string')continue;
     results.push({index,value});
     if(value.text.includes('#EXT-X-STREAM-INF:')){
      try{parseMaster(value.text,value.url,quality);finish(value);return;}catch(error){lastError=error;}
     }
    }
   }finally{if(isClosed()||--workers===0)finish(null);}
  };
  for(let i=0,n=workers;i<n;i++)void work();
 });
}
