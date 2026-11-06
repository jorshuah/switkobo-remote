import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{
 test.skip(!test.info().project.name.includes('iphone'),'iOS immediate UI');
 await request.get('/__test/reset');await request.get('/__test/history');await page.emulateMedia({reducedMotion:'no-preference'});
 await page.addInitScript(()=>{window.__uiAnimations=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){window.__uiAnimations.push(options?.id||'');return animate.call(this,frames,options);};});
 await page.goto('/#access='+'a'.repeat(64));await expect(page.locator('#connection-label')).toHaveText('Connected on your network');
});
async function still(page){
 await expect(page.locator('.screen-outgoing,.library-outgoing')).toHaveCount(0);expect(await page.evaluate(()=>window.__uiAnimations)).toEqual([]);
 await expect(page.locator('#sheet')).toHaveCSS('transform','none');
 if(await page.locator('#library-page-content').count())await expect(page.locator('#library-page-content')).toHaveCSS('transform','none');
}
test('iOS Search, Discover, title details, History, confirmations and Back switch directly',async({page,request})=>{
 await page.locator('#header-settings').click();await expect(page.locator('#settings-screen')).toBeVisible();await page.locator('#back-settings').click();await page.locator('#play-on-tv').click();await expect(page.locator('#movie-search')).toBeVisible();await still(page);
 await page.locator('#movie-view-discover').click();await page.locator('#popular-movie-result-157336').click();await expect(page.locator('#movie-play')).toBeVisible();await still(page);await page.locator('#catalog-back').click();await expect(page.locator('#discover-source-picker')).toBeVisible();await still(page);
 await page.locator('#movie-view-search').click();await page.locator('#movie-search').fill('Interstellar');await page.locator('#movie-search-submit').click();await page.locator('#movie-result-157336').click();await expect(page.locator('#movie-play')).toBeVisible();await still(page);await page.locator('#catalog-back').click();await expect(page.locator('#movie-search')).toHaveValue('Interstellar');
 await page.locator('#movie-view-history').click();await page.locator('.watch-history [data-history-key="movie:157336"]').click();await expect(page.locator('#library-resume')).toBeVisible();await still(page);await page.locator('#library-remove').click();await expect(page.locator('#library-remove-confirm')).toBeVisible();await still(page);await page.locator('#library-cancel').click();await page.locator('#library-entry-back').click();await expect(page.locator('.watch-history')).toBeVisible();await still(page);
 await page.locator('#close-sheet').click();await expect(page.locator('#sheet')).not.toBeVisible();expect(await page.evaluate(()=>window.__uiAnimations)).toEqual([]);expect(await(await request.get('/__test/commands')).json()).toEqual([]);
});
test('iOS link input, video opening, player and subtitle screens stay static and usable',async({page,request})=>{
 await page.locator('#play-on-tv').click();await page.locator('#catalog-paste').click();await page.locator('#movie-link').tap();await page.keyboard.type('https://cinejoy.pk/movie/157336');await expect(page.locator('#movie-link')).toHaveValue('https://cinejoy.pk/movie/157336');await still(page);
 await page.locator('#cast-start').click();await expect(page.locator('#cast-toggle')).toBeEnabled();await still(page);await page.locator('#cast-subtitle-tools').click();await expect(page.locator('#subtitle-find')).toBeVisible();await still(page);await page.locator('#subtitle-find').click();await expect(page.locator('#subtitle-back')).toBeVisible();await still(page);await page.locator('#subtitle-back').click();await page.locator('#subtitle-back').click();await expect(page.locator('#cast-toggle')).toBeEnabled();await still(page);expect(await(await request.get('/__test/commands')).json()).toEqual([]);
});
