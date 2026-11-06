import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{await request.get('/__test/reset');await page.goto('/#access='+'a'.repeat(64));await expect(page.locator('#connection-label')).toHaveText('Connected on your network');});
async function tapCenter(page,selector){const point=await page.locator(selector).evaluate(el=>{const box=el.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2;return {x,y,hit:el.contains(document.elementFromPoint(x,y))};});expect(point.hit).toBe(true);if(test.info().project.name.includes('desktop'))await page.mouse.click(point.x,point.y);else await page.touchscreen.tap(point.x,point.y);}
test('keyboard viewport changes keep visible link-form and player controls aligned with their hit targets',async({page,request})=>{
 // Install the viewport before app listeners bind, matching the browser lifecycle.
 await page.addInitScript(()=>{
  const vv=new EventTarget();let height=null,top=0;
  Object.defineProperties(vv,{height:{get:()=>height??innerHeight},width:{get:()=>innerWidth},offsetTop:{get:()=>top},offsetLeft:{value:0},scale:{value:1}});
  Object.defineProperty(window,'visualViewport',{configurable:true,value:vv});
  window.__resizeKeyboard=(nextHeight,nextTop=0)=>{height=nextHeight;top=nextTop;vv.dispatchEvent(new Event('resize'));vv.dispatchEvent(new Event('scroll'));};
 });
 await page.reload();await expect(page.locator('#connection-label')).toHaveText('Connected on your network');
 await page.locator('#play-on-tv').click();await page.locator('#catalog-paste').click();await page.getByLabel('Video link',{exact:true}).fill('https://cinejoy.pk/movie/157336');
 await page.evaluate(()=>window.__resizeKeyboard(360,24));await expect(page.locator('#sheet')).toHaveCSS('transform','none');
 await page.locator('#cast-start').scrollIntoViewIfNeeded();await tapCenter(page,'#cast-start');
 await page.evaluate(()=>window.__resizeKeyboard(innerHeight));await expect(page.locator('#cast-title')).toHaveText('Interstellar');await expect(page.locator('#cast-toggle')).toBeEnabled();
 await tapCenter(page,'#cast-toggle');await expect(page.locator('#cast-status')).toHaveText('Paused');
 const controls=await(await request.get('/__test/commands')).json();expect(controls).toEqual([{cast:'pause'}]);
 await tapCenter(page,'#close-sheet');await expect(page.locator('#sheet')).not.toBeVisible();await page.locator('#play-on-tv').click();await expect(page.locator('#cast-status')).toHaveText('Paused');
});
test('the transparent area above the visible panel cannot activate remote controls underneath',async({page,request})=>{
 await page.locator('#play-on-tv').click();const b=await page.locator('.sheet-panel').boundingBox();
 if(b.y>30){if(test.info().project.name.includes('desktop'))await page.mouse.click(40,25);else await page.touchscreen.tap(40,25);}
 expect(await(await request.get('/__test/commands')).json()).toEqual([]);await expect(page.locator('#sheet')).toBeVisible();
});

test('focus alone does not rewrite viewport geometry and editable ancestors allow native selection',async({page})=>{
 await page.addInitScript(()=>{const vv=new EventTarget();Object.defineProperties(vv,{height:{get:()=>innerHeight},width:{get:()=>innerWidth},offsetTop:{value:0},offsetLeft:{value:0},scale:{value:1}});Object.defineProperty(window,'visualViewport',{configurable:true,value:vv});});
 await page.reload();await expect(page.locator('#connection-label')).toHaveText('Connected on your network');await page.locator('#play-on-tv').click();await page.locator('#movie-search').waitFor();
 const state=await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const sheet=document.querySelector('#sheet'),input=document.querySelector('#movie-search'),mutations=[];const observer=new MutationObserver(records=>mutations.push(...records));observer.observe(sheet,{attributes:true,attributeFilter:['style']});input.focus();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));observer.disconnect();const ancestors=[];for(let p=input.parentElement;p;p=p.parentElement)ancestors.push(getComputedStyle(p).webkitUserSelect||getComputedStyle(p).userSelect);return {styleWrites:mutations.length,focused:document.activeElement===input,selection:getComputedStyle(input).webkitUserSelect||getComputedStyle(input).userSelect,blockedAncestor:ancestors.includes('none')};});
 expect(state).toEqual({styleWrites:0,focused:true,selection:'text',blockedAncestor:false});
});

test('the plain keyboard check runs without app focus handlers and never claims focus means keyboard visibility',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'standalone',{configurable:true,value:true}));await page.goto('/keyboard-check.html');await expect(page.locator('#keyboard-context')).toHaveText('Running inside the Home Screen app');expect(await page.evaluate(()=>typeof window.openSheet)).toBe('undefined');expect(await page.locator('dialog')).toHaveCount(0);
 const requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));const input=page.locator('#native-keyboard-input');await input.click();await expect(input).toBeFocused();await expect(page.locator('#keyboard-check-status')).toContainText('Check whether the keyboard is visible');await page.keyboard.type('local keyboard test');await expect(input).toHaveValue('local keyboard test');await expect(page.locator('#keyboard-check-status')).toContainText('Text edit received');
 await input.evaluate(el=>el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'})));await expect(page.locator('#keyboard-check-status')).toContainText('does not confirm the keyboard opened');expect(requests).toEqual([]);
 await page.getByRole('link',{name:'Back to TV Remote'}).click();await expect(page.locator('#connection-label')).toHaveText('Connected on your network');
});
