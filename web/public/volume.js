import {createStickRepeater} from './stick-controller.js';

function installVolumeHold(){
 const selector='.volume-rocker button[data-key="VOLUP"],.volume-rocker button[data-key="VOLDOWN"],#cast-volume-up,#cast-volume-down';
 let contact=null;
 const control=target=>target?.closest?.(selector);
 const available=button=>Boolean(button?.isConnected&&!button.disabled&&!button.closest('fieldset:disabled')&&tvEnabled()&&!document.hidden&&button.getClientRects().length&&(button.closest('.volume-rocker')?view==='remote'&&!sheet.open:sheet.open&&sheetKind==='cast'&&castScreen==='player'));
 const enabled=()=>available(contact?.button);
 function stop(){
  const old=contact;contact=null;repeater.end();
  if(!old)return;delete old.button.dataset.volumeHeld;
  try{if(old.button.hasPointerCapture(old.id))old.button.releasePointerCapture(old.id);}catch{}
 }
 const repeater=createStickRepeater({send:key=>sendKey(key),enabled,onHalt:stop,initialDelay:450});
 window.isVolumeHoldControl=button=>Boolean(button?.matches(selector));
 document.addEventListener('pointerdown',event=>{
  if(contact)stop();
  const button=control(event.target);
  if(!button||!event.isPrimary||event.button!==0||!available(button))return;
  contact={button,id:event.pointerId};button.dataset.volumeHeld='true';
  try{button.setPointerCapture(event.pointerId);}catch{}
  tapFeedback();repeater.begin();repeater.update(button.dataset.key||(button.id==='cast-volume-up'?'VOLUP':'VOLDOWN'),.75);
 },true);
 document.addEventListener('pointermove',event=>{
  if(!contact||event.pointerId!==contact.id)return;
  const r=contact.button.getBoundingClientRect();
  if(!enabled()||event.pointerType==='mouse'&&!event.buttons||event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)stop();
 },true);
 for(const name of ['pointerup','pointercancel','lostpointercapture'])document.addEventListener(name,event=>{if(contact?.id===event.pointerId)stop();},true);
 // A pointer already sent on press. Keep ordinary keyboard/assistive clicks.
 window.addEventListener('click',event=>{if(event.detail>0&&control(event.target)){event.preventDefault();event.stopImmediatePropagation();}},true);
 document.addEventListener('contextmenu',event=>{if(contact&&control(event.target))event.preventDefault();});
 document.addEventListener('keydown',event=>{if(contact&&['Escape','Enter',' '].includes(event.key))stop();});
 document.addEventListener('focusin',event=>{if(contact&&event.target!==contact.button&&!event.target.contains(contact.button))stop();});
 for(const name of ['blur','pagehide','resize'])window.addEventListener(name,stop);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
 // Also stop when a poll disconnects the TV or a renderer replaces/hides controls.
 new MutationObserver(()=>{if(contact&&!enabled())stop();}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','hidden','open','data-kind']});
 document.documentElement.dataset.volumeHold='true';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installVolumeHold,{once:true});else installVolumeHold();
