'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const storage={get(k){try{return localStorage.getItem(k);}catch{return null;}},set(k,v){try{localStorage.setItem(k,v);}catch{}},remove(k){try{localStorage.removeItem(k);}catch{}}};
let access=storage.get('remote-access')||'';
const hash=new URLSearchParams(location.hash.slice(1));
if(/^[a-f0-9]{64}$/.test(hash.get('access')||'')){access=hash.get('access');storage.set('remote-access',access);history.replaceState(null,'',location.pathname);}
let snapshot=null,helperOnline=false,polling=false,inFlight=0,view='remote',sheetKind='',returnFocus=null,originalForm='',mode=storage.get('remote-mode')||'buttons';
const sheet=$('#sheet');

// Safari can retain :focus-visible after programmatic dialog focus restoration.
// Keep focus for accessibility, but show its outline only during keyboard use.
document.documentElement.dataset.inputModality='keyboard';
const pointerModality=()=>{document.documentElement.dataset.inputModality='pointer';};
document.addEventListener('pointerdown',pointerModality,true);
document.addEventListener('touchstart',pointerModality,{capture:true,passive:true});
document.addEventListener('keydown',event=>{
  if(!event.metaKey&&!event.ctrlKey&&!event.altKey&&!['Shift','Control','Alt','Meta'].includes(event.key))document.documentElement.dataset.inputModality='keyboard';
},true);

const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
const iosMotion=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
if(iosMotion)document.documentElement.dataset.uiMotion='instant';
const activeMotion=new WeakMap();
const motionTokens=Object.freeze({quick:140,content:260,enter:300,exit:170,ease:'cubic-bezier(.22,1,.36,1)',leave:'cubic-bezier(.4,0,1,1)'});
function animateUI(element,frames,duration=motionTokens.content,options={}){
  if(!element||element===sheet)return null;
  const previous=activeMotion.get(element),moving=previous?.playState==='running';
  let first=frames[0];if(moving){const style=getComputedStyle(element);first={...first};for(const property of ['opacity','transform'])if(property in first)first[property]=style[property];}
  previous?.cancel();
  if(iosMotion||motionPreference.matches||document.hidden||!element.animate||!element.isConnected||!element.getClientRects().length)return null;
  const animation=element.animate([first,...frames.slice(1)],{duration,easing:motionTokens.ease,...options});
  activeMotion.set(element,animation);
  const finish=()=>{if(activeMotion.get(element)===animation)activeMotion.delete(element);};
  animation.finished.then(finish,finish);return animation;
}
const preparedScreens=new WeakMap();let contentTransition=null,motionBatchDepth=0;
const pendingPresentations=new Map();
const immediateSavedTitle=key=>iosMotion&&String(key||'').startsWith('library:entry:');
function motionTransaction(work){
  motionBatchDepth++;
  try{return work();}finally{
    if(--motionBatchDepth===0){
      const pending=[...pendingPresentations];pendingPresentations.clear();
      for(const [element,key]of pending)presentScreen(element,key);
    }
  }
}
const hasTextEntry=element=>Boolean(element?.querySelector('textarea,input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="hidden"]),[contenteditable="true"]'));
function settleContentTransition(){
  const transition=contentTransition;contentTransition=null;if(!transition)return;
  for(const animation of transition.animations)animation?.cancel();transition.ghost?.remove();
}
function sheetContentSurface(){
  if(sheetKind==='cast')return window.movieMotionSurface?.()||$('#sheet-body');
  const body=$('#sheet-body');let surface=body.querySelector(':scope > .sheet-content-surface');
  if(!surface){surface=document.createElement('div');surface.className='sheet-content-surface';surface.append(...body.childNodes);body.append(surface);}return surface;
}
function screenDepth(key){
  if(key.startsWith('connection:'))return Number(key.split(':')[2])||1;
  if(key.startsWith('cast:subtitles:'))return key.endsWith(':settings')?6:key.endsWith(':search')?5:4;
  if(/^cast:(?:opening|player):/.test(key))return 3;
  return (key.includes(':confirm:')||key==='catalog:replace')?3:/^(?:catalog:detail|library:entry:|cast:link)/.test(key)?2:1;
}
function prepareScreen(element,key){
  preparedScreens.delete(element);
  const previous=element.dataset.motionScreen;
  if(iosMotion&&element.id==='sheet-body'){settleScreenMotion(element);return;}
  if(!sheet.open||element.id!=='sheet-body'||!previous||previous===key||element.dataset.tabSwitching||motionPreference.matches||document.hidden)return;
  const surface=sheetContentSurface(),style=getComputedStyle(surface),copy=surface.cloneNode(true);
  const bounds=element.getBoundingClientRect(),painted=surface.getBoundingClientRect();
  // IDs must disappear from the inert copy, but ID-based styles should not
  // flash into their browser defaults while the old screen fades away.
  const styled=[surface,...surface.querySelectorAll('[id]')],copies=[copy,...copy.querySelectorAll('[id]')];
  const properties=['display','font','color','background','border','border-radius','box-shadow','padding','margin','width','height','min-width','min-height','max-width','gap','grid-template-columns','align-items','justify-content','text-align','letter-spacing','line-height','filter','flex','appearance','overflow','object-fit'];
  for(let i=0;i<styled.length;i++){const computed=getComputedStyle(styled[i]);for(const property of properties)copies[i].style.setProperty(property,computed.getPropertyValue(property));}
  for(const node of [copy,...copy.querySelectorAll('[id]')])node.removeAttribute('id');
  for(const node of copy.querySelectorAll('.screen-outgoing,.library-outgoing,.picker-popup'))node.remove();
  for(const node of copy.querySelectorAll('[data-poster-key]'))node.removeAttribute('data-poster-key');
  for(const input of copy.querySelectorAll('input[type="password"]')){input.value='';input.removeAttribute('value');}
  copy.classList.add('screen-copy');copy.style.cssText+=';position:absolute;left:'+(painted.left-bounds.left)+'px;top:'+(painted.top-bounds.top)+'px;width:'+surface.clientWidth+'px;margin:0;transform:none;opacity:'+style.opacity+';';
  preparedScreens.set(element,{key,copy,bounds});settleContentTransition();
}
function presentScreen(element,key){
  // Finish all pinned navigation, picker and footer changes before measuring
  // the new screen. Nested renderers share one synchronous presentation.
  if(motionBatchDepth){pendingPresentations.set(element,key);return;}
  const previous=element.dataset.motionScreen,prepared=preparedScreens.get(element);preparedScreens.delete(element);element.dataset.motionScreen=key;
  if(iosMotion&&element.id==='sheet-body'){settleScreenMotion(element);return;}
  if(!previous||previous===key||element.dataset.tabSwitching)return;
  window.settleMovieTabs?.();settleContentTransition();activeMotion.get(element)?.cancel();
  if(element.id!=='sheet-body'){animateUI(element,[{opacity:.25},{opacity:1}],motionTokens.content,{id:'content-change'});return;}
  const surface=sheetContentSurface(),direction=screenDepth(key)<screenDepth(previous)?-1:1;
  animateUI($('#sheet-title'),[{opacity:.35},{opacity:1}],180,{id:'content-title'});
  if(hasTextEntry(surface))activeMotion.get(sheetPanel)?.cancel();
  const incoming=animateUI(surface,[{opacity:0,transform:hasTextEntry(surface)?'none':'translateX('+(direction*24)+'px)'},{opacity:1,transform:'none'}],motionTokens.content,{id:'content-change'});
  if(!incoming)return;
  let ghost=null,outgoing=null;
  if(prepared?.key===key){
    const panelBounds=sheetPanel.getBoundingClientRect(),bounds=prepared.bounds;
    ghost=document.createElement('div');ghost.className='screen-outgoing';ghost.setAttribute('aria-hidden','true');ghost.inert=true;
    // Keep the outgoing image outside the scroller. Restoring the destination's
    // scroll position or hiding its tabs must not move the image being faded.
    ghost.style.cssText='position:absolute;left:'+(bounds.left-panelBounds.left-sheetPanel.clientLeft)+'px;top:'+(bounds.top-panelBounds.top-sheetPanel.clientTop)+'px;width:'+bounds.width+'px;height:'+bounds.height+'px;';ghost.append(prepared.copy);sheetPanel.append(ghost);
    outgoing=animateUI(ghost,[{opacity:1,transform:'none'},{opacity:0,transform:'translateX('+(-direction*16)+'px)'}],120,{id:'content-exit'});
  }
  const transition={ghost,animations:[incoming,outgoing]};contentTransition=transition;
  Promise.all(transition.animations.map(a=>a?.finished.catch(()=>{}))).then(()=>{ghost?.remove();if(contentTransition===transition)contentTransition=null;});
}
function settleScreenMotion(element){
  settleContentTransition();window.settleMovieTabs?.();
  const surface=sheetContentSurface();
  for(const target of [element,surface,sheetPanel,$('#sheet-title'),...surface.querySelectorAll('.movie-art img')])activeMotion.get(target)?.cancel();
}
window.remoteMotion={
  tokens:motionTokens,
  disabledOnIOS:iosMotion,
  immediateSavedTitle,
  transaction:motionTransaction,
  prepare:prepareScreen,
  settleSurface:()=>{settleContentTransition();activeMotion.get(sheetPanel)?.cancel();activeMotion.get($('#sheet-body'))?.cancel();activeMotion.get($('#library-page-content'))?.cancel();window.settleMovieTabs?.();},
  tabIn:(element,distance)=>animateUI(element,[{transform:hasTextEntry(element)?'none':'translateX('+distance+'px)',opacity:.6},{transform:'none',opacity:1}],320,{id:'movie-tab-enter'}),
  tabOut:(element,distance)=>animateUI(element,[{transform:'none',opacity:1},{transform:'translateX('+distance+'px)',opacity:.25}],320,{id:'movie-tab-exit'}),
  pickerIn:element=>animateUI(element,[{opacity:.25},{opacity:1}],motionTokens.quick,{id:'picker-enter'}),
  pickerOut:element=>animateUI(element,[{opacity:1},{opacity:0}],100,{easing:motionTokens.leave,id:'picker-exit'}),
  value:element=>animateUI(element,[{opacity:.55},{opacity:1}],motionTokens.quick,{id:'choice-change'}),
  poster:element=>immediateSavedTitle($('#sheet-body').dataset.motionScreen)?null:animateUI(element,[{opacity:.25},{opacity:1}],220,{id:'poster-ready'}),
  present:presentScreen,
  results(element){
    for(const [i,item]of [...element.querySelectorAll('.movie-result')].slice(0,6).entries())animateUI(item,[{opacity:.55},{opacity:1}],180,{delay:i*16,fill:'backwards',id:'results-ready'});
  }
};
// Keep the native top-layer dialog untransformed: Safari's keyboard can otherwise
// leave its composited image and native hit-test region at different coordinates.
const sheetPanel=$('#sheet .sheet-panel');
function revealSheet(){
  syncSheetViewport();
  animateUI(sheetPanel,[{transform:hasTextEntry(sheetPanel)?'none':'translateY(32px)',opacity:.6},{transform:'none',opacity:1}],motionTokens.enter,{id:'sheet-enter'});
}
function dismissSheet(){
  if(!sheet.open||sheet.dataset.closing)return;
  sheet.dataset.closing='true';
  settleContentTransition();
  qrScanController?.abort();
  document.activeElement?.blur();
  const animation=animateUI(sheetPanel,[{transform:'none',opacity:1},{transform:'translateY(24px)',opacity:0}],motionTokens.exit,{easing:motionTokens.leave,id:'sheet-exit'});
  if(!animation){sheet.close();return;}
  animation.finished.then(()=>{if(sheet.open&&sheet.dataset.closing)sheet.close();}).catch(()=>{if(sheet.open&&sheet.dataset.closing)sheet.close();});
}
motionPreference.addEventListener('change',()=>{
  if(!motionPreference.matches)return;
  settleContentTransition();window.settleMovieTabs?.();
  const closing=Boolean(sheet.dataset.closing);
  document.getAnimations().forEach(animation=>animation.cancel());
  if(closing)sheet.close();
});

let lastTrigger=null;
document.addEventListener('click',event=>{const button=event.target.closest('button');if(button&&!sheet.open)lastTrigger=button;},true);
function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
const themePreference=matchMedia('(prefers-color-scheme: light)');
function syncBrowserTheme(){
  const light=document.documentElement.dataset.theme==='light'||(!document.documentElement.dataset.theme&&themePreference.matches);
  $('meta[name="theme-color"]').content=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  $('meta[name="apple-mobile-web-app-status-bar-style"]').content=light?'default':'black';
}
function setTheme(value){
  const theme=['light','dark','system'].includes(value)?value:'system';
  if(theme==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme;
  $('#theme').value=theme;storage.set('remote-theme',theme);syncBrowserTheme();
}
themePreference.addEventListener('change',syncBrowserTheme);
setTheme(storage.get('remote-theme')||'system');

const canVibrate=typeof navigator.vibrate==='function';
const AudioEngine=window.AudioContext||window.webkitAudioContext;
let soundEnabled=storage.get('remote-sounds')!=='false';
let vibrationEnabled=storage.get('remote-vibration')!=='false';
let feedbackAudio=null,lastFeedback=-Infinity;
function tapFeedback(){
  if(document.hidden||performance.now()-lastFeedback<45)return;
  lastFeedback=performance.now();
  if(vibrationEnabled&&canVibrate){try{navigator.vibrate(12);}catch{}}
  if(!soundEnabled||!AudioEngine)return;
  const started=performance.now();
  try{
    feedbackAudio??=new AudioEngine();
    const context=feedbackAudio;
    const play=()=>{
      if(!soundEnabled||document.hidden||performance.now()-started>180||context.state!=='running')return;
      const oscillator=context.createOscillator(),gain=context.createGain(),now=context.currentTime;
      oscillator.type='sine';
      oscillator.frequency.setValueAtTime(850,now);
      oscillator.frequency.exponentialRampToValueAtTime(250,now+.025);
      gain.gain.setValueAtTime(.0001,now);
      gain.gain.exponentialRampToValueAtTime(.08,now+.002);
      gain.gain.exponentialRampToValueAtTime(.0001,now+.03);
      oscillator.connect(gain);gain.connect(context.destination);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
      oscillator.start(now);oscillator.stop(now+.035);
    };
    if(context.state==='running')play();else void context.resume().then(play).catch(()=>{});
  }catch{}
}
$('#button-sounds').checked=soundEnabled;
$('#button-sounds').disabled=!AudioEngine;
$('#vibration-setting').hidden=!canVibrate;
$('#button-vibration').checked=vibrationEnabled;
$('#feedback-help').textContent='Soft clicks use your phone’s media volume.';
$('#button-sounds').onchange=event=>{
  soundEnabled=event.target.checked;storage.set('remote-sounds',String(soundEnabled));
  if(soundEnabled)tapFeedback();
};
$('#button-vibration').onchange=event=>{
  vibrationEnabled=event.target.checked;storage.set('remote-vibration',String(vibrationEnabled));
  if(vibrationEnabled&&canVibrate){try{navigator.vibrate(12);}catch{}}
};
document.addEventListener('click',event=>{
  if(!event.isTrusted)return;
  const button=event.target.closest('#remote-screen button,#sheet .key');
  if(!button||button.disabled||button.closest('fieldset:disabled')||(button.id==='touchpad'&&event.detail!==0)||(button.closest('#dpad[data-joystick]')&&event.detail!==0))return;
  tapFeedback();
},true);

const noticeTimings={info:2500,error:5000,exit:120},noticeStates=new Map();let lastPollError='';
function noticeState(element){if(!noticeStates.has(element))noticeStates.set(element,{token:0,timer:null,deadline:0,closing:false,message:'',error:false});return noticeStates.get(element);}
function dismissNotice(element,immediate=false){
 const state=noticeState(element),token=++state.token;clearTimeout(state.timer);state.timer=null;state.deadline=0;state.closing=true;activeMotion.get(element)?.cancel();
 const animation=!immediate&&!element.hidden?animateUI(element,[{opacity:1},{opacity:0}],noticeTimings.exit,{id:'toast-exit'}):null;
 const finish=()=>{if(state.token===token){element.hidden=true;state.closing=false;}};
 if(animation)animation.finished.then(finish,()=>{});else finish();
}
function expireNotice(element){const state=noticeState(element);state.timer=null;if(element.hidden||!state.deadline||element.contains(document.activeElement))return;dismissNotice(element);}
function notify(message,{error=false}={}){
 const element=sheet.open?$('#sheet-notice'):$('#notice'),state=noticeState(element);message=String(message||'');
 if(!message){dismissNotice(element,true);return;}
 if(!element.hidden&&!state.closing&&state.message===message&&state.error===error)return;
 clearTimeout(state.timer);state.token++;state.closing=false;activeMotion.get(element)?.cancel();state.message=message;state.error=error;
 if(sheet.open){dismissNotice($('#notice'),true);element.textContent=message;}else $('#notice-text').textContent=message;
 element.hidden=false;const duration=error?(sheet.open?0:noticeTimings.error):noticeTimings.info;state.deadline=duration?Date.now()+duration:0;state.timer=duration?setTimeout(()=>expireNotice(element),duration):null;
}
for(const element of [$('#notice'),$('#sheet-notice')]){
 element.addEventListener('focusin',()=>{const state=noticeState(element);clearTimeout(state.timer);state.timer=null;});
 element.addEventListener('focusout',event=>{if(element.contains(event.relatedTarget))return;const state=noticeState(element);if(state.deadline&&!element.hidden){clearTimeout(state.timer);state.timer=setTimeout(()=>expireNotice(element),Math.max(0,state.deadline-Date.now()));}});
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)for(const [element,state]of noticeStates)if(state.deadline&&Date.now()>=state.deadline)expireNotice(element);});
function saveSnapshot(data){snapshot=data;helperOnline=true;lastPollError='';render();}
async function request(path,data){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),path.startsWith('catalog/')||path.startsWith('subtitles/')?55000:path==='launch'?20000:10000);
  try{
    const response=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+access,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data),signal:controller.signal,cache:'no-store'});
    let result;try{result=await response.json();}catch{throw new Error('The helper returned an unreadable response. Restart it on your PC.');}
    if(!response.ok){
      if(response.status===401){helperOnline=false;access='';storage.remove('remote-access');if(sheet.open)sheet.close();render();}
      throw new Error(result.error||'The request could not be completed.');
    }
    return result;
  }catch(error){
    if(error.name==='AbortError'&&path.startsWith('catalog/'))throw new Error('Movie search took too long. Try again, or use a video link.');
    if(error.name==='AbortError'||error instanceof TypeError){helperOnline=false;render();throw new Error('Cannot reach your PC. Keep it awake, run Start Remote, and connect this phone to the same Wi-Fi.');}
    throw error;
  }finally{clearTimeout(timer);}
}
async function action(path,data={},button=null,success=''){
  if(button?.dataset.busy==='true')return false;
  if(button){button.dataset.busy='true';button.classList.add('pending');button.disabled=true;}
  inFlight++;
  try{const result=await request(path,data);saveSnapshot(result);if(path==='launch'&&result.launchResult?.message)notify(result.launchResult.message);else if(success)notify(success);return true;}
  catch(error){notify(error.message,{error:true});return false;}
  finally{inFlight--;if(button){delete button.dataset.busy;button.classList.remove('pending');button.disabled=false;}render();}
}
async function poll(){
  if(polling||!access||document.hidden||inFlight)return;
  polling=true;
  try{saveSnapshot(await request('state'));}
  catch(error){if(access&&lastPollError!==error.message){lastPollError=error.message;notify(error.message,{error:true});}}
  finally{polling=false;}
}
function tvEnabled(){return helperOnline&&snapshot?.state==='connected';}
function render(){
  window.refreshPickers?.();
  window.renderCast?.();
  window.renderUpdateNotifications?.();
  $('#access-screen').hidden=Boolean(access);
  $('#remote-screen').hidden=!access||view!=='remote';
  $('#settings-screen').hidden=!access||view!=='settings';
  $('#settings-button').hidden=!access||view==='settings';
  $('#back-settings').hidden=view!=='settings'||!access;
  $('#page-title').textContent=view==='settings'&&access?'Settings':'TV Remote';
  const profile=snapshot?.profile;
  $('#welcome').hidden=Boolean(profile);$('#configured').hidden=!profile;
  const waitingForPC=Boolean(access)&&!helperOnline&&!snapshot;
  $('#welcome h2').textContent=waitingForPC?'Waiting for your PC':'Connect your Samsung TV';
  $('#welcome p:not(.help)').textContent=waitingForPC?'Open Start Remote on your PC and connect to the same home Wi-Fi.':'Control your Samsung TV from this browser, through your Windows PC.';
  $('#first-connect').hidden=waitingForPC;
  $('#first-connect').disabled=!helperOnline;
  $('#welcome .help').textContent=waitingForPC?'The app can open offline, but TV control needs the PC helper.':'Keep your PC and TV on the same network. You’ll approve the first connection on your TV.';
  if(profile){$('#tv-name').textContent=profile.name;$('#settings-tv-name').textContent=profile.name;}
  else{$('#settings-tv-name').textContent='Connect a TV';}
  const connected=tvEnabled(),connecting=helperOnline&&snapshot?.state==='connecting',retrying=helperOnline&&snapshot?.state==='reconnecting';
  const connectionText=!helperOnline?'PC not reachable':connected?'Connected on your network':connecting?(snapshot?.paired?'Reconnecting…':'Waiting for TV permission'):retrying?'Waiting for TV':snapshot?.state==='failed'?'Connection needs attention':'Not connected';
  if($('#connection-label').textContent!==connectionText){$('#connection-label').textContent=connectionText;animateUI($('.connection'),[{opacity:.35},{opacity:1}],180);}
  $('#status-icon').src='/icons/'+(connected?'wifi':'wifi-off')+'.svg';
  $('#connection-message').hidden=connected;
  $('#connection-message').textContent=!helperOnline?'Keep the PC awake and the helper running.':snapshot?.message||'';
  $('#wake').hidden=connected||connecting||!profile?.mac;
  $('#wake').disabled=!helperOnline||$('#wake').dataset.busy==='true';
  $('#power').disabled=!helperOnline||!profile||$('#power').dataset.busy==='true';
  $('#power').setAttribute('aria-label',connected?'Turn off TV':'Wake TV');
  $('#power').title=connected?'Turn off TV':'Send a wake request';
  $$('.requires-tv').forEach(el=>el.disabled=!connected||el.dataset.busy==='true');

  if(sheetKind==='shortcuts'&&sheet.open)renderApps();
  updatePairing();
  renderQuickApps();
  $('#settings-connection').textContent=$('#connection-label').textContent;
  $('#auto-reconnect').checked=snapshot?.autoReconnect!==false;
  $('#auto-reconnect').disabled=!helperOnline||$('#auto-reconnect').dataset.busy==='true';
  $('#settings-connect').textContent=connecting?'Cancel connection':retrying?'Try now':'Connect to TV';
  $('#settings-connect').hidden=connected;
  $('#settings-connect').disabled=!helperOnline||!profile||$('#settings-connect').dataset.busy==='true';
  if($('#forget'))$('#forget').disabled=!helperOnline||!snapshot?.paired;
  if($('#confirm-forget'))$('#confirm-forget').disabled=!helperOnline||!snapshot?.paired||$('#confirm-forget').dataset.busy==='true';
  if($('#disconnect'))$('#disconnect').disabled=!helperOnline||!['connecting','connected','reconnecting'].includes(snapshot?.state)||$('#disconnect').dataset.busy==='true';
  $('#dpad').hidden=mode!=='buttons';$('#touchpad').hidden=mode!=='touchpad';
  $('.segmented').dataset.mode=mode;
  $('#mode-buttons').setAttribute('aria-pressed',String(mode==='buttons'));$('#mode-touchpad').setAttribute('aria-pressed',String(mode==='touchpad'));
  if(!tvEnabled()||view!=='remote'||mode!=='buttons'||sheet.open)window.stopRemoteStick?.();
}
function showView(next,{animate=true}={}){const changed=view!==next;activeMotion.get($('#settings-screen'))?.cancel();activeMotion.get($('.controls'))?.cancel();view=next;render();window.scrollTo(0,0);if(next==='remote'&&snapshot?.profile)$('#header-settings').focus({preventScroll:true});else{$('#page-title').tabIndex=-1;$('#page-title').focus({preventScroll:true});}if(changed&&animate)animateUI(next==='settings'?$('#settings-screen'):$('.controls'),[{opacity:0,transform:'translateX('+(next==='settings'?28:-28)+'px)'},{opacity:1,transform:'none'}],motionTokens.content,{id:'view-change'});}
function openSheet(kind,title,html){
  if(sheet.open)return;
  dismissNotice($('#notice'),true);dismissNotice($('#sheet-notice'),true);
  sheetKind=kind;sheet.dataset.kind=kind;returnFocus=lastTrigger||document.activeElement;
  $('#sheet-title').textContent=title;$('#sheet-body').innerHTML=html;delete $('#sheet-body').dataset.motionScreen;
  $('#sheet-notice').hidden=true;$('#discard-prompt').hidden=true;
  sheet.showModal();sheet.scrollTop=0;$('#sheet-body').scrollTop=0;document.body.style.overflow='hidden';
  originalForm=formValue();render();$('#sheet-title').focus({preventScroll:true});revealSheet();
}
function formValue(){const form=$('#sheet-body form');return form?JSON.stringify([...new FormData(form)]):'';}
let discardContinuation=null;
function requestClose(continuation=null){
  discardContinuation=typeof continuation==='function'?continuation:null;
  if($('#sheet-body [data-busy="true"]')){notify('Wait for the current action to finish.');return;}
  if((['tv','shortcuts'].includes(sheetKind)&&originalForm!==formValue())||window.subtitleDraftDirty?.(Boolean(discardContinuation))){$('#discard-prompt').hidden=false;$('#keep-editing').focus();return;}
  if(discardContinuation){const next=discardContinuation;discardContinuation=null;next();}else dismissSheet();
}
sheet.addEventListener('cancel',event=>{event.preventDefault();requestClose();});
sheet.addEventListener('close',()=>{dismissNotice($('#sheet-notice'),true);settleContentTransition();preparedScreens.delete($('#sheet-body'));activeMotion.get(sheetPanel)?.cancel();delete sheet.dataset.closing;document.body.style.overflow='';const target=returnFocus?.isConnected?returnFocus:$('#header-settings');sheetKind='';target?.focus({preventScroll:true});});
$('#close-sheet').onclick=requestClose;
$('#keep-editing').onclick=()=>{discardContinuation=null;$('#discard-prompt').hidden=true;($('#subtitle-delay')||$('#sheet-body input:not([type="file"])')||$('#subtitle-apply'))?.focus();};
$('#discard-edits').onclick=()=>{const next=discardContinuation;discardContinuation=null;if(next)next();else dismissSheet();};
$('#dismiss-notice').onclick=()=>dismissNotice($('#notice'));
$('#settings-button').onclick=()=>showView('settings');
$('#header-settings').onclick=()=>showView('settings');
$('#back-settings').onclick=leaveSettings;

// Swipe right within Settings. Native vertical scrolling and pinch zoom remain available.
const settingsSurface=$('#settings-screen');
let settingsGesture=null,settingsLeaving=false,suppressSettingsClick=false;
function resetSettingsSwipe(){
  settingsGesture=null;
  const offset=settingsSurface.style.transform;
  settingsSurface.style.transform='';
  if(offset)animateUI(settingsSurface,[{transform:offset},{transform:'translateX(0)'}],220);
}
function leaveSettings(){
  if(settingsLeaving||sheet.open||view!=='settings')return;
  if(!settingsGesture?.claimed&&!settingsSurface.style.transform){showView('remote');return;}
  settingsGesture=null;settingsLeaving=true;
  const start=settingsSurface.style.transform||'translateX(0)';
  settingsSurface.style.transform='';
  const animation=animateUI(settingsSurface,[{transform:start,opacity:1},{transform:'translateX('+settingsSurface.clientWidth+'px)',opacity:0}],220);
  const finish=()=>{settingsLeaving=false;if(view==='settings')showView('remote',{animate:false});};
  if(animation)animation.finished.then(finish,finish);else finish();
}
settingsSurface.addEventListener('pointerdown',event=>{
  suppressSettingsClick=false;
  if(settingsLeaving||sheet.open||view!=='settings'||event.pointerType!=='touch')return;
  if(!event.isPrimary){resetSettingsSwipe();return;}
  if(event.target.closest('input,select,textarea,label,[role="slider"]'))return;
  activeMotion.get(settingsSurface)?.cancel();
  settingsGesture={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,claimed:false};
});
document.addEventListener('pointermove',event=>{
  const gesture=settingsGesture;
  if(!gesture||event.pointerId!==gesture.id)return;
  if(sheet.open||view!=='settings'){resetSettingsSwipe();return;}
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
  if(!gesture.claimed){
    if(Math.abs(dy)>12||dx < -12){resetSettingsSwipe();return;}
    if(dx<12||dx<Math.abs(dy)*1.4)return;
    gesture.claimed=true;suppressSettingsClick=true;
    try{settingsSurface.setPointerCapture(event.pointerId);}catch{resetSettingsSwipe();return;}
  }
  gesture.dx=Math.max(0,Math.min(dx,settingsSurface.clientWidth));
  if(!motionPreference.matches)settingsSurface.style.transform='translateX('+gesture.dx+'px)';
});
document.addEventListener('pointerup',event=>{
  const gesture=settingsGesture;if(!gesture||event.pointerId!==gesture.id)return;
  const threshold=Math.max(72,Math.min(120,settingsSurface.clientWidth*.25));
  if(gesture.claimed&&gesture.dx>=threshold)leaveSettings();else resetSettingsSwipe();
});
document.addEventListener('pointercancel',event=>{
  if(settingsGesture?.id===event.pointerId)resetSettingsSwipe();
});
document.addEventListener('click',event=>{
  if(!suppressSettingsClick)return;
  suppressSettingsClick=false;event.preventDefault();event.stopImmediatePropagation();
},true);
document.addEventListener('pointerdown',event=>{
  if(event.isPrimary)suppressSettingsClick=false;
  else if(settingsGesture)resetSettingsSwipe();
},true);
window.addEventListener('blur',resetSettingsSwipe);
motionPreference.addEventListener('change',()=>{if(motionPreference.matches)settingsSurface.style.transform='';});

$('#theme').onchange=event=>setTheme(event.target.value);
$('#auto-reconnect').onchange=event=>action('preferences',{autoReconnect:event.target.checked},event.target);
$('#settings-connect').onclick=()=>action(snapshot?.state==='connecting'?'disconnect':'connect',{},$('#settings-connect'));
let accessSubmitting=false;
$('#access-form').onsubmit=async event=>{
  event.preventDefault();if(accessSubmitting)return;
  const raw=$('#access-input').value.trim();let value=raw;
  try{value=new URLSearchParams(new URL(raw).hash.slice(1)).get('access')||raw;}catch{}
  if(!/^[a-f0-9]{64}$/.test(value)){notify('Paste the complete private link from your PC.',{error:true});return;}
  const button=$('#open-remote');
  accessSubmitting=true;button.disabled=true;button.textContent='Connecting…';
  access=value;$('#notice').hidden=true;
  try{
    await poll();
    if(helperOnline&&access){
      storage.set('remote-access',access);$('#access-input').value='';showView('remote');
    }else{
      access='';storage.remove('remote-access');render();
    }
  }finally{
    accessSubmitting=false;button.disabled=false;button.textContent='Connect';
  }
};

$('#connection-link-help').onclick=()=>{
  openSheet('link-help','Get your private link',
    '<ol class="help-steps"><li>On your PC, open the Remote APP folder and double-click <strong>Start Remote.cmd</strong>.</li><li>The <strong>Connect your phone</strong> page opens. Choose <strong>Copy private link</strong> below its QR code.</li><li>Send the copied link to your iPhone and open it in Safari, or paste it into this app.</li></ol>'+
    '<p class="help">You can reopen that page on Windows: press <strong>Win + R</strong>, paste this path, and press Enter.</p>'+
    '<label for="launcher-path">Windows path</label><input id="launcher-path" readonly value="%LOCALAPPDATA%&#92;TVRemote&#92;Open Remote.html">'+
    '<p class="help">The link includes your access key. Keep it private. You do not need to find or type a separate key.</p>');
};

let qrScanController=null;
sheet.addEventListener('close',()=>{qrScanController?.abort();qrScanController=null;});
$('#scan-connection').onclick=()=>{
  openSheet('scanner','Read a QR photo',

    '<p class="sheet-intro">Choose a clear photo of the QR on your PC. Keep the whole code visible.</p>'+
    '<div class="sheet-actions photo-options"><button id="take-qr-photo"><img src="/icons/camera.svg" alt="">Take Photo</button><button id="choose-qr-image"><img src="/icons/image.svg" alt="">Choose Image</button></div>'+
    '<input id="qr-camera-file" type="file" accept="image/*" capture="environment" hidden>'+
    '<input id="qr-image-file" type="file" accept="image/*" hidden>'+
    '<p id="qr-progress" class="help" role="status">Photos stay on your phone. For a direct scan, use iPhone Camera and tap the QR link.</p>');
  const camera=$('#qr-camera-file'),picker=$('#qr-image-file');
  $('#take-qr-photo').onclick=()=>camera.click();
  $('#choose-qr-image').onclick=()=>picker.click();
  async function scan(event){
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    qrScanController?.abort();const controller=new AbortController();qrScanController=controller;
    const buttons=[$('#take-qr-photo'),$('#choose-qr-image')],progress=$('#qr-progress');
    buttons.forEach(button=>button.disabled=true);progress.textContent='Reading the QR…';$('#sheet-notice').hidden=true;
    try{
      const {readConnectionPhoto}=await import('/qr-reader.js');
      const value=await readConnectionPhoto(file,{signal:controller.signal,origin:location.origin});
      if(controller.signal.aborted||!sheet.open||sheetKind!=='scanner')return;
      $('#access-input').value=value;
      sheet.close();$('#access-form').requestSubmit();
    }catch(error){
      if(controller.signal.aborted||!sheet.open||sheetKind!=='scanner')return;
      notify(error.message||'Could not scan that image. Try another photo or paste the private link.',{error:true});
      progress.textContent='Crop the image to just the QR and try again. You can also scan the PC’s QR directly with the iPhone Camera.';
    }finally{buttons.forEach(button=>button.disabled=false);}
  }
  camera.onchange=scan;picker.onchange=scan;
};

let connectionFlow=null,discoveryVersion=0;
function connectionContent(title,html,kind='connection',depth=1){
  discoveryVersion++;
  const motionKey='connection:'+kind+':'+depth+':'+title;
  window.remoteMotion.prepare($('#sheet-body'),motionKey);
  sheetKind=kind;sheet.dataset.kind=kind;
  $('#sheet-title').textContent=title;$('#sheet-body').innerHTML=html;
  $('#sheet-notice').hidden=true;$('#discard-prompt').hidden=true;
  originalForm=formValue();$('#sheet-body').scrollTop=0;
  window.remoteMotion.present($('#sheet-body'),motionKey);
  $('#sheet-title').focus({preventScroll:true});
}
const connectionIcon=name=>'<div class="connection-art"><img src="/icons/'+name+'.svg" alt=""></div>';
function tvChoice(p,description,id){
  return '<button class="device-choice" id="'+id+'"><img src="/icons/tv.svg" alt=""><span><strong>'+esc(p.name)+'</strong><small>'+esc(description)+'</small></span><img src="/icons/chevron-right.svg" alt=""></button>';
}
function editTV(){
  if(sheet.open)return;
  connectionFlow=null;
  openSheet('connection','Choose your TV','');
  showTVPicker();
}
function showTVPicker(){
  connectionFlow=null;
  const p=snapshot?.profile;
  connectionContent('Choose your TV',
    '<p class="sheet-intro">Turn your Samsung TV on and connect it to the same Wi-Fi as your phone and PC.</p>'+
    (p?'<div class="saved-device">'+tvChoice(p,tvEnabled()?'Connected · open remote':'Saved TV · tap to reconnect','saved-tv')+
    '<button class="text-action" id="edit-tv-details">Edit saved TV details</button></div>':'')+
    '<div id="discovery-results" class="device-results" aria-live="polite"></div>'+
    '<button id="search-tvs" class="'+(p?'':'primary ')+'wide">Find TVs on my network</button>'+
    '<button id="manual-tv" class="text-action wide">Enter an address manually</button>');
  if(p){
    $('#saved-tv').onclick=()=>prepareTV(p);
    $('#edit-tv-details').onclick=manualTV;
  }
  $('#search-tvs').onclick=findTVs;
  $('#manual-tv').onclick=()=>manualTV(false);
  if(!p)void findTVs();
}
async function findTVs(){
  const version=++discoveryVersion,button=$('#search-tvs'),results=$('#discovery-results');
  button.disabled=true;button.textContent='Searching your network…';
  results.innerHTML='<div class="discovery-empty"><img src="/icons/wifi.svg" alt=""><p>Looking for Samsung TVs</p><small>This usually takes a few seconds.</small></div>';
  results.setAttribute('aria-busy','true');
  try{
    const {devices}=await request('discover',{});
    if(version!==discoveryVersion||!sheet.open||sheetKind!=='connection')return;
    const list=devices.filter(device=>device.address!==snapshot?.profile?.address);
    results.innerHTML=list.length?'<p class="help">Select a TV to continue</p>'+list.map((p,i)=>tvChoice(p,p.model+' · '+p.address,'found-tv-'+i)).join(''):
      '<div class="discovery-empty"><img src="/icons/tv.svg" alt=""><p>'+(devices.length?'Your saved TV is available':(snapshot?.profile?'No other TVs found':'No TVs found'))+'</p><small>'+(devices.length?'Choose it above to continue.':'Make sure the TV is on. Guest Wi-Fi or a VPN can prevent discovery. You can also enter its address manually.')+'</small></div>';
    list.forEach((p,i)=>$('#found-tv-'+i).onclick=()=>prepareTV(p));
  }catch(error){
    if(version!==discoveryVersion||!sheet.open)return;
    results.innerHTML='<p class="help">'+esc(error.message)+'</p>';
  }finally{
    if(version===discoveryVersion&&sheet.open){button.disabled=false;button.textContent='Search again';results.setAttribute('aria-busy','false');}
  }
}
function prepareTV(p){
  connectionFlow={profile:p,stage:'ready'};
  if(p.address===snapshot?.profile?.address&&tvEnabled()){showPairing();return;}
  const changed=snapshot?.profile&&p.address!==snapshot.profile.address;
  connectionContent('Connect to '+p.name,
    connectionIcon('tv')+'<p class="connection-instruction">Ready to connect</p>'+
    '<p class="sheet-intro">If a permission message appears on your TV, select <strong>Allow</strong> for TV Remote.</p>'+
    '<p class="help">Keep a working remote or your USB keyboard nearby to approve it.</p>'+
    (changed?'<p class="help">Switching TVs replaces the saved pairing and custom app shortcuts.</p>':'')+
    '<button id="pair-tv" class="primary wide">Connect to this TV</button><button id="choose-another" class="text-action wide">Choose another TV</button>','connection',2);
  $('#pair-tv').onclick=()=>connectSelected(p,$('#pair-tv'));
  $('#choose-another').onclick=showTVPicker;
}
async function connectSelected(p,button){
  const same=p.address===snapshot?.profile?.address&&p.name===snapshot.profile.name&&p.mac===snapshot.profile.mac;
  if(await action(same?'connect':'profile',same?{}:{name:p.name,address:p.address,mac:p.mac||'',connect:true},button)){
    originalForm=formValue();connectionFlow={profile:p,stage:'pairing'};showPairing();
  }
}
function showPairing(){
  connectionFlow.stage='pairing';
  connectionContent('TV connection',connectionIcon('tv')+
    '<div class="pairing-status" role="status"><h3 id="pairing-title"></h3><p id="pairing-copy"></p></div>'+
    '<p id="pairing-help" class="help"></p><button id="pairing-primary" class="primary wide"></button>'+
    '<button id="pairing-choose" class="text-action wide">Choose another TV</button>','connection',3);
  $('#pairing-choose').onclick=showTVPicker;
  updatePairing();
}
function updatePairing(){
  if(!sheet.open||sheetKind!=='connection'||!$('#pairing-title')||!connectionFlow)return;
  const connected=tvEnabled(),waiting=helperOnline&&['connecting','reconnecting'].includes(snapshot?.state);
  $('#pairing-title').textContent=connected?'You’re connected':!helperOnline?'PC not reachable':waiting?(snapshot?.paired?'Connecting to your TV':'Check your TV'):connectionFlow.cancelled?'Connection paused':'Couldn’t connect';
  $('#pairing-copy').textContent=connected?connectionFlow.profile.name:!helperOnline?'Keep your PC awake with Start Remote running.':waiting?(snapshot?.paired?'Using your saved pairing. This may take a moment.':'Select Allow for TV Remote if the permission message appears.'):connectionFlow.cancelled?'Connect again whenever you’re ready.':snapshot?.message||'Turn your TV on and try again.';
  $('#pairing-help').textContent=connected?'Your connection is saved for next time.':waiting&&!snapshot?.paired?'Using a USB keyboard? Use the arrow keys to select Allow, then press Enter.':'';
  const button=$('#pairing-primary');
  button.textContent=connected?'Open remote':waiting?'Cancel connection':'Try again';
  button.disabled=!helperOnline||button.dataset.busy==='true';
  button.onclick=connected?()=>{sheet.close();showView('remote');}:waiting?()=>{connectionFlow.cancelled=true;return action('disconnect',{},button);}:()=>{connectionFlow.cancelled=false;return action('connect',{},button);};
  $('#pairing-choose').hidden=waiting;
}
function manualTV(saved=true){
  connectionFlow=null;
  const p=saved?snapshot?.profile||{name:'Samsung TV',address:'',mac:''}:{name:'Samsung TV',address:'',mac:''};
  connectionContent('TV details','<form id="tv-form"><p class="sheet-intro">Use this when your TV doesn’t appear in the network search.</p>'+
  '<label for="tv-label">TV name</label><input id="tv-label" name="name" maxlength="60" required value="'+esc(p.name)+'">'+
  '<label for="tv-address">TV IP address</label><input id="tv-address" name="address" type="text" inputmode="decimal" autocomplete="off" autocapitalize="none" spellcheck="false" required placeholder="192.168.0.25" value="'+esc(p.address)+'">'+
  '<p class="help">Find it in the TV’s network settings. Menu names vary by model.</p>'+
  '<label for="tv-mac">TV MAC address <span class="help">(optional)</span></label><input id="tv-mac" name="mac" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="AA:BB:CC:DD:EE:FF" value="'+esc(p.mac)+'">'+
  '<p class="help">Enables Wake TV when supported. A different TV address replaces the saved pairing and custom shortcuts.</p><button type="submit" class="primary wide" id="save-tv">Save and connect</button></form>','tv',2);
  $('#tv-form').onsubmit=async event=>{
    event.preventDefault();await connectSelected(Object.fromEntries(new FormData(event.target)),$('#save-tv'));
  };
}
$('#first-connect').onclick=editTV;$('#edit-tv').onclick=editTV;$('#settings-tv').onclick=editTV;
$('#wake').onclick=showWake;
function confirmSheet(kind,title,description,label,handler,success=''){
  openSheet(kind,title,'<p>'+esc(description)+'</p><div class="sheet-actions"><button id="confirm-action" class="primary">'+esc(label)+'</button><button id="cancel-action">Cancel</button></div>');
  $('#cancel-action').onclick=dismissSheet;
  $('#confirm-action').onclick=async()=>{if(await handler($('#confirm-action'))){sheet.close();if(success)notify(success);}};
}
function showWake(){
  if(!snapshot?.profile?.mac){
    openSheet('wake','Set up TV wake','<p class="sheet-intro">Save your TV’s MAC address to send wake requests. You can find it in the TV’s network information while the TV is on.</p><button id="wake-details" class="primary wide">Edit TV details</button>');
    $('#wake-details').onclick=()=>manualTV(true);return;
  }
  confirmSheet('wake','Wake your TV?','Send a wake request if your TV is in standby. Power On with Mobile must be enabled in the TV’s Network → Expert Settings. The TV must remain plugged in.','Send wake request',button=>action('wake',{},button),'Wake request sent. Waiting for the TV to connect. If it stays off, check Power On with Mobile on the TV.');
}
$('#power').onclick=()=>{
  if(!tvEnabled()){showWake();return;}
  confirmSheet('power','Turn off the TV?','After it disconnects, this same power button can send a wake request.','Turn off TV',button=>action('key',{key:'KEY_POWEROFF',confirm:true},button),'Power-off request sent.');
};
function sendKey(key,button=null){return action('key',{key:'KEY_'+key},button);}
document.addEventListener('click',event=>{const button=event.target.closest('.key');if(button&&!button.disabled&&!button.closest('fieldset:disabled'))sendKey(button.dataset.key,button);});
function changeMode(next){if(mode===next)return;mode=next;storage.set('remote-mode',mode);render();animateUI(mode==='buttons'?$('#dpad'):$('#touchpad'),[{opacity:.55},{opacity:1}],motionTokens.content);}
$('#mode-buttons').onclick=()=>changeMode('buttons');
$('#mode-touchpad').onclick=()=>changeMode('touchpad');
let gesture=null;
$('#touchpad').addEventListener('pointerdown',event=>{if(!tvEnabled()||!event.isPrimary)return;gesture={x:event.clientX,y:event.clientY,id:event.pointerId};event.currentTarget.setPointerCapture(event.pointerId);});
$('#touchpad').addEventListener('pointercancel',()=>gesture=null);
$('#touchpad').addEventListener('pointerup',event=>{if(!gesture||gesture.id!==event.pointerId)return;const x=event.clientX-gesture.x,y=event.clientY-gesture.y;gesture=null;tapFeedback();sendKey(Math.max(Math.abs(x),Math.abs(y))<18?'ENTER':Math.abs(x)>Math.abs(y)?(x>0?'RIGHT':'LEFT'):(y>0?'DOWN':'UP'));});
$('#touchpad').addEventListener('click',event=>{if(event.detail===0&&tvEnabled())sendKey('ENTER');});
document.addEventListener('keydown',event=>{
  if(sheet.open||view!=='remote'||!tvEnabled()||['INPUT','TEXTAREA','SELECT','BUTTON'].includes(event.target.tagName)||event.ctrlKey||event.metaKey||event.altKey)return;
  const keys={ArrowUp:'UP',ArrowDown:'DOWN',ArrowLeft:'LEFT',ArrowRight:'RIGHT',Enter:'ENTER',Backspace:'RETURN'};
  if(keys[event.key]){event.preventDefault();sendKey(keys[event.key]);}
});
function moreControls(){
  const key=(label,value)=>'<button class="key" data-key="'+value+'">'+label+'</button>';
  openSheet('more','More controls','<fieldset class="requires-tv"><div class="digits">'+[1,2,3,4,5,6,7,8,9].map(n=>key(n,n)).join('')+key('Guide','GUIDE')+key(0,0)+key('Info','INFO')+'</div><section class="sheet-section" aria-label="Playback"><div class="row two">'+key('Play','PLAY')+key('Pause','PAUSE')+'</div><div class="row three more-group">'+key('Rewind','REWIND')+key('Stop','STOP')+key('Fast forward','FF')+'</div></section><section class="sheet-section" aria-label="Channels"><div class="row two">'+key('Channel down','CHDOWN')+key('Channel up','CHUP')+'</div></section><section class="sheet-section" aria-label="Color buttons"><div class="row four">'+['Red','Green','Yellow','Blue'].map(color=>key(color,color.toUpperCase())).join('')+'</div></section></fieldset>');
}
$('#more').onclick=moreControls;
let appListSignature='';
function renderApps(){
  const list=$('#saved-apps');if(!list)return;
  const saved=snapshot?.shortcuts||[],available=snapshot?.apps||[];
  const signature=JSON.stringify([saved,available,tvEnabled()]);
  if(signature!==appListSignature){
    const focused=document.activeElement?.dataset;
    const focusID=focused?.app,focusClass=document.activeElement?.classList.contains('remove-app')?'remove-app':'save-app';
    appListSignature=signature;
    const rows=(apps,isSaved)=>apps.map(app=>'<div class="app-row"><button class="launch-app requires-tv" data-app="'+esc(app.appID)+'">'+esc(app.name)+'</button>'+
      '<button class="'+(isSaved?'remove-app':'save-app')+'" data-app="'+esc(app.appID)+'" aria-label="'+(isSaved?'Remove ':'Add ')+esc(app.name)+'">'+(isSaved?'<img src="/icons/minus.svg" alt="">':saved.some(s=>s.appID===app.appID)?'Added':'Add')+'</button></div>').join('');
    list.innerHTML=saved.length?rows(saved,true):'<p class="empty">Extra shortcuts you add will appear here and on your remote.</p>';
    const extra=available.filter(app=>!featuredApps.some(p=>p.appID===app.appID||p.aliases.includes(appNameKey(app.name))));
    $('#reported-apps').innerHTML=rows(extra,false);
    $$('#sheet-body .launch-app').forEach(button=>{
      button.disabled=!tvEnabled();
      button.onclick=()=>action('launch',[...saved,...available].find(a=>a.appID===button.dataset.app),button,'Launch request sent. If nothing opens, choose the app from TV Home.');
    });
    $$('#sheet-body .save-app').forEach(button=>{
      button.disabled=saved.some(a=>a.appID===button.dataset.app);
      button.onclick=()=>saveShortcut(available.find(a=>a.appID===button.dataset.app),button);
    });
    $$('#sheet-body .remove-app').forEach(button=>button.onclick=async()=>{
      if(await action('shortcuts',{shortcuts:snapshot.shortcuts.filter(a=>a.appID!==button.dataset.app)},button)){
        notify('Shortcut removed. The app stays installed on your TV.');
        $('#add-custom-shortcut').focus();
      }
    });
    if(focusID){const replacement=Array.from(document.querySelectorAll('#sheet-body .'+focusClass)).find(button=>button.dataset.app===focusID);const savedButton=Array.from(document.querySelectorAll('#saved-apps .launch-app')).find(button=>button.dataset.app===focusID);if(replacement&&!replacement.disabled)replacement.focus();else if(savedButton&&!savedButton.disabled)savedButton.focus();}
  }
  $$('#shortcut-featured button').forEach(button=>button.disabled=!tvEnabled()||button.dataset.busy==='true');
  const fetchButton=$('#fetch-apps');
  fetchButton.disabled=!tvEnabled()||snapshot.loadingApps||fetchButton.dataset.busy==='true';
  fetchButton.textContent=snapshot.loadingApps?'Checking your TV…':snapshot.appStatus==='unknown'?'Find apps on TV':'Check again';
  const message=!tvEnabled()?'Connect to your TV to find more apps.':snapshot.loadingApps?'Waiting for your TV to share its apps.':snapshot.appStatus==='unavailable'?'Your TV didn’t share an app list. Use TV Home to browse apps, or add a shortcut manually.':available.length?'Choose Add to put an app on your remote.':'Find more shortcuts without entering an app ID.';
  if($('#apps-result').textContent!==message)$('#apps-result').textContent=message;
}
async function saveShortcut(app,button){
  if(snapshot.shortcuts.some(a=>a.appID===app.appID)){notify('This app is already saved.');return false;}
  return action('shortcuts',{shortcuts:[...snapshot.shortcuts,app]},button);
}
function shortcutOverview(){
  appListSignature='';
  const html='<p class="sheet-intro">Open your favourites straight from the remote.</p>'+
    '<div id="shortcut-featured" class="shortcut-featured">'+featuredApps.map(app=>'<button data-brand="'+app.brand+'" aria-label="Open '+esc(app.name)+'"><img class="brand-logo brand-'+app.brand+'" src="/brands/'+app.brand+'.svg" alt=""></button>').join('')+'</div>'+
    '<p class="help shortcut-featured-note">These four are already on your remote.</p>'+
    '<section class="shortcut-section"><h3>Your added shortcuts</h3><div id="saved-apps" class="app-list"></div></section>'+
    '<section class="shortcut-section"><button id="fetch-apps" class="wide">Find apps on TV</button>'+
    '<p id="apps-result" class="help" role="status"></p><div id="reported-apps" class="app-list"></div></section>'+
    '<button id="add-custom-shortcut" class="text-action wide">Add a shortcut manually</button>';
  if(sheet.open)connectionContent('App shortcuts',html,'shortcuts');else openSheet('shortcuts','App shortcuts',html);
  $('#fetch-apps').onclick=()=>action('apps',{},$('#fetch-apps'));
  $('#add-custom-shortcut').onclick=shortcutEditor;
  $$('#shortcut-featured button').forEach(button=>button.onclick=()=>{
    const app=quickApps().find(a=>a.brand===button.dataset.brand);
    action('launch',{name:app.name,appID:app.appID,deepLink:app.deepLink},button,'Launch request sent. If nothing opens, choose the app from TV Home.');
  });
  renderApps();
  window.remoteMotion.present($('#sheet-body'),'connection:shortcuts:1:App shortcuts');
}
function shortcutEditor(){
  connectionContent('Add a shortcut',
    '<button id="back-shortcuts" class="text-action shortcut-back"><img src="/icons/arrow-left.svg" alt="">Back to shortcuts</button>'+
    '<form id="shortcut-form"><p class="sheet-intro">For apps with a known Samsung app ID. This adds a remote button; it doesn’t install an app.</p>'+
    '<label for="app-name">App name</label><input id="app-name" name="name" required maxlength="60" placeholder="Name on your remote">'+
    '<label for="app-id">Samsung app ID</label><input id="app-id" name="appID" required maxlength="160" autocapitalize="none" spellcheck="false" placeholder="Samsung app ID">'+
    '<label for="launch-mode">Launch mode</label><select id="launch-mode" name="mode"><option value="deep">Standard (deep link)</option><option value="native">Native launch</option></select>'+
    '<p class="help">Keep Standard unless the app’s instructions specify native launch.</p>'+
    '<button class="primary wide" id="save-app">Save shortcut</button></form>','shortcuts',2);
  $('#back-shortcuts').onclick=()=>requestClose(shortcutOverview);
  $('#shortcut-form').onsubmit=async event=>{
    event.preventDefault();const data=Object.fromEntries(new FormData(event.target));
    if(await saveShortcut({name:data.name,appID:data.appID,deepLink:data.mode==='deep'},$('#save-app'))){
      shortcutOverview();notify('Shortcut added to your remote.');
    }
  };
}
$('#manage-shortcuts').onclick=shortcutOverview;
$('#connection-help').onclick=()=>{
  openSheet('help','Connection help',
    '<p class="sheet-intro">Keep your phone, TV, and PC on the same Wi-Fi, with the PC awake and Start Remote running.</p>'+
    '<p class="help">After the TV turns on, give it a moment to reconnect. If its address changes, update TV connection in Settings.</p>'+
    '<div class="connection-tools"><button id="disconnect" class="wide">Disconnect TV</button><p class="help">Disconnect pauses automatic retries until you connect again.</p>'+
    '<button id="forget" class="danger wide">Forget TV pairing</button>'+
    '<div id="forget-confirmation" hidden><p>You’ll need to approve this remote on the TV again. Only forget pairing when you can select Allow on your TV.</p>'+
    '<div class="row two"><button id="cancel-forget">Keep pairing</button><button id="confirm-forget" class="danger">Forget pairing</button></div></div></div>');
  $('#disconnect').onclick=()=>action('disconnect',{},$('#disconnect'),'Disconnected. You can reconnect from Settings.');
  $('#forget').onclick=()=>{$('#forget').hidden=true;$('#forget-confirmation').hidden=false;$('#cancel-forget').focus();};
  $('#cancel-forget').onclick=()=>{$('#forget-confirmation').hidden=true;$('#forget').hidden=false;$('#forget').focus();};
  $('#confirm-forget').onclick=async()=>{if(await action('forget',{confirm:true},$('#confirm-forget'))){sheet.close();}};
  render();
};
const featuredApps=[
  {name:'YouTube',appID:'111299001912',deepLink:true,brand:'youtube',aliases:['youtube']},
  {name:'Netflix',appID:'3201907018807',deepLink:true,brand:'netflix',aliases:['netflix']},
  {name:'Prime Video',appID:'3201910019365',deepLink:true,brand:'primevideo',aliases:['primevideo','amazonprimevideo','amazonprime','amazon']},
  {name:'Disney+',appID:'3201901017640',deepLink:true,brand:'disneyplus',aliases:['disney','disneyplus']}
];
const appNameKey=name=>String(name).toLowerCase().replace(/\+/g,'plus').replace(/[^a-z0-9]/g,'');
function quickApps(){
  const saved=snapshot?.shortcuts||[],available=snapshot?.apps||[];
  const matches=(preset,app)=>app.appID===preset.appID||preset.aliases.includes(appNameKey(app.name));
  const featured=featuredApps.map(preset=>{
    const resolved=saved.find(app=>matches(preset,app))||available.find(app=>matches(preset,app))||preset;
    return {name:preset.name,appID:resolved.appID,deepLink:resolved.deepLink,brand:preset.brand};
  });
  return [...featured,...saved.filter(app=>!featuredApps.some(preset=>matches(preset,app)))];
}
function renderQuickApps(){
  const container=$('#quick-apps'),apps=quickApps();
  container.hidden=false;
  const signature=JSON.stringify(apps);
  if(container.dataset.signature!==signature){
    container.dataset.signature=signature;
    container.innerHTML=apps.map(app=>'<button class="quick-launch requires-tv" data-app="'+esc(app.appID)+'" aria-label="'+esc(app.name)+'" title="'+esc(app.name)+'">'+(app.brand?'<img class="brand-logo brand-'+app.brand+'" src="/brands/'+app.brand+'.svg" alt="">':esc(app.name))+'</button>').join('');
  }
  container.querySelectorAll('.quick-launch').forEach(button=>button.disabled=!tvEnabled()||button.dataset.busy==='true');
}
$('#quick-apps').onclick=event=>{
  const button=event.target.closest('.quick-launch');if(!button||button.disabled)return;
  const app=quickApps().find(app=>app.appID===button.dataset.app);
  if(app)action('launch',{name:app.name,appID:app.appID,deepLink:app.deepLink},button,'Launch request sent. If the app does not open, choose it from TV Home.');
};
window.addEventListener('online',poll);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
render();poll();setInterval(poll,1500);

// Safari may still double-tap zoom between disabled/enabled button states.
// Cancel only a second stationary single-finger tap; preserve scrolling and pinch.
const remoteSurface=$('#remote-screen');
let touchStart=null,lastTouch=null;
remoteSurface.addEventListener('touchstart',event=>{
  if(event.target.closest('#dpad[data-joystick]')||window.isVolumeHoldControl?.(event.target.closest('button'))){touchStart=null;lastTouch=null;return;}
  if(event.touches.length!==1){touchStart=null;lastTouch=null;return;}
  const touch=event.touches[0];
  touchStart={target:event.target,x:touch.clientX,y:touch.clientY,time:performance.now()};
},{passive:true});
remoteSurface.addEventListener('touchmove',event=>{
  if(!touchStart||event.touches.length!==1){touchStart=null;lastTouch=null;return;}
  const touch=event.touches[0];
  if(Math.hypot(touch.clientX-touchStart.x,touch.clientY-touchStart.y)>12){touchStart=null;lastTouch=null;}
},{passive:true});
remoteSurface.addEventListener('touchcancel',()=>{touchStart=null;lastTouch=null;},{passive:true});
remoteSurface.addEventListener('touchend',event=>{
  if(!touchStart||event.touches.length){touchStart=null;return;}
  const tap=touchStart;touchStart=null;
  if(performance.now()-tap.time>500){lastTouch=null;return;}
  const button=tap.target.closest('button');
  const sameTarget=lastTouch&&(button?button===lastTouch.button:tap.target===lastTouch.target);
  if(sameTarget&&tap.time-lastTouch.time<350&&Math.hypot(tap.x-lastTouch.x,tap.y-lastTouch.y)<24){
    event.preventDefault();
    // Suppressing the compatibility click must not swallow the second command.
    // The touchpad already sends from pointerup and must not send a second time.
    if(button&&button.id!=='touchpad'&&!button.disabled&&!button.closest('fieldset:disabled'))button.click();
  }
  lastTouch={...tap,button};
},{passive:false});
remoteSurface.addEventListener('dblclick',event=>event.preventDefault());
let pressedButton=null,pressedAt=0;
function releasePress(immediate=false){
  const button=pressedButton;pressedButton=null;
  if(!button)return;
  setTimeout(()=>{if(pressedButton!==button)button.classList.remove('pressed');},immediate?0:Math.max(0,80-(performance.now()-pressedAt)));
}
document.addEventListener('pointerdown',event=>{
  const button=event.target.closest('.key,.tool-dock button,.quick-apps button,.power');
  if(!event.isPrimary||!button||button.disabled||button.closest('fieldset:disabled'))return;
  releasePress(true);pressedButton=button;pressedAt=performance.now();button.classList.add('pressed');
});
document.addEventListener('pointerup',()=>releasePress());
document.addEventListener('pointercancel',()=>releasePress(true));
window.addEventListener('blur',()=>releasePress(true));

let sheetViewportFrame=0,sheetViewportGeometry=null;
function readSheetViewport(){
  const viewport=window.visualViewport;
  return {height:viewport?.height||innerHeight,top:viewport?.offsetTop||0,width:viewport?.width||innerWidth};
}
function syncSheetViewport(){
  const {height,top,width}=readSheetViewport();sheetViewportGeometry={height,top,width};
  sheet.style.setProperty('--sheet-height',height+'px');
  sheet.style.setProperty('--sheet-top',top+'px');
  window.positionOpenPicker?.();
}
function scheduleSheetViewport(){
  const next=readSheetViewport();
  if(sheetViewportGeometry&&Object.keys(next).every(key=>Math.abs(next[key]-sheetViewportGeometry[key])<.5))return;
  settleContentTransition();
  window.settleMovieTabs?.();
  activeMotion.get($('#library-page-content'))?.cancel();activeMotion.get($('#sheet-body'))?.cancel();
  // Cancel a moving surface before the browser changes keyboard/viewport geometry.
  if(!sheet.dataset.closing)activeMotion.get(sheetPanel)?.cancel();
  cancelAnimationFrame(sheetViewportFrame);
  sheetViewportFrame=requestAnimationFrame(syncSheetViewport);
}
window.visualViewport?.addEventListener('resize',scheduleSheetViewport);
window.visualViewport?.addEventListener('scroll',scheduleSheetViewport);
window.addEventListener('resize',scheduleSheetViewport);
function syncSheetFocus(event){
  const text=event.target.matches?.('textarea,input:not([type="range"]):not([type="checkbox"]):not([type="file"]),[contenteditable="true"]');
  // A focus event is not proof that iOS presented its software keyboard.
  // Leave its native activation alone; actual viewport events own geometry.
  if(text)window.remoteMotion?.settleSurface();
}
sheet.addEventListener('focusin',syncSheetFocus);
syncSheetViewport();

$('#about-remote').onclick=()=>openSheet('about','About TV Remote','<div class="metadata-credit"><a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" aria-label="The Movie Database, opens in a new tab"><img src="/brands/tmdb.svg" alt="TMDB"></a><p>Movie artwork and audience scores come from The Movie Database.</p><p class="help">This product uses the TMDB API but is not endorsed or certified by TMDB.</p><a class="keyboard-check-link" href="/keyboard-check.html">Check iPhone keyboard</a></div>');
