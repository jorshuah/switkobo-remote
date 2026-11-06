import {choose} from './picker-helpers.mjs';
import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{await request.get('/__test/reset');await page.goto('/#access='+'a'.repeat(64));await expect(page.locator('#connection-label')).toHaveText('Connected on your network');});
test('movie links retain failed input and opening a movie reveals the confirmed playback controls',async({page})=>{
 await page.locator('#play-on-tv').click();await expect(page.getByRole('heading',{name:'Find something to watch',exact:true})).toBeVisible();await page.locator('#catalog-paste').click();
 await page.getByLabel('Video link',{exact:true}).fill('https://192.168.0.1/video');await page.locator('#cast-start').click();await expect(page.locator('#sheet-notice')).toContainText('Use a public HTTPS video link');await expect(page.getByLabel('Video link',{exact:true})).toHaveValue('https://192.168.0.1/video');
 await page.getByLabel('Video link',{exact:true}).fill('https://www.movy.sx/movie/157336');await choose(page,'Video quality','720');const startRequest=page.waitForRequest(r=>r.url().endsWith('/api/cast/start'));await page.locator('#cast-start').click();expect((await startRequest).postDataJSON().quality).toBe(720);await expect(page.locator('#cast-status')).toContainText('Opening video');await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeVisible();
 await expect(page.locator('#cast-title')).toHaveText('Interstellar');await expect(page.getByRole('button',{name:'Pause movie',exact:true})).toBeEnabled();await expect(page.locator('#cast-duration')).toHaveText('2:49:02');
 await page.getByRole('button',{name:'Close sheet'}).click();await expect(page.locator('#cast-entry-title')).toHaveText('Interstellar');await page.locator('#play-on-tv').click();await expect(page.locator('#cast-title')).toHaveText('Interstellar');
});
test('pause, seek, subtitles and stop send authenticated session controls once',async({page,request})=>{
 await page.locator('#play-on-tv').click();await page.locator('#catalog-paste').click();await page.getByLabel('Video link',{exact:true}).fill('https://www.movy.sx/movie/157336');await page.locator('#cast-start').click();await expect(page.getByRole('button',{name:'Pause movie',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Pause movie',exact:true}).click();await expect(page.locator('#cast-status')).toHaveText('Paused');await page.getByRole('button',{name:'Resume movie',exact:true}).click();
 await page.locator('#cast-seek').evaluate(el=>{el.value='1200';el.dispatchEvent(new Event('input',{bubbles:true}));});await expect(page.locator('#cast-elapsed')).toHaveText('20:00');expect((await(await request.get('/__test/commands')).json()).filter(c=>c.cast==='seek')).toHaveLength(0);
 await page.locator('#cast-seek').dispatchEvent('change');await expect(page.locator('#cast-elapsed')).toHaveText('20:00');
 await choose(page,'Subtitles','0');await expect(page.locator('#cast-subtitle')).toHaveValue('0');
 const commands=await(await request.get('/__test/commands')).json();expect(commands).toEqual([{cast:'pause'},{cast:'play'},{cast:'seek',position:1200},{cast:'subtitle',subtitle:'0'}]);
 await page.getByRole('button',{name:'Stop playback',exact:true}).click();await expect(page.getByLabel('Video link',{exact:true})).toHaveValue('https://www.movy.sx/movie/157336');await expect(page.locator('#cast-form-message')).toHaveText('Playback stopped.');
});
test('source errors return to the retained link and the sheet supports keyboard dismissal',async({page,request})=>{
 await page.locator('#play-on-tv').click();await page.locator('#catalog-paste').click();await page.getByLabel('Video link',{exact:true}).fill('https://www.movy.sx/movie/157336');await page.locator('#cast-start').click();await request.get('/__test/cast-error');
 await expect(page.locator('#cast-form-message')).toContainText('Try a different video link');await expect(page.getByLabel('Video link',{exact:true})).toHaveValue('https://www.movy.sx/movie/157336');await page.keyboard.press('Escape');await expect(page.locator('#sheet')).not.toBeVisible();await expect(page.locator('#play-on-tv')).toBeFocused();
});
test('playback sheets fit narrow screens and honor both color schemes',async({page})=>{
 await page.setViewportSize({width:320,height:640});await page.locator('#play-on-tv').click();await page.locator('#catalog-paste').click();await page.getByLabel('Video link',{exact:true}).fill('https://www.movy.sx/movie/157336');await page.locator('#cast-start').click();await expect(page.locator('#cast-title')).toHaveText('Interstellar');
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const bounds=await page.locator('#sheet').boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(320);expect(bounds.y+bounds.height).toBeLessThanOrEqual(641);
  const width=await page.locator('#sheet-body').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));expect(width.scroll).toBeLessThanOrEqual(width.client+1);await expect(page.getByRole('button',{name:'Stop playback',exact:true})).toBeVisible();
 }
});

test('Cinejoy home pages explain the required link while movie and direct HLS links can start playback',async({page})=>{
 await page.locator('#play-on-tv').click();await page.locator('#catalog-paste').click();await page.getByLabel('Video link',{exact:true}).fill('https://cinejoy.pk/');await page.locator('#cast-start').click();await expect(page.locator('#sheet-notice')).toContainText('rather than its home page');
 await page.getByLabel('Video link',{exact:true}).fill('https://cinejoy.pk/movie/157336');const cinejoy=page.waitForRequest(r=>r.url().endsWith('/api/cast/start'));await page.locator('#cast-start').click();expect((await cinejoy).postDataJSON().url).toBe('https://cinejoy.pk/movie/157336');await expect(page.locator('#cast-title')).toHaveText('Interstellar');await page.locator('#cast-stop').click();
 await page.getByLabel('Video link',{exact:true}).fill('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');await page.locator('#cast-start').click();await expect(page.getByRole('button',{name:'Pause movie',exact:true})).toBeEnabled();
});

test('a failed replacement explains recovery while the current playback controls remain usable',async({page,request})=>{
 await page.locator('#play-on-tv').click();await page.locator('#catalog-paste').click();await page.getByLabel('Video link',{exact:true}).fill('https://cinejoy.pk/movie/157336');await page.locator('#cast-start').click();await expect(page.locator('#cast-title')).toHaveText('Interstellar');await request.get('/__test/cast-prepare-failed');await expect(page.locator('#cast-status')).toContainText('current video was kept playing');await expect(page.getByRole('button',{name:'Pause movie',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Stop playback',exact:true})).toBeEnabled();
});

test('missing tracks and failed subtitle files show different guidance without disabling playback',async({page,request})=>{
 await page.locator('#play-on-tv').click();await page.locator('#catalog-paste').click();await page.locator('#movie-link').fill('https://www.movy.sx/movie/157336');await page.locator('#cast-start').click();await expect(page.locator('#cast-title')).toHaveText('Interstellar');await request.get('/__test/cast-no-subtitles');await expect(page.locator('#cast-subtitle-help')).toContainText('does not include subtitle tracks');await expect(page.locator('#cast-toggle')).toBeEnabled();await request.get('/__test/cast-subtitles-failed');await expect(page.locator('#cast-subtitle-help')).toContainText('could not be loaded');await expect(page.locator('#cast-toggle')).toBeEnabled();
});

async function startPlayer(page){await page.locator('#play-on-tv').click();await page.locator('#catalog-paste').click();await page.locator('#movie-link').fill('https://cinejoy.pk/movie/157336');await page.locator('#cast-start').click();await expect(page.locator('#cast-toggle')).toBeEnabled();}

test('now playing can change quality without starting another movie or losing playback controls',async({page,request})=>{
 await startPlayer(page);await choose(page,'Subtitles','0');await page.locator('#cast-toggle').click();
 const starts=await(await request.get('/__test/starts')).json();await choose(page,'Video quality','720');await expect(page.locator('#cast-quality')).toHaveValue('720');await expect(page.locator('#cast-player-device')).toContainText('720p');await expect(page.locator('#cast-subtitle')).toHaveValue('0');await expect(page.locator('#cast-status')).toHaveText('Paused');await expect(page.locator('#cast-toggle')).toHaveAttribute('aria-label','Resume movie');
 expect(await(await request.get('/__test/starts')).json()).toHaveLength(starts.length);expect((await(await request.get('/__test/commands')).json()).filter(c=>c.cast==='quality')).toEqual([{cast:'quality',quality:720}]);
 await page.screenshot({path:test.info().outputPath('quality-selector.png')});expect(await page.locator('#sheet-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await request.get('/__test/cast-one-quality');await expect(page.getByRole('combobox',{name:'Video quality',exact:true})).toBeDisabled();await expect(page.locator('#cast-quality-help')).toContainText('one video quality');await expect(page.locator('#cast-toggle')).toBeEnabled();
});

test('a failed quality request restores the current resolution and remains usable',async({page})=>{
 await startPlayer(page);const quality=await page.locator('#cast-quality').inputValue();await page.route('**/api/cast/control',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Could not prepare that quality.'})}));await choose(page,'Video quality',quality==='720'?'480':'720');await expect(page.locator('#sheet-notice')).toContainText('Could not prepare');await expect(page.locator('#cast-quality')).toHaveValue(quality);await expect(page.getByRole('combobox',{name:'Video quality',exact:true})).toBeEnabled();await expect(page.locator('#cast-toggle')).toBeEnabled();
});

test('seek previews stay selected until confirmation and pending changes can be stopped safely',async({page,request})=>{
 await startPlayer(page);let release;const held=new Promise(resolve=>release=resolve);
 await page.route('**/api/cast/control',async route=>{if(route.request().postDataJSON().action==='seek'){const response=await route.fetch();await held;await route.fulfill({response});}else await route.continue();});
 await page.locator('#cast-seek').evaluate(el=>{el.value='1200';el.dispatchEvent(new Event('input',{bubbles:true}));});await expect(page.locator('#cast-elapsed')).toHaveText('20:00');expect((await(await request.get('/__test/commands')).json()).filter(c=>c.cast==='seek')).toHaveLength(0);
 await page.locator('#cast-seek').dispatchEvent('change');await expect(page.locator('#cast-status')).toHaveText('Seeking to 20:00…');await expect(page.locator('#cast-elapsed')).toHaveText('20:00');await expect(page.locator('#cast-toggle')).toBeDisabled();await expect(page.locator('#cast-stop')).toBeEnabled();
 await page.locator('#cast-stop').click();await expect(page.locator('#movie-link')).toBeVisible();release();await page.waitForResponse(r=>r.url().endsWith('/api/cast/control'));await page.evaluate(()=>poll());await expect(page.locator('#cast-title')).toHaveCount(0);expect((await(await request.get('/__test/commands')).json()).filter(c=>c.cast)).toEqual([{cast:'seek',position:1200},{cast:'stop'}]);
});

test('failed playback commands recover without claiming success',async({page})=>{
 await startPlayer(page);await page.route('**/api/cast/control',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'The TV did not confirm that change. Try again.'})}));await page.locator('#cast-toggle').click();await expect(page.locator('#sheet-notice')).toContainText('did not confirm');await expect(page.locator('#cast-toggle')).toHaveAttribute('aria-label','Pause movie');await expect(page.locator('#cast-toggle')).toBeEnabled();await expect(page.locator('#cast-status')).toHaveText('Playing');
});

test('player volume keys work independently and stay disabled when the TV remote disconnects',async({page,request})=>{
  await startPlayer(page);await page.locator('#cast-mute').click();await page.locator('#cast-volume-down').click();await page.locator('#cast-volume-up').click();expect(await(await request.get('/__test/commands')).json()).toEqual([{key:'MUTE'},{key:'KEY_VOLDOWN'},{key:'KEY_VOLUP'}]);await request.get('/__test/offline');await expect(page.locator('#cast-mute')).toBeDisabled();await expect(page.locator('#cast-volume-help')).toBeVisible();await expect(page.locator('#cast-toggle')).toBeEnabled();await page.locator('#cast-toggle').click();await expect(page.locator('#cast-status')).toHaveText('Paused');
});

test('a resumed series keeps episode identity in the player and across reloads',async({page,request})=>{
 await request.get('/__test/history');await page.locator('#play-on-tv').click();await page.locator('#movie-view-history').click();await page.locator('.watch-history [data-history-key="tv:1396:2:2"]').click();await page.locator('#library-resume').click();await expect(page.locator('#cast-toggle')).toBeEnabled();await expect(page.locator('#cast-title')).toHaveText('Breaking Bad');await expect(page.locator('#cast-player-meta')).toHaveText('2008 · Season 2 · Episode 2 · Grilled');await expect(page.locator('#cast-player-art')).toHaveAttribute('data-poster-key','movy-tv-1396');await page.reload();await page.locator('#play-on-tv').click();await expect(page.locator('#cast-title')).toHaveText('Breaking Bad');await expect(page.locator('#cast-player-meta')).toContainText('Season 2 · Episode 2');await expect(page.locator('#cast-elapsed')).toHaveText('10:00');
});
