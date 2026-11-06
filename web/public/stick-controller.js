// Pure geometry and one-request-at-a-time repetition for a single held gesture.
export function stickVector(x,y,radius,previous=null){
 const distance=Math.hypot(x,y),deadzone=Math.max(16,Math.min(25,radius*.17)),travel=Math.max(28,Math.min(46,radius*.3));
 const neutral=distance<(previous?deadzone*.7:deadzone);let direction=null;
 if(!neutral){
  if(previous&&['LEFT','RIGHT'].includes(previous)&&Math.abs(y)<Math.abs(x)*1.2)direction=x<0?'LEFT':'RIGHT';
  else if(previous&&['UP','DOWN'].includes(previous)&&Math.abs(x)<Math.abs(y)*1.2)direction=y<0?'UP':'DOWN';
  else direction=Math.abs(x)>Math.abs(y)?(x<0?'LEFT':'RIGHT'):(y<0?'UP':'DOWN');
 }
 const scale=distance?Math.min(1,travel/distance):0;
 return {direction,x:neutral?0:x*scale,y:neutral?0:y*scale,strength:Math.max(0,Math.min(1,(distance-deadzone)/Math.max(1,travel-deadzone)))};
}

export function createStickRepeater({send,enabled=()=>true,onHalt=()=>{},now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout,initialDelay=320}={}){
 let current=null;
 const clear=state=>{if(state&&state.timer!==null){cancel(state.timer);state.timer=null;}};
 const end=()=>{clear(current);current=null;};
 const halt=state=>{if(current!==state)return;end();onHalt();};
 function pump(state){
  if(current!==state)return;clear(state);
  if(!enabled()){halt(state);return;}if(!state.direction||state.busy)return;
  const wait=state.due-now();if(wait>0){state.timer=schedule(()=>pump(state),wait);return;}
  const direction=state.direction;state.busy=true;state.lastSent=now();state.count++;
  state.due=state.lastSent+(state.count===1?initialDelay:Math.round(250-90*state.strength));
  let result;try{result=send(direction);}catch{state.busy=false;halt(state);return;}
  Promise.resolve(result).then(ok=>{if(ok===false)halt(state);},()=>halt(state)).finally(()=>{state.busy=false;if(current===state)pump(state);});
 }
 return {
  begin(){end();current={direction:null,strength:0,count:0,busy:false,due:now(),lastSent:-Infinity,timer:null};},
  update(direction,strength=0){
   const state=current;if(!state)return;if(!enabled()){halt(state);return;}
   if(direction===state.direction){state.strength=Math.max(0,Math.min(1,strength));return;}
   clear(state);state.direction=direction;state.strength=Math.max(0,Math.min(1,strength));state.count=0;
   // Rapid direction changes cannot turn pointermove into a request flood.
   state.due=Math.max(now(),state.lastSent+125);if(direction)pump(state);
  },
  end
 };
}
