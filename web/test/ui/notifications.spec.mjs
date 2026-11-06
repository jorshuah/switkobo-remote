import {test,expect} from '@playwright/test';import {createECDH,randomBytes} from 'node:crypto';
test.use({serviceWorkers:'block'});
const key=createECDH('prime256v1');key.generateKeys();
const fixture={endpoint:'https://fcm.googleapis.com/push/ui-fixture',expirationTime:null,keys:{p256dh:key.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
async function mock(page,{installed=true,permission='default'}={}){
 await page.addInitScript(({fixture,installed,permission})=>{
  Object.defineProperty(navigator,'standalone',{configurable:true,value:installed});
  const notification={permission:sessionStorage.getItem('mock-permission')||permission,requestPermission:async()=>{window.__permissionCalls++;notification.permission=window.__permissionDecision||'granted';sessionStorage.setItem('mock-permission',notification.permission);return notification.permission;}};
  Object.defineProperty(window,'Notification',{configurable:true,value:notification});Object.defineProperty(window,'PushManager',{configurable:true,value:class{}});window.__permissionCalls=0;
  let current=null;
  function subscription(bytes){return {options:{applicationServerKey:Uint8Array.from(bytes).buffer},toJSON:()=>fixture,unsubscribe:async()=>{current=null;sessionStorage.removeItem('mock-subscription');return true;}};}
  const saved=sessionStorage.getItem('mock-subscription');if(saved)current=subscription(JSON.parse(saved));
  const registration={active:{},waiting:null,addEventListener(){},update:async()=>{},getNotifications:async()=>[],pushManager:{getSubscription:async()=>current,subscribe:async options=>{window.__subscribeOptions={visible:options.userVisibleOnly,keyLength:options.applicationServerKey.length};const bytes=[...options.applicationServerKey];sessionStorage.setItem('mock-subscription',JSON.stringify(bytes));current=subscription(bytes);return current;}}};
  Object.defineProperty(navigator.serviceWorker,'register',{configurable:true,value:async()=>registration});Object.defineProperty(navigator.serviceWorker,'getRegistration',{configurable:true,value:async()=>registration});
 },{fixture,installed,permission});
}
async function open(page){await page.locator('#header-settings').click();await page.locator('#update-notifications').click();}
test.beforeEach(async({request})=>{await request.get('/__test/reset');});
async function launch(page,options){await mock(page,options);await page.goto('/#access='+'a'.repeat(64));await expect(page.locator('#connection-label')).toHaveText('Connected on your network');}

test('notification permission is opt-in, persists and can be turned off per device',async({page,request})=>{
 await launch(page);expect(await page.evaluate(()=>window.__permissionCalls)).toBe(0);await open(page);await expect(page.locator('#toggle-update-notifications')).toBeEnabled();expect(await page.evaluate(()=>window.__permissionCalls)).toBe(0);
 await page.locator('#toggle-update-notifications').click();await expect(page.locator('#update-notification-state')).toHaveText('On');expect(await page.evaluate(()=>window.__permissionCalls)).toBe(1);expect(await page.evaluate(()=>window.__subscribeOptions)).toEqual({visible:true,keyLength:65});
 expect((await(await request.get('/__test/push-events')).json()).registrations).toBe(1);await page.reload();await open(page);await expect(page.locator('#update-notification-state')).toHaveText('On');expect(await page.evaluate(()=>window.__permissionCalls)).toBe(0);
 await page.locator('#toggle-update-notifications').click();await expect(page.locator('#update-notification-state')).toHaveText('Off');expect((await(await request.get('/__test/push-events')).json()).registrations).toBe(0);expect(await(await request.get('/__test/commands')).json()).toEqual([]);
});

test('a test notification reports service acceptance and updates are deduplicated by release',async({page,request})=>{
 await launch(page);await open(page);await expect(page.locator('#toggle-update-notifications')).toBeEnabled();await page.locator('#toggle-update-notifications').click();await expect(page.locator('#update-notification-state')).toHaveText('On');await page.locator('#test-update-notification').click();await expect(page.locator('#update-notification-status')).toContainText('accepted by the push service');
 await request.get('/__test/release?v=222222222222');await request.get('/__test/push-check');await request.get('/__test/push-check');const data=await(await request.get('/__test/push-events')).json();expect(data.events).toEqual([{kind:'test'},{kind:'update',version:'222222222222'}]);expect(await(await request.get('/__test/commands')).json()).toEqual([]);
});

test('denied permission and provider errors have clear recovery without false success',async({page,request})=>{
 await launch(page);await open(page);await expect(page.locator('#toggle-update-notifications')).toBeEnabled();await page.evaluate(()=>window.__permissionDecision='denied');await page.locator('#toggle-update-notifications').click();await expect(page.locator('#update-notification-state')).toHaveText('Blocked');await expect(page.locator('#update-notification-help')).toContainText('notification settings');await expect(page.locator('#test-update-notification')).toBeHidden();
 await page.evaluate(()=>{Notification.permission='granted';sessionStorage.setItem('mock-permission','granted');window.__permissionDecision='granted';});await page.locator('#retry-update-notifications').evaluate(()=>{}).catch(()=>{});await page.locator('#close-sheet').click();await page.locator('#update-notifications').click();await expect(page.locator('#toggle-update-notifications')).toBeEnabled();await page.locator('#toggle-update-notifications').click();await expect(page.locator('#update-notification-state')).toHaveText('On');await request.get('/__test/push-fail');await page.locator('#test-update-notification').click();await expect(page.locator('#update-notification-status')).toContainText('could not accept');expect((await(await request.get('/__test/push-events')).json()).events).toEqual([]);
});

test('iPhone browser explains Home Screen setup without requesting permission',async({page})=>{
 test.skip(!test.info().project.name.includes('iphone'),'iPhone installation rule');await launch(page,{installed:false});await open(page);await expect(page.locator('#update-notification-help')).toContainText('Home Screen');await expect(page.locator('#toggle-update-notifications')).toBeDisabled();expect(await page.evaluate(()=>window.__permissionCalls)).toBe(0);
});

test('unsupported notifications retain in-app updates and explain the fallback',async({page})=>{
 await launch(page);await page.evaluate(()=>{delete window.Notification;});await open(page);await expect(page.locator('#update-notification-help')).toContainText('in-app Update prompt still works');await expect(page.locator('#toggle-update-notifications')).toBeDisabled();expect(await page.evaluate(()=>typeof window.checkForAppUpdate)).toBe('function');
});
