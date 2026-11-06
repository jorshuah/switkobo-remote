import {choose} from './picker-helpers.mjs';
import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'}); // API interception belongs to these interaction tests; PWA caching is tested separately.
const key='a'.repeat(64);
test.beforeEach(async({page,request})=>{
 await request.get('/__test/reset');
 await page.goto('/#access='+key);
 await expect(page.locator('#connection-label')).toHaveText('Connected on your network');
});
test('navigation, mute and header settings remain reachable without a footer',async({page,request})=>{
 await expect(page.locator('.tool-dock')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Keyboard',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'TV apps',exact:true})).toHaveCount(0);
 const mute=await page.getByRole('button',{name:'Mute',exact:true}).boundingBox();
 const volume=await page.locator('.volume-rocker').boundingBox();
 expect(mute.y+mute.height).toBeLessThan(volume.y);
 expect(Math.abs(mute.x+mute.width/2-volume.x-volume.width/2)).toBeLessThan(1);
 for(const selector of ['.mute','#header-settings','.power']){
  const surface=await page.locator(selector).evaluate(el=>{const s=getComputedStyle(el);return {origin:s.backgroundOrigin,repeat:s.backgroundRepeat};});
  expect(surface.origin.split(',').every(value=>value.trim()==='border-box')).toBe(true);
  expect(surface.repeat.split(',').every(value=>value.trim()==='no-repeat')).toBe(true);
 }
 await page.getByRole('button',{name:'Up',exact:true}).click();
 await page.getByRole('button',{name:'Mute',exact:true}).click();
 expect(await(await request.get('/__test/commands')).json()).toEqual([{key:'KEY_UP'},{key:'KEY_MUTE'}]);
 await page.locator('#header-settings').click();
 await expect(page.getByRole('combobox',{name:'Color scheme',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to remote'}).click();
 await expect(page.locator('#header-settings')).toBeFocused();
});

test('power requires confirmation and disconnected controls cannot send',async({page,request})=>{
 await page.getByRole('button',{name:'Turn off TV',exact:true}).click();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(await(await request.get('/__test/commands')).json()).toEqual([]);
 await request.get('/__test/offline');
 await expect(page.getByRole('button',{name:'Up',exact:true})).toBeDisabled();
 await expect(page.locator('#remote-screen').getByRole('button',{name:'Connect to TV'})).toHaveCount(0);
 await expect(page.locator('#connection-label')).toHaveText('Not connected');
 await page.getByRole('button',{name:'Remote settings'}).click();
 await expect(page.getByRole('button',{name:'Connect to TV'})).toBeVisible();
 await page.getByRole('button',{name:'Connect to TV'}).click();
 await expect(page.locator('#settings-connection')).toHaveText('Connected on your network');
});
test('settings persist theme and editor protects unsaved changes',async({page})=>{
 await page.getByRole('button',{name:'Remote settings'}).click();
 await choose(page,'Color scheme','light');
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content','#f4f4f4');
 await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content','default');
 expect(await page.locator('html').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(244, 244, 244)');
 await page.getByRole('button',{name:'Samsung Q65B',exact:true}).click();
 await page.getByRole('button',{name:'Edit saved TV details'}).click();
 await page.getByLabel('TV name',{exact:true}).fill('Living room');
 await page.getByRole('button',{name:'Close sheet'}).click();
 await expect(page.getByText('Discard your unsaved changes?',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Keep editing'}).click();
 await page.getByRole('button',{name:'Save and connect'}).click();
 await page.getByRole('button',{name:'Open remote',exact:true}).click();
 await expect(page.getByRole('button',{name:'Living room',exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByRole('button',{name:'Living room',exact:true})).toBeVisible();
});
test('custom app shortcuts can be saved, launched and removed in settings',async({page,request})=>{
 await page.getByRole('button',{name:'Remote settings'}).click();
 await page.getByRole('button',{name:/App shortcuts/}).click();
 await page.getByRole('button',{name:'Add a shortcut manually',exact:true}).click();
 await page.getByLabel('App name',{exact:true}).fill('YouTube');
 await page.getByLabel('Samsung app ID').fill('test.youtube');
 await page.getByRole('button',{name:'Save shortcut',exact:true}).click();
 await page.locator('#saved-apps').getByRole('button',{name:'YouTube',exact:true}).click();
 expect((await(await request.get('/__test/commands')).json())[0].app.appID).toBe('test.youtube');
 await page.getByRole('button',{name:'Remove YouTube',exact:true}).click();
 await expect(page.getByRole('button',{name:'Remove YouTube',exact:true})).toHaveCount(0);
});

test('touchpad swipe sends one direction; layout fits narrow and large text views',async({page,request},testInfo)=>{
 await page.getByRole('button',{name:'Touchpad',exact:true}).click();
 const pad=page.locator('#touchpad'),box=await pad.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();await page.mouse.move(box.x+box.width/2+60,box.y+box.height/2);await page.mouse.up();
 await expect(page.locator('#touchpad')).toBeVisible();
 await expect.poll(async()=>await(await request.get('/__test/commands')).json()).toEqual([{key:'KEY_RIGHT'}]);
 await page.emulateMedia({colorScheme:'dark'});
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-gesture-dark.png',animations:'disabled',scale:'css'});
 await page.emulateMedia({colorScheme:'light'});
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-gesture-light.png',animations:'disabled',scale:'css'});
 await page.getByRole('button',{name:'Navigation stick',exact:true}).click();
 await page.emulateMedia({colorScheme:'dark'});
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-remote-dark.png',fullPage:true,animations:'disabled',scale:'css'});
 await page.emulateMedia({colorScheme:'light'});
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-remote-light.png',fullPage:true,animations:'disabled',scale:'css'});
 await page.setViewportSize({width:320,height:680});
 await page.evaluate(()=>document.documentElement.style.fontSize='24px');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'More controls'}).click();
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-more-narrow.png',fullPage:true,animations:'disabled',scale:'css'});
 expect(await page.evaluate(()=>document.querySelector('dialog').scrollWidth<=document.querySelector('dialog').clientWidth)).toBe(true);
});
test('keyboard focus stays inside modal and returns to its invoking control',async({page})=>{
 await page.getByRole('button',{name:'More controls',exact:true}).click();
 await page.keyboard.press('Tab');await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement))).toBe(true);
 await page.getByRole('button',{name:'Close sheet'}).click();
 await expect(page.getByRole('button',{name:'More controls',exact:true})).toBeFocused();
});

test('connected remote fits a phone with browser chrome and retains reachable controls',async({page},testInfo)=>{
 for(const [width,height] of [[375,620],[390,664],[390,844],[430,740]]){
  await page.setViewportSize({width,height});
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
  const middle=await page.locator('.remote-scroll').boundingBox(),controls=await page.locator('.controls').boundingBox();
  const shadowSpace=await page.locator('.remote-scroll').evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom));
  expect(Math.abs((middle.y+middle.height-shadowSpace)-(controls.y+controls.height)),JSON.stringify({width,height,middle,controls})).toBeLessThanOrEqual(1);
  const navigation=await page.locator('#dpad').boundingBox(),volume=await page.locator('.volume-rocker').boundingBox();
  expect(navigation.x).toBeGreaterThan(volume.x+volume.width);
  const modes=await page.locator('.segmented').boundingBox();
  expect(Math.abs(modes.x+modes.width/2-navigation.x-navigation.width/2)).toBeLessThan(1);
  expect((await page.getByRole('button',{name:'Back',exact:true}).boundingBox()).y).toBeGreaterThan(navigation.y+navigation.height);
  for(const selector of ['.key','#more','#header-settings']){
   const boxes=await page.locator(selector).evaluateAll(elements=>elements.filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,bottom:r.bottom};}));
   for(const box of boxes){expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);expect(box.bottom).toBeLessThanOrEqual(height);}
  }
 }
 await page.setViewportSize({width:390,height:664});
 await page.emulateMedia({colorScheme:'dark'});
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-compact-dark.png',animations:'disabled',scale:'css'});
 await page.emulateMedia({colorScheme:'light'});
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-compact-light.png',animations:'disabled',scale:'css'});
 const button=page.getByRole('button',{name:'Up',exact:true}),box=await button.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await expect(button).toHaveClass(/pressed/);
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-pressed.png',animations:'disabled',scale:'css'});
 await page.mouse.up();
 await expect(button).not.toHaveClass(/pressed/);
 await page.setViewportSize({width:390,height:844});
 await page.locator('.shell').evaluate(el=>el.style.paddingBottom='54px');
 const shadowBounds=await page.locator('.remote-scroll').boundingBox();
 for(const name of ['Back','Home']){
  const keyBounds=await page.getByRole('button',{name,exact:true}).boundingBox();
  expect(shadowBounds.y+shadowBounds.height-keyBounds.y-keyBounds.height).toBeGreaterThanOrEqual(30);
 }
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-bottom-shadows.png',animations:'disabled',scale:'css'});
 await page.locator('.shell').evaluate(el=>el.style.removeProperty('padding-bottom'));
});
test('double-tap fallback preserves two commands without cancelling scroll or pinch',async({page,request})=>{
 const result=await page.evaluate(()=>{
  const button=document.querySelector('[data-key="MENU"]');
  const emit=(type,touches,cancelable=false)=>{const event=new Event(type,{bubbles:true,cancelable});Object.defineProperty(event,'touches',{value:touches});button.dispatchEvent(event);return event.defaultPrevented;};
  emit('touchstart',[{clientX:30,clientY:30}]);
  const first=emit('touchend',[],true);
  button.click();
  return {first};
 });
 expect(result.first).toBe(false);
 await expect(page.getByRole('button',{name:'Menu',exact:true})).toBeEnabled();
 const second=await page.evaluate(()=>{
  const button=document.querySelector('[data-key="MENU"]');
  const emit=(type,touches,cancelable=false)=>{const event=new Event(type,{bubbles:true,cancelable});Object.defineProperty(event,'touches',{value:touches});button.dispatchEvent(event);return event.defaultPrevented;};
  emit('touchstart',[{clientX:30,clientY:30}]);
  const doubled=emit('touchend',[],true);
  emit('touchstart',[{clientX:30,clientY:30}]);
  emit('touchmove',[{clientX:30,clientY:80}]);
  const scrolled=emit('touchend',[],true);
  emit('touchstart',[{clientX:30,clientY:30},{clientX:90,clientY:90}]);
  const pinched=emit('touchend',[],true);
  return {doubled,scrolled,pinched,viewport:document.querySelector('meta[name="viewport"]').content};
 });
 expect(second.doubled).toBe(true);expect(second.scrolled).toBe(false);expect(second.pinched).toBe(false);
 expect(second.viewport).not.toMatch(/user-scalable=no|maximum-scale/);
 await expect.poll(async()=>await(await request.get('/__test/commands')).json()).toEqual([{key:'KEY_MENU'},{key:'KEY_MENU'}]);
});

test('circular controls send their labelled commands and extra playback stays available',async({page,request})=>{
 const controls=[['Menu','MENU'],['Inputs','SOURCE'],['Exit','EXIT'],['Guide','GUIDE'],['Select','ENTER'],['Home','HOME'],['Back','RETURN'],['Mute','MUTE'],['Volume up','VOLUP'],['Volume down','VOLDOWN']];
 for(const [name] of controls)await page.getByRole('button',{name,exact:true}).click();
 await page.getByRole('button',{name:'More controls'}).click();
 const extra=[['Channel up','CHUP'],['Channel down','CHDOWN'],['Play','PLAY'],['Pause','PAUSE'],['Red','RED'],['Green','GREEN'],['Yellow','YELLOW'],['Blue','BLUE']];
 for(const [name] of extra)await page.getByRole('dialog').getByRole('button',{name,exact:true}).click();
 const expectedColors={Red:'rgb(180, 35, 43)',Green:'rgb(24, 113, 63)',Yellow:'rgb(242, 201, 76)',Blue:'rgb(23, 93, 184)'};
 for(const [name,color] of Object.entries(expectedColors))expect(await page.getByRole('dialog').getByRole('button',{name,exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(color);
 for(const theme of ['light','dark']){
  await page.emulateMedia({colorScheme:theme});
  for(const name of Object.keys(expectedColors)){
   const face=await page.getByRole('dialog').getByRole('button',{name,exact:true}).evaluate(el=>getComputedStyle(el).backgroundImage);
   expect(face).not.toContain('255, 255, 255');
  }
  await page.screenshot({path:'test-results/color-keys-'+test.info().project.name+'-'+theme+'.png',animations:'disabled',scale:'css'});
 }
 await page.getByRole('dialog').getByRole('button',{name:'Rewind',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Fast forward',exact:true}).click();
 await expect.poll(async()=>await(await request.get('/__test/commands')).json()).toEqual([...[...controls,...extra].map(([,key])=>({key:'KEY_'+key})),{key:'KEY_REWIND'},{key:'KEY_FF'}]);
});
test('saved app appears on the main remote and survives reload',async({page,request})=>{
 await request.post('/api/shortcuts',{headers:{Authorization:'Bearer '+key},data:{shortcuts:[{name:'YouTube',appID:'test.youtube',deepLink:true}]}});
 await page.reload();
 await page.locator('#quick-apps').getByRole('button',{name:'YouTube',exact:true}).click();
 await expect.poll(async()=>await(await request.get('/__test/commands')).json()).toEqual([{app:{name:'YouTube',appID:'test.youtube',deepLink:true}}]);
 await request.get('/__test/offline');
 for(const button of await page.locator('#quick-apps button').all())await expect(button).toBeDisabled();
});

test('TV header stays visible while the middle controls scroll',async({page,request},testInfo)=>{
 await page.setViewportSize({width:390,height:430});
 const scroller=page.locator('.remote-scroll');
 const header=page.locator('.device-header');
 const before={header:await header.boundingBox()};
 expect(before.header.y).toBeLessThan(16);
 expect(await scroller.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await scroller.evaluate(el=>el.scrollTop=el.scrollHeight);
 await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 await page.mouse.move(before.header.x+before.header.width/2,before.header.y+before.header.height/2);
 if(!testInfo.project.use.isMobile)await page.mouse.wheel(0,-500);
 await page.evaluate(()=>window.scrollTo(0,200));
 expect(await header.boundingBox()).toEqual(before.header);
 expect(await page.evaluate(()=>scrollY===0&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
 await expect(page.getByRole('button',{name:'Volume down',exact:true})).toBeInViewport();
 await page.getByRole('button',{name:'More controls',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('button',{name:'Close sheet'}).click();
 await expect(page.getByRole('button',{name:'More controls',exact:true})).toBeFocused();
 await request.get('/__test/offline');
 await expect(page.locator('#connection-label')).toHaveText('Not connected');
 await scroller.evaluate(el=>el.scrollTop=0);
 await expect(page.locator('#remote-screen').getByRole('button',{name:'Connect to TV',exact:true})).toHaveCount(0);
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-fixed-bars.png',animations:'disabled',scale:'css'});
 await page.getByRole('button',{name:'Remote settings'}).click();
 await expect(page.getByRole('combobox',{name:'Color scheme',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to remote'}).click();
 await expect(page.locator('#header-settings')).toBeInViewport();
});

test('reconnection feedback updates without a tap and settings persist the preference',async({page,request},testInfo)=>{
 await request.get('/__test/reconnecting');
 await expect(page.locator('#connection-label')).toHaveText('Waiting for TV');
 await expect(page.getByRole('button',{name:'Try now',exact:true})).not.toBeVisible();
 await expect(page.getByRole('button',{name:'Up',exact:true})).toBeDisabled();
 await request.get('/__test/online');
 await expect(page.getByRole('button',{name:'Up',exact:true})).toBeEnabled();
 expect(await(await request.get('/__test/commands')).json()).toEqual([]);
 await page.setViewportSize({width:390,height:664});
 await page.getByRole('button',{name:'Remote settings'}).click();
 await page.getByRole('switch',{name:/Reconnect automatically/}).uncheck();
 await expect.poll(async()=> (await(await request.get('/api/state',{headers:{Authorization:'Bearer '+key}})).json()).autoReconnect).toBe(false);
 await page.reload();
 await page.getByRole('button',{name:'Remote settings'}).click();
 await expect(page.getByRole('switch',{name:/Reconnect automatically/})).not.toBeChecked();
 await page.emulateMedia({colorScheme:'dark'});
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-settings-dark.png',fullPage:true,animations:'disabled',scale:'css'});
 await page.emulateMedia({colorScheme:'light'});
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-settings-light.png',fullPage:true,animations:'disabled',scale:'css'});
 await page.getByRole('button',{name:/App shortcuts/}).click();
 await page.getByRole('button',{name:'Add a shortcut manually',exact:true}).click();
 await page.getByLabel('App name',{exact:true}).fill('Draft app');
 await page.getByRole('button',{name:'Close sheet'}).click();
 await expect(page.getByText('Discard your unsaved changes?',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Keep editing'}).click();
 await expect(page.getByLabel('App name',{exact:true})).toHaveValue('Draft app');
 await page.getByRole('button',{name:'Close sheet'}).click();
 await page.getByRole('button',{name:'Discard',exact:true}).click();
 await expect(page.getByRole('button',{name:/App shortcuts/})).toBeFocused();
});

test('modal motion keeps focus predictable and respects reduced motion',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:664});
 await page.emulateMedia({reducedMotion:'no-preference',colorScheme:'dark'});
 await page.getByRole('button',{name:'More controls'}).click();
 await expect(page.locator('#sheet-title')).toBeFocused();
 await expect(page.getByRole('button',{name:'Close sheet'})).not.toBeFocused();
 expect(await page.locator('#close-sheet').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-modal-close.png',animations:'disabled',scale:'css'});
 await page.keyboard.press('Tab');
 await expect(page.getByRole('button',{name:'Close sheet'})).toBeFocused();
 expect(await page.locator('#close-sheet').evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
 await page.evaluate(()=>{window.sheetCloseCount=0;document.querySelector('#sheet').addEventListener('close',()=>window.sheetCloseCount++);});
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await expect(page.locator('#sheet')).not.toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.sheetCloseCount)).toBe(1);
 await expect(page.getByRole('button',{name:'More controls'})).toBeFocused();
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:'Touchpad',exact:true}).click();
 await expect(page.locator('#touchpad')).toBeVisible();
 await page.getByRole('button',{name:'More controls',exact:true}).click();
 await expect(page.locator('#sheet-title')).toBeFocused();
 expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
 await page.getByRole('button',{name:'Close sheet'}).click();
 await expect(page.locator('#sheet')).not.toBeVisible();
});

test('featured full logos follow TV options in two columns and send app launch requests',async({page,request})=>{
 const apps=page.locator('#quick-apps');
 await expect(apps.getByRole('button')).toHaveCount(4);
 const appBox=await apps.boundingBox(),optionBox=await page.getByRole('group',{name:'TV options'}).boundingBox();
 expect(appBox.y).toBeGreaterThan(optionBox.y+optionBox.height);
 const boxes=await apps.getByRole('button').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,height:r.height};}));
 expect(new Set(boxes.map(box=>box.height)).size).toBe(1);
 expect(boxes[0].y).toBe(boxes[1].y);expect(boxes[2].y).toBeGreaterThan(boxes[0].y);expect(boxes[0].x).toBe(boxes[2].x);
 const headerBefore=await page.locator('.device-header').boundingBox(),controlsBefore=await page.locator('.controls').boundingBox();
 const expected=[['YouTube','111299001912'],['Netflix','3201907018807'],['Prime Video','3201910019365'],['Disney+','3201901017640']];
 for(const [name] of expected){
  const button=apps.getByRole('button',{name,exact:true});
  expect(await button.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await button.click();
 }
 await expect.poll(async()=>await(await request.get('/__test/commands')).json()).toEqual(expected.map(([name,appID])=>({app:{name,appID,deepLink:true}})));
 await expect(page.locator('#notice')).toBeVisible();
 expect(await page.locator('#notice').evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
 expect(await page.locator('.device-header').boundingBox()).toEqual(headerBefore);
 expect(await page.locator('.controls').boundingBox()).toEqual(controlsBefore);
 await page.getByRole('button',{name:'Dismiss message'}).focus();
 await page.screenshot({path:'test-results/toast-'+test.info().project.name+'.png',animations:'disabled',scale:'css'});
 await page.getByRole('button',{name:'Dismiss message'}).click();
 await expect(page.locator('#notice')).toBeHidden();
});

test('tap feedback is gesture-only, optional and persists across reload',async({page,request})=>{
 await page.addInitScript(()=>{
  window.feedbackLog={sounds:0,vibrations:[]};
  Object.defineProperty(navigator,'vibrate',{configurable:true,value:ms=>{window.feedbackLog.vibrations.push(ms);return true;}});
  window.AudioContext=class {
   state='running';currentTime=0;destination={};
   createOscillator(){return {frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){},start(){window.feedbackLog.sounds++;},stop(){this.onended?.();}};}
   createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  };
 });
 await page.reload();
 await expect(page.locator('#connection-label')).toHaveText('Connected on your network');
 expect(await page.evaluate(()=>feedbackLog)).toEqual({sounds:0,vibrations:[]});
 await page.getByRole('button',{name:'Mute',exact:true}).click();
 expect(await page.evaluate(()=>feedbackLog)).toEqual({sounds:1,vibrations:[12]});
 await page.getByRole('button',{name:'Remote settings'}).click();
 await page.getByRole('switch',{name:/Soft clicks/}).uncheck();
 await page.getByRole('switch',{name:/Vibration/}).uncheck();
 await page.reload();
 await page.getByRole('button',{name:'Mute',exact:true}).click();
 expect(await page.evaluate(()=>feedbackLog)).toEqual({sounds:0,vibrations:[]});
 await page.getByRole('button',{name:'Remote settings'}).click();
 await expect(page.getByRole('switch',{name:/Soft clicks/})).not.toBeChecked();
 await expect(page.getByRole('switch',{name:/Vibration/})).not.toBeChecked();
 expect(await(await request.get('/__test/commands')).json()).toEqual([{key:'KEY_MUTE'},{key:'KEY_MUTE'}]);
});
test('unavailable audio and vibration never block remote commands',async({page,request})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'vibrate',{configurable:true,value:undefined});
  window.AudioContext=class {state='suspended';resume(){return Promise.reject(new Error('Audio blocked'));}};
 });
 await page.reload();
 await expect(page.locator('#connection-label')).toHaveText('Connected on your network');
 await page.getByRole('button',{name:'Mute',exact:true}).click();
 await expect.poll(async()=>await(await request.get('/__test/commands')).json()).toEqual([{key:'KEY_MUTE'}]);
 await page.getByRole('button',{name:'Remote settings'}).click();
 await expect(page.locator('#vibration-setting')).toBeHidden();
 await expect(page.locator('#feedback-help')).toContainText('media volume');
});

test('connection recovery stays secondary and forgetting pairing requires confirmation',async({page,request})=>{
 await request.get('/__test/paired');
 await page.reload();
 await page.getByRole('button',{name:'Remote settings'}).click();
 await expect(page.getByRole('button',{name:'Disconnect TV',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Forget TV pairing',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Connection help',exact:true}).click();
 await page.getByRole('button',{name:'Disconnect TV',exact:true}).click();
 await expect(page.locator('#settings-connection')).toHaveText('Not connected');
 await page.getByRole('button',{name:'Close sheet'}).click();
 await expect(page.getByRole('button',{name:'Connection help',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Connect to TV',exact:true}).click();
 await expect(page.locator('#settings-connection')).toHaveText('Connected on your network');
 await page.getByRole('button',{name:'Connection help',exact:true}).click();
 await page.getByRole('button',{name:'Forget TV pairing',exact:true}).click();
 await expect(page.getByRole('button',{name:'Keep pairing',exact:true})).toBeFocused();
 await expect(page.locator('dialog[open]')).toHaveCount(1);
 await page.getByRole('button',{name:'Keep pairing',exact:true}).click();
 expect((await(await request.get('/api/state',{headers:{Authorization:'Bearer '+key}})).json()).paired).toBe(true);
 await page.getByRole('button',{name:'Forget TV pairing',exact:true}).click();
 await page.getByRole('button',{name:'Forget pairing',exact:true}).click();
 await expect(page.locator('#sheet')).not.toBeVisible();
 expect((await(await request.get('/api/state',{headers:{Authorization:'Bearer '+key}})).json()).paired).toBe(false);
});

test('TV picker discovers, guides approval, cancels and confirms only a real connection',async({page,request},testInfo)=>{
 await page.setViewportSize({width:390,height:664});
 await page.getByRole('button',{name:'Samsung Q65B',exact:true}).click();
 await expect(page.getByLabel('TV IP address',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Find TVs on my network'}).click();
 await expect(page.getByRole('button',{name:/Living room/})).toBeVisible();
 await page.emulateMedia({colorScheme:'light'});
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-tv-picker.png',animations:'disabled',scale:'css'});
 await page.getByRole('button',{name:/Living room/}).click();
 await expect(page.getByText('Switching TVs replaces the saved pairing and custom app shortcuts.')).toBeVisible();
 await page.getByRole('button',{name:'Connect to this TV'}).click();
 await expect(page.locator('#pairing-title')).toHaveText('Check your TV');
 await expect(page.getByRole('button',{name:'Open remote',exact:true})).toHaveCount(0);
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-tv-pairing.png',animations:'disabled',scale:'css'});
 await page.getByRole('button',{name:'Cancel connection'}).click();
 await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Try again',exact:true}).click();
 await request.get('/__test/online');
 await expect(page.locator('#pairing-title')).toHaveText('You’re connected');
 await page.getByRole('button',{name:'Open remote',exact:true}).click();
 await expect(page.locator('#sheet')).not.toBeVisible();
 await expect(page.locator('#tv-name')).toHaveText('Living room');
});
test('TV discovery empty, error and dismissed results leave manual recovery available',async({page})=>{
 await page.route('**/api/discover',route=>route.fulfill({json:{devices:[]}}));
 await page.getByRole('button',{name:'Samsung Q65B',exact:true}).click();
 await page.getByRole('button',{name:'Find TVs on my network'}).click();
 await expect(page.getByText('No other TVs found')).toBeVisible();
 await page.unroute('**/api/discover');
 await page.route('**/api/discover',route=>route.fulfill({status:503,json:{error:'Search unavailable. Try again.'}}));
 await page.getByRole('button',{name:'Search again'}).click();
 await expect(page.getByText('Search unavailable. Try again.')).toBeVisible();
 await page.getByRole('button',{name:'Enter an address manually'}).click();
 await expect(page.getByLabel('TV IP address',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close sheet'}).click();
 await expect(page.getByRole('button',{name:'Samsung Q65B',exact:true})).toBeFocused();
});

test('first TV setup searches automatically and keeps the manual form secondary',async({page,request})=>{
 await request.get('/__test/unconfigured');await page.reload();
 await page.getByRole('button',{name:'Connect a TV',exact:true}).click();
 await expect(page.getByRole('button',{name:/Living room/})).toBeVisible();
 await expect(page.getByLabel('TV IP address',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:/Living room/}).click();
 await page.getByRole('button',{name:'Connect to this TV'}).click();
 await expect(page.locator('#pairing-title')).toHaveText('Check your TV');
 await request.get('/__test/denied');
 await expect(page.locator('#pairing-title')).toHaveText('Couldn’t connect');
 await expect(page.locator('#pairing-copy')).toContainText('declined');
 await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
});

test('shortcut manager finds apps, persists additions and explains unavailable lists',async({page,request},testInfo)=>{
 await page.setViewportSize({width:390,height:664});
 await page.getByRole('button',{name:'Remote settings'}).click();
 await page.getByRole('button',{name:'App shortcuts',exact:true}).click();
 await expect(page.getByLabel('Samsung app ID')).toHaveCount(0);
 await expect(page.locator('#shortcut-featured button')).toHaveCount(4);
 for(const theme of ['light','dark']){
   await page.emulateMedia({colorScheme:theme});
   await page.screenshot({path:'test-results/'+testInfo.project.name+'-shortcuts-'+theme+'.png',animations:'disabled',scale:'css'});
 }
 await page.getByRole('button',{name:'Find apps on TV',exact:true}).click();
 await page.getByRole('button',{name:'Add Plex',exact:true}).click();
 await expect(page.locator('#saved-apps').getByRole('button',{name:'Plex',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Add Plex',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Close sheet'}).click();
 await page.reload();
 await expect(page.locator('#quick-apps').getByRole('button',{name:'Plex',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Remote settings'}).click();
 await page.getByRole('button',{name:'App shortcuts',exact:true}).click();
 await request.get('/__test/apps-unavailable');
 await page.getByRole('button',{name:'Check again',exact:true}).click();
 await expect(page.locator('#apps-result')).toContainText('didn’t share an app list');
 await request.get('/__test/offline');
 await expect(page.getByRole('button',{name:'Check again',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Open Netflix',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Add a shortcut manually',exact:true})).toBeEnabled();
});
test('manual shortcut back navigation protects drafts without nesting dialogs',async({page})=>{
 await page.getByRole('button',{name:'Remote settings'}).click();
 await page.getByRole('button',{name:'App shortcuts',exact:true}).click();
 await page.getByRole('button',{name:'Add a shortcut manually',exact:true}).click();
 await page.getByLabel('App name',{exact:true}).fill('Draft app');
 await page.getByRole('button',{name:'Back to shortcuts',exact:true}).click();
 await expect(page.getByText('Discard your unsaved changes?',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Keep editing',exact:true}).click();
 await expect(page.getByLabel('App name',{exact:true})).toHaveValue('Draft app');
 await page.getByRole('button',{name:'Back to shortcuts',exact:true}).click();
 await page.getByRole('button',{name:'Discard',exact:true}).click();
 await expect(page.locator('#shortcut-featured')).toBeVisible();
 await expect(page.locator('dialog[open]')).toHaveCount(1);
 await page.getByRole('button',{name:'Close sheet'}).click();
 await expect(page.getByRole('button',{name:'App shortcuts',exact:true})).toBeFocused();
});

test('Settings swipe-back commits deliberate right swipes and preserves other interactions',async({page})=>{
 await page.setViewportSize({width:390,height:664});
 await page.getByRole('button',{name:'Remote settings'}).click();
 // Synthetic touch pointers exercise the gesture state machine on both engines.
 // Pointer capture itself requires a native active pointer, so stub only that API.
 await page.evaluate(()=>{document.querySelector('#settings-screen').setPointerCapture=()=>{};});
 const swipe=async(selector,dx,dy=0,cancel=false)=>{
   await page.locator(selector).dispatchEvent('pointerdown',{pointerId:42,pointerType:'touch',isPrimary:true,clientX:60,clientY:300,bubbles:true});
   await page.locator(selector).dispatchEvent('pointermove',{pointerId:42,pointerType:'touch',isPrimary:true,clientX:60+dx,clientY:300+dy,bubbles:true});
   await page.locator(selector).dispatchEvent(cancel?'pointercancel':'pointerup',{pointerId:42,pointerType:'touch',isPrimary:true,clientX:60+dx,clientY:300+dy,bubbles:true});
 };
 await swipe('#settings-screen',35);
 await expect(page.locator('#settings-screen')).toBeVisible();
 await expect(page.locator('#settings-screen')).toHaveCSS('transform','none');
 await swipe('#settings-screen',110,130);
 await expect(page.locator('#settings-screen')).toBeVisible();
 await swipe('#settings-screen',-130);
 await expect(page.locator('#settings-screen')).toBeVisible();
 const sounds=await page.locator('#button-sounds').isChecked();
 await swipe('#button-sounds',150);
 expect(await page.locator('#button-sounds').isChecked()).toBe(sounds);
 await expect(page.locator('#settings-screen')).toBeVisible();
 await swipe('#settings-screen',150,0,true);
 await expect(page.locator('#settings-screen')).toBeVisible();
 await page.getByRole('button',{name:'Connection help',exact:true}).click();
 await swipe('#settings-screen',150);
 await expect(page.locator('#sheet')).toBeVisible();
 await page.getByRole('button',{name:'Close sheet'}).click();
 await expect(page.locator('#sheet')).toBeHidden();
 await swipe('#settings-screen',150);
 await expect(page.locator('#settings-screen')).toBeHidden();
 await expect(page.getByRole('button',{name:'Remote settings'})).toBeFocused();
 await page.getByRole('button',{name:'Remote settings'}).click();
 await page.emulateMedia({reducedMotion:'reduce'});
 await swipe('#settings-screen',150);
 await expect(page.locator('#settings-screen')).toBeHidden();
 expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
});

test('native touch swipe slides Settings and does not activate the row underneath',async({page,browserName})=>{
 test.skip(browserName!=='chromium','Native touch injection uses Chromium CDP; iPhone handling is covered by the shared pointer tests.');
 await page.setViewportSize({width:390,height:664});
 await page.getByRole('button',{name:'Remote settings'}).click();
 await page.locator('#settings-screen').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
 const bounds=await page.locator('#settings-screen').boundingBox();
 const client=await page.context().newCDPSession(page),x=bounds.x+25,y=bounds.y+30;
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(const dx of [20,60,100,150])await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y}]});
 await expect.poll(()=>page.locator('#settings-screen').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m41)).toBeGreaterThan(100);
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page.locator('#settings-screen')).toBeHidden();
 await expect(page.locator('#sheet')).not.toBeVisible();
 await expect(page.locator('#header-settings')).toBeFocused();
});

test.describe('touch focus appearance',()=>{
 test.use({hasTouch:true});
 test('closing More controls by touch leaves no ring while keyboard focus remains visible',async({page},testInfo)=>{
   await page.setViewportSize({width:390,height:844});
   await page.emulateMedia({colorScheme:'light'});
   for(const mode of ['Touchpad','Navigation stick']){
     await page.getByRole('button',{name:mode,exact:true}).tap();
     await page.getByRole('button',{name:'More controls',exact:true}).tap();
     await page.getByRole('button',{name:'Close sheet'}).tap();
     await expect(page.locator('#sheet')).toBeHidden();
     await expect(page.getByRole('button',{name:'More controls',exact:true})).toBeFocused();
     await expect(page.locator('html')).toHaveAttribute('data-input-modality','pointer');
     expect(await page.locator('#more').evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('none');
     for(const selector of ['#dpad','#touchpad','.navigation-cluster']){
       const highlight=await page.locator(selector).evaluate(el=>getComputedStyle(el).getPropertyValue('-webkit-tap-highlight-color'));
       if(highlight)expect(highlight).toBe('rgba(0, 0, 0, 0)');
     }
     await page.screenshot({path:'test-results/'+testInfo.project.name+'-touch-focus-'+mode.toLowerCase()+'.png',animations:'disabled',scale:'css'});
   }
   await page.keyboard.press('Tab');
   await expect(page.locator('html')).toHaveAttribute('data-input-modality','keyboard');
   expect(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle)).toBe('solid');
   await page.getByRole('button',{name:'More controls',exact:true}).focus();
   await page.keyboard.press('Enter');
   await page.keyboard.press('Escape');
   await expect(page.locator('#sheet')).toBeHidden();
   await expect(page.locator('#more')).toBeFocused();
   expect(await page.locator('#more').evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
 });
});

test('power button remains available to wake an offline TV and controls cannot select text',async({page,request})=>{
 await request.get('/__test/wake-ready');
 await page.reload();
 const selection=await page.locator('#remote-screen').evaluate(el=>getComputedStyle(el).userSelect||getComputedStyle(el).webkitUserSelect);
 expect(selection).toBe('none');
 await page.getByRole('button',{name:'Turn off TV',exact:true}).click();
 await page.locator('#confirm-action').click();
 await expect(page.locator('#sheet')).toBeHidden();
 await expect(page.locator('#power')).toBeEnabled();
 await expect(page.locator('#power')).toHaveAttribute('aria-label','Wake TV');
 await page.locator('#power').click();
 await expect(page.locator('#sheet')).toContainText('Power On with Mobile');
 await page.getByRole('button',{name:'Send wake request',exact:true}).click();
 await expect(page.locator('#sheet')).toBeHidden();
 expect(await(await request.get('/__test/commands')).json()).toEqual([{key:'KEY_POWEROFF'},{wake:true}]);
 await expect(page.locator('#connection-label')).not.toHaveText('Connected on your network');
 await expect(page.locator('#notice-text')).toContainText('Wake request sent');
 await page.getByRole('button',{name:'Samsung Q65B',exact:true}).click();
 await page.getByRole('button',{name:'Edit saved TV details'}).click();
 expect(await page.locator('#tv-address').evaluate(el=>getComputedStyle(el).userSelect||getComputedStyle(el).webkitUserSelect)).toBe('text');
});
test('power wake setup explains a missing MAC instead of leaving a dead button',async({page,request})=>{
 await request.get('/__test/offline');
 await expect(page.locator('#power')).toHaveAttribute('aria-label','Wake TV');
 await page.locator('#power').click();
 await expect(page.getByRole('heading',{name:'Set up TV wake'})).toBeVisible();
 await page.getByRole('button',{name:'Edit TV details',exact:true}).click();
 await expect(page.getByLabel('TV MAC address',{exact:false})).toBeVisible();
});
