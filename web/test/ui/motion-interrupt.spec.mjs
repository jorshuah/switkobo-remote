import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
test('closing a partially entered sheet starts from its current painted position and closes once',async({page,request})=>{
 test.skip(test.info().project.name.includes('iphone'),'iOS sheets open and close immediately');
 await request.get('/__test/reset');await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/#access='+'a'.repeat(64));await expect(page.locator('#connection-label')).toHaveText('Connected on your network');
 await page.locator('#play-on-tv').click();
 const frame=await page.evaluate(()=>{const panel=document.querySelector('.sheet-panel'),entry=panel.getAnimations().find(a=>a.id==='sheet-enter');if(!entry)throw Error('Sheet entrance was not running');entry.currentTime=45;const s=getComputedStyle(panel),before={opacity:Number(s.opacity),transform:s.transform};window.__closes=0;document.querySelector('#sheet').addEventListener('close',()=>window.__closes++);dismissSheet();dismissSheet();const exit=panel.getAnimations().find(a=>a.id==='sheet-exit'),first=exit.effect.getKeyframes()[0];return {before,after:{opacity:Number(first.opacity),transform:first.transform},entryState:entry.playState,root:getComputedStyle(document.querySelector('#sheet')).transform};});
 expect(frame.before.opacity).toBeLessThan(1);expect(frame.after.opacity).toBeCloseTo(frame.before.opacity,4);expect(frame.after.transform).toBe(frame.before.transform);expect(frame.entryState).toBe('idle');expect(frame.root).toBe('none');
 await expect(page.locator('#sheet')).not.toBeVisible();await expect.poll(()=>page.evaluate(()=>window.__closes)).toBe(1);await expect(page.locator('#play-on-tv')).toBeFocused();
 await page.locator('#play-on-tv').click();await expect(page.locator('#sheet-title')).toBeFocused();await expect.poll(()=>page.locator('.sheet-panel').evaluate(e=>getComputedStyle(e).transform)).toBe('none');
});
