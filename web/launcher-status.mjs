export async function helperStatus({port,key,fetcher=fetch}){
 try{
  const response=await fetcher('http://127.0.0.1:'+port+'/api/state',{headers:{Authorization:'Bearer '+(key||'')},signal:AbortSignal.timeout(1500)});
  let data;try{data=await response.json();}catch{return {kind:'occupied',status:response.status};}
  if(response.ok&&['connected','connecting','reconnecting','disconnected','failed'].includes(data.state))return {kind:'ready'};
  if(response.status===401)return {kind:'credentials'};
  return {kind:'occupied',status:response.status};
 }catch(error){
  return {kind:error.name==='TimeoutError'||error.name==='AbortError'?'unresponsive':'unavailable'};
 }
}
export function startupError(status,port,log){
 if(status.kind==='credentials')return 'A helper is already running on port '+port+', but its access key does not match the saved settings. Close that helper before starting again. Your saved TV pairing has not been changed.';
 if(status.kind==='occupied')return 'Port '+port+' is already in use, but it is not responding as this remote helper. Close the conflicting service or check its configuration before starting again.';
 if(status.kind==='unresponsive')return 'The helper on port '+port+' is not responding. Restart that helper, then run Start Remote again.';
 return 'The helper could not start. The startup details are in '+log;
}
