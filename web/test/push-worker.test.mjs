import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function worker(){const handlers={},notifications=[],opened=[],messages=[];let focused=0,activated=0,clients=[];
 const self={location:{origin:'https://remote.example'},addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(title,options)=>notifications.push({title,options})},skipWaiting:()=>activated++,clients:{matchAll:async()=>clients,openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(fs.readFileSync(new URL('../public/service-worker.js',import.meta.url),'utf8'),{self,URL,Response,caches:{}});
 return {notifications,opened,messages,get activated(){return activated;},get focused(){return focused;},setClient(url){clients=[{url,focus:async()=>focused++,postMessage:m=>messages.push(m)}];},async fire(name,data){let promise;handlers[name]({...data,waitUntil:p=>promise=p});await promise;}};
}
test('push events always show a bounded visible notice without arbitrary payload URLs or text',async()=>{
 const w=worker();await w.fire('push',{data:{json:()=>({kind:'update',version:'111111111111',url:'https://evil.example',title:'untrusted title',body:'secret movie history'})}});assert.equal(w.notifications[0].title,'TV Remote update available');assert.deepEqual(Object.keys(w.notifications[0].options.data).sort(),['kind','version']);assert.ok(!JSON.stringify(w.notifications).includes('evil'));assert.ok(!JSON.stringify(w.notifications).includes('secret'));assert.equal(w.activated,0);
 await w.fire('push',{data:{json:()=>{throw Error('invalid JSON');}}});assert.equal(w.notifications.length,2);assert.equal(w.notifications[1].title,'TV Remote');
});
test('a notification click focuses the existing app and requests a check without installing or navigating away',async()=>{
 const w=worker();w.setClient('https://remote.example/');let closed=0;await w.fire('notificationclick',{notification:{data:{url:'https://evil.example'},close:()=>closed++}});assert.equal(closed,1);assert.equal(w.focused,1);assert.equal(w.messages[0].type,'CHECK_APP_UPDATE');assert.equal(w.opened.length,0);assert.equal(w.activated,0);
});
test('without an existing app a notification opens only the local root and carries no credentials',async()=>{
 const w=worker();w.setClient('https://other.example/');await w.fire('notificationclick',{notification:{data:{url:'https://evil.example/#access=private'},close(){}}});assert.deepEqual(w.opened,['https://remote.example/']);assert.equal(w.activated,0);
});
