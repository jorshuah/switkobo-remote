const CACHE='switkobo-shell-240224fed04e';
const ASSETS=["/","/index.html","/style.css","/app.js","/pwa.js","/updates.js","/cast.js","/movies.js","/library.js","/pickers.js","/subtitles.js","/icon.svg","/manifest.webmanifest","/qr-reader.js","/qr-worker.js","/vendor/jsQR.js","/app-version.json","/icons/arrow-left.svg","/icons/bell.svg","/icons/camera.svg","/icons/check.svg","/icons/chevron-down.svg","/icons/chevron-left.svg","/icons/chevron-right.svg","/icons/chevron-up.svg","/icons/corner-up-left.svg","/icons/external-link.svg","/icons/film.svg","/icons/grid-2x2.svg","/icons/hand.svg","/icons/house.svg","/icons/image.svg","/icons/joystick.svg","/icons/keyboard.svg","/icons/minus.svg","/icons/panels-top-left.svg","/icons/pause.svg","/icons/play.svg","/icons/plus.svg","/icons/power.svg","/icons/refresh-cw.svg","/icons/rewind.svg","/icons/rotate-ccw.svg","/icons/rotate-cw.svg","/icons/scan-qr-code.svg","/icons/search.svg","/icons/settings.svg","/icons/sliders-horizontal.svg","/icons/star.svg","/icons/tv.svg","/icons/volume-x.svg","/icons/wifi-off.svg","/icons/wifi.svg","/icons/x.svg","/brands/disneyplus.svg","/brands/netflix.svg","/brands/primevideo.svg","/brands/tmdb.svg","/brands/youtube-dark.svg","/brands/youtube.svg","/app-icons/tv-remote-192.png","/app-icons/tv-remote-512.png","/app-icons/tv-remote-apple-180.png","/app-icons/tv-remote-favicon-32.png","/app-icons/tv-remote-maskable-192.png","/app-icons/tv-remote-maskable-512.png","/stick.js","/stick-controller.js","/volume.js","/notifications.js"];
const ALLOWED=new Set(ASSETS);
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
});
self.addEventListener('message',event=>{
 if(event.data?.type==='APPLY_UPDATE')event.waitUntil(self.skipWaiting());
 if(event.data?.type==='GET_BUILD')event.ports[0]?.postMessage({version:CACHE.replace('switkobo-shell-','')});
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(names=>Promise.all(names.filter(name=>name.startsWith('switkobo-shell-')&&name!==CACHE).map(name=>caches.delete(name)))).then(()=>self.clients.claim()));
});
self.addEventListener('push',event=>{
 let data=null;try{data=event.data?.json();}catch{}
 const update=data?.kind==='update'&&/^[a-f0-9]{12}$/.test(data.version||'');
 event.waitUntil(self.registration.showNotification(update?'TV Remote update available':'TV Remote',{
  body:update?'Open the app on your home network to download and install the update.':data?.kind==='test'?'Update notifications are working on this device.':'Open TV Remote to see what is new.',
  icon:'/app-icons/tv-remote-192.png',tag:update?'tv-remote-update':'tv-remote-test',renotify:false,
  data:{kind:update?'update':'test',...(update?{version:data.version}:{})}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(client=>{const u=new URL(client.url);return u.origin===self.location.origin&&['/','/index.html'].includes(u.pathname);});
  if(existing){await existing.focus();existing.postMessage({type:'CHECK_APP_UPDATE'});return;}
  await self.clients.openWindow(new URL('/',self.location.origin).href);
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 // Control requests and credentials must always reach the helper, never the cache.
 if(request.method!=='GET'||url.origin!==self.location.origin||(url.pathname.startsWith('/api/')||url.pathname==='/app-version.json')||request.headers.has('Authorization'))return;
 const navigation=request.mode==='navigate';
 if(navigation&&!['/','/index.html'].includes(url.pathname))return;
 if(url.search||(!navigation&&!ALLOWED.has(url.pathname)))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE),key=navigation?'/index.html':url.pathname;
  const cached=await cache.match(key);if(cached)return cached;
  try{const response=await fetch(request);if(response.ok&&response.type==='basic')await cache.put(key,response.clone());return response;}catch{return Response.error();}
 })());
});
