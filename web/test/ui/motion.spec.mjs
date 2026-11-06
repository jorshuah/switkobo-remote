import {test,expect} from '@playwright/test';import {choose} from './picker-helpers.mjs';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{
 test.skip(test.info().project.name.includes('iphone'),'iOS UI transitions are disabled; covered by ios-static-ui.spec.mjs');
 await request.get('/__test/reset');await page.emulateMedia({reducedMotion:'no-preference'});
 await page.addInitScript(()=>{window.__motionEvents=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){const animation=animate.call(this,frames,options),record={name:options?.id||'',target:this.id||this.className,properties:[...new Set(frames.flatMap(f=>Object.keys(f)))],state:'running',focus:document.activeElement?.id||''};window.__motionEvents.push(record);animation.finished.then(()=>record.state='finished',()=>record.state='cancelled');return animation;};});
 await page.goto('/#access='+'a'.repeat(64));await expect(page.locator('#connection-label')).toHaveText('Connected on your network');
});
test('sheet entry survives initial title focus while the native dialog stays untransformed',async({page})=>{
 await page.locator('#play-on-tv').click();await expect(page.locator('#sheet-title')).toBeFocused();await expect(page.locator('#sheet')).toHaveCSS('transform','none');
 const entry=await page.evaluate(()=>window.__motionEvents.find(e=>e.name==='sheet-enter'));expect(entry).toBeTruthy();expect(entry.focus).toBe('sheet-title');await expect.poll(()=>page.evaluate(()=>window.__motionEvents.find(e=>e.name==='sheet-enter')?.state)).toBe('finished');
 await expect(page.locator('#sheet')).toHaveCSS('transform','none');
});
test('a picker can open during sheet entry with stationary hit targets and only an opacity transition',async({page})=>{
 await page.locator('#play-on-tv').click();await page.evaluate(()=>document.querySelector('#catalog-source-picker').click());await expect(page.getByRole('listbox',{name:'Search in',exact:true})).toBeVisible();await expect(page.locator('.picker-popup')).toHaveCSS('transform','none');await expect(page.locator('#sheet')).toHaveCSS('transform','none');
 const option=page.getByRole('option',{name:'Aether',exact:true}),box=await option.boundingBox();expect(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[role="option"]')?.textContent,{x:box.x+box.width/2,y:box.y+box.height/2})).toBe('Aether');
 await option.click();await expect(page.locator('#catalog-source')).toHaveValue('aether');
 const events=await page.evaluate(()=>window.__motionEvents.filter(e=>/^picker-/.test(e.name)));expect(events.length).toBeGreaterThan(0);expect(events.every(e=>e.properties.every(p=>p==='opacity'))).toBe(true);
});
test('rapid picker changes leave one live list and no interactive fading remnants',async({page})=>{
 await page.locator('#play-on-tv').click();await page.evaluate(()=>{document.querySelector('#catalog-source-picker').click();document.querySelector('#catalog-source-picker').click();document.querySelector('#catalog-type-picker').click();});
 await expect(page.getByRole('listbox')).toHaveCount(1);await expect(page.getByRole('listbox')).toHaveAttribute('aria-label','Show');
 const remnants=await page.locator('.picker-popup[aria-hidden="true"]').evaluateAll(es=>es.map(e=>({pointer:getComputedStyle(e).pointerEvents,inert:e.inert})));expect(remnants.every(e=>e.pointer==='none'&&e.inert)).toBe(true);
 await page.getByRole('option',{name:'Series',exact:true}).click();await expect(page.locator('#catalog-type')).toHaveValue('tv');await expect(page.getByRole('listbox')).toHaveCount(0);
});
test('search and preview transition once and do not replay motion on background status polls',async({page})=>{
 await page.locator('#play-on-tv').click();await page.getByLabel('Title',{exact:true}).fill('Interstellar');await page.locator('#movie-search-submit').click();await page.locator('#movie-result-157336').click();await expect(page.locator('#movie-synopsis')).toContainText('team of explorers');
 await expect.poll(()=>page.evaluate(()=>window.__motionEvents.filter(e=>e.name==='content-change').length)).toBeGreaterThan(0);
 const before=await page.evaluate(()=>window.__motionEvents.filter(e=>e.name==='content-change'||e.name==='results-ready').length);await page.evaluate(()=>poll());const after=await page.evaluate(()=>window.__motionEvents.filter(e=>e.name==='content-change'||e.name==='results-ready').length);expect(after).toBe(before);
 await page.locator('#catalog-back').click();await expect(page.getByLabel('Title',{exact:true})).toHaveValue('Interstellar');
});
test('TV commands are sent while visual feedback is still running',async({page,request})=>{
 await page.evaluate(()=>{const fetcher=window.fetch;window.__commandDuringMotion=false;window.fetch=function(url,options){if(String(url).endsWith('/api/key'))window.__commandDuringMotion=document.getAnimations().some(a=>a.playState==='running');return fetcher.call(this,url,options);};document.querySelector('#mode-touchpad').click();document.querySelector('[data-key="HOME"]').click();});
 await expect.poll(async()=>await(await request.get('/__test/commands')).json()).toEqual([{key:'KEY_HOME'}]);expect(await page.evaluate(()=>window.__commandDuringMotion)).toBe(true);
});
test('reduced motion settles immediately and retains picker, focus and close behavior',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#play-on-tv').click();await choose(page,'Search in','movy');await expect(page.locator('#catalog-source')).toHaveValue('movy');expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
 await page.locator('#close-sheet').click();await expect(page.locator('#sheet')).not.toBeVisible();await expect(page.locator('#play-on-tv')).toBeFocused();
 await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('#play-on-tv').click();await page.evaluate(()=>dismissSheet());await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('#sheet')).not.toBeVisible();await expect(page.locator('.picker-popup')).toHaveCount(0);
});

test('movie navigation animates stable content surfaces through preview, saved-title actions and link entry',async({page,request})=>{
 await request.get('/__test/history');await page.locator('#play-on-tv').click();await expect(page.locator('#continue-watching')).toContainText('Interstellar');await page.locator('.sheet-panel').evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{}))));
 const panel=await page.locator('.sheet-panel').boundingBox();
 const finish=async()=>{const direct=await page.evaluate(()=>window.remoteMotion.immediateSavedTitle(document.querySelector('#sheet-body').dataset.motionScreen));if(direct){await expect(page.locator('.screen-outgoing,.library-outgoing')).toHaveCount(0);await expect(page.locator('#library-page-content')).toHaveCSS('transform','none');}else await expect.poll(()=>page.evaluate(()=>window.__motionEvents.filter(e=>e.name==='content-change').at(-1)?.state)).toBe('finished');await expect(page.locator('#sheet')).toHaveCSS('transform','none');const after=await page.locator('.sheet-panel').boundingBox();expect(after.y).toBeCloseTo(panel.y,1);expect(after.height).toBeCloseTo(panel.height,1);};
 await page.locator('#continue-watching [data-history-key="movie:157336"]').click();await expect(page.locator('#library-resume')).toBeVisible();await finish();
 const direct=await page.evaluate(()=>window.remoteMotion.immediateSavedTitle(document.querySelector('#sheet-body').dataset.motionScreen)),forward=await page.evaluate(()=>window.__motionEvents.filter(e=>e.name==='content-change').at(-1));if(direct)expect(forward).toBeUndefined();else{expect(forward.target).toBe('library-page-content');expect(forward.properties).toContain('transform');}
 let before=await page.evaluate(()=>window.__motionEvents.length);await page.locator('#library-remove').click();await expect(page.locator('#library-remove-confirm')).toBeVisible();await finish();if(direct)expect(await page.evaluate(()=>window.__motionEvents.length)).toBe(before);else expect(await page.evaluate(()=>window.__motionEvents.length)).toBeGreaterThan(before);
 await page.locator('#library-cancel').click();await expect(page.locator('#library-remove')).toBeFocused();await finish();
 await page.locator('#movie-view-search').click();await expect.poll(()=>page.locator('.library-outgoing').count()).toBe(0);await page.locator('#movie-search').fill('Interstellar');await page.locator('#movie-search-submit').click();await page.locator('#movie-result-157336').click();await finish();
 await page.locator('#catalog-back').click();await finish();await page.locator('#catalog-paste').click();await page.locator('#movie-link').waitFor();await finish();await page.locator('#catalog-return').click();await finish();
 before=await page.evaluate(()=>window.__motionEvents.filter(e=>e.name==='content-change').length);await page.evaluate(()=>poll());expect(await page.evaluate(()=>window.__motionEvents.filter(e=>e.name==='content-change').length)).toBe(before);expect(await(await request.get('/__test/commands')).json()).toEqual([]);
});

test('navigation blends an inert outgoing screen, reverses on Back and cleans rapid replacements',async({page,request})=>{
 await page.locator('#play-on-tv').click();await page.locator('#movie-search').fill('Interstellar');await page.locator('#movie-search-submit').click();await expect(page.locator('#movie-result-157336')).toBeVisible();
 const forward=await page.evaluate(()=>{document.querySelector('#movie-result-157336').click();const ghost=document.querySelector('.screen-outgoing'),pane=document.querySelector('#library-page-content'),animation=pane.getAnimations().find(a=>a.id==='content-change');for(const a of document.getAnimations())if(['content-change','content-exit'].includes(a.id)){a.pause();a.currentTime=70;}return {frame:animation.effect.getKeyframes()[0].transform,ghost:Boolean(ghost),inert:ghost?.inert,ids:ghost?.querySelectorAll('[id]').length,hidden:ghost?.getAttribute('aria-hidden'),pointer:getComputedStyle(ghost).pointerEvents};});
 expect(forward).toMatchObject({frame:'translateX(24px)',ghost:true,inert:true,ids:0,hidden:'true',pointer:'none'});
 const back=await page.evaluate(()=>{document.querySelector('#catalog-back').click();const pane=document.querySelector('#library-page-content');return {frame:pane.getAnimations().find(a=>a.id==='content-change').effect.getKeyframes()[0].transform,ghosts:document.querySelectorAll('.screen-outgoing').length,duplicateIDs:[...document.querySelectorAll('[id]')].map(e=>e.id).filter((id,i,ids)=>ids.indexOf(id)!==i)};});expect(back.frame).toBe('none');expect(back.ghosts).toBe(1);expect(back.duplicateIDs).toEqual([]);
 await expect(page.locator('.screen-outgoing')).toHaveCount(0);await expect(page.locator('#movie-search')).toHaveValue('Interstellar');expect(await(await request.get('/__test/commands')).json()).toEqual([]);
});

test('viewport changes settle navigation immediately and preserve content hit testing',async({page})=>{
 await page.locator('#play-on-tv').click();await page.locator('#movie-search').fill('Interstellar');await page.locator('#movie-search-submit').click();await expect(page.locator('#movie-result-157336')).toBeVisible();
 const state=await page.evaluate(()=>{document.querySelector('#movie-result-157336').click();const height=visualViewport.height;Object.defineProperty(visualViewport,'height',{configurable:true,value:height-100});window.dispatchEvent(new Event('resize'));const pane=document.querySelector('#library-page-content'),button=document.querySelector('#catalog-back'),r=button.getBoundingClientRect();return {ghosts:document.querySelectorAll('.screen-outgoing').length,transform:getComputedStyle(pane).transform,native:getComputedStyle(document.querySelector('#sheet')).transform,hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')?.id};});expect(state).toEqual({ghosts:0,transform:'none',native:'none',hit:'catalog-back'});
});

test('Settings and remote use directional transitions and remain responsive to rapid Back',async({page})=>{
 const forward=await page.evaluate(()=>{document.querySelector('#header-settings').click();return document.querySelector('#settings-screen').getAnimations().find(a=>a.id==='view-change').effect.getKeyframes()[0].transform;});expect(forward).toBe('translateX(28px)');await expect(page.locator('#settings-screen')).toBeVisible();
 const back=await page.evaluate(()=>{document.querySelector('#back-settings').click();return document.querySelector('.controls').getAnimations().find(a=>a.id==='view-change').effect.getKeyframes()[0].transform;});expect(back).toBe('translateX(-28px)');await expect(page.locator('#remote-screen')).toBeVisible();await expect(page.locator('#header-settings')).toBeFocused();
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#header-settings').click();await page.locator('#back-settings').click();expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
});

test('subtitle screens keep forward and back directions consistent without playback commands',async({page,request})=>{
 await page.locator('#play-on-tv').click();await page.locator('#catalog-paste').click();await page.locator('#movie-link').fill('https://cinejoy.pk/movie/157336');await page.locator('#cast-start').click();await expect(page.locator('#cast-toggle')).toBeEnabled();
 const step=async(selector)=>page.evaluate(selector=>{document.querySelector(selector).click();const pane=document.querySelector('#library-page-content');return pane.getAnimations().find(a=>a.id==='content-change')?.effect.getKeyframes()[0].transform;},selector);
 expect(await step('#cast-subtitle-tools')).toBe('none');expect(await step('#subtitle-find')).toBe('translateX(24px)');expect(await step('#subtitle-back')).toBe('none');expect(await step('#subtitle-back')).toBe('translateX(-24px)');await expect(page.locator('#cast-toggle')).toBeEnabled();await expect(page.locator('.screen-outgoing')).toHaveCount(0);expect(await(await request.get('/__test/commands')).json()).toEqual([]);
});

test('shortcut editing uses the shared forward and back transition without changing saved apps',async({page,request})=>{
 await page.locator('#header-settings').click();await page.locator('#manage-shortcuts').click();await expect(page.locator('#add-custom-shortcut')).toBeVisible();
 const forward=await page.evaluate(()=>{document.querySelector('#add-custom-shortcut').click();return document.querySelector('.sheet-content-surface').getAnimations().find(a=>a.id==='content-change')?.effect.getKeyframes()[0].transform;});expect(forward).toBe('none');
 const back=await page.evaluate(()=>{document.querySelector('#back-shortcuts').click();return document.querySelector('.sheet-content-surface').getAnimations().find(a=>a.id==='content-change')?.effect.getKeyframes()[0].transform;});expect(back).toBe('translateX(-24px)');await expect(page.locator('#add-custom-shortcut')).toBeVisible();await expect(page.locator('.screen-outgoing')).toHaveCount(0);expect(await(await request.get('/__test/commands')).json()).toEqual([]);
});
