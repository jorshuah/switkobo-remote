import {test,expect} from '@playwright/test';import {choose} from './picker-helpers.mjs';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{await page.emulateMedia({reducedMotion:'reduce'});await request.get('/__test/reset');await page.goto('/#access='+'a'.repeat(64));await expect(page.locator('#connection-label')).toHaveText('Connected on your network');await page.locator('#play-on-tv').click();});
async function search(page,title='Interstellar'){await page.getByLabel('Title',{exact:true}).fill(title);await page.locator('#movie-search-submit').click();await page.locator(title==='Breaking Bad'?'#movie-result-tv-1396':'#movie-result-157336').click();}

test('bundled movie description is displayed and Play is enabled without a detail-page request',async({page})=>{
 let details=0;await page.route('**/api/catalog/details',async route=>{details++;await route.fulfill({status:503,json:{error:'Description service unavailable.'}});});await search(page);await expect(page.locator('#movie-synopsis')).toContainText('team of explorers');await expect(page.locator('#movie-play')).toBeEnabled();await expect(page.locator('#movie-provider-picker')).toBeEnabled();expect(details).toBe(0);
 const start=page.waitForRequest(r=>r.url().endsWith('/api/cast/start'));await page.locator('#movie-play').click();await start;await expect(page.locator('#cast-title')).toHaveText('Interstellar');expect(details).toBe(0);
});

test('a movie with no supplied description remains playable and does not trigger a description request',async({page})=>{
 await page.route('**/api/catalog/search',async route=>{const response=await route.fetch(),data=await response.json();data.results=data.results.map(({synopsis,...item})=>item);await route.fulfill({json:data});});let details=0;await page.route('**/api/catalog/details',async route=>{details++;await route.abort();});await search(page);await expect(page.locator('#movie-synopsis')).toContainText('No description');await choose(page,'Play using','movy');await expect(page.locator('#movie-play')).toBeEnabled();const start=page.waitForRequest(r=>r.url().endsWith('/api/cast/start'));await page.locator('#movie-play').click();expect((await start).postDataJSON().url).toBe('https://www.movy.sx/movie/157336');expect(details).toBe(0);
});

test('Aether movie matching reuses the bundled page without loading details',async({page})=>{
 let details=0;await page.route('**/api/catalog/details',async route=>{details++;await route.abort();});await search(page);await choose(page,'Play using','aether');const start=page.waitForRequest(r=>r.url().endsWith('/api/cast/start'));await page.locator('#movie-play').click();expect((await start).postDataJSON().url).toBe('https://aether.st/media/tmdb-movie-157336-interstellar');expect(details).toBe(0);
});

test('older Aether results obtain only the required playback page after Play is pressed',async({page})=>{
 await choose(page,'Search in','aether');await page.route('**/api/catalog/search',async route=>{const response=await route.fetch(),data=await response.json();data.results=data.results.map(({page,synopsis,...item})=>item);await route.fulfill({json:data});});let details=0;await page.route('**/api/catalog/details',async route=>{details++;await route.continue();});await search(page);await expect(page.locator('#movie-play')).toBeEnabled();expect(details).toBe(0);const start=page.waitForRequest(r=>r.url().endsWith('/api/cast/start'));await page.locator('#movie-play').click();expect((await start).postDataJSON().url).toContain('aether.st/media/tmdb-movie-157336-');expect(details).toBe(1);
});

test('series show the bundled description while waiting only for seasons and episodes',async({page})=>{
 let release;const gate=new Promise(r=>release=r);await page.route('**/api/catalog/details',async route=>{await gate;await route.continue();});await search(page,'Breaking Bad');await expect(page.locator('#movie-synopsis')).toContainText('team of explorers');await expect(page.locator('#movie-play')).toBeDisabled();await expect(page.locator('#movie-episode-help')).toHaveText('Loading seasons…');await choose(page,'Play using','movy');release();await expect(page.locator('#movie-episode-picker')).toBeEnabled();await expect(page.locator('#movie-play')).toBeEnabled();await expect(page.locator('#movie-provider')).toHaveValue('movy');
});
