import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{
 await request.get('/__test/reset');await request.get('/__test/history');await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:390,height:664});
 await page.route('**/api/library',async route=>{const response=await route.fetch(),data=await response.json(),base=data.entries.find(e=>e.media.type==='movie');data.entries.push(...Array.from({length:18},(_,i)=>({...base,key:'movie:'+(2000000+i),media:{...base.media,id:String(2000000+i),title:'Saved movie '+(i+1)}})));await route.fulfill({json:data});});
 await page.goto('/#access='+'a'.repeat(64));await expect(page.locator('#connection-label')).toHaveText('Connected on your network');await page.locator('#play-on-tv').click();await expect(page.locator('#continue-watching .watch-row')).toHaveCount(3);await page.locator('.sheet-panel').evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{}))));
});

async function captureClick(page,selector){
 return page.evaluate(selector=>{
  const body=document.querySelector('#sheet-body');body.scrollTop=body.scrollHeight;
  const beforeScroll=body.scrollTop,animate=Element.prototype.animate;let initial=null;
  Element.prototype.animate=function(frames,options){const a=animate.call(this,frames,options);if(options?.id==='content-change'&&this.id==='library-page-content'){a.pause();a.currentTime=0;initial={top:this.getBoundingClientRect().top,scroll:body.scrollTop};}return a;};
  try{document.querySelector(selector).click();}finally{Element.prototype.animate=animate;}
  return {beforeScroll,initial,final:{top:document.querySelector('#library-page-content').getBoundingClientRect().top,scroll:body.scrollTop},transform:getComputedStyle(document.querySelector('#library-page-content')).transform,opacity:getComputedStyle(document.querySelector('#library-page-content')).opacity,ghosts:document.querySelectorAll('.screen-outgoing,.library-outgoing').length};
 },selector);
}

test('Continue watching sets its final scroll before the detail transition begins and keeps Search selected',async({page})=>{
 const frame=await captureClick(page,'#continue-watching .watch-row:last-child');expect(frame.beforeScroll).toBeGreaterThan(0);if(test.info().project.name.includes('iphone')){expect(frame.initial).toBeNull();expect(frame.transform).toBe('none');expect(frame.opacity).toBe('1');expect(frame.ghosts).toBe(0);}else{expect(frame.initial.scroll).toBe(0);expect(frame.initial.top).toBeCloseTo(frame.final.top,1);}await expect(page.locator('#movie-view-search')).toHaveAttribute('aria-current','page');
 await page.evaluate(()=>document.getAnimations().forEach(a=>a.finish()));await page.locator('#library-entry-back').click();await expect(page.locator('#movie-search')).toBeVisible();expect(await page.locator('#sheet-body').evaluate(e=>e.scrollTop)).toBeGreaterThan(0);
});

test('a scrolled History list settles its detail position before animation and restores the list on Back',async({page})=>{
 await page.locator('#movie-view-history').click();await expect(page.locator('.watch-history .watch-row')).toHaveCount(20);await page.evaluate(()=>document.getAnimations().forEach(a=>a.finish()));
 const frame=await captureClick(page,'.watch-history .watch-row:last-child');expect(frame.beforeScroll).toBeGreaterThan(500);if(test.info().project.name.includes('iphone')){expect(frame.initial).toBeNull();expect(frame.transform).toBe('none');expect(frame.opacity).toBe('1');expect(frame.ghosts).toBe(0);}else{expect(frame.initial.scroll).toBe(0);expect(frame.initial.top).toBeCloseTo(frame.final.top,1);}await expect(page.locator('#movie-view-history')).toHaveAttribute('aria-current','page');
 await page.evaluate(()=>document.getAnimations().forEach(a=>a.finish()));await page.locator('#library-entry-back').click();await expect(page.locator('.watch-history .watch-row')).toHaveCount(20);expect(await page.locator('#sheet-body').evaluate(e=>e.scrollTop)).toBeGreaterThan(500);
});

test('a late history refresh updates the saved position without replacing the preview or replaying its entrance',async({page})=>{
 await page.locator('#continue-watching [data-history-key="movie:157336"]').click();await expect(page.locator('#library-resume')).toBeVisible();
 const result=await page.evaluate(()=>{
  const pane=document.querySelector('#library-page-content'),poster=pane.querySelector('.movie-art img'),resume=document.querySelector('#library-resume');
  const e=libraryUI.entries.find(e=>e.key===libraryUI.key);e.position+=5;libraryUI.version++;window.renderCast();
  return {posterSame:poster===pane.querySelector('.movie-art img'),buttonSame:resume===document.querySelector('#library-resume'),label:document.querySelector('#library-resume').textContent};
 });expect(result).toEqual({posterSame:true,buttonSame:true,label:'Resume 21:05'});
});

test('iOS cancels an unfinished tab slide and uses no detail, title or poster transition',async({page})=>{
 test.skip(!test.info().project.name.includes('iphone'),'iOS saved-title behavior');
 const state=await page.evaluate(()=>{
  document.querySelector('#movie-view-history').click();document.querySelector('.watch-history .watch-row').click();
  return {ghosts:document.querySelectorAll('.screen-outgoing,.library-outgoing').length,animations:document.getAnimations().filter(a=>['content-change','content-exit','content-title','movie-tab-enter','movie-tab-exit','poster-ready'].includes(a.id)).length,transform:getComputedStyle(document.querySelector('#library-page-content')).transform};
 });expect(state).toEqual({ghosts:0,animations:0,transform:'none'});
 await page.locator('#movie-view-search').click();expect(await page.evaluate(()=>document.getAnimations().filter(a=>['content-change','content-exit','movie-tab-enter','movie-tab-exit'].includes(a.id)).length)).toBe(0);await expect(page.locator('.screen-outgoing,.library-outgoing')).toHaveCount(0);
});

test('iPad desktop browser identification also makes saved-title navigation immediate',async({page})=>{
 test.skip(!test.info().project.name.includes('desktop'),'Desktop-mode iPad detection');
 await page.addInitScript(()=>{Object.defineProperty(navigator,'platform',{configurable:true,value:'MacIntel'});Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:5});});await page.reload();await page.locator('#play-on-tv').click();await expect(page.locator('#continue-watching .watch-row')).toHaveCount(3);
 const state=await page.evaluate(()=>{document.querySelector('#continue-watching .watch-row').click();return {immediate:window.remoteMotion.immediateSavedTitle(document.querySelector('#sheet-body').dataset.motionScreen),ghosts:document.querySelectorAll('.screen-outgoing,.library-outgoing').length,transform:getComputedStyle(document.querySelector('#library-page-content')).transform};});expect(state).toEqual({immediate:true,ghosts:0,transform:'none'});
});
