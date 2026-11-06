import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {MovieCatalog,searchQuery,movieID,posterPath,catalogItems} from '../catalog.mjs';
import {Store,createHelper} from '../server.mjs';
test('catalog inputs and posters accept only bounded titles, movie IDs and the public image CDN',()=>{
 assert.equal(searchQuery('  Interstellar   movie '),'Interstellar movie');
 for(const value of ['', 'a', 'a'.repeat(101), 'abc\n', 157336])assert.throws(()=>searchQuery(value));
 for(const value of ['0','1x','../1',157336,'1'.repeat(11)])assert.throws(()=>movieID(value));
 assert.equal(movieID('157336'),'157336');
 assert.equal(posterPath('https://image.tmdb.org/t/p/w500/abc-1.jpg','w342'),'/t/p/w342/abc-1.jpg');
 for(const url of ['http://image.tmdb.org/t/p/w500/a.jpg','https://image.tmdb.org.evil.test/t/p/w500/a.jpg','https://127.0.0.1/t/p/w500/a.jpg','https://x@image.tmdb.org/t/p/w500/a.jpg','https://image.tmdb.org/t/p/w500/a.jpg?secret=a','https://image.tmdb.org/t/p/w500/a.svg'])assert.equal(posterPath(url),null);
});
test('catalog results discard foreign links, deduplicate and bound untrusted metadata',()=>{
 const rows=[{url:'https://cinejoy.pk/movie/157336',alt:'Interstellar',text:'Interstellar\n2014',poster:'https://image.tmdb.org/t/p/w500/a.jpg'},{url:'https://cinejoy.pk/movie/157336',alt:'duplicate'},{url:'https://evil.test/movie/2',alt:'foreign'},{url:'https://cinejoy.pk/movie/2',alt:'x'.repeat(200),poster:'http://localhost/a.jpg'}];
 const items=catalogItems(rows);assert.equal(items.length,2);assert.equal(items[0].year,'2014');assert.equal(items[1].title.length,160);assert.equal(items[1].posterURL,null);
});
test('poster requests deduplicate, validate selection and retain a bounded image cache',async()=>{
 let calls=0,release;const catalog=new MovieCatalog({fetchPoster:async()=>{calls++;await new Promise(r=>release=r);return {image:'data:image/png;base64,AAAA'};}});
 catalog.items.set('1',{id:'1',posterURL:'https://image.tmdb.org/t/p/w500/a.jpg'});
 const a=catalog.poster('1'),b=catalog.poster('1');assert.equal(calls,1);release();assert.deepEqual(await a,await b);await catalog.poster('1');assert.equal(calls,1);
 await assert.rejects(catalog.poster('2'),/Search for this title/);await assert.rejects(catalog.poster('1','original'),/supported poster size/);
 catalog.fetchPoster=async()=>({image:'data:image/png;base64,AAAA'});for(let i=2;i<=36;i++){catalog.items.set(String(i),{id:String(i),posterURL:'https://image.tmdb.org/t/p/w500/a.jpg'});await catalog.poster(String(i));}assert.equal(catalog.images.size,32);
 await catalog.close();
});
test('catalog queue serializes browser work, bounds pending jobs and recovers from a failed request',async()=>{
 const catalog=new MovieCatalog();let release;const events=[];
 const a=catalog.run(async()=>{events.push('a');await new Promise(r=>release=r);throw new Error('upstream secret');});
 const b=catalog.run(async()=>{events.push('b');return 2;});
 const c=catalog.run(async()=>3),d=catalog.run(async()=>4);
 await assert.rejects(catalog.run(async()=>5),/busy/);assert.deepEqual(events,['a']);release();
 await assert.rejects(a,error=>!error.message.includes('secret')&&error.status===503);assert.equal(await b,2);await c;await d;assert.deepEqual(events,['a','b']);await catalog.close();await assert.rejects(catalog.run(async()=>1),/unavailable/);
});
test('catalog APIs require the private connection and cannot issue TV or playback commands',async t=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'catalog-api-')),store=new Store(directory);let touched=0;
 const tv={snapshot:()=>({state:'connected'}),key:()=>touched++,disconnect(){}},cast={snapshot:()=>({state:'idle'}),start:()=>touched++};
 const catalog={search:async q=>({query:searchQuery(q),results:[{id:'157336',title:'Interstellar',year:'2014',poster:false}]}),details:async id=>({id:movieID(id),synopsis:'Public synopsis'}),poster:async()=>({image:'data:image/png;base64,AAAA'})};
 const helper=createHelper({store,tv,cast,catalog,addresses:[]});await new Promise(r=>helper.server.listen(0,'127.0.0.1',r));const port=helper.server.address().port;helper.hosts.add('127.0.0.1:'+port);
 t.after(async()=>{await new Promise(r=>helper.server.close(r));rmSync(directory,{recursive:true,force:true});});
 const url='http://127.0.0.1:'+port,headers={Authorization:'Bearer '+store.data.accessKey,'Content-Type':'application/json'};
 const post=(route,body,extra=headers)=>fetch(url+'/api/catalog/'+route,{method:'POST',headers:extra,body:JSON.stringify(body)});
 assert.equal((await post('search',{query:'Interstellar'},{})).status,401);
 assert.equal((await post('search',{query:'Interstellar'},{...headers,Origin:'https://evil.test'})).status,403);
 assert.equal((await post('search',{query:'a'})).status,400);assert.equal((await post('details',{id:'../1'})).status,400);
 const result=await(await post('search',{query:'Interstellar'})).json();assert.equal(result.results[0].year,'2014');
 assert.equal((await post('details',{id:'157336'})).status,200);assert.equal((await post('poster',{id:'157336'})).status,200);assert.equal(touched,0);
});

test('source/type identities cannot collide and series metadata is bounded and normalized',async()=>{
 const {catalogRef,metadataItems,normalizeSeasons,normalizeEpisodes,seasonNumber}=await import('../catalog.mjs');
 assert.notEqual(catalogRef('1396',{source:'cinejoy',type:'tv'}).key,catalogRef('1396',{source:'aether',type:'tv'}).key);
 assert.notEqual(catalogRef('1396',{type:'tv'}).key,catalogRef('1396',{type:'movie'}).key);
 assert.throws(()=>catalogRef('1396',{source:'private'}));assert.throws(()=>catalogRef('1396',{type:'person'}));assert.throws(()=>seasonNumber(-1));assert.throws(()=>seasonNumber(false));assert.equal(seasonNumber(0),0);
 const rows=[{id:1396,media_type:'tv',name:'Breaking Bad',first_air_date:'2008-01-20',poster_path:'/a.jpg'},{id:157336,media_type:'movie',title:'Interstellar',release_date:'2014-11-05'},{id:1,media_type:'person',name:'not a title'}];
 const result=metadataItems(rows,'movy','tv');assert.equal(result.length,1);assert.equal(result[0].source,'movy');assert.equal(result[0].type,'tv');assert.equal(result[0].year,'2008');
 assert.deepEqual(normalizeSeasons([{id:2,season_number:2,name:'Season 2',episode_count:13},{id:1,season_number:0,name:'Specials'},{id:3,season_number:-2}]).map(s=>s.number),[0,2]);
 assert.deepEqual(normalizeEpisodes([{id:62085,season_number:1,episode_number:1,name:'Pilot'},{id:2,season_number:2,episode_number:1,name:'Wrong season'},{id:3,episode_number:-1}],1).map(e=>e.title),['Pilot']);
});
test('series pages use observed public source routes and reject unselected season requests',async()=>{
 const catalog=new MovieCatalog();catalog.items.set('aether-tv-1396',{id:'1396',source:'aether',type:'tv',key:'aether-tv-1396',page:'https://aether.st/media/tmdb-tv-1396-breaking-bad',seasons:[{number:1}]});
 assert.equal(catalog.pageURL(catalog.item('1396',{source:'aether',type:'tv'})),'https://aether.st/media/tmdb-tv-1396-breaking-bad');
 await assert.rejects(catalog.episodes('1396',2,{source:'aether',type:'tv'}),/Choose a season/);assert.throws(()=>catalog.item('1396',{source:'movy',type:'tv'}),/Search for this title/);await catalog.close();
});


test('search metadata includes a bounded description and cached results retain it without visiting details',async()=>{
 const {metadataItems}=await import('../catalog.mjs');const catalog=new MovieCatalog();
 const item=metadataItems([{id:157336,media_type:'movie',title:'Interstellar',release_date:'2014-11-05',overview:'Public description '+ 'x'.repeat(2500),poster_path:'/poster.jpg'}],'aether','movie')[0];
 assert.equal(item.synopsis.length,1800);item.page='https://aether.st/media/tmdb-movie-157336-interstellar';item.cookies='private';item.headers={Authorization:'private'};catalog.items.set(item.key,item);catalog.searches.set('aether:movie:interstellar',{ids:[item.key],expires:Date.now()+10000});
 catalog.session=()=>{throw Error('Cached search must not open a browser');};const result=(await catalog.search('Interstellar',{source:'aether',type:'movie'})).results[0];
 assert.equal(result.synopsis,item.synopsis);assert.equal(result.page,item.page);assert.equal(result.poster,true);assert.equal(result.cookies,undefined);assert.equal(result.headers,undefined);assert.equal(result.posterURL,undefined);await catalog.close();
});


test('discovery hero action links retain the actual title instead of the Play label',()=>{const rows=catalogItems([{url:'https://www.movy.sx/movie/1',text:'Play\nA real movie'}],'movy');assert.equal(rows[0].title,'A real movie');});


test('TMDB ratings remain bounded, require real votes and survive cached public results',async()=>{
 const {normalizeRating,metadataItems}=await import('../catalog.mjs'),rating={source:'tmdb',value:8.64,votes:12345};assert.deepEqual(normalizeRating(rating),rating);
 for(const r of [null,{}, {...rating,source:'imdb'},{...rating,value:NaN},{...rating,value:Infinity},{...rating,value:-1},{...rating,value:0},{...rating,value:10.1},{...rating,value:'8.6'},{...rating,votes:0},{...rating,votes:1.5},{...rating,votes:1000000001}])assert.equal(normalizeRating(r),null);
 const c=new MovieCatalog(),item=metadataItems([{id:157336,media_type:'movie',title:'Interstellar',vote_average:8.64,vote_count:12345}],'cinejoy')[0];assert.deepEqual(item.rating,rating);item.rating.cookie='private';c.items.set(item.key,item);c.searches.set('cinejoy:all:interstellar',{ids:[item.key],expires:Date.now()+10000});c.session=()=>{throw Error('Ratings must not visit another page');};const result=(await c.search('Interstellar')).results[0];assert.deepEqual(result.rating,rating);assert.equal(result.rating.cookie,undefined);assert.equal(metadataItems([{id:1,media_type:'tv',name:'Unrated',vote_average:0,vote_count:0}],'movy')[0].rating,null);await c.close();
});
