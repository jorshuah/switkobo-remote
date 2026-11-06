import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
const up='.volume-rocker [data-key="VOLUP"]',down='.volume-rocker [data-key="VOLDOWN"]';
const commands=async request=>(await(await request.get('/__test/commands')).json()).filter(c=>c.key);
const point=(page,selector)=>page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
async function pointer(page,type,p,{id=51,primary=true}={}){await page.evaluate(({type,p,id,primary})=>{const target=type==='pointerdown'?document.elementFromPoint(p.x,p.y):document;target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:id,isPrimary:primary,button:0,buttons:type==='pointerup'?0:1,clientX:p.x,clientY:p.y}));},{type,p,id,primary});}
test.beforeEach(async({page,request})=>{await request.get('/__test/reset');await page.goto('/#access='+'a'.repeat(64));await expect(page.locator('#connection-label')).toHaveText('Connected on your network');await expect(page.locator('html')).toHaveAttribute('data-volume-hold','true');});

test('holding either volume button repeats and release leaves no queued commands',async({page,request})=>{
 for(const [selector,key]of [[up,'KEY_VOLUP'],[down,'KEY_VOLDOWN']]){
  const before=(await commands(request)).length,p=await point(page,selector);await pointer(page,'pointerdown',p);await expect(page.locator(selector)).toHaveAttribute('data-volume-held','true');
  await expect.poll(async()=>(await commands(request)).length-before).toBeGreaterThanOrEqual(3);await pointer(page,'pointerup',p);await expect(page.locator(selector)).not.toHaveAttribute('data-volume-held','true');
  const after=await commands(request);expect(after.slice(before).every(c=>c.key===key)).toBe(true);await page.waitForTimeout(500);expect(await commands(request)).toEqual(after);
 }
});

test('native clicks and keyboard activation each change volume exactly once',async({page,request})=>{
 await page.locator(up).click();await expect.poll(()=>commands(request)).toEqual([{key:'KEY_VOLUP'}]);await page.locator(down).focus();await page.keyboard.press('Enter');await expect.poll(()=>commands(request)).toEqual([{key:'KEY_VOLUP'},{key:'KEY_VOLDOWN'}]);await page.waitForTimeout(550);expect((await commands(request)).length).toBe(2);
});

test('sliding off, cancellation, another finger, Escape and opening Settings stop a hold',async({page,request})=>{
 for(const reason of ['off','cancel','capture','second','escape','settings','pagehide']){
  const before=(await commands(request)).length,p=await point(page,up);await pointer(page,'pointerdown',p);await expect.poll(async()=>(await commands(request)).length).toBeGreaterThan(before);
  if(reason==='off')await pointer(page,'pointermove',{x:p.x+100,y:p.y});
  else if(reason==='cancel')await pointer(page,'pointercancel',p);
  else if(reason==='capture')await page.locator(up).dispatchEvent('lostpointercapture',{pointerId:51});
  else if(reason==='second')await pointer(page,'pointerdown',p,{id:52,primary:false});
  else if(reason==='escape')await page.keyboard.press('Escape');
  else if(reason==='settings')await page.locator('#header-settings').evaluate(e=>e.click());
  else await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  await expect(page.locator(up)).not.toHaveAttribute('data-volume-held','true');const after=await commands(request);await page.waitForTimeout(500);expect(await commands(request)).toEqual(after);
  if(reason==='settings')await page.locator('#back-settings').click();
 }
});

test('a delayed volume request cannot build a backlog after release',async({page,request})=>{
 let release,requests=0;const gate=new Promise(r=>release=r);await page.route('**/api/key',async route=>{requests++;await gate;await route.continue();});
 try{const p=await point(page,up);await pointer(page,'pointerdown',p);await expect.poll(()=>requests).toBe(1);await page.waitForTimeout(900);expect(requests).toBe(1);await pointer(page,'pointerup',p);}finally{release();}
 await expect.poll(()=>commands(request)).toEqual([{key:'KEY_VOLUP'}]);await page.waitForTimeout(500);expect(requests).toBe(1);
});

test('disconnect and disabled controls stop sending volume',async({page,request})=>{
 const p=await point(page,up);await pointer(page,'pointerdown',p);await expect.poll(async()=>(await commands(request)).length).toBeGreaterThan(0);await request.get('/__test/offline');await expect(page.locator(up)).toBeDisabled();await expect(page.locator(up)).not.toHaveAttribute('data-volume-held','true');const after=await commands(request);await pointer(page,'pointerdown',p);await page.waitForTimeout(500);expect(await commands(request)).toEqual(after);
});

test('Now playing volume holds repeat without seeking or changing playback',async({page,request})=>{
 await page.locator('#play-on-tv').click();await page.locator('#catalog-paste').click();await page.locator('#movie-link').fill('https://cinejoy.pk/movie/157336');await page.locator('#cast-start').click();await expect(page.locator('#cast-toggle')).toBeEnabled();
 const p=await point(page,'#cast-volume-up');await pointer(page,'pointerdown',p);await expect.poll(async()=>(await commands(request)).length).toBeGreaterThanOrEqual(3);await pointer(page,'pointerup',p);const after=await commands(request);expect(after.every(c=>c.key==='KEY_VOLUP')).toBe(true);await page.waitForTimeout(500);expect(await commands(request)).toEqual(after);await expect(page.locator('#cast-toggle')).toHaveAttribute('aria-label','Pause movie');
});

test('native touch double taps produce two volume steps without a compatibility duplicate',async({page,request})=>{
 test.skip(!test.info().project.use.hasTouch,'Touch-enabled project');await page.locator(up).tap();await page.locator(up).tap();await expect.poll(()=>commands(request)).toEqual([{key:'KEY_VOLUP'},{key:'KEY_VOLUP'}]);
});

test('native Android touch hold repeats until lift',async({page,request})=>{
 test.skip(!test.info().project.name.includes('android'),'Android touch injection');const p=await point(page,down),client=await page.context().newCDPSession(page);await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});await expect.poll(async()=>(await commands(request)).length).toBeGreaterThanOrEqual(3);await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const after=await commands(request);await page.waitForTimeout(500);expect(await commands(request)).toEqual(after);expect(after.every(c=>c.key==='KEY_VOLDOWN')).toBe(true);await client.detach();
});
