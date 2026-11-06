import {RemoteError,localAddress,shortcut} from './protocol.mjs';

// Store IDs differ across Samsung generations; probe before sending a launch.
const variants=[
 ['11101200001','3201907018807'],
 ['3201512006785','3201910019365'],
 ['3201901017640','3202009021709','3202204027038']
];
export function appCandidates(id){return [id,...(variants.find(ids=>ids.includes(id))||[]).filter(value=>value!==id)];}
export async function appRequest(address,id,method='GET'){
 const url='http://'+localAddress(address)+':8001/api/v2/applications/'+encodeURIComponent(id);
 const response=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(method==='GET'?1500:3000)});
 const text=await response.text();
 if(text.length>65536)throw new RemoteError('The TV returned an invalid app response.',502);
 let data;try{data=JSON.parse(text);}catch{data=null;}
 return {status:response.status,data};
}
export async function launchApp(input,{address,request=appRequest,ensureCurrent,fallback,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 const app=shortcut(input);ensureCurrent();
 let selected=null;
 for(const id of appCandidates(app.appID)){
  let response;try{response=await request(address,id);}catch{ensureCurrent();return fallback(app);}
  ensureCurrent();
  if(response.status===200&&response.data?.id===id){selected=id;break;}
  if(response.status!==404)return fallback(app);
 }
 if(!selected)throw new RemoteError(app.name+' is not available under its saved app ID on this TV. Check that it is installed, or update its shortcut in Settings.',404);
 ensureCurrent();
 let launched;
 try{launched=await request(address,selected,'POST');}catch{ensureCurrent();throw new RemoteError('The TV did not answer the launch request. Check the TV before trying again.',504);}
 ensureCurrent();
 if([405,501].includes(launched.status))return fallback({...app,appID:selected});
 if(launched.status!==200||launched.data===false)throw new RemoteError('The TV rejected the request to open '+app.name+'. Try opening it from TV Home.',502);
 for(let attempt=0;attempt<4;attempt++){
  await wait(500);ensureCurrent();
  let status;try{status=await request(address,selected);}catch{break;}
  ensureCurrent();
  if(status.status===200&&status.data?.id===selected&&status.data.visible===true)return {appID:selected,verified:true,message:app.name+' is open on your TV.'};
 }
 ensureCurrent();return {appID:selected,verified:false,message:'The TV accepted the request for '+app.name+', but has not confirmed it is onscreen.'};
}
