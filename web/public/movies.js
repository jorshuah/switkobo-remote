'use strict';
// Catalog browsing is independent of playback. Each title keeps source + type + ID.
const sourceLabels={cinejoy:'Cinejoy',movy:'Movy',aether:'Aether'};
let searchSource=storage.get('remote-search-source')||'cinejoy',searchType=storage.get('remote-search-type')||'all';
if(!sourceLabels[searchSource])searchSource='cinejoy';if(!['all','movie','tv'].includes(searchType))searchType='all';
const catalogUI={mode:'search',draft:'',query:'',results:[],searched:false,busy:false,error:'',selected:null,detailBusy:false,detailError:'',scroll:0,revision:0,signature:'',searchSequence:0,detailSequence:0,episodeSequence:0,startBusy:false,resolveBusy:false,resolveSequence:0,pending:null,season:null,episode:null,episodes:[],episodesBusy:false,episodeError:''};
const catalogImages=new Map(),catalogImageJobs=new Map(),catalogImageQueues=[Promise.resolve(),Promise.resolve(),Promise.resolve()];let catalogImageNext=0;
if(!['480','720','1080'].includes(movieQuality))movieQuality='480';let movieProvider='cinejoy';
const catalogIdentity=item=>({id:item.id,source:item.source||'cinejoy',type:item.type||'movie'});
const catalogKey=item=>(item.source||'cinejoy')+'-'+(item.type||'movie')+'-'+item.id;
const resultID=item=>'movie-result-'+(item.type==='tv'?'tv-':'')+item.id;
function catalogChanged(){catalogUI.revision++;window.renderCast();}
function cancelCatalogResolve(){catalogUI.resolveSequence++;catalogUI.resolveBusy=false;}
function catalogBack(){cancelCatalogResolve();catalogUI.detailSequence++;catalogUI.episodeSequence++;catalogUI.mode='search';catalogUI.detailError='';catalogChanged();$('#sheet-body').scrollTop=catalogUI.scroll;$('#'+resultID(catalogUI.selected))?.focus({preventScroll:true});}
function usableMovieRating(item){const r=item?.rating;return r?.source==='tmdb'&&typeof r.value==='number'&&Number.isFinite(r.value)&&r.value>0&&r.value<=10&&Number.isSafeInteger(r.votes)&&r.votes>0&&r.votes<=1000000000?r:null;}
function movieRatingLabel(item){const r=usableMovieRating(item);return r?'TMDB '+(item.type==='tv'?'series':'movie')+' rating '+r.value.toFixed(1)+' out of 10, based on '+new Intl.NumberFormat().format(r.votes)+' '+(r.votes===1?'vote':'votes'):'';}
function movieRatingHTML(item,detail=false){
 const r=usableMovieRating(item);if(!r)return '';
 return '<span class="movie-rating" role="img" aria-label="'+esc(movieRatingLabel(item))+'"><img src="/icons/star.svg" alt=""><span class="rating-number"><strong>'+r.value.toFixed(1)+'</strong><span class="rating-scale">/10</span></span><span class="rating-source">TMDB'+(detail&&item.type==='tv'?' series':'')+'</span>'+(detail?'<span class="rating-votes">'+new Intl.NumberFormat().format(r.votes)+' '+(r.votes===1?'vote':'votes')+'</span>':'')+'</span>';
}
function catalogSearchHTML(){
 return '<button id="catalog-current" class="catalog-current" hidden><img src="/icons/play.svg" alt=""><span></span><img src="/icons/chevron-right.svg" alt=""></button><form id="movie-search-form" class="movie-search-form" role="search"><label class="sr-only" for="movie-search">Title</label><div class="movie-search-field"><img src="/icons/search.svg" alt=""><input id="movie-search" type="search" placeholder="Search movies and series" autocomplete="off" maxlength="100" enterkeyhint="search" value="'+esc(catalogUI.draft)+'"><button id="movie-search-clear" type="button" aria-label="Clear title" hidden><img src="/icons/x.svg" alt=""></button><button id="movie-search-submit" type="submit" aria-label="Search titles"><img src="/icons/chevron-right.svg" alt=""></button></div><div class="catalog-filters"><div><label for="catalog-source">Search in</label><select id="catalog-source">'+Object.entries(sourceLabels).map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('')+'</select></div><div><label for="catalog-type">Show</label><select id="catalog-type"><option value="all">All titles</option><option value="movie">Movies</option><option value="tv">Series</option></select></div></div></form><p id="catalog-upgrade-help" class="catalog-status" hidden>Restart the PC helper after watching to enable the new sources and series.</p><p id="movie-search-status" class="catalog-status" role="status"></p><div id="movie-results" class="movie-results" aria-label="Search results"></div>';
}
function catalogDetailHTML(){
 const item=catalogUI.selected,tv=item.type==='tv';
 return '<button id="catalog-back" class="catalog-back"><img src="/icons/arrow-left.svg" alt="">'+esc(window.movieBackLabel?.()||'Back to results')+'</button><div class="movie-preview"><div class="movie-art" data-poster-key="'+esc(catalogKey(item))+'" data-size="large"><img class="poster-fallback" src="/icons/film.svg" alt=""></div><div class="movie-preview-heading"><h3>'+esc(item.title)+'</h3><p>'+esc(item.year||'Year unavailable')+' · '+(tv?'Series':'Movie')+'</p><div id="movie-rating">'+movieRatingHTML(item,true)+'</div></div></div><p id="movie-synopsis" class="movie-synopsis"></p><p id="movie-detail-error" class="catalog-status" role="status"></p>'+
 (tv?'<div class="episode-options"><div><label for="movie-season">Season</label><select id="movie-season"></select></div><div><label for="movie-episode">Episode</label><select id="movie-episode"></select></div></div><p id="movie-episode-help" class="catalog-status" role="status"></p><button id="movie-episodes-retry" class="secondary-action wide" hidden>Try loading episodes again</button>':'')+
 '<div class="movie-options"><div><label for="movie-provider">Play using</label><select id="movie-provider"><option value="cinejoy">Cinejoy</option><option value="movy">Movy</option><option value="aether">Aether</option></select></div><div><label for="movie-preview-quality">Quality</label><select id="movie-preview-quality"><option value="480">480p</option><option value="720">720p</option><option value="1080">1080p</option></select></div></div><button id="movie-play" class="primary wide"><img src="/icons/play.svg" alt="">'+(tv?'Play episode on TV':'Play on TV')+'</button><p id="movie-play-help" class="cast-footnote"></p>';
}
function syncOptions(select,options,value,empty){const html=options.length?options.map(i=>'<option value="'+esc(i.value)+'">'+esc(i.label)+'</option>').join(''):'<option value="">'+esc(empty)+'</option>';if(select.dataset.options!==html){select.innerHTML=html;select.dataset.options=html;}select.value=value===null?'':String(value);}
window.renderCatalog=function(){
 if(sheetKind!=='cast'||!sheet.open||castScreen!=='catalog')return;
 const modernCatalog=Number(snapshot?.catalog?.version)>=2;if(!modernCatalog){searchSource='cinejoy';searchType='movie';}
 const anchor=catalogUI.mode==='detail'&&$('#sheet-body').contains(document.activeElement)?document.activeElement:null,anchorTop=anchor?.getBoundingClientRect().top;
 const signature=catalogUI.mode+':'+catalogUI.revision;
 if(catalogUI.signature!==signature||!$('#sheet-body').querySelector(catalogUI.mode==='search'?'#movie-search':catalogUI.mode==='detail'?'#movie-play':'#movie-replace')){
  const previousScreen=$('#sheet-body').dataset.motionScreen;
  window.remoteMotion?.prepare($('#sheet-body'),'catalog:'+catalogUI.mode+(catalogUI.mode==='detail'?':'+catalogKey(catalogUI.selected):''));
  catalogUI.signature=signature;castSheetSignature='';$('#sheet-notice').hidden=true;
  $('#sheet-title').textContent=catalogUI.mode==='search'?'Find something to watch':catalogUI.mode==='replace'?'Replace the current video?':'Title preview';
  if(catalogUI.mode==='search'){
   if(!$('#movie-search')){
   $('#sheet-body').innerHTML=catalogSearchHTML();const input=$('#movie-search');input.oninput=()=>{catalogUI.draft=input.value;$('#movie-search-clear').hidden=!input.value;$('#movie-search-submit').disabled=catalogUI.busy&&input.value.trim()===catalogUI.query;};
   input.autocapitalize='none';input.spellcheck=false;
   $('.movie-search-field').onclick=event=>{if(event.target===input||event.target.closest('button'))return;window.remoteMotion?.settleSurface();input.focus({preventScroll:true});};
   $('#movie-search-clear').onclick=()=>{catalogUI.draft='';catalogUI.query='';catalogUI.searchSequence++;catalogUI.busy=false;catalogUI.results=[];catalogUI.searched=false;catalogUI.error='';catalogChanged();$('#movie-search').focus();};
   $('#movie-search-form').onsubmit=e=>{e.preventDefault();void searchMovies();};$('#catalog-source').value=searchSource;$('#catalog-type').value=searchType;
   for(const [selector,kind] of [['#catalog-source','source'],['#catalog-type','type']])$(selector).onchange=e=>{catalogUI.draft=input.value;catalogUI.searchSequence++;catalogUI.busy=false;catalogUI.results=[];catalogUI.searched=false;catalogUI.error='';if(kind==='source'){searchSource=e.target.value;storage.set('remote-search-source',searchSource);}else{searchType=e.target.value;storage.set('remote-search-type',searchType);}catalogChanged();if(catalogUI.draft.trim().length>=2)void searchMovies();};
   $('#catalog-current').onclick=()=>{castScreen='player';castSheetSignature='';window.renderCast();};
   }
   if($('#movie-search').value!==catalogUI.draft)$('#movie-search').value=catalogUI.draft;
   const results=$('#movie-results');results.innerHTML=catalogUI.results.map(item=>'<button id="'+resultID(item)+'" class="movie-result" data-key="'+esc(catalogKey(item))+'" aria-label="Preview '+esc(item.title)+(item.year?' ('+esc(item.year)+')':'')+(movieRatingLabel(item)?', '+esc(movieRatingLabel(item)):'')+'"><span class="movie-art"'+(item.poster?' data-poster-key="'+esc(catalogKey(item))+'"':'')+'><img class="poster-fallback" src="/icons/film.svg" alt=""></span><strong>'+esc(item.title)+'</strong><small>'+esc(item.year||'Year unavailable')+' · '+(item.type==='tv'?'Series':'Movie')+'</small>'+movieRatingHTML(item)+'</button>').join('');
   results.onclick=e=>{const target=e.target.closest('.movie-result');if(target)void previewMovie(target.dataset.key);};
  }else if(catalogUI.mode==='detail'){
   $('#sheet-body').innerHTML=catalogDetailHTML();$('#catalog-back').onclick=catalogBack;
   $('#movie-provider').value=movieProvider;$('#movie-provider').onchange=e=>{movieProvider=e.target.value;catalogUI.detailError='';window.renderCast();};
   $('#movie-preview-quality').value=movieQuality;$('#movie-preview-quality').onchange=e=>{movieQuality=e.target.value;storage.set('remote-movie-quality',movieQuality);};$('#movie-play').onclick=()=>playCatalogSelection(false);
   if(catalogUI.selected.type==='tv'){$('#movie-season').onchange=e=>{void loadEpisodes(Number(e.target.value));};$('#movie-episode').onchange=e=>{catalogUI.episode=Number(e.target.value);window.renderCast();};$('#movie-episodes-retry').onclick=()=>loadEpisodes(catalogUI.season);}
  }else{
   const pending=catalogUI.pending,current=snapshot?.cast?.title||'the current video';
   $('#sheet-body').innerHTML='<p class="catalog-replace-copy">This will stop '+esc(current)+' on your TV and play '+esc(pending?.title||'the selected video')+'.</p><button id="movie-replace" class="primary wide">Play on TV</button><button id="movie-keep" class="catalog-back wide">Keep watching</button>';
   $('#movie-replace').onclick=()=>{if(catalogUI.pending?.replaceId!==snapshot?.cast?.id&&activeCast()){catalogUI.pending.replaceId=snapshot.cast.id;catalogChanged();return;}void startMovieSelection(catalogUI.pending,$('#movie-replace'),true);};
   $('#movie-keep').onclick=()=>{catalogUI.pending=null;catalogUI.mode=catalogUI.selected?'detail':'search';catalogUI.revision++;castScreen='player';castSheetSignature='';window.renderCast();};
  }
  if(catalogUI.mode!=='search')$('#sheet-body').scrollTop=0;
  window.remoteMotion?.present($('#sheet-body'),'catalog:'+catalogUI.mode+(catalogUI.mode==='detail'?':'+catalogKey(catalogUI.selected):''));
  if(catalogUI.mode==='search'&&previousScreen==='catalog:search'&&catalogUI.results.length)window.remoteMotion?.results($('#movie-results'));
  loadCatalogPosters();
 }
 if(catalogUI.mode==='search'){
  $('#catalog-source').disabled=!modernCatalog;$('#catalog-type').disabled=!modernCatalog;$('#catalog-source').value=searchSource;$('#catalog-type').value=searchType;$('#catalog-upgrade-help').hidden=modernCatalog;
  const current=$('#catalog-current');current.hidden=!activeCast();current.querySelector('span').textContent=(snapshot?.cast?.title||'Current video')+(snapshot?.cast?.state==='paused'?' · Paused':snapshot?.cast?.state==='playing'?' · Now playing':' · Preparing video…');
  $('#movie-search-clear').hidden=!catalogUI.draft;$('#movie-search-submit').disabled=!helperOnline||(catalogUI.busy&&catalogUI.draft.trim()===catalogUI.query);
  const status=$('#movie-search-status');status.textContent=!helperOnline?'Cannot reach your PC. Keep it awake and run Start Remote.':catalogUI.error||(catalogUI.busy?'Searching '+sourceLabels[searchSource]+'…':!catalogUI.searched?'Search by title, then choose a movie or series to preview.':catalogUI.results.length?catalogUI.results.length+' results from '+sourceLabels[searchSource]+' for “'+catalogUI.query+'”':'No titles found for “'+catalogUI.query+'”. Try another title or source.');status.classList.toggle('cast-loading',catalogUI.busy);
 }else if(catalogUI.mode==='detail'){
  const item=catalogUI.selected,tv=item.type==='tv',rating=movieRatingHTML(item,true),synopsis=item.synopsis||(catalogUI.detailBusy?'Loading description…':'No description supplied by this catalog.');
  if($('#movie-rating').innerHTML!==rating)$('#movie-rating').innerHTML=rating;
  if($('#movie-synopsis').textContent!==synopsis){$('#movie-synopsis').textContent=synopsis;if(!catalogUI.detailBusy)window.remoteMotion?.value($('#movie-synopsis'));}
  $('#movie-detail-error').textContent=catalogUI.detailError||'';$('#movie-detail-error').hidden=!catalogUI.detailError;
  if(tv){
   syncOptions($('#movie-season'),(item.seasons||[]).map(s=>({value:s.number,label:s.number===0?'Specials':String(s.number)})),catalogUI.season,'No seasons available');
   syncOptions($('#movie-episode'),catalogUI.episodes.map(e=>({value:e.number,label:e.number+' · '+e.title})),catalogUI.episode,catalogUI.episodesBusy?'Loading episodes…':'Choose an episode');
   $('#movie-season').disabled=catalogUI.detailBusy||catalogUI.resolveBusy||!item.seasons?.length;$('#movie-episode').disabled=catalogUI.resolveBusy||catalogUI.episodesBusy||!catalogUI.episodes.length;
   const help=$('#movie-episode-help');help.textContent=catalogUI.episodeError||(catalogUI.detailBusy?'Loading seasons…':catalogUI.episodesBusy?'Loading episodes…':!catalogUI.detailBusy&&!item.seasons?.length?'No seasons were supplied. Try another source.':'');help.hidden=!help.textContent;$('#movie-episodes-retry').hidden=!catalogUI.episodeError;
  }
  $('#movie-provider').disabled=catalogUI.startBusy||catalogUI.resolveBusy;$('#movie-preview-quality').disabled=catalogUI.resolveBusy;$('#movie-play').disabled=catalogUI.startBusy||catalogUI.resolveBusy||!tvEnabled()||(tv&&(catalogUI.detailBusy||catalogUI.episodesBusy||!catalogUI.episodes.some(e=>e.number===catalogUI.episode)));
  const playLabel=catalogUI.resolveBusy?'Finding on Aether…':window.movieResumeLabel?.(item,catalogUI.season,catalogUI.episode)||(tv?'Play episode on TV':'Play on TV');if(!catalogUI.startBusy&&$('#movie-play').textContent!==playLabel)$('#movie-play').innerHTML='<img src="/icons/play.svg" alt="">'+playLabel;
  $('#movie-play-help').textContent=!helperOnline?'Keep your PC awake and the helper running.':!tvEnabled()?'Connect to your TV from the remote header before playing.':'Source availability can change. Keep your PC awake while watching.';
 }else if($('#movie-replace'))$('#movie-replace').disabled=catalogUI.startBusy||!tvEnabled();
 if(anchor?.isConnected&&Number.isFinite(anchorTop))$('#sheet-body').scrollTop+=anchor.getBoundingClientRect().top-anchorTop;
};
async function searchMovies(){
 const query=$('#movie-search').value.trim();catalogUI.draft=query;if(query.length<2){catalogUI.error='Enter at least two characters.';catalogChanged();$('#movie-search').focus();return;}if(catalogUI.busy&&query===catalogUI.query)return;
 const sequence=++catalogUI.searchSequence,source=searchSource,type=searchType;document.activeElement?.blur();catalogUI.query=query;catalogUI.busy=true;catalogUI.error='';catalogUI.results=[];catalogUI.searched=true;catalogChanged();
 try{const data=await request('catalog/search',{query,source,type});if(sequence!==catalogUI.searchSequence)return;catalogUI.results=data.results.map(i=>({...i,source:i.source||source,type:i.type||'movie'}));}catch(e){if(sequence===catalogUI.searchSequence)catalogUI.error=e.message;}finally{if(sequence===catalogUI.searchSequence){catalogUI.busy=false;catalogChanged();}}
}
async function previewMovie(key){
 const item=catalogUI.results.find(i=>catalogKey(i)===key);if(!item)return;cancelCatalogResolve();catalogUI.scroll=$('#sheet-body').scrollTop;catalogUI.selected={...item};catalogUI.mode='detail';catalogUI.detailBusy=item.type==='tv';catalogUI.detailError='';catalogUI.episodes=[];catalogUI.episode=null;catalogUI.season=null;catalogUI.episodeError='';catalogUI.episodesBusy=false;catalogUI.episodeSequence++;movieProvider=item.source;const sequence=++catalogUI.detailSequence;catalogChanged();$('#sheet-title').focus({preventScroll:true});
 if(item.type!=='tv')return;
 try{const detail=await request('catalog/details',catalogIdentity(item));if(sequence!==catalogUI.detailSequence)return;Object.assign(catalogUI.selected,detail,{synopsis:detail.synopsis||catalogUI.selected.synopsis||''});if(item.type==='tv'){const seasons=catalogUI.selected.seasons||[];const first=seasons.find(s=>s.number===1)||seasons.find(s=>s.number>0)||seasons[0];if(first)void loadEpisodes(first.number);}}
 catch(e){if(sequence===catalogUI.detailSequence)catalogUI.detailError=e.message;}
 finally{if(sequence===catalogUI.detailSequence){catalogUI.detailBusy=false;window.renderCast();}}
}
async function loadEpisodes(season){
 const item=catalogUI.selected;if(!item||item.type!=='tv')return;const sequence=++catalogUI.episodeSequence;catalogUI.season=season;catalogUI.episode=null;catalogUI.episodes=[];catalogUI.episodeError='';catalogUI.episodesBusy=true;window.renderCast();
 try{const data=await request('catalog/episodes',{...catalogIdentity(item),season});if(sequence!==catalogUI.episodeSequence)return;catalogUI.episodes=data.episodes;catalogUI.episode=data.episodes[0]?.number??null;if(!data.episodes.length)catalogUI.episodeError='This season has no episodes available. Choose another season or source.';}
 catch(e){if(sequence===catalogUI.episodeSequence)catalogUI.episodeError=e.message;}
 finally{if(sequence===catalogUI.episodeSequence){catalogUI.episodesBusy=false;window.renderCast();}}
}
sheet.addEventListener('close',cancelCatalogResolve);
async function aetherPlaybackURL(item,season,episodeNumber,current){
 let target=item;
 if(item.source!=='aether'){
  const data=await request('catalog/search',{query:item.title.slice(0,100),source:'aether',type:item.type});if(!current())return null;
  const match=data.results.find(i=>String(i.id)===String(item.id)&&i.type===item.type);
  if(!match)throw Error('This title was not found on Aether. Try another playback source.');
  target=match;
  if(item.type==='tv'||!target.page){target=await request('catalog/details',{id:match.id,source:'aether',type:item.type});if(!current())return null;}
 }
 if(item.source==='aether'&&!target.page){target=await request('catalog/details',catalogIdentity(item));if(!current())return null;}
 if(!target.page)throw Error('Aether did not provide a playable page for this title. Try again or choose another source.');
 if(item.type!=='tv')return target.page;
 const selectedSeason=target.seasons?.find(s=>s.number===season);
 if(!selectedSeason?.id)throw Error('This season is not available on Aether. Choose another playback source.');
 const episodes=item.source==='aether'?catalogUI.episodes:(await request('catalog/episodes',{id:item.id,source:'aether',type:'tv',season})).episodes;if(!current())return null;
 const selectedEpisode=episodes.find(e=>e.number===episodeNumber);
 if(!selectedEpisode?.id)throw Error('This episode is not available on Aether. Choose another playback source.');
 return target.page+'/'+selectedSeason.id+'/'+selectedEpisode.id;
}
async function playCatalogSelection(restart=false){
 if(catalogUI.resolveBusy||catalogUI.startBusy)return;
 const item=catalogUI.selected;if(!item)return;
 const tv=item.type==='tv',season=catalogUI.season,episode=catalogUI.episodes.find(e=>e.number===catalogUI.episode);let url,title=item.title;
 if(tv&&!episode)return;
 if(movieProvider==='aether'){
  const sequence=++catalogUI.resolveSequence;
  const current=()=>sequence===catalogUI.resolveSequence&&sheet.open&&!sheet.dataset.closing&&sheetKind==='cast'&&castScreen==='catalog'&&catalogUI.mode==='detail'&&catalogUI.selected===item&&movieProvider==='aether';
  catalogUI.resolveBusy=true;catalogUI.detailError='';window.renderCast();
  try{url=await aetherPlaybackURL(item,season,episode?.number,current);if(!current())return;}
  catch(e){if(current())catalogUI.detailError=e.message;return;}
  finally{if(sequence===catalogUI.resolveSequence){catalogUI.resolveBusy=false;window.renderCast();}}
  if(!url)return;
 }
 else if(movieProvider==='movy')url='https://www.movy.sx/'+(tv?'tv/'+item.id+'/'+season+'/'+episode.number:'movie/'+item.id);
 else url='https://cinejoy.pk/'+(tv?'watch/tv/'+item.id+'/'+season+'/'+episode.number:'movie/'+item.id);
 if(tv)title+=' · S'+season+' E'+episode.number+' · '+episode.title;
 document.activeElement?.blur();return window.playVideoSelection({url,quality:Number(movieQuality),title,origin:'catalog',restart:restart===true,presentation:{...item,season,episode:episode?.number,episodeTitle:episode?.title||''},media:{...catalogIdentity(item),title:item.title,year:item.year||'',synopsis:item.synopsis||'',genres:item.genres||[],season,episode:episode?.number,episodeTitle:episode?.title||''}},$('#movie-play'));
}
function loadCatalogPosters(){
 for(const node of document.querySelectorAll('#sheet-body [data-poster-key]')){
  const ref=node.dataset.posterKey,[source,type,id]=ref.split('-'),size=node.dataset.size||'small',key=ref+':'+size;
  const apply=async(image,rank=size==='large'?2:1)=>{
   if(!node.isConnected||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image||''))return;
   const img=node.querySelector('img');if(img.src===image)return;
   const preload=new Image();preload.src=image;await preload.decode().catch(()=>{});if(!node.isConnected||!preload.naturalWidth||(Number(img.dataset.posterRank)||0)>rank)return;img.dataset.posterRank=String(rank);
   const first=img.classList.contains('poster-fallback');img.src=image;img.classList.remove('poster-fallback');if(first)window.remoteMotion?.poster(img);
  };
  if(catalogImages.has(key)){apply(catalogImages.get(key));continue;}if(size==='large'&&catalogImages.has(ref+':small'))apply(catalogImages.get(ref+':small'),1);let job=catalogImageJobs.get(key);
  if(!job){const slot=catalogImageNext++%3,queue=size==='large'?Promise.resolve():catalogImageQueues[slot];job=queue.then(()=>request('catalog/poster',{id,source,type,size})).then(data=>{catalogImages.set(key,data.image);while(catalogImages.size>48)catalogImages.delete(catalogImages.keys().next().value);return data.image;}).finally(()=>catalogImageJobs.delete(key));catalogImageJobs.set(key,job);if(size!=='large')catalogImageQueues[slot]=job.catch(()=>{});}void job.then(apply).catch(()=>{});
 }
}
window.playVideoSelection=async(selection,button)=>{
 if(catalogUI.startBusy)return false;
 if(activeCast()){
  catalogUI.pending={...selection,replaceId:snapshot.cast.id};catalogUI.mode='replace';castScreen='catalog';catalogChanged();$('#sheet-title').focus({preventScroll:true});return false;
 }
 return startMovieSelection(selection,button,false);
};
async function startMovieSelection(selection,button,replace){
 if(!selection||catalogUI.startBusy)return false;catalogUI.startBusy=true;window.renderCast();
 try{
  if(replace&&activeCast()){const stopped=await action('cast/control',{id:snapshot.cast.id,action:'stop'},button);if(!stopped)return false;}
  lastPlaybackOrigin=selection.origin;catalogUI.detailError='';
  const ok=await action('cast/start',selection.libraryKey?{libraryKey:selection.libraryKey,restart:selection.restart===true}:{url:selection.url,quality:selection.quality,...(selection.media?{media:selection.media,restart:selection.restart===true}:{})},button);
  if(ok){window.rememberCastSelection?.(selection,snapshot?.cast?.id);castScreen='player';castSheetSignature='';catalogUI.pending=null;catalogUI.mode=catalogUI.selected?'detail':'search';catalogUI.revision++;}
  else{const error=$('#sheet-notice').textContent;castScreen=selection.origin==='link'?'link':'catalog';catalogUI.pending=null;catalogUI.mode=catalogUI.selected?'detail':'search';catalogUI.revision++;if(selection.origin==='catalog')catalogUI.detailError=error;}
  window.renderCast();return ok;
 }finally{catalogUI.startBusy=false;window.renderCast();}
}
window.catalogPlaybackFailed=message=>{catalogUI.detailError=message;catalogUI.mode=catalogUI.selected?'detail':'search';if(!catalogUI.selected)catalogUI.error=message;catalogUI.revision++;};

window.browseMovies=()=>{cancelCatalogResolve();catalogUI.mode='search';catalogUI.revision++;castScreen='catalog';window.renderCast();};
