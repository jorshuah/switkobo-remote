'use strict';
const libraryUI={page:'search',entries:[],revision:-1,loading:false,manageBusy:false,error:'',version:0,key:null,confirm:null,entryReturn:null,historyLimit:30,discovery:null,discoverBusy:false,discoverError:'',discoverSequence:0,source:storage.get('remote-discover-source')||'aether',type:'all'};
if(!sourceLabels[libraryUI.source])libraryUI.source='aether';
const libraryAvailable=()=>Number(snapshot?.library?.version)>=1;
// Recover public identity on reload without blocking playback controls on catalog requests.
window.playbackPresentation=cast=>{const entry=libraryUI.entries.find(e=>e.key===cast.historyKey);if(!entry&&cast.historyKey&&libraryAvailable()&&!libraryUI.loading&&!libraryUI.historyFailed&&Number(snapshot?.library?.revision)>libraryUI.revision)void loadHistory();return entry?.media||null;};
const historyKey=(item,season,episode)=>item.type==='tv'?'tv:'+item.id+':'+season+':'+episode:'movie:'+item.id;
window.movieBackLabel=()=>libraryUI.page==='discover'?'Back to Discover':'Back to Search';
const historyEntry=(item,season,episode)=>libraryUI.entries.find(e=>e.key===historyKey(item,season,episode));
window.movieResumeLabel=(item,season,episode)=>{const e=historyEntry(item,season,episode);return e&&!e.completed&&e.position>=10?'Resume '+castTime(e.position):'';};
const libraryNav=page=>'<nav class="movie-view-nav" aria-label="Movie views">'+[['search','Search'],['discover','Discover'],['history','History']].map(([id,label])=>'<button type="button" id="movie-view-'+id+'" data-library-view="'+id+'"'+(page===id?' aria-current="page"':'')+'>'+label+'</button>').join('')+'</nav>';
let movieTabTransition=null;
window.settleMovieTabs=()=>{const t=movieTabTransition;if(!t)return;movieTabTransition=null;for(const a of t.animations)a?.cancel();t.ghost?.remove();$('#sheet-body').classList.remove('library-switching');};
function ensureMoviePane(){const body=$('#sheet-body');if(sheetKind!=='cast'||!body.childNodes.length)return null;let pane=$('#library-page-content');if(!pane){pane=document.createElement('div');pane.id='library-page-content';pane.append(...body.childNodes);body.append(pane);}return pane;}
window.movieMotionSurface=ensureMoviePane;
function beginTabSlide(previous,direction){const pane=ensureMoviePane(),body=$('#sheet-body');if(!pane||window.remoteMotion.disabledOnIOS||motionPreference.matches||!previous)return;const width=body.clientWidth,ghost=previous.node;ghost.removeAttribute('id');ghost.classList.add('library-outgoing');ghost.setAttribute('aria-hidden','true');ghost.inert=true;ghost.style.cssText='position:absolute;pointer-events:none;left:'+pane.offsetLeft+'px;top:'+(pane.offsetTop-(previous.scrollTop||0))+'px;width:'+pane.clientWidth+'px;';for(const e of ghost.querySelectorAll('[id]'))e.removeAttribute('id');body.append(ghost);body.classList.add('library-switching');const animations=[window.remoteMotion.tabIn(pane,direction*width),window.remoteMotion.tabOut(ghost,-direction*width)],transition={ghost,animations};movieTabTransition=transition;Promise.all(animations.map(a=>a?.finished.catch(()=>{}))).then(()=>{ghost.remove();if(movieTabTransition===transition){movieTabTransition=null;body.classList.remove('library-switching');}});}
const movieViews=['search','discover','history'];
function switchLibraryView(next,{focus=true}={}){
 const previousPage=libraryUI.page==='entry'?(libraryUI.entryReturn?.page||'history'):libraryUI.page;
 if(!movieViews.includes(next)||next===previousPage&&libraryUI.page!=='entry')return;
 window.settleMovieTabs();const pane=ensureMoviePane(),previous=!window.remoteMotion.disabledOnIOS&&!motionPreference.matches&&pane?{node:pane.cloneNode(true),scrollTop:$('#sheet-body').scrollTop}:null,direction=movieViews.indexOf(next)>movieViews.indexOf(previousPage)?1:-1;
 $('#sheet-body').dataset.tabSwitching='true';
 try{libraryUI.page=next;libraryUI.confirm=null;catalogUI.mode='search';catalogUI.revision++;libraryUI.version++;window.renderCast();$('#sheet-body').scrollTop=0;}finally{delete $('#sheet-body').dataset.tabSwitching;}
 if(focus)$('#movie-view-'+next)?.focus({preventScroll:true});
 beginTabSlide(previous,direction);if(next==='discover'&&!libraryUI.discovery&&!libraryUI.discoverBusy)void loadDiscovery();
}
function bindLibraryNav(){for(const b of $$('#movie-library-nav [data-library-view]'))b.onclick=()=>switchLibraryView(b.dataset.libraryView);}
// Claim deliberate horizontal touch gestures only; leave native scrolling and editing alone.
(()=>{
 const body=$('#sheet-body'),surface=body.parentElement;let gesture=null,suppressClickUntil=0;
 const available=()=>sheet.open&&sheetKind==='cast'&&castScreen==='catalog'&&catalogUI.mode==='search'&&movieViews.includes(libraryUI.page)&&!libraryUI.confirm&&!catalogUI.startBusy&&!libraryUI.manageBusy&&!inFlight&&!$('#movie-library-nav').hidden&&!sheet.querySelector('[role="listbox"]');
 const ownsGesture=target=>{
  if(target.closest('input,textarea,select,label,a,[contenteditable="true"],[role="combobox"],[role="slider"],button:not(.movie-result):not(.watch-row):not([data-library-view])'))return true;
  for(let e=target;e&&e!==surface;e=e.parentElement){const overflow=getComputedStyle(e).overflowX;if(e.matches('.discover-section .movie-results')||/auto|scroll/.test(overflow)&&e.scrollWidth>e.clientWidth+1)return true;}
  return false;
 };
 surface.addEventListener('touchstart',event=>{
  gesture=null;suppressClickUntil=0;if(event.touches.length!==1||!event.target.closest('#sheet-body,#movie-library-nav')||!available()||ownsGesture(event.target))return;
  const touch=event.touches[0];if(touch.clientX<24||touch.clientX>innerWidth-24)return;
  gesture={id:touch.identifier,x:touch.clientX,y:touch.clientY,page:libraryUI.page,start:performance.now(),claimed:false};
 },{passive:true});
 surface.addEventListener('touchmove',event=>{
  const g=gesture;if(!g)return;if(event.touches.length!==1||!available()||g.page!==libraryUI.page){gesture=null;return;}
  const touch=[...event.touches].find(t=>t.identifier===g.id);if(!touch){gesture=null;return;}
  const dx=touch.clientX-g.x,dy=touch.clientY-g.y;
  if(!g.claimed){if(Math.abs(dy)>10&&Math.abs(dy)>=Math.abs(dx)){gesture=null;return;}if(Math.abs(dx)<12||Math.abs(dx)<Math.abs(dy)*1.5)return;if(!event.cancelable){gesture=null;return;}g.claimed=true;}
  if(event.cancelable)event.preventDefault();
 },{passive:false});
 surface.addEventListener('touchend',event=>{
  const g=gesture;gesture=null;if(!g||!g.claimed)return;suppressClickUntil=performance.now()+500;if(event.cancelable)event.preventDefault();
  const touch=[...event.changedTouches].find(t=>t.identifier===g.id);if(!touch||event.touches.length||!available()||g.page!==libraryUI.page||performance.now()-g.start>1200)return;
  const dx=touch.clientX-g.x,dy=touch.clientY-g.y,threshold=Math.max(48,Math.min(80,body.clientWidth*.18));
  if(Math.abs(dx)<threshold||Math.abs(dx)<Math.abs(dy)*1.5)return;
  const next=movieViews[movieViews.indexOf(g.page)+(dx<0?1:-1)];if(next)switchLibraryView(next,{focus:false});
 },{passive:false});
 surface.addEventListener('touchcancel',()=>{if(gesture?.claimed)suppressClickUntil=performance.now()+500;gesture=null;},{passive:true});
 surface.addEventListener('click',event=>{if(performance.now()<suppressClickUntil){suppressClickUntil=0;event.preventDefault();event.stopImmediatePropagation();}},true);
 sheet.addEventListener('close',()=>{gesture=null;suppressClickUntil=0;window.settleMovieTabs();});
})();
function progressRows(entries){return entries.map(e=>{const m=e.media;return '<button class="watch-row" data-history-key="'+esc(e.key)+'"><span class="movie-art watch-art"'+(m.poster?' data-poster-key="'+esc(catalogKey(m))+'"':'')+'><img class="poster-fallback" src="/icons/film.svg" alt=""></span><span class="watch-copy"><strong>'+esc(m.title)+'</strong><small>'+(m.type==='tv'?'Season '+m.season+' · Episode '+m.episode+' · ':'')+(e.completed?'Watched':castTime(e.position)+' of '+castTime(e.duration))+'</small><progress value="'+e.position+'" max="'+e.duration+'" aria-label="Watch progress"></progress></span><img class="watch-chevron" src="/icons/chevron-right.svg" alt=""></button>';}).join('');}
function bindHistoryRows(){for(const b of $$('#sheet-body [data-history-key]'))b.onclick=()=>window.remoteMotion.transaction(()=>{
 const body=$('#sheet-body');libraryUI.entryReturn={page:libraryUI.page==='search'?'search':'history',scroll:body.scrollTop,key:b.dataset.historyKey};
 libraryUI.key=b.dataset.historyKey;libraryUI.page='entry';libraryUI.confirm=null;catalogUI.selected=null;catalogUI.mode='search';catalogUI.detailError='';catalogUI.error='';libraryUI.version++;
 window.renderCast();body.scrollTop=0;$('#sheet-title').focus({preventScroll:true});
});}
function backFromSavedTitle(){window.remoteMotion.transaction(()=>{
 const target=libraryUI.entryReturn||{page:'history',scroll:0};libraryUI.page=target.page;libraryUI.confirm=null;libraryUI.version++;catalogUI.mode='search';catalogUI.revision++;
 window.renderCast();$('#sheet-body').scrollTop=target.scroll;
 if(target.key)$('#sheet-body [data-history-key="'+CSS.escape(target.key)+'"]')?.focus({preventScroll:true});
});}
// Saved progress may refresh while the entry is entering. Patch its data in
// place so decoded posters, focus and pressed controls are not discarded.
function patchSavedTitle(parent,desired){
 const matches=(a,b)=>a.nodeType===b.nodeType&&(a.nodeType!==Node.ELEMENT_NODE||(a.tagName===b.tagName&&(a.id||b.id?a.id===b.id:a.classList[0]===b.classList[0])));
 let cursor=parent.firstChild;
 for(const next of [...desired.childNodes]){
  let node=cursor;
  if(!node||!matches(node,next)){
   node=[...parent.childNodes].find(n=>n!==cursor&&matches(n,next)&&next.nodeType===Node.ELEMENT_NODE&&(next.id||next.classList.length));
   if(!node)node=next.cloneNode(true);parent.insertBefore(node,cursor);
  }
  if(node.nodeType===Node.TEXT_NODE){if(node.nodeValue!==next.nodeValue)node.nodeValue=next.nodeValue;}
  else if(node.nodeType===Node.ELEMENT_NODE){
   if(!(node.matches('.movie-art')&&node.dataset.posterKey===next.dataset.posterKey)){
    for(const a of [...node.attributes])if(!next.hasAttribute(a.name)&&a.name!=='data-busy')node.removeAttribute(a.name);
    for(const a of [...next.attributes])if(node.getAttribute(a.name)!==a.value)node.setAttribute(a.name,a.value);
    patchSavedTitle(node,next);
   }
  }
  cursor=node.nextSibling;
 }
 while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next;}
}
function invalidateSuggestions(){libraryUI.discovery=null;libraryUI.discoverSequence++;libraryUI.discoverBusy=false;}
function updateHistoryProfile(entries){const signature=JSON.stringify(entries.map(e=>[e.media.type,e.media.id,e.media.genres,e.position>=30||e.completed]).sort());if(signature!==libraryUI.profileSignature){libraryUI.profileSignature=signature;invalidateSuggestions();}}
function continued(){const seen=new Set();return libraryUI.entries.filter(e=>{const key=e.media.type+':'+e.media.id;if(e.completed||e.position<10||seen.has(key))return false;seen.add(key);return true;}).slice(0,3);}
async function loadHistory(){if(libraryUI.loading||!libraryAvailable())return;libraryUI.loading=true;libraryUI.historyFailed=false;try{const data=await request('library');libraryUI.entries=data.entries;updateHistoryProfile(data.entries);libraryUI.revision=data.revision;libraryUI.error=data.warning||'';libraryUI.version++;}catch(e){libraryUI.error=e.message;libraryUI.historyFailed=true;libraryUI.version++;}finally{libraryUI.loading=false;window.renderCast();if(libraryUI.page==='discover'&&!libraryUI.discovery&&!libraryUI.discoverBusy&&sheet.open)void loadDiscovery();}}
async function loadDiscovery(){if(libraryUI.discoverBusy)return;const sequence=++libraryUI.discoverSequence,source=libraryUI.source,type=libraryUI.type;libraryUI.discoverBusy=true;libraryUI.discoverError='';libraryUI.version++;window.renderCast();try{const data=await request('catalog/browse',{source,type});if(sequence===libraryUI.discoverSequence)libraryUI.discovery=data;}catch(e){if(sequence===libraryUI.discoverSequence)libraryUI.discoverError=e.message;}finally{if(sequence===libraryUI.discoverSequence){libraryUI.discoverBusy=false;libraryUI.version++;window.renderCast();}}}
// Personal picks take precedence, then recent releases; render each title once.
function distinctDiscoveryRows(data){
 const seen=new Set(),take=items=>(items||[]).filter(item=>{const key=item.type+':'+item.id;if(seen.has(key))return false;seen.add(key);return true;});
 const recommended=take(data.recommended),recent=take(data.recent),popular=take(data.popular);
 return {recommended,recent,popular};
}
function discoverSection(name,items,id){return items?.length?'<section class="discover-section"><h3>'+name+'</h3><div class="movie-results">'+items.map(i=>'<button class="movie-result" data-discover-key="'+esc(catalogKey(i))+'" id="'+id+'-'+resultID(i)+'" aria-label="Preview '+esc(i.title)+(movieRatingLabel(i)?', '+esc(movieRatingLabel(i)):'')+'"><span class="movie-art"'+(i.poster?' data-poster-key="'+esc(catalogKey(i))+'"':'')+'><img class="poster-fallback" src="/icons/film.svg" alt=""></span><strong>'+esc(i.title)+'</strong><small>'+esc(i.year||'Year unavailable')+' · '+(i.type==='tv'?'Series':'Movie')+'</small>'+movieRatingHTML(i)+'</button>').join('')+'</div></section>':'';}
function watchProgressHTML(entry){
 const duration=Math.max(1,Number(entry.duration)||1),position=Math.min(duration,Math.max(0,Number(entry.position)||0)),date=new Date(entry.updatedAt),dateLabel=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',...(date.getFullYear()!==new Date().getFullYear()?{year:'numeric'}:{})}).format(date);
 return '<div class="watch-progress-summary"><div class="watch-progress-times"><span>'+(entry.completed?'<strong>Watched</strong>':'<strong>'+castTime(position)+'</strong> watched')+'</span><span>'+castTime(duration)+' total</span></div><progress value="'+(entry.completed?duration:position)+'" max="'+duration+'" aria-label="Viewing progress" aria-valuetext="'+(entry.completed?'Marked as watched':castTime(position)+' watched out of '+castTime(duration))+'"></progress><time datetime="'+date.toISOString()+'">Last watched '+esc(dateLabel)+'</time></div>';
}
function libraryEntryHTML(){
 const backLabel=libraryUI.entryReturn?.page==='search'?'Back to Search':'Back to history';
 const e=libraryUI.entries.find(e=>e.key===libraryUI.key);if(!e)return '<p class="empty">This title is no longer in your history.</p><button id="library-entry-back" class="catalog-back">'+backLabel+'</button>';const m=e.media;
 const summary='<button id="library-entry-back" class="catalog-back"><img src="/icons/arrow-left.svg" alt="">'+backLabel+'</button><div class="movie-preview"><div class="movie-art"'+(m.poster?' data-poster-key="'+esc(catalogKey(m))+'" data-size="large"':'')+'><img class="poster-fallback" src="/icons/film.svg" alt=""></div><div class="movie-preview-heading"><h3>'+esc(m.title)+'</h3><p>'+esc(m.year)+' · '+(m.type==='tv'?'Season '+m.season+' · Episode '+m.episode:'Movie')+'</p>'+movieRatingHTML(m,true)+'</div></div>'+(m.episodeTitle?'<p>'+esc(m.episodeTitle)+'</p>':'')+watchProgressHTML(e);
 const status='<p id="library-action-status" class="catalog-status" role="status">'+esc(libraryUI.manageBusy?'Saving changes…':catalogUI.detailError||catalogUI.error||libraryUI.error)+'</p>';
 if(libraryUI.confirm==='remove')return summary+'<div class="watch-confirm"><h3>Remove from history?</h3><p>This removes this title and its saved position. You can still find and play it again.</p>'+status+'<button id="library-remove-confirm" class="primary wide">Remove from history</button><button id="library-cancel" class="catalog-back wide">Keep title</button></div>';
 return summary+status+'<div class="watch-actions"><button id="library-resume" class="primary wide">'+(e.completed?'Watch again':'Resume '+castTime(e.position))+'</button>'+(!e.completed?'<div class="watch-secondary"><button id="library-start-over"><span>Start over</span><img class="action-end-icon" src="/icons/rotate-ccw.svg" alt=""></button><button id="library-mark-watched"><span>Mark as watched</span><img class="action-end-icon" src="/icons/check.svg" alt=""></button></div>':'')+'<button id="library-remove" class="watch-remove danger">Remove from history</button></div>';
}
async function manageHistory(input){if(libraryUI.manageBusy)return;libraryUI.manageBusy=true;libraryUI.error='';libraryUI.version++;window.renderCast();try{const data=await request('library/manage',input);libraryUI.entries=data.entries;updateHistoryProfile(data.entries);libraryUI.revision=data.revision;libraryUI.error=data.warning||'';libraryUI.confirm=null;if(input.action==='remove'||input.action==='clear')libraryUI.page='history';libraryUI.version++;window.renderCast();}catch(e){libraryUI.error=e.message;}finally{libraryUI.manageBusy=false;libraryUI.version++;window.renderCast();if(!libraryUI.error)$('#'+(input.action==='watched'?'library-resume':'movie-view-history'))?.focus({preventScroll:true});}}
function playSaved(restart){const e=libraryUI.entries.find(e=>e.key===libraryUI.key);if(!e)return;void window.playVideoSelection({libraryKey:e.key,restart,title:e.media.title,origin:'catalog',presentation:e.media},$('#library-resume'));}
function renderLibraryPage(){
 const body=$('#sheet-body'),signature=libraryUI.page+':'+libraryUI.version+':'+libraryUI.key+':'+libraryUI.confirm+':'+Boolean(catalogUI.startBusy)+':'+libraryUI.manageBusy+':'+(catalogUI.detailError||catalogUI.error);
 if(body.dataset.librarySignature!==signature){window.remoteMotion?.prepare(body,'library:'+libraryUI.page+(libraryUI.page==='entry'?':'+libraryUI.key:'')+(libraryUI.confirm?':confirm:'+libraryUI.confirm:''));const focused=body.contains(document.activeElement)?document.activeElement.id:null,scroll=body.scrollTop;body.dataset.librarySignature=signature;catalogUI.signature='';$('#sheet-title').textContent=libraryUI.page==='discover'?'Discover':libraryUI.page==='entry'?'Saved title':'Viewing history';let html='';
 if(!libraryAvailable())html+='<p class="help">Restart the PC helper after watching to enable discovery and saved progress.</p>';
 else if(libraryUI.confirm==='clear')html+='<div class="watch-confirm"><h3>Clear viewing history?</h3><p>This removes all saved positions on this helper and resets your suggestions.</p><p class="catalog-status" role="status">'+esc(libraryUI.manageBusy?'Saving changes…':libraryUI.error)+'</p><button id="library-clear-confirm" class="primary wide">Clear viewing history</button><button id="library-cancel" class="catalog-back wide">Keep history</button></div>';
 else if(libraryUI.page==='history'){html+='<p id="history-status" class="catalog-status" role="status">'+esc(libraryUI.error||(libraryUI.loading?'Loading history…':''))+'</p>'+(libraryUI.error?'<button id="history-retry" class="secondary-action wide">Try loading history again</button>':'')+(libraryUI.entries.length?'<div class="watch-history">'+progressRows(libraryUI.entries.slice(0,libraryUI.historyLimit))+'</div>'+(libraryUI.entries.length>libraryUI.historyLimit?'<button id="history-more" class="secondary-action wide">Show more history</button>':'')+'<button id="library-clear" class="catalog-back wide danger">Clear viewing history</button>':'<div class="library-empty"><p class="empty">Movies and episodes you play here will appear in your history.</p><button id="history-find-title" class="secondary-action wide">Find a title</button></div>');}
 else if(libraryUI.page==='entry')html+=libraryEntryHTML();
 else{const d=libraryUI.discovery;html+='<div class="catalog-filters"><div><label for="discover-source">Discover in</label><select id="discover-source">'+Object.entries(sourceLabels).map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('')+'</select></div><div><label for="discover-type">Show</label><select id="discover-type"><option value="all">All titles</option><option value="movie">Movies</option><option value="tv">Series</option></select></div></div><p class="catalog-status'+(libraryUI.discoverBusy?' cast-loading':'')+'" role="status">'+esc(libraryUI.discoverError||(libraryUI.discoverBusy?'Finding titles on '+sourceLabels[libraryUI.source]+'…':''))+'</p>'+(libraryUI.discoverError&&!d?'<button id="discover-retry" class="secondary-action wide">Try again</button>':'');if(d){const rows=distinctDiscoveryRows(d);html+=discoverSection('Picked for you',rows.recommended,'recommended')+(!rows.recommended.length?'<p class="help discover-note">'+(d.recommendationBasis?'This selection has no new genre matches yet. Try another source.':'Play a few titles to build suggestions from the genres you watch.')+'</p>':'<p class="help discover-note">Based on genres in your local viewing history.</p>')+discoverSection('Popular now',rows.popular,'popular')+discoverSection('Recent titles',rows.recent,'recent')+'<button id="discover-refresh" class="secondary-action wide" aria-busy="'+libraryUI.discoverBusy+'" aria-disabled="'+libraryUI.discoverBusy+'"><img src="/icons/refresh-cw.svg" alt="">'+(libraryUI.discoverBusy?'Refreshing titles…':libraryUI.discoverError?'Try refreshing again':'Refresh titles')+'</button>';}}
 const existingPane=$('#library-page-content');if(existingPane&&body.dataset.libraryPage===libraryUI.page){const template=document.createElement('template');template.innerHTML=html;const oldFilters=body.querySelector('.catalog-filters'),newFilters=template.content.querySelector('.catalog-filters');if(oldFilters&&newFilters)newFilters.replaceWith(oldFilters);if(libraryUI.page==='entry'&&body.dataset.libraryEntryKey===libraryUI.key&&body.dataset.libraryConfirm===(libraryUI.confirm||''))patchSavedTitle(existingPane,template.content);else existingPane.replaceChildren(template.content);}else body.innerHTML=html;body.dataset.libraryPage=libraryUI.page;body.dataset.libraryEntryKey=libraryUI.key||'';body.dataset.libraryConfirm=libraryUI.confirm||'';bindLibraryNav();bindHistoryRows();const bind=(id,fn)=>{const b=$('#'+id);if(b)b.onclick=fn;};bind('library-entry-back',backFromSavedTitle);bind('library-remove',()=>{libraryUI.confirm='remove';libraryUI.version++;window.renderCast();});bind('library-remove-confirm',()=>manageHistory({action:'remove',key:libraryUI.key}));bind('library-mark-watched',()=>manageHistory({action:'watched',key:libraryUI.key}));bind('library-clear',()=>{libraryUI.confirm='clear';libraryUI.version++;window.renderCast();});bind('library-clear-confirm',()=>manageHistory({action:'clear',confirm:true}));bind('library-cancel',()=>{const confirm=libraryUI.confirm;libraryUI.confirm=null;libraryUI.version++;window.renderCast();$('#'+(confirm==='remove'?'library-remove':'library-clear'))?.focus({preventScroll:true});});bind('library-resume',()=>playSaved(false));bind('library-start-over',()=>playSaved(true));bind('history-find-title',()=>switchLibraryView('search'));bind('history-retry',()=>{libraryUI.historyFailed=false;void loadHistory();});bind('history-more',()=>{libraryUI.historyLimit+=30;libraryUI.version++;window.renderCast();});bind('discover-retry',loadDiscovery);bind('discover-refresh',loadDiscovery);
 if($('#discover-source')){for(const [id,key]of [['discover-source','source'],['discover-type','type']]){const select=$('#'+id);select.value=libraryUI[key];select.onchange=()=>{libraryUI[key]=select.value;if(key==='source')storage.set('remote-discover-source',select.value);libraryUI.discoverSequence++;libraryUI.discoverBusy=false;libraryUI.discovery=null;void loadDiscovery();};}}
 for(const b of $$('#sheet-body [data-discover-key]'))b.onclick=()=>{const d=libraryUI.discovery,items=[...d.popular,...d.recent,...d.recommended];const previous=catalogUI.results;catalogUI.results=[...new Map(items.map(i=>[catalogKey(i),i])).values()];void previewMovie(b.dataset.discoverKey);catalogUI.results=previous;};window.refreshPickers?.();loadCatalogPosters();body.scrollTop=scroll;if(focused)$('#'+focused)?.focus({preventScroll:true});window.remoteMotion?.present(body,'library:'+libraryUI.page+(libraryUI.page==='entry'?':'+libraryUI.key:'')+(libraryUI.confirm?':confirm:'+libraryUI.confirm:''));}
 for(const button of $$('#sheet-body #library-remove-confirm,#sheet-body #library-clear-confirm,#sheet-body #library-mark-watched,#sheet-body #library-remove,#sheet-body #library-cancel,#sheet-body #library-entry-back'))button.disabled=libraryUI.manageBusy;
 for(const id of ['library-resume','library-start-over'])if($('#'+id))$('#'+id).disabled=libraryUI.manageBusy||catalogUI.startBusy||!tvEnabled();
}
const baseRenderCatalog=window.renderCatalog;
window.renderCatalog=function(){if(sheetKind!=='cast'||!sheet.open||castScreen!=='catalog')return;if(libraryAvailable()&&!libraryUI.loading&&!libraryUI.historyFailed&&(libraryUI.revision<0||Number(snapshot.library.revision)>libraryUI.revision))void loadHistory();
 if(catalogUI.mode==='search'&&libraryUI.page!=='search'){renderLibraryPage();ensureMoviePane();return;}
 baseRenderCatalog();delete $('#sheet-body').dataset.librarySignature;delete $('#sheet-body').dataset.libraryPage;
 if(catalogUI.mode==='search'){if(!$('#continue-watching')){const continued=document.createElement('section');continued.id='continue-watching';continued.className='continue-watching';ensureMoviePane();$('#movie-results').after(continued);}const list=$('#continue-watching'),entries=continued(),signature=JSON.stringify(entries.map(e=>[e.key,e.position,e.completed]));if(list.dataset.signature!==signature){list.dataset.signature=signature;list.innerHTML=entries.length?'<h3>Continue watching</h3>'+progressRows(entries):'';list.hidden=!entries.length;bindHistoryRows();loadCatalogPosters();}}
 else if(catalogUI.mode==='detail'){const e=historyEntry(catalogUI.selected,catalogUI.season,catalogUI.episode);let b=$('#movie-start-over');if(e&&!e.completed&&e.position>=10){if(!b){b=document.createElement('button');b.id='movie-start-over';b.className='secondary-action wide';b.innerHTML='<span>Start over</span><img class="action-end-icon" src="/icons/rotate-ccw.svg" alt="">';b.onclick=()=>playCatalogSelection(true);$('#movie-play').after(b);}b.disabled=catalogUI.startBusy||catalogUI.resolveBusy||!tvEnabled();}else b?.remove();}
 ensureMoviePane();
};
const baseBrowseMovies=window.browseMovies;window.browseMovies=()=>{libraryUI.page='search';baseBrowseMovies();};

// The navigation is a fixed sheet sibling; only the content below it scrolls.
function syncMovieNavigation(){
 const host=$('#movie-library-nav'),visible=sheet.open&&sheetKind==='cast'&&castScreen==='catalog'&&catalogUI.mode==='search';
 host.hidden=!visible;if(!visible)return;
 const selected=libraryUI.page==='entry'?(libraryUI.entryReturn?.page||'history'):libraryUI.page;
 if(!host.firstElementChild){host.innerHTML=libraryNav(selected);bindLibraryNav();}
 for(const button of host.querySelectorAll('[data-library-view]')){if(button.dataset.libraryView===selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
}
const renderCastWithLibrary=window.renderCast;
window.renderCast=function(){renderCastWithLibrary();syncMovieNavigation();};
sheet.addEventListener('close',()=>{$('#movie-library-nav').hidden=true;});
syncMovieNavigation();
