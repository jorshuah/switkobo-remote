import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{await request.get('/__test/reset');await page.goto('/#access='+'a'.repeat(64));await expect(page.locator('#connection-label')).toHaveText('Connected on your network');await expect(page.locator('#mode-buttons')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#dpad')).toHaveAttribute('data-joystick','true');});
async function point(page,selector='#dpad .select'){return page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});}
async function pointer(page,type,p,{id=91,primary=true}={}){await page.evaluate(({type,p,id,primary})=>{const target=type==='pointerdown'?document.elementFromPoint(p.x,p.y):document;target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',isPrimary:primary,button:0,buttons:type==='pointerup'?0:1,clientX:p.x,clientY:p.y}));},{type,p,id,primary});}
const commands=async request=>(await(await request.get('/__test/commands')).json()).filter(c=>c.key);

test('pushing and holding repeats, releasing stops, and the cap returns to neutral',async({page,request})=>{
 const center=await point(page);await pointer(page,'pointerdown',center);await pointer(page,'pointermove',{x:center.x+65,y:center.y});await expect(page.locator('#dpad')).toHaveAttribute('data-direction','RIGHT');await expect.poll(async()=>(await commands(request)).length).toBeGreaterThanOrEqual(3);await pointer(page,'pointerup',{x:center.x+65,y:center.y});await expect(page.locator('#dpad')).not.toHaveAttribute('data-stick-active','true');const after=await commands(request);expect(after.every(c=>c.key==='KEY_RIGHT')).toBe(true);await page.waitForTimeout(450);expect(await commands(request)).toEqual(after);await expect.poll(()=>page.locator('#dpad .select').evaluate(el=>getComputedStyle(el).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
});

test('changing direction and returning to centre never selects OK after a drag',async({page,request})=>{
 const center=await point(page);await pointer(page,'pointerdown',center);await pointer(page,'pointermove',{x:center.x,y:center.y-70});await expect.poll(async()=>await commands(request)).toContainEqual({key:'KEY_UP'});await pointer(page,'pointermove',{x:center.x-65,y:center.y});await expect.poll(async()=>await commands(request)).toContainEqual({key:'KEY_LEFT'});await pointer(page,'pointermove',center);const before=await commands(request);await page.waitForTimeout(420);expect(await commands(request)).toEqual(before);await pointer(page,'pointerup',center);expect((await commands(request)).some(c=>c.key==='KEY_ENTER')).toBe(false);
});

test('real clicks and keyboard activation select exactly once and arrow taps stay available',async({page,request})=>{
 await page.getByRole('button',{name:'Select',exact:true}).click();await expect.poll(async()=>await commands(request)).toEqual([{key:'KEY_ENTER'}]);await page.getByRole('button',{name:'Up',exact:true}).click();await expect.poll(async()=>await commands(request)).toEqual([{key:'KEY_ENTER'},{key:'KEY_UP'}]);await page.getByRole('button',{name:'Select',exact:true}).focus();await page.keyboard.press('Enter');await expect.poll(async()=>await commands(request)).toEqual([{key:'KEY_ENTER'},{key:'KEY_UP'},{key:'KEY_ENTER'}]);
});

test('cancellation, losing capture, another finger and opening Settings stop a held stick',async({page,request})=>{
 for(const cancel of ['pointercancel','lostpointercapture','multitouch','escape','focusaway','settings']){
  const center=await point(page);await pointer(page,'pointerdown',center);await pointer(page,'pointermove',{x:center.x,y:center.y+65});await expect(page.locator('#dpad')).toHaveAttribute('data-direction','DOWN');
  if(cancel==='multitouch')await pointer(page,'pointerdown',center,{id:92,primary:false});else if(cancel==='escape')await page.keyboard.press('Escape');else if(cancel==='focusaway')await page.locator('#header-settings').focus();else if(cancel==='settings')await page.locator('#header-settings').click();else if(cancel==='lostpointercapture')await page.locator('#dpad').dispatchEvent(cancel,{pointerId:91});else await pointer(page,cancel,center);
  await expect(page.locator('#dpad')).not.toHaveAttribute('data-stick-active','true');const before=await commands(request);await page.waitForTimeout(380);expect(await commands(request)).toEqual(before);if(cancel==='settings')await page.locator('#back-settings').click();
 }
});

test('a native mouse drag stays captured outside the pad and release does not send a late select',async({page,request})=>{
 const center=await point(page);await page.mouse.move(center.x,center.y);await page.mouse.down();await page.mouse.move(center.x-220,center.y,{steps:4});await expect.poll(async()=>await commands(request)).toContainEqual({key:'KEY_LEFT'});await page.mouse.up();await expect(page.locator('#dpad')).not.toHaveAttribute('data-stick-active','true');const before=await commands(request);await page.waitForTimeout(400);expect(await commands(request)).toEqual(before);expect(before.some(c=>c.key==='KEY_ENTER')).toBe(false);
});

test('disabled controls send nothing and reduced motion keeps release immediate',async({page,request})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const center=await point(page);await pointer(page,'pointerdown',center);await pointer(page,'pointermove',{x:center.x+60,y:center.y});await pointer(page,'pointerup',{x:center.x+60,y:center.y});expect(await page.locator('#dpad .select').evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s');await request.get('/__test/offline');await page.evaluate(()=>poll());await expect(page.locator('#dpad .select')).toBeDisabled();const before=await commands(request);await pointer(page,'pointerdown',center);await pointer(page,'pointermove',{x:center.x+60,y:center.y});await pointer(page,'pointerup',center);expect(await commands(request)).toEqual(before);
});

test('native touch taps do not duplicate OK or directional commands',async({page,request})=>{
 test.skip(test.info().project.name.includes('desktop'),'Native touch device case');
 const center=await point(page);await page.touchscreen.tap(center.x,center.y);await expect.poll(async()=>await commands(request)).toEqual([{key:'KEY_ENTER'}]);await page.touchscreen.tap(center.x,center.y);await expect.poll(async()=>await commands(request)).toEqual([{key:'KEY_ENTER'},{key:'KEY_ENTER'}]);const up=await point(page,'#dpad .up');await page.touchscreen.tap(up.x,up.y);await expect.poll(async()=>await commands(request)).toEqual([{key:'KEY_ENTER'},{key:'KEY_ENTER'},{key:'KEY_UP'}]);
});

test('native Android touch holds repeat until the finger lifts',async({page,request})=>{
 test.skip(!test.info().project.name.includes('android'),'Android native touch case');
 const center=await point(page),client=await page.context().newCDPSession(page);await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:center.x,y:center.y,id:1}]});await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:center.x+70,y:center.y,id:1}]});await expect.poll(async()=>(await commands(request)).length).toBeGreaterThanOrEqual(3);await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.locator('#dpad')).not.toHaveAttribute('data-stick-active','true');const before=await commands(request);await page.waitForTimeout(450);expect(await commands(request)).toEqual(before);expect(before.every(c=>c.key==='KEY_RIGHT')).toBe(true);await client.detach();
});

test('connection loss and page hiding cancel repeats while a stick is held',async({page,request})=>{
 for(const reason of ['disconnect','pagehide']){
  if(reason==='pagehide'){await request.get('/__test/reset');await page.reload();await expect(page.locator('#dpad')).toHaveAttribute('data-joystick','true');await expect(page.locator('#connection-label')).toHaveText('Connected on your network');}
  const center=await point(page);await pointer(page,'pointerdown',center);await pointer(page,'pointermove',{x:center.x-65,y:center.y});await expect.poll(async()=>(await commands(request)).length).toBeGreaterThan(0);
  if(reason==='disconnect'){await request.get('/__test/offline');await expect(page.locator('#connection-label')).not.toHaveText('Connected on your network');}else await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await expect(page.locator('#dpad')).not.toHaveAttribute('data-stick-active','true');const before=await commands(request);await page.waitForTimeout(400);expect(await commands(request)).toEqual(before);
 }
});
