'use strict';
(()=>{
 const models=new Map(),physicalMouseMoves=new WeakSet();let mousePoint=null,closingMenu=null,opened=null,queued=false,serial=0,positionFrame=0;
 const enabled=m=>!m.select.matches(':disabled')&&!m.select.hiddenByApp;
 const labelFor=s=>[...s.labels||[]].map(l=>l.textContent.trim()).filter(Boolean).join(' ')||s.getAttribute('aria-label')||'Choose an option';
 const entries=m=>[...m.select.options].map((o,index)=>({value:o.value,label:o.label||o.textContent,disabled:o.disabled||o.parentElement?.disabled,index})).filter(e=>!m.select.options[e.index].hidden);
 function sync(m){
  const value=m.select.selectedOptions[0]?.label||m.select.selectedOptions[0]?.textContent||'Choose an option';
  if(m.value.textContent!==value){const hadValue=Boolean(m.value.textContent);m.value.textContent=value;if(hadValue)window.remoteMotion?.value(m.value);}
  if(m.button.dataset.value!==m.select.value)m.button.dataset.value=m.select.value;
  const disabled=!enabled(m);if(m.button.disabled!==disabled)m.button.disabled=disabled;
  for(const attr of ['aria-invalid','aria-required']){const value=m.select.getAttribute(attr);if(value)m.button.setAttribute(attr,value);else m.button.removeAttribute(attr);}
  if(opened?.model===m){if(disabled||!m.button.getClientRects().length){close(false,false);return;}const signature=JSON.stringify(entries(m))+m.select.value;if(signature!==opened.signature)renderOptions(m);}
 }
 function enhance(s){
  if(s.multiple||s.size>1||models.has(s)||s.closest('[inert]'))return;
  if(!s.id)s.id='remote-choice-'+(++serial);
  const b=document.createElement('button');b.type='button';b.id=s.id+'-picker';b.className='picker-trigger';b.setAttribute('role','combobox');b.setAttribute('aria-haspopup','listbox');b.setAttribute('aria-expanded','false');b.dataset.selectId=s.id;
  const labels=[...s.labels||[]];if(labels.length){for(const [i,l]of labels.entries())if(!l.id)l.id=s.id+'-label-'+i;b.setAttribute('aria-labelledby',labels.map(l=>l.id).join(' '));}else b.setAttribute('aria-label',labelFor(s));
  const value=document.createElement('span');value.className='picker-value';value.id=s.id+'-display';b.setAttribute('aria-describedby',[s.getAttribute('aria-describedby'),value.id].filter(Boolean).join(' '));
  const icon=document.createElement('img');icon.src='/icons/chevron-down.svg';icon.alt='';if(s.dataset.inlineLabel==='true'){const prefix=document.createElement('span');prefix.className='picker-prefix';prefix.textContent=labelFor(s);prefix.setAttribute('aria-hidden','true');b.append(prefix);}b.append(value,icon);
  const m={select:s,button:b,value,typed:'',typedAt:0};models.set(s,m);s.hidden=true;s.tabIndex=-1;s.setAttribute('aria-hidden','true');s.after(b);
  b.addEventListener('click',()=>{if(opened?.model===m)close(true);else open(m);});
  b.addEventListener('keydown',e=>key(m,e));s.addEventListener('change',()=>sync(m));s.addEventListener('input',()=>sync(m));sync(m);
 }
 function refresh(){
  queued=false;
  for(const [s,m]of models){if(!s.isConnected){if(opened?.model===m)close(false,false);models.delete(s);}}
  for(const s of document.querySelectorAll('select'))enhance(s);
  for(const m of models.values())sync(m);
  if(opened)position();
 }
 function schedule(){if(queued)return;queued=true;queueMicrotask(refresh);}
 window.refreshPickers=schedule;
 function close(focus,withMotion=true){
  if(!opened)return;const {model:m,popup}=opened;opened=null;
  m.button.setAttribute('aria-expanded','false');m.button.removeAttribute('aria-activedescendant');m.button.removeAttribute('aria-controls');
  popup.style.pointerEvents='none';popup.inert=true;popup.setAttribute('aria-hidden','true');popup.removeAttribute('role');popup.removeAttribute('id');for(const row of popup.querySelectorAll('[id]'))row.removeAttribute('id');
  if(closingMenu&&closingMenu!==popup){for(const a of closingMenu.getAnimations())a.cancel();closingMenu.remove();}
  const animation=withMotion?window.remoteMotion?.pickerOut(popup):null;
  if(animation){closingMenu=popup;const finish=()=>{popup.remove();if(closingMenu===popup)closingMenu=null;};animation.finished.then(finish,finish);}else popup.remove();
  if(focus&&m.button.isConnected)m.button.focus({preventScroll:true});
 }
 function open(m){
  if(!enabled(m)||!m.button.isConnected)return;window.remoteMotion?.settleSurface();close(false,false);m.button.focus({preventScroll:true});
  const popup=document.createElement('div');popup.className='picker-popup';popup.id=m.button.id+'-listbox';popup.setAttribute('role','listbox');popup.setAttribute('aria-label',labelFor(m.select));
  const host=m.button.closest('dialog[open]')||document.body;host.append(popup);opened={model:m,popup,host,active:0,rows:[],signature:''};
  m.button.setAttribute('aria-expanded','true');m.button.setAttribute('aria-controls',popup.id);renderOptions(m);
  popup.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')e.preventDefault();});
  popup.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse'||!physicalMouseMoves.has(e))return;const row=e.target.closest('[role="option"]');if(row)setActive(Number(row.dataset.index),false);});
  popup.addEventListener('click',e=>{const row=e.target.closest('[role="option"]');if(row)commit(Number(row.dataset.index));});
  position();window.remoteMotion?.pickerIn(popup);
 }
 function renderOptions(m){
  if(opened?.model!==m)return;const o=opened,oldValue=o.rows[o.active]?.value;o.rows=entries(m);o.signature=JSON.stringify(o.rows)+m.select.value;o.popup.replaceChildren();
  for(const [i,item]of o.rows.entries()){
   const row=document.createElement('div');row.id=o.popup.id+'-'+i;row.className='picker-option';row.dataset.index=String(i);row.setAttribute('role','option');row.setAttribute('aria-selected',String(item.value===m.select.value));if(item.disabled)row.setAttribute('aria-disabled','true');
   const text=document.createElement('span');text.textContent=item.label;row.append(text);
   if(item.value===m.select.value){const check=document.createElement('img');check.src='/icons/check.svg';check.alt='';row.append(check);}
   o.popup.append(row);
  }
  const active=o.rows.findIndex(r=>r.value===(oldValue??m.select.value)&&!r.disabled);setActive(active>=0?active:o.rows.findIndex(r=>!r.disabled),false);position();
 }
 function setActive(index,scroll=true){
  if(!opened||index<0||!opened.rows[index]||opened.rows[index].disabled)return;
  opened.active=index;for(const [i,row]of [...opened.popup.children].entries())row.dataset.active=String(i===index);
  const row=opened.popup.children[index];opened.model.button.setAttribute('aria-activedescendant',row.id);if(scroll)row.scrollIntoView({block:'nearest'});
 }
 function commit(index,restore=true){
  if(!opened)return;const o=opened,m=o.model,item=o.rows[index];if(!item||item.disabled||!enabled(m)||!m.select.isConnected){close(false);return;}
  const changed=m.select.value!==item.value;m.select.value=item.value;close(restore);sync(m);
  if(changed){m.select.dispatchEvent(new Event('input',{bubbles:true}));m.select.dispatchEvent(new Event('change',{bubbles:true}));}
  schedule();
  if(restore)queueMicrotask(()=>{const b=document.getElementById(m.button.id);if(b&&(document.activeElement===document.body||document.activeElement===m.button))b.focus({preventScroll:true});});
 }
 function move(delta){
  if(!opened)return;const allowed=opened.rows.flatMap((row,i)=>row.disabled?[]:[i]);if(!allowed.length)return;
  const current=Math.max(0,allowed.indexOf(opened.active)),next=Math.max(0,Math.min(allowed.length-1,current+delta));setActive(allowed[next]);
 }
 function key(m,e){
  if(e.ctrlKey||e.metaKey||!enabled(m))return;const isOpen=opened?.model===m;
  if(e.key==='Escape'&&isOpen){e.preventDefault();e.stopPropagation();close(true);return;}
  if(e.key==='Tab'&&isOpen){commit(opened.active,false);return;}
  if(['ArrowDown','ArrowUp','Home','End','PageDown','PageUp','Enter',' '].includes(e.key)){
   e.preventDefault();e.stopPropagation();
   if(!isOpen){open(m);if(e.key==='Home')setActive(opened.rows.findIndex(r=>!r.disabled));if(e.key==='End')setActive(opened.rows.findLastIndex(r=>!r.disabled));return;}
   if(e.key==='Enter'||e.key===' '){commit(opened.active);return;}if(e.key==='ArrowUp'&&e.altKey){commit(opened.active);return;}
   if(e.key==='Home'){setActive(opened.rows.findIndex(r=>!r.disabled));return;}if(e.key==='End'){setActive(opened.rows.findLastIndex(r=>!r.disabled));return;}
   move(e.key==='ArrowUp'?-1:e.key==='PageUp'?-10:e.key==='PageDown'?10:1);return;
  }
  if(e.key.length===1&&!e.altKey){
   e.preventDefault();if(!isOpen)open(m);const now=performance.now(),char=e.key.toLocaleLowerCase();m.typed=now-m.typedAt>700?'':m.typed;m.typedAt=now;m.typed+=char;
   const repeated=[...m.typed].every(c=>c===char),query=repeated?char:m.typed,start=repeated?opened.active+1:0;
   for(let n=0;n<opened.rows.length;n++){const i=(start+n)%opened.rows.length,item=opened.rows[i];if(!item.disabled&&item.label.toLocaleLowerCase().startsWith(query)){setActive(i);break;}}
  }
 }
 function position(){
  if(!opened)return;const {model:m,popup,host}=opened;
  if(!m.button.isConnected||!m.button.getClientRects().length||host instanceof HTMLDialogElement&&!host.open){close(false,false);return;}
  const r=m.button.getBoundingClientRect(),vv=window.visualViewport,edge=12,left=vv?.offsetLeft||0,top=vv?.offsetTop||0,width=vv?.width||innerWidth,height=vv?.height||innerHeight,bottom=top+height;
  const w=Math.min(Math.max(r.width,220),width-edge*2),x=Math.max(left+edge,Math.min(r.left,left+width-w-edge));
  popup.style.width=w+'px';const desired=Math.min(320,popup.scrollHeight||320,height-edge*2),below=bottom-edge-r.bottom-8,above=r.top-top-edge-8,down=below>=Math.min(desired,144)||below>=above;
  const available=Math.max(44,down?below:above),h=Math.min(desired,available,height-edge*2),y=Math.max(top+edge,Math.min(down?r.bottom+8:r.top-8-h,bottom-edge-h));
  popup.style.maxHeight=h+'px';popup.style.left=x+'px';popup.style.top=y+'px';
 }
 window.positionOpenPicker=position;
 function reposition(){cancelAnimationFrame(positionFrame);positionFrame=requestAnimationFrame(position);}
 document.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse')return;if(mousePoint&&(mousePoint.x!==e.clientX||mousePoint.y!==e.clientY))physicalMouseMoves.add(e);mousePoint={x:e.clientX,y:e.clientY};},true);
 document.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')mousePoint={x:e.clientX,y:e.clientY};if(opened&&!opened.popup.contains(e.target)&&!opened.model.button.contains(e.target))close(false);},true);
 document.addEventListener('focusin',e=>{if(opened&&!opened.popup.contains(e.target)&&e.target!==opened.model.button)close(false);});
 document.addEventListener('click',e=>{const label=e.target.closest('label[for]');if(!label)return;const select=document.getElementById(label.htmlFor),m=models.get(select);if(m){e.preventDefault();m.button.focus({preventScroll:true});}});
 document.addEventListener('scroll',e=>{if(opened&&!opened.popup.contains(e.target))reposition();},true);
 window.addEventListener('resize',reposition);window.visualViewport?.addEventListener('resize',reposition);window.visualViewport?.addEventListener('scroll',reposition);
 new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','hidden','selected','open']});schedule();
})();
