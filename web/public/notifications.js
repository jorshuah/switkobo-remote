'use strict';
(()=>{
 const row=$('#update-notifications');if(!row)return;
 const intentKey='remote-update-notifications',pendingKey='remote-push-cleanup';
 let registration=null,config=null,subscription=null,id=null,busy=false,loading=false,error='',feedback='';
 const ios=()=>/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const installed=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 function limitation(){
  if(!isSecureContext)return 'Use the secure app address from your PC’s connection page to enable notifications.';
  if(ios()&&!installed())return 'On iPhone, open TV Remote from your Home Screen to enable notifications. In Safari, use Share → Add to Home Screen first.';
  if(!('Notification'in window)||!('PushManager'in window)||!navigator.serviceWorker)return 'This browser does not support app update notifications. The in-app Update prompt still works.';
  return '';
 }
 const open=()=>sheet.open&&sheetKind==='update-settings';
 function paint(){
  row.hidden=!(Number(snapshot?.notifications?.version)>=1);
  if(!open())return;
  const blocked=limitation(),denied=window.Notification?.permission==='denied',enabled=Boolean(subscription&&id);
  $('#update-notification-state').textContent=blocked?'Unavailable':denied?'Blocked':enabled?'On':loading?'Checking…':'Off';
  $('#update-notification-help').textContent=blocked||(denied?'Allow notifications for TV Remote in your device’s notification settings, then reopen the app.':!helperOnline?'Keep your PC awake and on the same network to change notification settings.':!(Number(snapshot?.notifications?.version)>=1)?'Restart the PC helper after watching to enable update notifications.':enabled?'You will receive an alert when a new app version is available.':'Notifications are optional. Updates will still appear inside the app.');
  const toggle=$('#toggle-update-notifications');toggle.textContent=busy?'Working…':enabled?'Turn off notifications':'Enable notifications';toggle.disabled=busy||loading||Boolean(blocked)||denied||!registration||!config||!helperOnline;
  $('#test-update-notification').hidden=!enabled;$('#test-update-notification').disabled=busy||!helperOnline;
  const status=$('#update-notification-status');status.textContent=error||feedback;status.classList.toggle('is-error',Boolean(error));status.hidden=!status.textContent;
  $('#retry-update-notifications').hidden=!error||busy||Boolean(blocked);$('#retry-update-notifications').disabled=loading;
 }
 function publicKey(value){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
 function sameKey(sub,key){const saved=sub.options?.applicationServerKey,wanted=publicKey(key);return saved&&saved.byteLength===wanted.length&&new Uint8Array(saved).every((n,i)=>n===wanted[i]);}
 async function cleanup(){const pending=storage.get(pendingKey);if(!pending)return;await request('push/unsubscribe',{id:pending});storage.remove(pendingKey);}
 async function refresh(){
  if(loading||busy)return;error='';loading=true;paint();
  try{
   if(limitation())return;
   registration=await Promise.resolve(window.remoteUpdateRegistration);if(!registration)throw Error('Offline app support is not ready. Reopen the secure app and try again.');
   if(!registration.active){let timer;try{registration=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Offline app support is still loading. Try again shortly.')),8000);})]);}finally{clearTimeout(timer);}}
   subscription=await registration.pushManager.getSubscription();id=null;
   config=await request('push/config');await cleanup();
   if(subscription&&storage.get(intentKey)==='off'){if(!await subscription.unsubscribe())throw Error('Notifications could not be turned off. Try again.');subscription=null;}
   if(subscription&&Notification.permission==='granted'){
    if(!sameKey(subscription,config.publicKey))throw Error('The PC notification key changed. Turn notifications on again to reconnect this device.');
    const saved=await request('push/subscribe',{subscription:subscription.toJSON()});id=saved.id;storage.set(intentKey,'on');
   }
  }catch(e){error=e.message;}finally{loading=false;paint();}
 }
 async function toggle(){
  if(busy||loading||limitation()||!config||!registration)return;
  busy=true;error='';feedback='';inFlight++;paint();
  try{
   if(subscription&&id){
    const oldId=id;storage.set(intentKey,'off');storage.set(pendingKey,oldId);
    if(!await subscription.unsubscribe())throw Error('Notifications could not be turned off. Try again.');
    subscription=null;id=null;
    try{await cleanup();feedback='Notifications are off on this device.';}catch{feedback='Notifications are off on this device. PC cleanup will finish when you reconnect.';}
   }else{
    // Request directly inside this trusted button action, before any network work.
    const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
    if(permission!=='granted'){feedback=permission==='denied'?'Notifications were not allowed. You can change this in your device’s notification settings.':'Notifications were not enabled.';return;}
    const existing=await registration.pushManager.getSubscription();
    if(existing&&!sameKey(existing,config.publicKey)){if(!await existing.unsubscribe())throw Error('The old notification connection could not be removed. Try again.');subscription=null;}else subscription=existing;
    subscription??=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKey(config.publicKey)});
    try{const result=await request('push/subscribe',{subscription:subscription.toJSON()});id=result.id;storage.set(intentKey,'on');feedback='Update notifications are on for this device.';}
    catch(e){await subscription.unsubscribe().catch(()=>{});subscription=null;throw e;}
   }
  }catch(e){error=e.name==='NotAllowedError'?'Your device did not allow notifications. Check its notification settings and try again.':e.name==='AbortError'?'The browser could not connect to its push service. Check your internet connection and trusted certificate, then try again.':e.message;}
  finally{inFlight--;busy=false;paint();}
 }
 async function test(){
  if(busy||!id)return;busy=true;error='';feedback='';inFlight++;paint();
  try{await request('push/test',{id});feedback='Test accepted by the push service. Check your device’s notifications.';}
  catch(e){error=e.message;}finally{inFlight--;busy=false;paint();}
 }
 row.onclick=()=>{
  openSheet('update-settings','App updates','<p class="sheet-intro">Get a notification when a new version is available, even when TV Remote is closed.</p><div class="notification-device"><span>This device</span><strong id="update-notification-state">Checking…</strong></div><p id="update-notification-help" class="help"></p><div class="sheet-actions"><button id="toggle-update-notifications" class="primary wide" disabled>Enable notifications</button><button id="test-update-notification" class="secondary-action wide" hidden>Send test notification</button></div><p id="update-notification-status" class="notification-status" role="status" hidden></p><button id="retry-update-notifications" class="catalog-back wide" hidden>Check again</button><p class="notification-offline-note">The app can open offline. TV control, search and streaming need your PC and network. Push notifications need internet, and the PC helper must be awake to send them.</p>');
  $('#toggle-update-notifications').onclick=toggle;$('#test-update-notification').onclick=test;$('#retry-update-notifications').onclick=refresh;paint();void refresh();
 };
 window.renderUpdateNotifications=paint;
 paint();
 window.addEventListener('pageshow',()=>{if(open())void refresh();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(open()||storage.get(intentKey)==='on'||storage.get(pendingKey)))void refresh();});
 if(storage.get(intentKey)==='on'||storage.get(pendingKey))Promise.resolve(window.remoteUpdateRegistration).then(()=>void refresh());
})();
