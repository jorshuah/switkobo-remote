import {stickVector,createStickRepeater} from './stick-controller.js';

function installStick(){
 const pad=document.querySelector('#dpad'),cap=pad?.querySelector('.select');if(!pad||!cap)return;
 const enabled=()=>tvEnabled()&&view==='remote'&&mode==='buttons'&&!sheet.open&&!document.hidden;
 let contact=null;
 function reset(){
  const old=contact;contact=null;repeater.end();delete pad.dataset.stickActive;delete pad.dataset.direction;
  pad.style.setProperty('--stick-x','0px');pad.style.setProperty('--stick-y','0px');
  if(old)try{if(pad.hasPointerCapture(old.id))pad.releasePointerCapture(old.id);}catch{}
 }
 const repeater=createStickRepeater({send:direction=>sendKey(direction),enabled,onHalt:reset});
 window.stopRemoteStick=reset;pad.dataset.joystick='true';
 function update(event){
  if(!contact||event.pointerId!==contact.id)return;if(!enabled()){reset();return;}
  if(event.pointerType==='mouse'&&event.buttons===0&&event.type==='pointermove'){reset();return;}
  const x=event.clientX-contact.x,y=event.clientY-contact.y;
  if(Math.hypot(x,y)>10)contact.moved=true;
  const vector=stickVector(x,y,contact.radius,contact.direction),changed=vector.direction!==contact.direction;
  contact.direction=vector.direction;if(vector.direction)contact.navigated=true;
  pad.style.setProperty('--stick-x',vector.x.toFixed(1)+'px');pad.style.setProperty('--stick-y',vector.y.toFixed(1)+'px');
  if(vector.direction)pad.dataset.direction=vector.direction;else delete pad.dataset.direction;
  if(changed&&vector.direction)tapFeedback();repeater.update(vector.direction,vector.strength);
 }
 pad.addEventListener('pointerdown',event=>{
  if(!event.isPrimary){reset();return;}if(event.button!==0||!enabled()||event.target.closest('button:disabled'))return;
  reset();const box=pad.getBoundingClientRect(),center=Boolean(event.target.closest('.select'));
  contact={id:event.pointerId,x:center?event.clientX:box.left+box.width/2,y:center?event.clientY:box.top+box.height/2,radius:Math.min(box.width,box.height)/2,center,moved:false,navigated:false,direction:null,started:performance.now()};
  repeater.begin();pad.dataset.stickActive='true';try{pad.setPointerCapture(event.pointerId);}catch{}
  update(event);
 });
 document.addEventListener('pointermove',update);
 document.addEventListener('pointerup',event=>{
  if(!contact||event.pointerId!==contact.id)return;
  update(event);if(!contact)return;
  const select=contact.center&&!contact.moved&&!contact.navigated&&performance.now()-contact.started<600&&enabled();reset();
  if(select){tapFeedback();void sendKey('ENTER');}
 });
 document.addEventListener('pointercancel',event=>{if(contact?.id===event.pointerId)reset();});
 pad.addEventListener('lostpointercapture',()=>{if(contact)reset();});
 document.addEventListener('pointerdown',event=>{if(contact&&!event.isPrimary)reset();},true);
 pad.addEventListener('contextmenu',event=>{if(contact)event.preventDefault();});
 // Pointer gestures already sent their command. Keyboard/screen-reader clicks
 // retain the existing labelled buttons and never enter a repeating gesture.
 pad.addEventListener('click',event=>{if(event.detail>0){event.preventDefault();event.stopPropagation();}},true);
 pad.addEventListener('keydown',event=>{if(['Enter',' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape'].includes(event.key))reset();});
 document.addEventListener('keydown',event=>{if(contact&&event.key==='Escape')reset();});
 document.addEventListener('focusin',event=>{if(contact&&!pad.contains(event.target)&&!event.target.contains(pad))reset();});
 window.addEventListener('blur',reset);window.addEventListener('pagehide',reset);window.addEventListener('resize',reset);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installStick,{once:true});else installStick();
