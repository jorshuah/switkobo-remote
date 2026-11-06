import {test,expect} from '@playwright/test';

test('the complete desktop connection page fits including its footer at enlarged scale',async({page},testInfo)=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const size of [{width:1280,height:640,zoom:1},{width:1278,height:664,zoom:1},{width:1024,height:600,zoom:1},{width:1917,height:996,zoom:1.5}]){
  await page.setViewportSize({width:size.width,height:size.height});await page.goto('/connect/');
  await page.evaluate(zoom=>{const s=document.createElement('style');s.nonce=document.querySelector('style[nonce]').nonce;s.textContent='html{zoom:'+zoom+'}';document.head.append(s);},size.zoom);
  for(const panel of ['connect','setup']){
   await page.locator('#'+panel+'-tab').click();
   expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),panel+' '+JSON.stringify(size)).toBe(true);
   const footer=await page.locator('.footer').boundingBox();expect(footer.y+footer.height).toBeLessThanOrEqual(size.height);
   const qr=await page.locator('#'+panel+'-panel .qr').boundingBox();expect(qr.y+qr.height).toBeLessThanOrEqual(size.height);
  }
  if(size.zoom===1.5){await page.locator('#connect-tab').click();await page.emulateMedia({colorScheme:'dark'});await page.screenshot({caret:'initial',path:testInfo.outputPath('desktop-full-page-enlarged.png')});}
 }
});
test.use({baseURL:'http://127.0.0.1:48869',serviceWorkers:'block'});
test.beforeEach(async({page,request})=>{await request.get('/__fixture/ready');await page.addInitScript(()=>{window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective));});});
test('connection and first-time setup show one QR at a time, with keyboard navigation and a real copy fallback',async({page})=>{
 await page.goto('/connect/');await expect(page.getByRole('heading',{name:'Connect your phone',exact:true})).toBeVisible();await expect(page.locator('#connect-panel .qr')).toBeVisible();await expect(page.locator('#setup-panel .qr')).not.toBeVisible();
 await page.getByRole('tab',{name:'Connect phone',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'Set up a new phone'})).toBeFocused();await expect(page.locator('#setup-panel .qr')).toBeVisible();await expect(page.locator('#connect-panel .qr')).not.toBeVisible();
 await page.getByRole('button',{name:'Continue to connection'}).click();await expect(page.getByRole('tab',{name:'Connect phone',exact:true})).toBeFocused();
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('fixture denied');}}}));await page.getByRole('button',{name:'Copy private link'}).click();await expect(page.locator('#link-0')).toBeVisible();await expect(page.locator('#copy-status')).toContainText('selected');await expect(page.locator('#link-0')).toBeFocused();
 await page.getByRole('button',{name:'Connection help',exact:true}).click();await page.getByRole('button',{name:'View certificate details'}).click();await expect(page.locator('dialog[open]')).toHaveCount(1);await expect(page.getByRole('heading',{name:'About secure access'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Connection help',exact:true})).toBeFocused();expect(await page.evaluate(()=>window.__csp)).toEqual([]);
});
test('phone setup selects the platform, keeps downloads functional and explains the secure-check handoff',async({page,request},testInfo)=>{
 await page.goto('/setup/');await expect(page.getByRole('heading',{name:'Set up your phone',exact:true})).toBeVisible();const android=testInfo.project.name==='chromium-android';await expect(page.getByRole('tab',{name:android?'Android':'iPhone & iPad',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('tab',{name:'iPhone & iPad',exact:true}).click();await expect(page.getByRole('link',{name:'Download iPhone profile'})).toHaveAttribute('href','/setup/iphone.mobileconfig');expect((await request.get('/setup/iphone.mobileconfig')).status()).toBe(200);
 await page.getByRole('tab',{name:'Android',exact:true}).click();await expect(page.getByRole('link',{name:'Download Android certificate'})).toHaveAttribute('href','/setup/root.cer');expect((await request.get('/setup/root.cer')).status()).toBe(200);await expect(page.getByRole('link',{name:'Open secure check'})).toHaveAttribute('href','https://127.0.0.1:48766/setup/?check=1');
 await page.getByRole('button',{name:'Why is this needed?'}).click();await expect(page.locator('#security-help')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Why is this needed?'})).toBeFocused();
 await page.goto('/setup/?check=1');await expect(page.getByRole('heading',{name:'Set up your phone',exact:true})).toBeVisible();await page.goto('/__fixture/checked');await expect(page.getByRole('heading',{name:'Secure page opened',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Scan the private connection code'})).toBeVisible();
});
test('network recovery and selection keep QR and copy targets in sync',async({page,request})=>{
 await request.get('/__fixture/empty');await page.goto('/connect/');await expect(page.getByRole('heading',{name:'Waiting for Wi-Fi',exact:true})).toBeVisible();await request.get('/__fixture/ready');await page.getByRole('button',{name:'Check again',exact:true}).click();await expect(page.locator('#connect-panel .qr')).toBeVisible();
 await request.get('/__fixture/multiple');await page.reload();await page.getByLabel('PC network address').selectOption('1');await expect(page.locator('.network-code:not([hidden]) .qr-address')).toHaveText('192.168.0.152');await expect(page.locator('#copy-private')).toHaveAttribute('data-copy','link-1');
});
// WebKit's full-page screenshot capture injects a style. Check product CSP before capture.
test('light and dark screens fit narrow widths and enlarged text without CSP violations',async({page},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push({directive:e.violatedDirective,source:e.sourceFile,line:e.lineNumber}));});
 for(const scheme of ['light','dark']){await page.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});await page.setViewportSize({width:1280,height:850});await page.goto('/connect/');expect(await page.evaluate(()=>window.__csp)).toEqual([]);await page.screenshot({caret:'initial',path:testInfo.outputPath('connect-'+scheme+'.png')});await page.getByRole('tab',{name:'Set up a new phone'}).click();await page.screenshot({caret:'initial',path:testInfo.outputPath('first-setup-'+scheme+'.png')});
  await page.setViewportSize({width:390,height:760});await page.goto('/setup/');await page.screenshot({caret:'initial',path:testInfo.outputPath('phone-standard-'+scheme+'.png'),fullPage:true});await page.setViewportSize({width:320,height:640});await page.goto('/setup/');await page.evaluate(()=>{const style=document.createElement('style');style.nonce=document.querySelector('style[nonce]').nonce;style.textContent='html{font-size:22px}';document.head.append(style);});expect(await page.locator('body').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBe(22);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.evaluate(()=>window.__csp)).toEqual([]);await page.screenshot({caret:'initial',path:testInfo.outputPath('phone-'+scheme+'.png'),fullPage:true});
 }expect(errors).toEqual([]);
});

 test('both QR codes are fully visible without scrolling on compact screens',async({page},testInfo)=>{
  for(const viewport of [{width:1280,height:640},{width:390,height:640},{width:320,height:568}]){
   await page.setViewportSize(viewport);await page.goto('/connect/');
   for(const panel of ['connect','setup']){
    if(panel==='setup')await page.getByRole('tab',{name:'Set up a new phone'}).click();
    const qr=await page.locator('#'+panel+'-panel .qr').boundingBox();expect(qr.y).toBeGreaterThanOrEqual(0);expect(qr.y+qr.height).toBeLessThanOrEqual(viewport.height);expect(qr.width).toBeGreaterThanOrEqual(200);expect(await page.evaluate(()=>scrollY)).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   }
   if(viewport.width===390)await page.screenshot({caret:'initial',path:testInfo.outputPath('compact-connection.png')});
  }
 });
