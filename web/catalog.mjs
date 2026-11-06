import https from 'node:https';
import {publicGuard} from './cast-source.mjs';
import {browserEgress,destination} from './cast-egress.mjs';
import {RemoteError} from './protocol.mjs';
export const catalogSources=['cinejoy','movy','aether'];
export function searchQuery(value){if(typeof value!=='string'||/[\x00-\x1f]/.test(value))throw new RemoteError('Enter a title.');const q=value.trim().replace(/\s+/g,' ');if(q.length<2||q.length>100)throw new RemoteError('Enter between 2 and 100 characters for the title.');return q;}
export function movieID(value){if(typeof value!=='string'||! /^[1-9]\d{0,9}$/.test(value))throw new RemoteError('Choose a title from the search results.');return value;}
export function catalogRef(id,{source='cinejoy',type='movie'}={}){movieID(id);if(!catalogSources.includes(source)||!['movie','tv'].includes(type))throw new RemoteError('Choose a supported source and title type.');return {id,source,type,key:source+'-'+type+'-'+id};}
export function seasonNumber(value){if(typeof value!=='number'&&!(typeof value==='string'&&/^(?:0|[1-9]\d{0,2})$/.test(value)))throw new RemoteError('Choose a valid season.');const n=Number(value);if(!Number.isInteger(n)||n<0||n>999||value===null||value==='')throw new RemoteError('Choose a valid season.');return n;}
const clean=(s,max=160)=>String(s||'').replace(/[\x00-\x1f]/g,' ').trim().slice(0,max);
export function normalizeRating(value){
 if(!value||value.source!=='tmdb'||typeof value.value!=='number'||!Number.isFinite(value.value)||value.value<=0||value.value>10||!Number.isSafeInteger(value.votes)||value.votes<1||value.votes>1000000000)return null;
 return {source:'tmdb',value:value.value,votes:value.votes};
}
export function posterPath(value,size='w185'){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='image.tmdb.org'||u.port||u.username||u.password||u.search||u.hash)return null;const match=u.pathname.match(/^\/t\/p\/(?:w\d+|original)\/([a-zA-Z0-9_-]{1,120}\.(?:jpg|png|webp))$/i);if(!match||!['w185','w342'].includes(size))return null;return '/t/p/'+size+'/'+match[1];}catch{return null;}
}
export function catalogItems(rows,source='cinejoy'){
 const items=new Map();for(const row of rows.slice(0,100)){
  try{const u=new URL(row.url);if(u.protocol!=='https:'||u.username||u.password||u.port)continue;
   let match;if(source==='cinejoy'&&u.hostname==='cinejoy.pk')match=u.pathname.match(/^\/(movie|series)\/([1-9]\d{0,9})(?:-[^/]*)?\/?$/);
   else if(source==='aether'&&u.hostname==='aether.st')match=u.pathname.match(/^\/media\/tmdb-(movie|tv)-([1-9]\d{0,9})(?:-[^/]+)?\/?$/);
   else if(source==='movy'&&u.hostname==='www.movy.sx')match=u.pathname.match(/^\/(movie|tv)\/([1-9]\d{0,9})\/?$/);
   if(!match)continue;const ref=catalogRef(match[2],{source,type:match[1]==='series'?'tv':match[1]}),lines=String(row.text||'').split('\n').map(s=>s.trim()).filter(Boolean),title=clean(row.alt||(/^(?:Play|More info)$/i.test(lines[0])?lines[1]:lines[0]));if(!title)continue;
   const year=String(row.text||'').match(/\b((?:18|19|20|21)\d{2})\b/)?.[1]||'';
   if(!items.has(ref.key))items.set(ref.key,{...ref,title,year,page:u.origin+u.pathname,posterURL:posterPath(row.poster)?row.poster:null});
  }catch{}if(items.size>=24)break;
 }return [...items.values()];
}
export function metadataItems(rows,source,filter='all'){
 const items=[];for(const row of (Array.isArray(rows)?rows:[]).slice(0,100)){try{
  const type=row.media_type;if(!['movie','tv'].includes(type)||filter!=='all'&&type!==filter)continue;
  const ref=catalogRef(String(row.id),{source,type}),title=clean(row.title||row.name);if(!title)continue;
  const year=String(row.release_date||row.first_air_date||'').match(/^(\d{4})/)?.[1]||'';
  const poster='https://image.tmdb.org/t/p/w500'+String(row.poster_path||'');
  items.push({...ref,title,year,synopsis:clean(row.overview,1800),rating:normalizeRating({source:'tmdb',value:row.vote_average,votes:row.vote_count}),genres:[...new Set((Array.isArray(row.genre_ids)?row.genre_ids:[]).filter(n=>Number.isInteger(n)&&n>0))].slice(0,12),releaseDate:clean(row.release_date||row.first_air_date,10),posterURL:posterPath(poster)?poster:null});
 }catch{}if(items.length>=12)break;}return items;
}
export function normalizeSeasons(rows){return (Array.isArray(rows)?rows:[]).slice(0,120).flatMap(s=>{try{const number=seasonNumber(s.season_number??s.number),id=movieID(String(s.id));return [{id,number,name:clean(s.name||('Season '+number),80),count:Math.max(0,Math.min(1000,Number(s.episode_count??s.count)||0))}];}catch{return [];}}).sort((a,b)=>a.number-b.number);}
export function normalizeEpisodes(rows,season){return (Array.isArray(rows)?rows:[]).slice(0,500).flatMap(e=>{const number=Number(e.episode_number??e.number);if(!Number.isInteger(number)||number<1||number>9999||e.season_number!==undefined&&Number(e.season_number)!==season)return [];try{return [{id:movieID(String(e.id)),number,title:clean(e.name||e.title||('Episode '+number)),synopsis:clean(e.overview||e.synopsis,700)}];}catch{return [];}}).sort((a,b)=>a.number-b.number);}
async function posterBytes(path){
 const {address}=await destination('image.tmdb.org:443');
 return new Promise((resolve,reject)=>{
  const req=https.get({hostname:'image.tmdb.org',servername:'image.tmdb.org',port:443,path,lookup:(host,options,callback)=>callback(null,address,4),family:4,agent:false,headers:{Accept:'image/jpeg,image/png,image/webp'},timeout:6000},res=>{
   const type=String(res.headers['content-type']||'').split(';')[0];if(res.statusCode!==200||!['image/jpeg','image/png','image/webp'].includes(type)||Number(res.headers['content-length'])>512000){res.destroy();reject(new Error('Poster unavailable'));return;}
   let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>512000)res.destroy(new Error('Poster too large'));else chunks.push(chunk);});res.on('error',reject);res.on('end',()=>{const bytes=Buffer.concat(chunks);const valid=type==='image/jpeg'?bytes[0]===255&&bytes[1]===216:type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';valid?resolve({image:'data:'+type+';base64,'+bytes.toString('base64')}):reject(new Error('Invalid poster'));});
  });req.on('timeout',()=>req.destroy(new Error('Poster request timed out')));req.on('error',reject);
 });
}
export class MovieCatalog{
 constructor({fetchPoster=posterBytes}={}){Object.assign(this,{fetchPoster,items:new Map(),searches:new Map(),images:new Map(),imageJobs:new Map(),pages:new Map(),metadata:new Map(),seasonData:new Map(),queue:Promise.resolve(),pending:0,closed:false});}
 async session(source='cinejoy'){
  if(this.pages.get(source)&&!this.pages.get(source).isClosed())return this.pages.get(source);
  if(this.closed)throw new RemoteError('Search is shutting down.',503);
  if(!this.browser?.isConnected()){
   // Use full Chromium's windowless headless mode instead of the Windows console shell.
   await this.closeBrowser();const {chromium}=await import('playwright');this.egress=await browserEgress();const options={headless:true,...(process.platform==='win32'?{channel:'chromium'}:{}),proxy:this.egress.proxy,args:['--force-webrtc-ip-handling-policy=disable_non_proxied_udp']};
   try{this.browser=await chromium.launch(options);}catch{try{this.browser=await chromium.launch({...options,channel:'msedge'});}catch{this.egress.close();throw new RemoteError('The search browser is missing. Run Setup Playback.cmd on the PC.',503);}}
  }
  const context=await this.browser.newContext({acceptDownloads:false,serviceWorkers:'block',viewport:{width:1280,height:800}}),allow=publicGuard();
  await context.route('**/*',async route=>{try{const r=route.request(),embedded=r.isNavigationRequest()&&r.frame().parentFrame();await(!embedded&&!['image','media','font'].includes(r.resourceType())&&!/\.(m3u8|m4s|ts)(?:\?|$)/i.test(r.url())&&await allow(r.url())?route.continue():route.abort());}catch{}});
  await context.routeWebSocket('**/*',ws=>ws.close());const p=await context.newPage();this.pages.set(source,p);context.on('page',q=>{if(q!==p)q.close().catch(()=>{});});
  // Observe only metadata responses generated by the site's own normal UI. Never replay keys.
  p.on('response',async r=>{try{
   const u=new URL(r.url());if(!r.ok()||!['api.themoviedb.org','db.wecollege.net'].includes(u.hostname)||Number(r.headers()['content-length'])>2000000)return;
   const m=u.pathname.match(/^\/3\/(movie|tv)\/([1-9]\d{0,9})(?:\/season\/(\d{1,3}))?$/);if(!m)return;
   const d=await r.json(),ref=catalogRef(m[2],{source,type:m[1]});if(this.closed)return;
   if(m[3]!==undefined&&Array.isArray(d.episodes)){this.seasonData.set(ref.key+':'+Number(m[3]),normalizeEpisodes(d.episodes,Number(m[3])));while(this.seasonData.size>48)this.seasonData.delete(this.seasonData.keys().next().value);}
   else if(d.id&&String(d.id)===ref.id){this.metadata.set(ref.key,{title:clean(d.title||d.name),year:String(d.release_date||d.first_air_date||'').slice(0,4),synopsis:clean(d.overview,1800),rating:normalizeRating({source:'tmdb',value:d.vote_average,votes:d.vote_count}),seasons:normalizeSeasons(d.seasons)});while(this.metadata.size>80)this.metadata.delete(this.metadata.keys().next().value);}
  }catch{}});
  return p;
 }
 run(work){
  if(this.closed)return Promise.reject(new RemoteError('Search is unavailable.',503));if(this.pending>=4)return Promise.reject(new RemoteError('Search is busy. Try again in a moment.',429));this.pending++;clearTimeout(this.idle);
  const job=this.queue.then(()=>{if(this.closed)throw new RemoteError('Search is shutting down.',503);return work();}).catch(error=>{if(error instanceof RemoteError)throw error;throw new RemoteError('This source could not complete the request. Try again, choose another source, or use a video link.',503);}).finally(()=>{this.pending--;if(!this.pending&&!this.closed){this.idle=setTimeout(()=>{void this.closeBrowser();},300000);this.idle.unref?.();}});this.queue=job.catch(()=>{});return job;
 }
 item(id,options){const ref=catalogRef(id,options),item=this.items.get(ref.key)||(ref.source==='cinejoy'&&ref.type==='movie'?this.items.get(id):null);if(!item)throw new RemoteError('Search for this title again to view its details.',404);return {...ref,...item};}
 publicItem(item){const ref=catalogRef(item.id,{source:item.source||'cinejoy',type:item.type||'movie'});return {...ref,title:item.title,year:item.year,synopsis:clean(item.synopsis,1800),rating:normalizeRating(item.rating),genres:item.genres||[],poster:Boolean(item.posterURL),...(ref.source==='aether'&&item.page?{page:item.page}:{})};}
 async search(value,{source='cinejoy',type='all'}={}){
  const query=searchQuery(value);if(!catalogSources.includes(source)||!['all','movie','tv'].includes(type))throw new RemoteError('Choose a supported search source and title type.');
  const key=source+':'+type+':'+query.toLocaleLowerCase(),cached=this.searches.get(key);
  if(cached&&cached.expires>Date.now())return {query,source,type,results:cached.ids.map(id=>this.items.get(id)).filter(Boolean).map(i=>this.publicItem(i))};
  return this.run(async()=>{
   const p=await this.session(source),target=source==='cinejoy'?'https://cinejoy.pk/search':source==='movy'?'https://www.movy.sx/':'https://aether.st/';
   await p.goto(target,{waitUntil:'domcontentloaded',timeout:25000});p.catalogKey=null;
   let input=p.locator('input:visible').first();
   if(source==='movy'){await p.getByRole('button',{name:'Search',exact:true}).first().waitFor({timeout:20000});for(let i=0;i<24&&!await input.isVisible().catch(()=>false);i++){await p.getByRole('button',{name:'Search',exact:true}).first().click();await p.waitForTimeout(600);}}
   await input.waitFor({state:'visible',timeout:22000});
   const response=p.waitForResponse(r=>{try{const u=new URL(r.url());return u.pathname.includes('/search/')&&u.searchParams.get('query')?.toLocaleLowerCase()===query.toLocaleLowerCase();}catch{return false;}},{timeout:20000}).catch(()=>null);
   await input.fill(query);const completed=await response;if(!completed||!completed.ok())throw new RemoteError('The selected source did not finish this search. Try again or choose another source.',503);
   const d=await completed.json(),rows=Array.isArray(d)?d:d.results||d.data?.results||[],metadata=metadataItems(rows,source,type);
   await p.waitForTimeout(400);if(source==='aether'&&metadata.length)await p.locator('a[href*="/media/tmdb-"]').first().waitFor({state:'attached',timeout:8000});
   const links=await p.locator('a[href]').evaluateAll(as=>as.slice(0,150).map(a=>({url:a.href,text:a.innerText,poster:a.querySelector('img')?.src,alt:a.querySelector('img')?.alt})));
   const visible=catalogItems(links,source);let items=metadata.length?metadata:visible.filter(i=>type==='all'||i.type===type).slice(0,12);
   for(const item of items){const observed=visible.find(v=>v.key===item.key);if(observed)item.page=observed.page;const old=this.items.get(item.key);this.items.delete(item.key);this.items.set(item.key,{...old,...item,synopsis:item.synopsis||old?.synopsis||''});}
   while(this.items.size>160)this.items.delete(this.items.keys().next().value);this.searches.set(key,{ids:items.map(i=>i.key),expires:Date.now()+600000});while(this.searches.size>18)this.searches.delete(this.searches.keys().next().value);
   return {query,source,type,results:items.map(i=>this.publicItem(this.items.get(i.key)))};
  });
 }
 pageURL(item){
  if(item.source==='aether'){if(!item.page)throw new RemoteError('This Aether result has no playable page. Search again or choose another source.',404);return item.page;}
  return item.source==='movy'?'https://www.movy.sx/'+item.type+'/'+item.id:'https://cinejoy.pk/'+(item.type==='tv'?'series':'movie')+'/'+item.id;
 }
 async loadDetailPage(item){
  const p=await this.session(item.source);if(p.catalogKey===item.key)return p;await p.goto(this.pageURL(item),{waitUntil:'domcontentloaded',timeout:25000});p.catalogKey=item.key;
  const end=Date.now()+23000;while(Date.now()<end){if(this.metadata.has(item.key)||await p.locator('meta[property="og:type"][content^="video."],h1').count())break;await p.waitForTimeout(250);}
  if(item.source==='movy')await p.locator('h1').first().waitFor({timeout:15000});
  return p;
 }
 async details(value,options={}){
  const item=this.item(value,options),cached=this.items.get(item.key);if(cached?.detailsUntil>Date.now())return {...this.publicItem(cached),synopsis:cached.synopsis,seasons:cached.seasons||[],...(item.source==='aether'?{page:item.page}:{})};
  return this.run(async()=>{
   const p=await this.loadDetailPage(item);let data=this.metadata.get(item.key);
   if(!data){const dom=await p.evaluate(()=>({title:document.querySelector('h1')?.textContent||[...document.querySelectorAll('meta[property="og:title"]')].at(-1)?.content||'',summary:[...document.querySelectorAll('p')].map(p=>p.textContent.trim()).find(t=>t.length>40&&!/^Cinejoy does not host/i.test(t))||[...document.querySelectorAll('meta[property="og:description"]')].at(-1)?.content||''}));data={title:item.title,year:dom.title.match(/\b((?:18|19|20|21)\d{2})\b/)?.[1]||item.year,synopsis:clean(dom.summary,1800),seasons:[]};}
   if(item.type==='tv'&&!data.seasons.length){
    const opener=p.getByRole('button',{name:/^(?:Season \d+|Specials)$/}).first();await opener.waitFor({timeout:15000});
    for(let i=0;i<24;i++){await opener.click();await p.waitForTimeout(500);if(await p.getByRole('option').first().isVisible().catch(()=>false))break;}
    if(item.source==='movy')await p.getByRole('option').first().waitFor({state:'visible',timeout:5000});
    const choices=await p.locator('[role="option"],button').evaluateAll(es=>es.filter(e=>e.getAttribute('role')==='option'||/^Season \d+\s+\d+ episodes$/.test(e.textContent.trim())).map(e=>e.textContent.trim()));
    const seasons=[...new Set(choices.map(t=>Number(t.match(/Season (\d+)/)?.[1])).filter(Number.isInteger))].filter(n=>n>=0&&n<=999).map(n=>({id:'',number:n,name:'Season '+n,count:0}));data.seasons=seasons;await p.keyboard.press('Escape').catch(()=>{});
   }
   Object.assign(item,{...data,title:item.title,detailsUntil:Date.now()+600000});this.items.set(item.key,item);
   return {...this.publicItem(item),synopsis:item.synopsis,seasons:item.seasons||[],...(item.source==='aether'?{page:item.page}:{})};
  });
 }
 async episodes(value,number,options={}){
  const item=this.item(value,options),season=seasonNumber(number);if(item.type!=='tv'||!item.seasons?.some(s=>s.number===season))throw new RemoteError('Choose a season from this series.');
  const key=item.key+':'+season;if(this.seasonData.has(key))return {season,episodes:this.seasonData.get(key)};
  return this.run(async()=>{
   const p=await this.loadDetailPage(item);if(this.seasonData.has(key))return {season,episodes:this.seasonData.get(key)};
   if(item.source==='aether'){const wait=Date.now()+2000;while(Date.now()<wait&&!this.seasonData.has(key))await p.waitForTimeout(150);if(this.seasonData.has(key))return {season,episodes:this.seasonData.get(key)};await p.mouse.move(600,200);await p.getByRole('button',{name:'Episodes',exact:true}).first().click({timeout:3000}).catch(()=>{});}
   const opener=p.getByRole('button',{name:/^(?:Season \d+|Specials)$/}).first();await opener.waitFor({timeout:12000});await opener.click();
   const choice=item.source==='movy'?p.getByRole('option',{name:season===0?'Specials':'Season '+season,exact:true}):p.getByRole('button',{name:season===0?/^Specials(?:\s|$)/:new RegExp('^Season '+season+'(?: .*)?$')}).last();
   await choice.click({timeout:5000});
   const end=Date.now()+18000;while(Date.now()<end&&!this.seasonData.has(key))await p.waitForTimeout(200);
   if(!this.seasonData.has(key))throw new RemoteError('Episodes could not load from this source. Try again or choose another source.',503);
   return {season,episodes:this.seasonData.get(key)};
  });
 }
 async poster(value,size='small',options={}){
  const item=this.item(value,options);if(!['small','large'].includes(size))throw new RemoteError('Choose a supported poster size.');if(!item.posterURL)throw new RemoteError('Poster unavailable.',404);const path=posterPath(item.posterURL,size==='large'?'w342':'w185');if(!path)throw new RemoteError('Poster unavailable.',404);
  const key=item.key+':'+size;if(this.images.has(key))return this.images.get(key);if(this.imageJobs.has(key))return this.imageJobs.get(key);if(this.imageJobs.size>=6)throw new RemoteError('Posters are loading. Try again.',429);
  const job=this.fetchPoster(path).then(image=>{if(!this.closed){this.images.set(key,image);while(this.images.size>32)this.images.delete(this.images.keys().next().value);}return image;}).catch(()=>{throw new RemoteError('Poster unavailable.',404);}).finally(()=>this.imageJobs.delete(key));this.imageJobs.set(key,job);return job;
 }
 remember(media){const ref=catalogRef(media.id,{source:media.source,type:media.type}),old=this.items.get(ref.key);if(old)return;let page;if(media.source==='aether'&&media.page?.startsWith('https://aether.st/'))page=media.type==='tv'?media.page.replace(/\/[0-9]+\/[0-9]+$/,''):media.page;this.items.set(ref.key,{...ref,title:media.title,year:media.year,synopsis:media.synopsis,rating:normalizeRating(media.rating),genres:media.genres,posterURL:posterPath(media.posterURL)?media.posterURL:null,...(page?{page}:{})});while(this.items.size>160)this.items.delete(this.items.keys().next().value);}
 async browse(options){const {discoverCatalog}=await import('./catalog-discovery.mjs');return discoverCatalog(this,options);}
 async closeBrowser(){clearTimeout(this.idle);const browser=this.browser,egress=this.egress;this.pages.clear();this.browser=null;this.egress=null;egress?.close();await browser?.close().catch(()=>{});}
 async close(){this.closed=true;await this.closeBrowser();for(const map of [this.items,this.searches,this.images,this.metadata,this.seasonData])map.clear();}
}
