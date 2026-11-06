import {choose} from './picker-helpers.mjs';
import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{await request.get('/__test/reset');await page.goto('/#access='+'a'.repeat(64));await expect(page.locator('#connection-label')).toHaveText('Connected on your network');await page.locator('#play-on-tv').click();});
async function search(page,query='Interstellar'){await page.getByLabel('Title',{exact:true}).fill(query);await page.locator('#movie-search-submit').click();}
async function preview(page){await search(page);await page.locator('#movie-result-157336').click();await expect(page.locator('#movie-synopsis')).toContainText('team of explorers');}

test('tapping the search icon focuses the editable field and native typing can submit a title',async({page,request})=>{
 const icon=page.locator('.movie-search-field > img'),box=await icon.boundingBox();if(test.info().project.name.includes('desktop'))await page.mouse.click(box.x+box.width/2,box.y+box.height/2);else await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
 await expect(page.locator('#movie-search')).toBeFocused();await page.keyboard.type('Interstellar');await expect(page.locator('#movie-search')).toHaveValue('Interstellar');await page.keyboard.press('Enter');await expect(page.locator('#movie-result-157336')).toBeVisible();expect(await(await request.get('/__test/commands')).json()).toEqual([]);
});

test('the search field stays mounted while searching and polling, with Continue watching below it',async({page,request})=>{
 await request.get('/__test/history');await page.evaluate(()=>loadHistory());await expect(page.locator('#continue-watching')).toContainText('Interstellar');
 expect(await page.evaluate(()=>Boolean(document.querySelector('#movie-search-form').compareDocumentPosition(document.querySelector('#continue-watching'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 const box=await page.locator('#movie-search').boundingBox();if(test.info().project.name.includes('desktop'))await page.mouse.click(box.x+box.width/2,box.y+box.height/2);else await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
 await expect(page.locator('#movie-search')).toBeFocused();await page.keyboard.type('Interstellar');await page.locator('#movie-search').evaluate(el=>window.__searchInput=el);await page.evaluate(()=>poll());await expect(page.locator('#movie-search')).toBeFocused();await page.locator('#movie-search-submit').click();await expect(page.locator('#movie-result-157336')).toBeVisible();expect(await page.locator('#movie-search').evaluate(el=>el===window.__searchInput)).toBe(true);
 await page.locator('#movie-search-clear').click();await expect(page.locator('#movie-search')).toBeFocused();await expect(page.locator('#movie-search')).toHaveValue('');await page.keyboard.type('Breaking Bad');await page.keyboard.press('Enter');await expect(page.locator('#movie-result-tv-1396')).toBeVisible();
});

test('returning to search keeps every input ancestor stationary and accepts touch typing immediately',async({page,request})=>{
 await preview(page);await page.evaluate(()=>document.querySelector('#catalog-back').click());
 const input=page.locator('#movie-search'),box=await input.boundingBox();if(test.info().project.name.includes('desktop'))await page.mouse.click(box.x+box.width/2,box.y+box.height/2);else await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await expect(input).toBeFocused();
 expect(await input.evaluate(el=>{const transforms=[];for(let p=el;p&&p.id!=='sheet';p=p.parentElement)transforms.push(getComputedStyle(p).transform);return transforms.every(t=>t==='none');})).toBe(true);
 await page.locator('#movie-search-clear').click();await page.keyboard.type('Breaking Bad');await page.locator('#movie-search-submit').click();await expect(page.locator('#movie-result-tv-1396')).toBeVisible();expect(await(await request.get('/__test/commands')).json()).toEqual([]);
});
test('title search previews real-shaped metadata without sending anything to the TV and preserves results',async({page,request})=>{
 await expect(page.getByRole('heading',{name:'Find something to watch',exact:true})).toBeVisible();await expect(page.locator('#movie-link')).toHaveCount(0);
 await search(page);await expect(page.locator('.movie-result')).toHaveCount(2);await expect(page.locator('#movie-result-157336')).toContainText('2014');await expect(page.locator('#movie-result-529107')).toContainText('2015');
 await expect(page.locator('#movie-result-157336 .movie-art img')).toHaveAttribute('src',/^data:image/);
 await page.locator('#movie-result-157336').click();await expect(page.locator('#movie-synopsis')).toContainText('team of explorers');await expect(page.getByRole('heading',{name:'Interstellar',exact:true})).toBeVisible();
 expect(await(await request.get('/__test/commands')).json()).toEqual([]);
 await page.locator('#catalog-back').click();await expect(page.getByLabel('Title',{exact:true})).toHaveValue('Interstellar');await expect(page.locator('#movie-result-157336')).toBeFocused();
 await page.getByRole('button',{name:'Close sheet'}).click();await page.locator('#play-on-tv').click();await expect(page.locator('.movie-result')).toHaveCount(2);
 await page.locator('#catalog-paste').click();await expect(page.locator('#movie-link')).toBeVisible();await page.locator('#catalog-return').click();await expect(page.locator('.movie-result')).toHaveCount(2);
});
test('play uses the chosen source and quality; browsing preserves playback until replacement confirmation',async({page,request})=>{
 await preview(page);await choose(page,'Play using','movy');await choose(page,'Quality','720');
 const started=page.waitForRequest(r=>r.url().endsWith('/api/cast/start'));await page.locator('#movie-play').click();expect((await started).postDataJSON()).toMatchObject({url:'https://www.movy.sx/movie/157336',quality:720});
 await expect(page.locator('#cast-title')).toHaveText('Interstellar');await page.locator('#cast-browse').click();await page.locator('#movie-result-529107').click();await expect(page.locator('#movie-play')).toBeEnabled();
 await page.locator('#movie-play').click();await expect(page.getByRole('heading',{name:'Replace the current video?',exact:true})).toBeVisible();expect(await(await request.get('/__test/commands')).json()).toEqual([]);
 await page.locator('#movie-keep').click();await expect(page.locator('#cast-title')).toHaveText('Interstellar');
 await page.locator('#cast-browse').click();await page.locator('#movie-result-157336').click();await expect(page.locator('#movie-play')).toBeEnabled();await page.locator('#movie-play').click();
 const next=page.waitForRequest(r=>r.url().endsWith('/api/cast/start'));await page.locator('#movie-replace').click();await next;expect(await(await request.get('/__test/commands')).json()).toEqual([{cast:'stop'}]);await expect(page.locator('#cast-title')).toHaveText('Interstellar');
});
test('empty results, source failures and asynchronous playback failures offer recovery',async({page,request})=>{
 await search(page,'nothing');await expect(page.locator('#movie-search-status')).toContainText('No titles found');await search(page,'error');await expect(page.locator('#movie-search-status')).toContainText('unavailable');
 await preview(page);await page.locator('#movie-play').click();await expect(page.locator('#cast-title')).toHaveText('Interstellar');await request.get('/__test/cast-error');await expect(page.locator('#movie-detail-error')).toContainText('No supported video');
 await expect(page.locator('#movie-play')).toBeEnabled();await expect(page.locator('#movie-synopsis')).toContainText('team of explorers');
});
test('late searches cannot replace newer results or reopen a dismissed sheet',async({page})=>{
 await page.route('**/api/catalog/search',async route=>{const q=route.request().postDataJSON().query;if(q==='slow')await new Promise(r=>setTimeout(r,900));await route.fulfill({json:{query:q,results:[{id:q==='slow'?'1':'2',title:q,year:'2020',poster:false}]}});});
 await search(page,'slow');await search(page,'latest');await expect(page.locator('.movie-result')).toContainText('latest');await page.waitForTimeout(1100);await expect(page.locator('.movie-result')).toContainText('latest');
 await search(page,'slow');await page.getByRole('button',{name:'Close sheet'}).click();await page.waitForTimeout(1100);await expect(page.locator('#sheet')).not.toBeVisible();
});
test('search and preview fit narrow screens, both themes and keyboard dismissal',async({page})=>{
 await page.setViewportSize({width:320,height:640});await search(page);await page.locator('#movie-result-529107').click();await expect(page.locator('#movie-synopsis')).toContainText('team of explorers');
 for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);const bounds=await page.locator('#sheet').boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(320);expect(bounds.y+bounds.height).toBeLessThanOrEqual(641);const width=await page.locator('#sheet-body').evaluate(el=>({s:el.scrollWidth,c:el.clientWidth}));expect(width.s).toBeLessThanOrEqual(width.c+1);await expect(page.locator('#movie-play')).toBeEnabled();}
 await page.keyboard.press('Tab');await expect(page.locator('#sheet')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#sheet')).not.toBeVisible();await expect(page.locator('#play-on-tv')).toBeFocused();
});

test('a rejected start retains the preview and can be retried without treating the catalog as a TV connection failure',async({page})=>{
 await preview(page);let attempts=0;await page.route('**/api/cast/start',async route=>{attempts++;if(attempts===1)await route.fulfill({status:503,json:{error:'This source is temporarily unavailable. Try another source.'}});else await route.continue();});
 await page.locator('#movie-play').click();await expect(page.locator('#movie-detail-error')).toContainText('temporarily unavailable');await expect(page.locator('#sheet-notice')).toBeHidden();await expect(page.locator('#movie-synopsis')).toContainText('team of explorers');await expect(page.locator('#connection-label')).toHaveText('Connected on your network');
 await choose(page,'Play using','movy');await page.locator('#movie-play').click();await expect(page.locator('#cast-title')).toHaveText('Interstellar');expect(attempts).toBe(2);
});
