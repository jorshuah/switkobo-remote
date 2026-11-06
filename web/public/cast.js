'use strict';
// Uses the existing authenticated connection and sheet; never stores source sessions in the PWA.
let movieQuality=storage.get('remote-movie-quality')||'480';
let castScreen='catalog',lastPlaybackOrigin='catalog';
let movieDraft='',castSheetSignature='',castSubmitting=false,seekEditing=false,castReadySession=null,castPresentation=null,castPendingAction=null;
window.rememberCastSelection=(selection,id)=>{const item=selection.presentation||selection.media||null;castPresentation={id,item,title:item?.title||(selection.title!=='the selected video'?selection.title:'')||''};};
function renderCastOpening(cast){
 const info=castPresentation?.id===cast.id?castPresentation:null,item=info?.item;
 $('#cast-opening-title').textContent=info?.title||cast.title||'Getting your video ready';
 const details=[item?.year,item?.type==='tv'&&item.season!==undefined?'Season '+item.season+(item.episode!==undefined?' · Episode '+item.episode:''):'',item?.episodeTitle].filter(Boolean);
 $('#cast-opening-meta').textContent=details.join(' · ');$('#cast-opening-meta').hidden=!details.length;
 const art=$('#cast-opening-art'),key=item?.poster&&item.id&&item.source?catalogKey(item):'';
 if(art.dataset.key!==key||!art.firstElementChild){art.dataset.key=key;art.classList.toggle('has-poster',Boolean(key));if(key){art.dataset.posterKey=key;art.dataset.size='large';}else{delete art.dataset.posterKey;delete art.dataset.size;}art.innerHTML='<img class="poster-fallback" src="/icons/'+(key?'film':'tv')+'.svg" alt="">';window.loadCatalogPosters?.();}
 $('#cast-opening-help').textContent=helperOnline?'Playback will start on '+(snapshot.profile?.name||'your TV')+'.':'Keep your PC awake and reconnect to continue.';
 $('#cast-opening-progress').setAttribute('aria-valuetext',helperOnline?(cast.message||'Preparing video'):'Waiting for the PC');$('#cast-opening-progress').classList.toggle('is-waiting',!helperOnline);
}
function renderPlayerIdentity(cast){
 const item=(castPresentation?.id===cast.id?castPresentation.item:null)||window.playbackPresentation?.(cast);
 $('#cast-title').textContent=item?.title||cast.title||'Video';
 const details=[item?.year,item?.type==='tv'&&item.season!==undefined?'Season '+item.season+(item.episode!==undefined?' · Episode '+item.episode:''):'',item?.episodeTitle].filter(Boolean);
 $('#cast-player-meta').textContent=details.join(' · ');$('#cast-player-meta').hidden=!details.length;
 $('#cast-player-device').textContent=(snapshot.profile?.name||'Your TV')+(cast.quality?' · '+cast.quality+'p':'');
 const art=$('#cast-player-art'),key=item?.poster&&item.id&&item.source?catalogKey(item):'';
 if(art.dataset.key!==key||!art.firstElementChild){art.dataset.key=key;art.classList.toggle('has-poster',Boolean(key));if(key){art.dataset.posterKey=key;art.dataset.size='large';}else{delete art.dataset.posterKey;delete art.dataset.size;}art.innerHTML='<img class="poster-fallback" src="/icons/'+(key?'film':'tv')+'.svg" alt="">';window.loadCatalogPosters?.();}
}
function updateSeekPreview(value,duration){
 const seek=$('#cast-seek'),position=Math.max(0,Math.min(Number(duration)||0,Number(value)||0));
 seek.style.setProperty('--cast-progress',((duration>0?position/duration:0)*100)+'%');
 $('#cast-elapsed').textContent=castTime(position);seek.setAttribute('aria-valuetext',castTime(position)+' of '+castTime(duration));
}
const activeCast=()=>['loading','buffering','playing','paused'].includes(snapshot?.cast?.state);
const castTime=value=>{const n=Math.floor(Math.max(0,Number(value)||0));return (n>=3600?Math.floor(n/3600)+':':'')+String(Math.floor(n/60)%60).padStart(n>=3600?2:1,'0')+':'+String(n%60).padStart(2,'0');};
function openCast(){
  castScreen=activeCast()?'player':'catalog';castSheetSignature='';openSheet('cast',activeCast()?'Now playing':'Find a movie','');window.renderCast();
}
$('#play-on-tv').onclick=openCast;
$('#catalog-paste').onclick=()=>{document.activeElement?.blur();castScreen='link';castSheetSignature='';window.renderCast();};
window.renderCast=function(){
  window.refreshPickers?.();
  const cast=snapshot?.cast||{state:'idle'},active=activeCast(),ready=['playing','paused'].includes(cast.state);if(ready)castReadySession=cast.id;
  $('#play-on-tv').disabled=!helperOnline;
  $('#cast-entry-title').textContent=active?(cast.title||(castPresentation?.id===cast.id?castPresentation.title:'')||'Play on TV'):'Play on TV';
  $('#cast-entry-status').textContent=active?(!helperOnline?'PC not reachable':cast.state==='playing'?'Playing on TV':cast.state==='paused'?'Paused':cast.message||'Preparing movie…'):'Find a movie to watch';
  if(sheetKind!=='cast'||!sheet.open)return;
  if(!active&&castScreen==='player'){castScreen=lastPlaybackOrigin==='link'?'link':'catalog';if(cast.state==='error'&&lastPlaybackOrigin==='catalog')window.catalogPlaybackFailed?.(cast.message);}
  if(castScreen==='subtitles'){if(active){window.renderSubtitles?.();return;}castScreen='catalog';castSheetSignature='';}
  if(castScreen==='catalog'){window.renderCatalog?.();return;}
  const player=castScreen==='player'&&active,opening=player&&!ready&&castReadySession!==cast.id;
  const signature=player?cast.id+'player':'form';
  window.remoteMotion?.prepare($('#sheet-body'),player?(opening?'cast:opening:':'cast:player:')+cast.id:'cast:link');
  if(signature!==castSheetSignature){
    castSheetSignature=signature;seekEditing=false;$('#sheet-notice').hidden=true;
    $('#sheet-title').textContent=player?(opening?'Play on TV':'Now playing'):'Use a video link';
    if(!player){
      $('#sheet-body').innerHTML='<button id="catalog-return" class="catalog-back"><img src="/icons/arrow-left.svg" alt="">Back to movies</button><p class="cast-intro">Paste the page link for the video you want to watch.</p><form id="cast-form" novalidate><label for="movie-link">Video link</label><input id="movie-link" name="movie" type="url" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="https://cinejoy.pk/movie/…" required maxlength="4096" value="'+esc(movieDraft)+'"><label for="movie-quality">Video quality</label><select id="movie-quality"><option value="480">Up to 480p · Less buffering</option><option value="720">Up to 720p · HD</option><option value="1080">Up to 1080p · Full HD</option></select><p id="cast-form-message" class="help" role="status"></p><button id="cast-start" class="primary wide" type="submit"><img src="/icons/play.svg" alt="">Play on TV</button></form><p class="cast-footnote">Keep your PC awake while watching.</p>';
      $('#catalog-return').onclick=()=>{castScreen='catalog';castSheetSignature='';window.renderCast();};
      $('#movie-quality').value=['480','720','1080'].includes(movieQuality)?movieQuality:'480';
      $('#movie-quality').onchange=event=>{movieQuality=event.target.value;storage.set('remote-movie-quality',movieQuality);};
      $('#movie-link').oninput=event=>{movieDraft=event.target.value;};
      $('#cast-form').onsubmit=async event=>{
        event.preventDefault();if(castSubmitting)return;castSubmitting=true;movieDraft=$('#movie-link').value;
        try{await window.playVideoSelection({url:movieDraft,quality:Number(movieQuality),title:'the selected video',origin:'link'},$('#cast-start'));}finally{castSubmitting=false;window.renderCast();}
      };
    }else{
      $('#sheet-body').innerHTML=`<div class="cast-playing">
        <section id="cast-opening" class="cast-opening" aria-labelledby="cast-opening-title" hidden><div id="cast-opening-art" class="cast-opening-art"></div><h3 id="cast-opening-title"></h3><p id="cast-opening-meta"></p><div id="cast-opening-status-slot"></div><div id="cast-opening-progress" class="cast-opening-progress" role="progressbar" aria-label="Preparing video"><span></span></div><p id="cast-opening-help"></p></section>
        <section id="cast-player-identity" class="cast-player-identity" aria-labelledby="cast-title"><div id="cast-player-art" class="cast-player-art" aria-hidden="true"></div><div class="cast-player-copy"><h3 id="cast-title"></h3><p id="cast-player-meta"></p><p id="cast-player-device"></p></div></section>
        <p id="cast-status" class="cast-status" role="status"></p>
        <div id="cast-timeline"><label class="sr-only" for="cast-seek">Movie position</label><input id="cast-seek" type="range" min="0" max="1" step="1" value="0"><div class="cast-times"><output id="cast-elapsed" for="cast-seek" aria-live="off">0:00</output><span id="cast-duration">0:00</span></div>
          <div class="cast-transport" role="group" aria-label="Playback controls"><button id="cast-rewind" aria-label="Back 10 seconds"><img src="/icons/rotate-ccw.svg" alt=""><span>10</span></button><button id="cast-toggle" class="primary" aria-label="Pause movie"><img src="/icons/pause.svg" alt=""></button><button id="cast-forward" aria-label="Forward 10 seconds"><img src="/icons/rotate-cw.svg" alt=""><span>10</span></button></div>
          <div class="cast-subtitles"><label class="sr-only" for="cast-quality">Video quality</label><select id="cast-quality" data-inline-label="true" aria-describedby="cast-quality-help"></select></div><p id="cast-quality-help" class="help"></p>
          <div class="cast-subtitles"><label class="sr-only" for="cast-subtitle">Subtitles</label><select id="cast-subtitle" data-inline-label="true"><option value="off">Off</option></select></div><p id="cast-subtitle-help" class="help" hidden></p><button id="cast-subtitle-tools" class="subtitle-text-action">Find subtitles &amp; adjust timing<img src="/icons/chevron-right.svg" alt=""></button>
          <div class="cast-volume" role="group" aria-labelledby="cast-volume-label"><span id="cast-volume-label">Volume</span><button id="cast-mute" aria-label="Mute or unmute TV"><img src="/icons/volume-x.svg" alt=""></button><button id="cast-volume-down" aria-label="Lower TV volume"><img src="/icons/minus.svg" alt=""></button><button id="cast-volume-up" aria-label="Raise TV volume"><img src="/icons/plus.svg" alt=""></button></div><p id="cast-volume-help" class="help" hidden>Connect the TV remote to adjust volume.</p>
        </div>
        <div class="cast-secondary"><button id="cast-browse" class="catalog-back"><img src="/icons/search.svg" alt="">Find another movie</button><button id="cast-stop">Stop playback</button></div><p class="cast-footnote">Keep your PC awake. Playback continues when you close this sheet.</p><p id="cast-progress-warning" class="help" role="status" hidden></p>
      </div>`;
      $('#cast-seek').oninput=event=>{seekEditing=true;updateSeekPreview(event.target.value,snapshot.cast.duration);};
      $('#cast-seek').onpointercancel=()=>{seekEditing=false;window.renderCast();};
      $('#cast-seek').onchange=event=>{const position=Number(event.target.value);seekEditing=false;void castCommand({action:'seek',position},event.target);};
      $('#cast-toggle').onclick=event=>castCommand({action:snapshot.cast.state==='paused'?'play':'pause'},event.currentTarget);
      $('#cast-rewind').onclick=event=>castCommand({action:'seek',position:Math.max(0,snapshot.cast.position-10)},event.currentTarget);
      $('#cast-forward').onclick=event=>castCommand({action:'seek',position:Math.min(snapshot.cast.duration-1,snapshot.cast.position+10)},event.currentTarget);
      $('#cast-subtitle-tools').onclick=()=>window.openSubtitleTools?.();
      $('#cast-subtitle').onchange=event=>castCommand({action:'subtitle',subtitle:event.target.value},event.target);
      $('#cast-quality').onchange=event=>{const quality=Number(event.target.value);void castCommand({action:'quality',quality},event.target).then(ok=>{if(ok&&[480,720,1080].includes(quality)){movieQuality=String(quality);storage.set('remote-movie-quality',movieQuality);}});};
      for(const [id,key]of [['cast-mute','MUTE'],['cast-volume-down','VOLDOWN'],['cast-volume-up','VOLUP']])$('#'+id).onclick=event=>action('key',{key},event.currentTarget);
      $('#cast-browse').onclick=()=>window.browseMovies();
      $('#cast-stop').onclick=event=>castCommand({action:'stop'},event.currentTarget);
    }
    if(player)$('#sheet-title').focus({preventScroll:true});else window.remoteMotion?.present($('#sheet-body'),'cast:link');
  }
  if(!player){
    $('#cast-start').disabled=castSubmitting||!helperOnline||!tvEnabled();
    $('#cast-form-message').textContent=!helperOnline?'Cannot reach your PC. Keep it awake and run Start Remote.':!tvEnabled()?'Turn on and connect to your TV first.':cast.state==='error'?cast.message:cast.state==='ended'?'Movie finished.':cast.state==='stopped'?cast.message:'';
    return;
  }
  $('#sheet-title').textContent=opening?'Play on TV':'Now playing';
  $('.cast-playing').classList.toggle('is-opening',opening);$('#cast-opening').hidden=!opening;$('#cast-player-identity').hidden=opening;$('#cast-browse').hidden=opening;
  const statusHost=opening?$('#cast-opening-status-slot'):$('.cast-playing');
  if($('#cast-status').parentElement!==statusHost){if(opening)statusHost.append($('#cast-status'));else $('#cast-player-identity').after($('#cast-status'));}
  if(opening)renderCastOpening(cast);else renderPlayerIdentity(cast);
  if($('#cast-progress-warning')){$('#cast-progress-warning').textContent=snapshot.library?.warning||'';$('#cast-progress-warning').hidden=!snapshot.library?.warning;}
  const pending=castPendingAction?.id===cast.id?castPendingAction:null;
  const pendingMessage=pending?({pause:'Pausing…',play:'Resuming…',seek:'Seeking to '+castTime(pending.position)+'…',subtitle:'Changing subtitles…',quality:'Preparing '+pending.quality+'p video…',stop:'Stopping playback…'})[pending.action]:'';
  const statusMessage=!helperOnline?'PC not reachable':pendingMessage||cast.transitionError||(cast.busy&&cast.message?cast.message:cast.state==='playing'?'Playing':cast.state==='paused'?'Paused':cast.message||'Preparing movie…');
  if($('#cast-status').textContent!==statusMessage)$('#cast-status').textContent=statusMessage;
  $('#cast-status').classList.toggle('cast-loading',Boolean((!ready||pending||cast.busy)&&helperOnline&&!opening));
  $('#cast-timeline').hidden=opening||!cast.title;
  $('#cast-stop').textContent=opening?'Cancel':'Stop playback';
  $('#cast-stop').disabled=!helperOnline||pending?.action==='stop'||$('#cast-stop').dataset.busy==='true';
  const seek=$('#cast-seek');seek.max=Math.floor(cast.duration||1);
  if(!seekEditing){seek.value=Math.floor(pending?.action==='seek'?pending.position:cast.position||0);updateSeekPreview(seek.value,cast.duration);}
  $('#cast-duration').textContent=castTime(cast.duration);
  $('#cast-toggle').setAttribute('aria-label',cast.state==='paused'?'Resume movie':'Pause movie');
  $('#cast-toggle img').src='/icons/'+(cast.state==='paused'?'play':'pause')+'.svg';
  for(const el of [seek,$('#cast-toggle'),$('#cast-rewind'),$('#cast-forward')])el.disabled=!helperOnline||!ready||cast.busy||Boolean(pending)||el.dataset.busy==='true'||el!==$('#cast-toggle')&&!(cast.duration>0);
  const quality=$('#cast-quality'),qualities=cast.qualities?.length?cast.qualities:cast.quality?[cast.quality]:[],qualitySignature=JSON.stringify(qualities);
  if(quality.dataset.qualities!==qualitySignature){quality.dataset.qualities=qualitySignature;quality.innerHTML=qualities.map(h=>'<option value="'+Number(h)+'">'+Number(h)+'p'+(h===720?' · HD':h===1080?' · Full HD':'')+'</option>').join('');}
  quality.value=String(cast.quality||'');quality.disabled=!helperOnline||!ready||cast.busy||Boolean(pending)||qualities.length<2;
  $('#cast-quality-help').textContent=!Array.isArray(cast.qualities)?'Restart the PC helper to change quality while watching.':qualities.length>1?'Changing quality briefly reloads the video at your current position.':'This stream offers one video quality.';
  const subtitles=$('#cast-subtitle'),tracks=cast.subtitles||[],trackSignature=JSON.stringify(tracks);
  if(subtitles.dataset.tracks!==trackSignature){subtitles.dataset.tracks=trackSignature;subtitles.innerHTML='<option value="off">Off</option>'+tracks.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.label)+'</option>').join('');}
  subtitles.value=pending?.action==='subtitle'?pending.subtitle:cast.subtitle||'off';subtitles.disabled=!helperOnline||!ready||cast.busy||Boolean(pending)||!tracks.length;
  $('#cast-subtitle-help').hidden=tracks.length>0;
  $('#cast-subtitle-help').textContent=cast.subtitleStatus==='loading'?'Checking subtitles… The movie can play while this finishes.':!ready?'Checking subtitles while the video opens…':cast.subtitleStatus==='failed'?'Subtitle files could not be loaded. Try another playback source.':'This stream does not include subtitle tracks. Try another playback source.';
  for(const id of ['cast-mute','cast-volume-down','cast-volume-up']){const b=$('#'+id);b.disabled=!tvEnabled()||b.dataset.busy==='true';}
  $('#cast-volume-help').hidden=tvEnabled();
  window.remoteMotion?.present($('#sheet-body'),(opening?'cast:opening:':'cast:player:')+cast.id);
};
async function castCommand(data,button){
  const id=snapshot?.cast?.id;if(!id||castPendingAction?.id===id&&(data.action!=='stop'||castPendingAction.action==='stop'))return;
  let accepted=false;const pending={...data,id};castPendingAction=pending;window.renderCast();
  if(button){button.dataset.busy='true';button.classList.add('pending');button.disabled=true;}inFlight++;
  // Stop may supersede a pending change. Never let its late reply restore an old session.
  try{const result=await request('cast/control',{...data,id});if(castPendingAction===pending&&snapshot?.cast?.id===id){saveSnapshot(result);accepted=true;}}
  catch(error){if(castPendingAction===pending&&snapshot?.cast?.id===id)notify(error.message,{error:true});}
  finally{inFlight--;if(button){delete button.dataset.busy;button.classList.remove('pending');}if(castPendingAction===pending)castPendingAction=null;render();}
  return accepted;
}
window.renderCast();
