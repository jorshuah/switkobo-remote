import {test,expect} from '@playwright/test';
import QRCode from 'qrcode';
test.use({serviceWorkers:'block'}); // These tests intercept API responses; service-worker behavior has its own suite.
const key='a'.repeat(64);
const photo=async value=>({name:'connection.png',mimeType:'image/png',buffer:await QRCode.toBuffer(value,{width:600,margin:4})});
test.beforeEach(async({page,request})=>{
 await request.get('/__test/reset');
 await page.goto('/');
 await expect(page.locator('#access-screen')).toBeVisible();
});
test('QR photo unlocks this helper without uploading the photo or exposing the key in the URL',async({page},testInfo)=>{
 const posts=[];page.on('request',request=>{if(request.method()==='POST')posts.push(request.url());});
 await page.setViewportSize({width:390,height:664});
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-first-connection.png',animations:'disabled',scale:'css'});
 await page.getByRole('button',{name:'Use a QR photo'}).click();
 await expect(page.locator('#qr-camera-file')).toHaveAttribute('capture','environment');
 await page.screenshot({path:'test-results/'+testInfo.project.name+'-qr-scanner.png',animations:'disabled',scale:'css'});
 const chooserPromise=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'Take Photo'}).click();
 const chooser=await chooserPromise;
 await chooser.setFiles(await photo(new URL('/',page.url()).href+'#access='+key));
 await expect(page.locator('#connection-label')).toHaveText('Connected on your network');
 await expect(page.locator('#sheet')).not.toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('remote-access'))).toBe(key);
 expect(new URL(page.url()).hash).toBe('');
 expect(posts).toEqual([]);
 await expect(page.getByRole('button',{name:'Remote settings'})).toBeFocused();
});
test('wrong QR, wrong address and unreadable photos keep the user on setup with a paste fallback',async({page})=>{
 await page.getByRole('button',{name:'Use a QR photo'}).click();
 await page.locator('#qr-image-file').setInputFiles(await photo('https://example.com/'));
 await expect(page.locator('#sheet-notice')).toContainText('not a TV Remote connection QR');
 await page.locator('#qr-image-file').setInputFiles(await photo('http://192.168.0.222:48765/#access='+key));
 await expect(page.locator('#sheet-notice')).toContainText('different helper address');
 await page.locator('#qr-image-file').setInputFiles({name:'blank.png',mimeType:'image/png',buffer:await QRCode.toBuffer('blank',{width:250,color:{dark:'#ffffff',light:'#ffffff'}})});
 await expect(page.locator('#sheet-notice')).toContainText('No QR code found');
 expect(await page.evaluate(()=>localStorage.getItem('remote-access'))).toBeNull();
 await expect(page.getByRole('button',{name:'Choose Image'})).toBeEnabled();
 await page.getByRole('button',{name:'Close sheet'}).click();
 await expect(page.getByRole('button',{name:'Use a QR photo'})).toBeFocused();
 await page.locator('#access-input').fill(key);
 await page.getByRole('button',{name:'Connect',exact:true}).click();
 await expect(page.locator('#connection-label')).toHaveText('Connected on your network');
});
test('closing the scanner cancels a pending decode without unlocking later',async({page})=>{
 await page.evaluate(()=>{
   window.Worker=class{
     constructor(){window.workerTerminated=false;}
     postMessage(){window.decodeStarted=true;this.timer=setTimeout(()=>this.onmessage?.({data:{value:location.origin+'/#access='+'a'.repeat(64)}}),1000);}
     terminate(){clearTimeout(this.timer);window.workerTerminated=true;}
   };
 });
 await page.getByRole('button',{name:'Use a QR photo'}).click();
 await page.locator('#qr-image-file').setInputFiles(await photo(new URL('/',page.url()).href+'#access='+key));
 await expect.poll(()=>page.evaluate(()=>window.decodeStarted)).toBe(true);
 await page.getByRole('button',{name:'Close sheet'}).click();
 await expect.poll(()=>page.evaluate(()=>window.workerTerminated)).toBe(true);
 expect(await page.evaluate(()=>localStorage.getItem('remote-access'))).toBeNull();
 await expect(page.locator('#access-screen')).toBeVisible();
});

test('setup explains where the private link comes from and protects its key',async({page})=>{
 await page.getByRole('button',{name:'Find my private link',exact:true}).click();
 await expect(page.locator('#sheet')).toContainText('Start Remote.cmd');
 await expect(page.locator('#sheet')).toContainText('Copy private link');
 await expect(page.locator('#launcher-path')).toHaveValue('%LOCALAPPDATA%\\TVRemote\\Open Remote.html');
 await expect(page.locator('#sheet')).toContainText('do not need to find or type a separate key');
});
test('camera-sized JPEG photo with a small rotated QR can unlock the helper',async({page})=>{
 const qr=await QRCode.toDataURL(new URL('/',page.url()).href+'#access='+key,{width:450,margin:4});
 const data=await page.evaluate(async src=>{
   const image=new Image();image.src=src;await image.decode();
   const canvas=document.createElement('canvas');canvas.width=3000;canvas.height=4000;
   const c=canvas.getContext('2d');c.fillStyle='#d8d8d8';c.fillRect(0,0,3000,4000);
   c.translate(1500,2000);c.rotate(.12);c.drawImage(image,-225,-225,450,450);
   return canvas.toDataURL('image/jpeg',.82).split(',')[1];
 },qr);
 await page.getByRole('button',{name:'Use a QR photo'}).click();
 await page.locator('#qr-image-file').setInputFiles({name:'camera-photo.jpg',mimeType:'image/jpeg',buffer:Buffer.from(data,'base64')});
 await expect(page.locator('#connection-label')).toHaveText('Connected on your network',{timeout:20000});
});
test('PC connection page shows a copyable full link and QR for the phone',async({page})=>{
 await page.goto('/__test/launcher');
 await expect(page.getByRole('heading',{name:'Connect your phone',exact:true})).toBeVisible();
 await expect(page.locator('.qr')).toHaveCount(1);
 await expect(page.locator('#link-0')).toHaveValue('http://192.168.0.151:48765/#access='+key);
 await page.getByRole('button',{name:'Copy private link',exact:true}).click();
 await expect(page.locator('#copy-status')).toContainText(/copied|selected/);
 await expect(page.locator('main')).toContainText('Open Remote.html');
});

test('clean connect form keeps a rejected link for retry and prevents duplicate submissions',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:664});
 for(const theme of ['light','dark']){
   await page.emulateMedia({colorScheme:theme});
   await page.screenshot({path:'test-results/'+testInfo.project.name+'-connect-clean-'+theme+'.png',animations:'disabled',scale:'css'});
 }
 await expect(page.locator('#access-screen img.welcome-icon')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Connect',exact:true})).toBeVisible();
 const link=new URL('/',page.url()).href+'#access='+key;
 await page.locator('#access-input').fill(link);
 let requests=0;
 await page.route('**/api/state',async route=>{
   requests++;await route.fulfill({status:401,json:{error:'This connection link is no longer valid. Open the latest private link on your PC.'}});
 });
 await page.locator('#access-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
 await expect(page.locator('#access-screen')).toBeVisible();
 await expect(page.locator('#access-input')).toHaveValue(link);
 await expect(page.getByRole('button',{name:'Connect',exact:true})).toBeEnabled();
 expect(requests).toBe(1);
 expect(await page.evaluate(()=>localStorage.getItem('remote-access'))).toBeNull();
 await page.setViewportSize({width:320,height:568});
 await page.evaluate(()=>document.documentElement.style.fontSize='22px');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Find my private link',exact:true}).click();
 await expect(page.locator('#sheet')).toBeVisible();
});
