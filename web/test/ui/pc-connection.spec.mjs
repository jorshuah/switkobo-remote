import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
test('the PC connection page loads through HTTP with styled content and a working QR image',async({page})=>{
 const violations=[];await page.addInitScript(()=>{window.__connectionCsp=[];document.addEventListener('securitypolicyviolation',e=>window.__connectionCsp.push(e.violatedDirective));});
 page.on('pageerror',e=>violations.push(e.message));await page.goto('/connect/');await expect(page.getByRole('heading',{name:'Connect your phone',exact:true})).toBeVisible();
 const qr=page.getByRole('img',{name:'Scan with your iPhone Camera to open your private remote'}).first();await expect(qr).toBeVisible();await expect.poll(()=>qr.evaluate(e=>e.complete&&e.naturalWidth===400)).toBe(true);
 expect(await page.locator('#connect-panel').isVisible()).toBe(true);await expect(page.locator('[data-copy]').first()).toBeVisible();expect(await page.evaluate(()=>window.__connectionCsp)).toEqual([]);expect(violations).toEqual([]);
});
