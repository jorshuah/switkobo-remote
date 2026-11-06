import {choose} from './picker-helpers.mjs';
import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{await request.get('/__test/reset');await page.goto('/#access='+'a'.repeat(64));await expect(page.locator('#connection-label')).toHaveText('Connected on your network');await page.locator('#play-on-tv').click();});
test('searching another source keeps the typed title and discards stale results',async({page})=>{
 await page.getByLabel('Title',{exact:true}).fill('Breaking Bad');await page.locator('#movie-search-submit').click();await expect(page.locator('#movie-result-tv-1396')).toBeVisible();
 const searched=page.waitForRequest(r=>r.url().endsWith('/api/catalog/search')&&r.postDataJSON().source==='aether');await choose(page,'Search in','aether');expect((await searched).postDataJSON()).toMatchObject({query:'Breaking Bad',source:'aether',type:'all'});
 await expect(page.locator('#movie-search-status')).toContainText('Aether');await expect(page.getByLabel('Title',{exact:true})).toHaveValue('Breaking Bad');await page.locator('#movie-result-tv-1396').click();await expect(page.locator('#movie-provider')).toHaveValue('aether');
});
test('selecting a season and episode sends that episode to the chosen source without earlier TV commands',async({page,request})=>{
 await choose(page,'Search in','aether');await choose(page,'Show','tv');await page.getByLabel('Title',{exact:true}).fill('Breaking Bad');await page.locator('#movie-search-submit').click();await page.locator('#movie-result-tv-1396').click();
 await expect(page.locator('#movie-episode-picker')).toBeEnabled();await expect(page.locator('#movie-episode')).toHaveValue('1');expect(await(await request.get('/__test/commands')).json()).toEqual([]);
 await choose(page,'Season','2');await expect(page.locator('#movie-episode')).toContainText('Grilled');await choose(page,'Episode','2');
 const started=page.waitForRequest(r=>r.url().endsWith('/api/cast/start'));await page.getByRole('button',{name:'Play episode on TV',exact:true}).click();expect((await started).postDataJSON().url).toBe('https://aether.st/media/tmdb-tv-1396-breaking-bad/3573/972874');await expect(page.locator('#cast-title')).toHaveText('Interstellar');
});
test('episode errors preserve series and season, and retry restores episode selection',async({page})=>{
 let attempts=0;await page.route('**/api/catalog/episodes',async route=>{if(++attempts===1)await route.fulfill({status:503,json:{error:'Episodes are temporarily unavailable.'}});else await route.continue();});
 await page.getByLabel('Title',{exact:true}).fill('Breaking Bad');await page.locator('#movie-search-submit').click();await page.locator('#movie-result-tv-1396').click();await expect(page.locator('#movie-episode-help')).toContainText('temporarily unavailable');await expect(page.locator('#movie-play')).toBeDisabled();await expect(page.getByRole('heading',{name:'Breaking Bad',exact:true})).toBeVisible();await page.locator('#movie-episodes-retry').click();await expect(page.locator('#movie-play')).toBeEnabled();await expect(page.locator('#movie-season')).toHaveValue('1');
});
test('details arriving do not replace a focused control or shift it to another action',async({page})=>{
 await page.route('**/api/catalog/details',async route=>{await new Promise(r=>setTimeout(r,500));await route.continue();});await page.getByLabel('Title',{exact:true}).fill('Breaking Bad');await page.locator('#movie-search-submit').click();await page.locator('#movie-result-tv-1396').click();
 await page.locator('#movie-preview-quality-picker').scrollIntoViewIfNeeded();await page.locator('#movie-preview-quality-picker').focus();await expect(page.locator('#movie-play')).toBeEnabled();await expect(page.locator('#movie-preview-quality-picker')).toBeFocused();
 const box=await page.locator('#movie-preview-quality-picker').boundingBox();expect(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[role="combobox"]')?.id,{x:box.x+box.width/2,y:box.y+box.height/2})).toBe('movie-preview-quality-picker');
});

test('episode controls and the play action stay reachable at narrow phone sizes',async({page})=>{
 await page.setViewportSize({width:320,height:640});await page.getByLabel('Title',{exact:true}).fill('Breaking Bad');await page.locator('#movie-search-submit').click();await page.locator('#movie-result-tv-1396').click();await expect(page.locator('#movie-play')).toBeEnabled();
 await choose(page,'Season','2');await expect(page.locator('#movie-episode-picker')).toBeEnabled();await choose(page,'Episode','2');await page.locator('#movie-play').scrollIntoViewIfNeeded();
 const box=await page.locator('#movie-play').boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(640);expect(await page.locator('#sheet-body').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);expect(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('button')?.id,{x:box.x+box.width/2,y:box.y+box.height/2})).toBe('movie-play');
});

test('an older running helper explains the pending update instead of offering unsupported search filters',async({page})=>{
 await page.getByRole('button',{name:'Close sheet'}).click();await page.route('**/api/state',async route=>{const response=await route.fetch(),data=await response.json();delete data.catalog;await route.fulfill({json:data});});await expect.poll(()=>page.evaluate(()=>snapshot.catalog)).toBeUndefined();await page.locator('#play-on-tv').click();await expect(page.locator('#catalog-source-picker')).toBeDisabled();await expect(page.locator('#catalog-type-picker')).toBeDisabled();await expect(page.locator('#catalog-upgrade-help')).toContainText('after watching');await expect(page.locator('#catalog-source')).toHaveValue('cinejoy');
});
