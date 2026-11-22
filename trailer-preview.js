(() => {
  'use strict';

  // A single trailer dialog is shared by Discover and Hidden Match.
  // Autoplay must start muted for mobile browser compatibility. The YouTube
  // player keeps its controls so viewers can unmute or press play manually.
  const overlay=document.getElementById('frameTrailerOverlay');
  if (!overlay) return;

  const node=id=>document.getElementById(id);
  const player=node('frameTrailerPlayer');
  const status=node('frameTrailerStatus');
  const playButton=node('frameTrailerPlay');
  const videoBox=node('frameTrailerVideo');
  let activeIframe=null,playerTimeout=null,playFallback=null;
  const meta=node('frameTrailerMeta');
  const description=node('frameTrailerDescription');
  let current=null;
  let previewRequest=null;
  let metaRequest=null;
  let lastFocus=null;
  let openedAt=0;
  let seq=0;

  const posterUrl=value=> {
    const path=String(value||'');
    return /^\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(path)
      ? 'https://image.tmdb.org/t/p/w780'+path : null;
  };
  const getTitle=(item)=>String(item?.title||'Film oder Serie').slice(0,160);
  const isMedia=item=>['movie','series'].includes(item?.type) && (
    (Number.isSafeInteger(Number(item?.tmdbId)) && Number(item.tmdbId)>0) ||
    (typeof item?.title==='string' && item.title.trim().length>0)
  );

  function showStatus(message) {
    status.textContent=message;
    status.hidden=false;
  }
  function stopPlayer() {
    // Keep poster during loading, stop remote playback on close or next trailer.
    clearTimeout(playerTimeout);clearTimeout(playFallback);
    playerTimeout=null;playFallback=null;
    activeIframe=null;
    videoBox.classList.remove('is-playing');
    player.replaceChildren();
    player.hidden=true;
    playButton.hidden=true;
  }
  function revealPlayer(){
    if(overlay.hidden||!activeIframe)return;
    clearTimeout(playerTimeout);clearTimeout(playFallback);
    videoBox.classList.add('is-playing');
    playButton.hidden=true;status.hidden=true;
  }
  // The iframe can report that it is truly playing via the official YouTube
  // postMessage player events. Until then the verified movie still stays visible.
  window.addEventListener('message',event=>{
    if(!['https://www.youtube-nocookie.com','https://www.youtube.com'].includes(event.origin))return;
    if(!activeIframe||event.source!==activeIframe.contentWindow||overlay.hidden)return;
    let data=event.data;
    try{if(typeof data==='string')data=JSON.parse(data);}catch{return;}
    if(!data||typeof data!=='object')return;
    if((data.event==='onStateChange'&&Number(data.info)===1)||
       (data.event==='infoDelivery'&&Number(data.info?.playerState)===1))
      revealPlayer();
  });
  function cleanupRequests() {
    if(previewRequest)previewRequest.abort();
    if(metaRequest)metaRequest.abort();
    previewRequest=null;
    metaRequest=null;
  }

  function close({restoreFocus=true}={}) {
    const wasOpen=!overlay.hidden;
    ++seq;
    cleanupRequests();
    stopPlayer();
    overlay.hidden=true;
    document.body.classList.remove('frame-trailer-open');
    current=null;
    description.hidden=true;
    description.textContent='';
    if(restoreFocus && wasOpen && lastFocus?.isConnected){
      try {lastFocus.focus({preventScroll:true});}catch{}
    }
    lastFocus=null;
  }


  // A concise plot summary, sourced from the card or the German TMDB detail response.
  function renderDescription(value,{loading=false}={}) {
    const raw=String(value||'').replace(/\s+/g,' ').trim();
    const isFallback=/^(?:Noch keine (?:ausführliche |Kurz)?Beschreibung verfügbar\.?|Keine (?:ausführliche |Kurz)?Beschreibung verfügbar\.?)$/i.test(raw);
    const valid=isFallback?'':raw;
    const maxLength=400;
    let text=valid;
    if(text.length>maxLength){
      const breakAt=text.lastIndexOf(' ',maxLength);
      text=text.slice(0,breakAt>maxLength*0.75?breakAt:maxLength).trimEnd()+'…';
    }
    description.textContent=text || (loading?'Kurzbeschreibung wird geladen …':'Keine Kurzbeschreibung verfügbar.');
    description.hidden=false;
  }

  function renderMeta(details={}) {
    if(!current)return;
    const pieces=[current.type==='movie'?'Film':'Serie'];
    const genre=(details.facts||[]).find(x=>x && x.label==='Genres');
    const genres=String((genre && genre.value)||current.genreHint||'').split(/[·,/]/).map(s=>s.trim()).filter(Boolean).slice(0,2);
    if(genres.length)pieces.push(genres.join(' / '));
    const primary=String(details.primaryMeta||'').trim();
    if(current.type==='movie'){
      const x=/^([0-9]{1,3}) *min$/i.exec(primary);
      if(x){
        const m=Number(x[1]),h=Math.floor(m/60);
        if(m>0)pieces.push(h?h+'h'+(m%60?' '+m%60+'min':''):m+'min');
      }
    }else if(/^[0-9]{1,3} +Staffel(n)?$/i.test(primary))pieces.push(primary);
    if(/^[0-9]{4}$/.test(String(current.year||'')))pieces.push(String(current.year));
    meta.textContent=pieces.join(' · ');
  }

  function loadMeta(token){
    if(!current?.tmdbId || metaRequest)return;
    metaRequest=new AbortController();
    fetch('/api/details?type='+encodeURIComponent(current.type)+'&id='+current.tmdbId,{
      headers:{accept:'application/json'},signal:metaRequest.signal
    }).then(async response=>{
      const data=await response.json().catch(()=>({}));
      if(!response.ok || !data.details)throw new Error('Filmdaten nicht erreichbar.');
      return data.details;
    }).then(details=>{
      if(token!==seq || overlay.hidden)return;
      renderMeta(details);
      renderDescription(details.description || current.descriptionHint);
    }).catch(error=>{
      if(error.name!=='AbortError' && token===seq){
        renderDescription(current?.descriptionHint);
        console.warn('[FRAME TRAILER]',error.message);
      }
    }).finally(()=>{if(token===seq)metaRequest=null;});
  }

  function open(item) {
    if(!isMedia(item))return false;

    close({restoreFocus:false});
    const token=++seq;
    const title=getTitle(item);
    current={
      id:item.id||null,
      title, type:item.type,
      tmdbId:Number.isSafeInteger(Number(item.tmdbId))&&Number(item.tmdbId)>0?Number(item.tmdbId):null,
      poster:item.poster||null,
      year:item.year||null,
      genreHint:typeof item.subtitle==='string' && !/^(film|serie)$/i.test(item.subtitle.trim())?item.subtitle.trim():'',
      descriptionHint:typeof (item.blurb||item.description)==='string'?(item.blurb||item.description):'',
      video:null
    };
    lastFocus=document.activeElement;
    stopPlayer();
    node('frameTrailerType').textContent=item.type==='movie'?'FILM · TRAILER':'SERIE · TRAILER';
    node('frameTrailerTitle').textContent=title;
    renderMeta();
    renderDescription(current.descriptionHint,{loading:Boolean(current.tmdbId)});
    const poster=posterUrl(current.poster);
    node('frameTrailerPoster').style.backgroundImage=poster?'url("'+poster+'")':'';
    showStatus('Trailer wird gesucht …');
    overlay.hidden=false;
    openedAt=Date.now();
    document.body.classList.add('frame-trailer-open');
    node('frameTrailerClose').focus({preventScroll:true});
    if(current.tmdbId)loadMeta(token);
    try {navigator.vibrate?.(10);}catch{}

    previewRequest=new AbortController();
    const params=new URLSearchParams({type:item.type});
    if(current.tmdbId) {
      params.set('id',String(current.tmdbId));
    } else {
      params.set('title',title);
      if(/^\d{4}$/.test(String(item.year||'')))params.set('year',String(item.year));
    }
    fetch('/api/trailer?'+params.toString(),{
      headers:{accept:'application/json'},
      signal:previewRequest.signal
    }).then(async response=>{
      const data=await response.json().catch(()=>({}));
      if(!response.ok || !data.ok)throw new Error(data.message||'Trailer-Dienst nicht erreichbar.');
      return data;
    }).then(data=>{
      if(token!==seq || overlay.hidden)return;
      const key=String(data.video?.key||'');
      if(Number.isSafeInteger(Number(data.tmdbId))&&Number(data.tmdbId)>0) {
        const previousId=current.tmdbId;
        current.tmdbId=Number(data.tmdbId);
        if(!metaRequest && previousId!==current.tmdbId)loadMeta(token);
      }
      if(data.available && /^[a-zA-Z0-9_-]{11}$/.test(key)){
        current.video={key,language:data.video.language,official:data.video.official};
        // TMDB answers asynchronously, after the initial long press. Muted
        // YouTube autoplay is allowed on most iPhones; audible autoplay isn't.
        // Built-in YouTube controls remain the fallback if autoplay is blocked.
        play({muted:true});
      }else{
        showStatus('Für diesen Titel ist derzeit kein Trailer verfügbar.');
      }
    }).catch(error=>{
      if(error.name==='AbortError' || token!==seq)return;
      showStatus('Trailer sind gerade nicht erreichbar.');
      console.warn('[FRAME TRAILER]',error.message);
    }).finally(()=>{
      if(token===seq)previewRequest=null;
    });

    return true;
  }

  function play({muted=false}={}) {
    if(!current?.video || overlay.hidden)return;
    const {key}=current.video;
    if(!/^[a-zA-Z0-9_-]{11}$/.test(key))return;
    clearTimeout(playerTimeout);clearTimeout(playFallback);
    videoBox.classList.remove('is-playing');
    showStatus('Trailer wird geladen …');
    playButton.hidden=true;
    const iframe=document.createElement('iframe');
    iframe.title='Trailer zu '+current.title;
    iframe.id='frameTrailerIframe';
    iframe.loading='eager';
    iframe.src='https://www.youtube-nocookie.com/embed/'+key+
      '?autoplay=1&playsinline=1&controls=1&rel=0&enablejsapi=1'+
      '&origin='+encodeURIComponent(location.origin)+
      '&mute='+(muted?'1':'0');
    iframe.allow='accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.referrerPolicy='strict-origin-when-cross-origin';
    iframe.setAttribute('allowfullscreen','');
    activeIframe=iframe;
    iframe.addEventListener('load',()=>{
      if(activeIframe!==iframe||overlay.hidden||videoBox.classList.contains('is-playing'))return;
      showStatus('Trailer bereit – bei Bedarf manuell starten.');
      playButton.hidden=false;
      // Register for onStateChange; keep the poster above the iframe until
      // YouTube actually reports that playback has started.
      try{iframe.contentWindow?.postMessage(JSON.stringify({
        event:'listening',id:'frameTrailerIframe'
      }),'https://www.youtube-nocookie.com');}catch{}
    });
    player.replaceChildren(iframe);
    player.hidden=false;
    playerTimeout=setTimeout(()=>{
      if(overlay.hidden||activeIframe!==iframe||videoBox.classList.contains('is-playing'))return;
      showStatus('Trailer starten, wenn die automatische Wiedergabe nicht beginnt.');
      playButton.hidden=false;
    },5000);
  }
  playButton.addEventListener('click',()=>{
    if(!activeIframe||overlay.hidden)return;
    try{activeIframe.contentWindow?.postMessage(JSON.stringify({
      event:'command',func:'playVideo',args:[]
    }),'https://www.youtube-nocookie.com');}catch{}
    showStatus('Trailer startet …');
    playButton.hidden=true;
    // If the provider sends no playback events, reveal native controls so
    // the viewer can start playback directly inside YouTube.
    clearTimeout(playFallback);
    playFallback=setTimeout(()=>{if(!overlay.hidden)revealPlayer();},1800);
  });

  node('frameTrailerClose').addEventListener('click',()=>close());
  node('frameTrailerBack').addEventListener('click',()=>close());
  node('frameTrailerWatched')?.addEventListener('click',()=>{
    if(!current)return;
    const item={...current,blurb:current.descriptionHint||''};
    close({restoreFocus:false});
    window.FrameWatched?.open(item);
  });

  overlay.addEventListener('pointerdown',event=>event.stopPropagation());
  overlay.addEventListener('pointerup',event=>event.stopPropagation());
  overlay.addEventListener('click',event=>{
    // Ignore any delayed synthetic click from the tap that opened the dialog.
    if(event.target===overlay && Date.now()-openedAt>450)close();
  });
  overlay.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      event.preventDefault();
      close();
      return;
    }
    if(event.key!=='Tab')return;
    const focusable=[...overlay.querySelectorAll('button:not([hidden]):not([disabled])')]
      .filter(element=>element.getClientRects().length);
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){
      event.preventDefault();last.focus();
    }else if(!event.shiftKey&&document.activeElement===last){
      event.preventDefault();first.focus();
    }
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden && !overlay.hidden)close({restoreFocus:false});
  });
  document.addEventListener('frame:view-changed',()=>{
    if(!overlay.hidden)close({restoreFocus:false});
  });

  window.FrameTrailer=Object.freeze({open,close,isOpen:()=>!overlay.hidden});
})();
