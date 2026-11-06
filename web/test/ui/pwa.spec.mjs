import {test,expect,devices} from '@playwright/test';
const key='a'.repeat(64);
test.beforeEach(async({page,request})=>{await request.get('/__test/reset');await page.goto('/#access='+key);await expect(page.locator('#connection-label')).toHaveText('Connected on your network');});
test('home-screen assets and offline shell work without caching TV requests',async({page,context})=>{
 const manifest=await(await page.request.get('/manifest.webmanifest')).json();
 expect(manifest.name).toBe('TV Remote');expect(manifest.short_name).toBe('TV Remote');
 expect(manifest.display).toBe('standalone');expect(manifest.id).toBe('/');expect(manifest.scope).toBe('/');
 for(const purpose of ['any','maskable'])for(const size of ['192x192','512x512']){
  const icon=manifest.icons.find(icon=>icon.purpose===purpose&&icon.sizes===size);expect(icon).toBeTruthy();
  const dimensions=await page.evaluate(async src=>{const image=new Image();image.src=src;await image.decode();return [image.naturalWidth,image.naturalHeight];},icon.src);
  expect(dimensions).toEqual(size.split('x').map(Number));
 }
 await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('sizes','180x180');
 const mask=await page.evaluate(async()=>{
  const image=new Image();image.src='/app-icons/tv-remote-maskable-512.png';await image.decode();
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const context=canvas.getContext('2d');context.drawImage(image,0,0);
  const pixels=context.getImageData(0,0,512,512).data;let opaque=true,maxRadius=0;
  for(let y=0;y<512;y++)for(let x=0;x<512;x++){const i=(y*512+x)*4;if(pixels[i+3]!==255)opaque=false;if(pixels[i]>180)maxRadius=Math.max(maxRadius,Math.hypot(x-256,y-256));}
  return {opaque,maxRadius};
 });
 expect(mask.opaque).toBe(true);expect(mask.maxRadius).toBeLessThan(512*.4);
 await page.evaluate(()=>navigator.serviceWorker.ready);
 await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
 await page.getByRole('button',{name:'Mute',exact:true}).click();
 const cached=await page.evaluate(async()=>{const names=await caches.keys();const entries=await Promise.all(names.map(async name=>(await(await caches.open(name)).keys()).map(request=>({url:request.url,authenticated:request.headers.has('Authorization')}))));return entries.flat();});
 expect(cached.length).toBeGreaterThan(30);
 for(const module of ['/stick.js','/stick-controller.js','/volume.js'])expect(cached.some(item=>new URL(item.url).pathname===module)).toBe(true);
 expect(cached.some(item=>new URL(item.url).pathname.startsWith('/api/')||item.authenticated)).toBe(false);
 await context.setOffline(true);await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-volume-hold','true');
 await expect(page.locator('#notice-text')).toContainText('Cannot reach your PC');
 await expect(page.locator('#power')).toBeDisabled();
 await expect(page.locator('.mute')).toBeDisabled();
 await expect(page.locator('#welcome h2')).toHaveText('Waiting for your PC');
 await expect(page.locator('#first-connect')).toBeHidden();
});
test('installation guidance is platform aware and native install is user initiated',async({page},testInfo)=>{
 await page.getByRole('button',{name:'Remote settings'}).click();
 await page.getByRole('button',{name:'Install app',exact:true}).click();
 await expect(page.locator('#sheet')).toContainText('Your PC still needs to stay awake');
 if(testInfo.project.name==='webkit-iphone')await expect(page.locator('#sheet')).toContainText('Add to Home Screen');
 else await expect(page.locator('#sheet')).toContainText('Install app');
 await page.getByRole('button',{name:'Close sheet'}).click();await expect(page.locator('#sheet')).toBeHidden();
 await page.evaluate(()=>{
  window.installCalls=0;
  const event=new Event('beforeinstallprompt');
  event.prompt=async()=>{window.installCalls++;};event.userChoice=Promise.resolve({outcome:'accepted'});
  window.dispatchEvent(event);
 });
 expect(await page.evaluate(()=>window.installCalls)).toBe(0);
 await page.getByRole('button',{name:'Install app',exact:true}).click();
 await page.locator('#confirm-install').click();
 expect(await page.evaluate(()=>window.installCalls)).toBe(1);
});
test.describe('Android phone',()=>{

 test('remote and installation controls fit an Android screen',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='chromium-android','Android layout is exercised in the Android project.');
  await page.getByRole('button',{name:'Remote settings'}).click();
  await page.getByRole('button',{name:'Install app',exact:true}).click();
  await expect(page.locator('#sheet')).toContainText('In Chrome');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/'+testInfo.project.name+'-android-install.png',animations:'disabled',scale:'css'});
 });
});
