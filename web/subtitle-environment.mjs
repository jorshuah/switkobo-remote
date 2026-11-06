import fs from 'node:fs';
import {parseEnv} from 'node:util';

// Parse a single provider setting without injecting it into child processes.
// The small file is re-read so key changes do not require stopping playback.
export function subtitleEnvironment(file,environment=process.env){
 const direct=environment.WYZIE_API_KEY;
 if(direct!==undefined&&typeof direct!=='string')return {key:'',managed:true,warning:'WYZIE_API_KEY on the PC must be a text value.'};
 if(direct?.trim())return {key:direct.trim(),managed:true,warning:''};
 try{
  const stat=fs.statSync(file);if(!stat.isFile()||stat.size>65536)throw Error();
  const data=parseEnv(fs.readFileSync(file,'utf8')),value=data.WYZIE_API_KEY;
  return value?.trim()?{key:value.trim(),managed:true,warning:''}:{key:'',managed:false,warning:''};
 }catch(error){if(error.code==='ENOENT')return {key:'',managed:false,warning:''};return {key:'',managed:true,warning:'The PC subtitle environment file could not be read. Check its format and permissions.'};}
}
