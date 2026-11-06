import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{
 test.skip(test.info().project.name.includes('iphone'),'iOS UI transitions are disabled; covered by ios-static-ui.spec.mjs');
 await request.get('/__test/reset');await page.emulateMedia({reducedMotion:'no-preference'});
 await page.goto('/#access='+'a'.repeat(64));await expect(page.locator('#connection-label')).toHaveText('Connected on your network');
 await page.locator('#play-on-tv').click();await page.locator('.sheet-panel').evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{}))));
});

test('preview keeps the outgoing screen at its painted position when pinned tabs disappear',async({page})=>{
 await page.locator('#movie-search').fill('Interstellar');await page.locator('#movie-search-submit').click();await expect(page.locator('#movie-result-157336')).toBeVisible();
 const frame=await page.evaluate(()=>{
  const before=document.querySelector('#library-page-content').getBoundingClientRect(),label=getComputedStyle(document.querySelector('.catalog-filters label'));
  const font=label.fontSize;
  document.querySelector('#movie-result-157336').click();
  for(const a of document.getAnimations())if(['content-change','content-exit'].includes(a.id)){a.pause();a.currentTime=0;}
  const copy=document.querySelector('.screen-copy').getBoundingClientRect();return {before:{top:before.top,left:before.left},after:{top:copy.top,left:copy.left},font,copyFont:getComputedStyle(document.querySelector('.screen-copy .catalog-filters label')).fontSize};
 });
 expect(frame.after.top).toBeCloseTo(frame.before.top,0);expect(frame.after.left).toBeCloseTo(frame.before.left,0);
 expect(frame.copyFont).toBe(frame.font);
});

test('Back restores scrolled Discover without displacing the outgoing preview',async({page})=>{
 await page.locator('#movie-view-discover').click();await expect(page.locator('[data-discover-key]').first()).toBeVisible();
 await page.locator('#sheet-body').evaluate(e=>e.scrollTop=120);await page.evaluate(()=>{document.querySelector('[data-discover-key]').click();for(const a of document.getAnimations())a.finish();});
 const frame=await page.evaluate(()=>{
  const before=document.querySelector('#library-page-content').getBoundingClientRect();document.querySelector('#catalog-back').click();
  for(const a of document.getAnimations())if(['content-change','content-exit'].includes(a.id)){a.pause();a.currentTime=0;}
  const copy=document.querySelector('.screen-copy').getBoundingClientRect();return {before:before.top,after:copy.top,scroll:document.querySelector('#sheet-body').scrollTop};
 });
 expect(frame.after).toBeCloseTo(frame.before,0);expect(frame.scroll).toBeGreaterThan(0);
});

test('harmless viewport notifications do not cancel a screen transition',async({page})=>{
 await page.locator('#movie-search').fill('Interstellar');await page.locator('#movie-search-submit').click();await expect(page.locator('#movie-result-157336')).toBeVisible();
 const frame=await page.evaluate(()=>{
  document.querySelector('#movie-result-157336').click();const pane=document.querySelector('#library-page-content'),a=pane.getAnimations().find(a=>a.id==='content-change');
  a.pause();a.currentTime=60;window.visualViewport?.dispatchEvent(new Event('scroll'));
  return {state:a.playState,ghosts:document.querySelectorAll('.screen-outgoing').length};
 });
 expect(frame.state).toBe('paused');expect(frame.ghosts).toBe(1);
});
