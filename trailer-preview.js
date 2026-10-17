(() => {
  'use strict';

  // A single trailer dialog is shared by Discover and Hidden Match.
  // TMDB metadata is fetched from FRAME's server; YouTube is loaded only
  // when the viewer explicitly presses the play button (works on iOS).
  const overlay=document.getElementById('frameTrailerOverlay');
  if (!overlay) return;

  const node=id=>document.getElementById(id);
  const player=node('frameTrailerPlayer');
  const status=node('frameTrailerStatus');
  const playButton=node('frameTrailerPlay');
  const detailsButton=node('frameTrailerDetails');
  const facts=node('frameTrailerFacts');
  let current=null;
  let previewRequest=null;
  let detailsRequest=null;
  let lastFocus=null;
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
    // Removing the iframe immediately stops video and audio on iPhones.
    player.replaceChildren();
    player.hidden=true;
  }
  function cleanupRequests() {
    if(previewRequest)previewRequest.abort();
    if(detailsRequest)detailsRequest.abort();
    previewRequest=null;
    detailsRequest=null;
  }

  function close({restoreFocus=true}={}) {
    const wasOpen=!overlay.hidden;
    ++seq;
    cleanupRequests();
    stopPlayer();
    overlay.hidden=true;
    document.body.classList.remove('frame-trailer-open');
    current=null;
    facts.hidden=true;
    facts.replaceChildren();
    if(restoreFocus && wasOpen && lastFocus?.isConnected){
      try {lastFocus.focus({preventScroll:true});}catch{}
    }
    lastFocus=null;
  }

  function open(item,{onDetails}={}) {
    if(!isMedia(item))return false;

    close({restoreFocus:false});
    const token=++seq;
    const title=getTitle(item);
    current={
      title, type:item.type,
      tmdbId:Number.isSafeInteger(Number(item.tmdbId))&&Number(item.tmdbId)>0?Number(item.tmdbId):null,
      poster:item.poster||null,
      year:item.year||null,
      video:null,
      onDetails:typeof onDetails==='function'?onDetails:null
    };
    lastFocus=document.activeElement;
    stopPlayer();
    facts.hidden=true;
    facts.replaceChildren();
    playButton.hidden=true;
    detailsButton.hidden=false;
    detailsButton.disabled=false;
    detailsButton.textContent='Mehr Infos';
    node('frameTrailerType').textContent=item.type==='movie'?'FILM · TRAILER':'SERIE · TRAILER';
    node('frameTrailerTitle').textContent=title;
    node('frameTrailerIntro').textContent='Schau kurz rein und entscheide anschließend in Ruhe.';
    const poster=posterUrl(current.poster);
    node('frameTrailerPoster').style.backgroundImage=poster?'url("'+poster+'")':'';
    showStatus('Trailer wird gesucht …');
    overlay.hidden=false;
    document.body.classList.add('frame-trailer-open');
    node('frameTrailerClose').focus({preventScroll:true});
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
        current.tmdbId=Number(data.tmdbId);
      }
      if(data.available && /^[a-zA-Z0-9_-]{11}$/.test(key)){
        current.video={key,language:data.video.language,official:data.video.official};
        playButton.hidden=false;
        const language=data.video.language==='de'?'Deutsch':data.video.language==='en'?'Englisch':'Originalsprache';
        showStatus('Trailer gefunden · '+language);
        node('frameTrailerIntro').textContent='Bereit zum Abspielen. Deine Bewertung bleibt unverändert.';
      }else{
        showStatus('Für diesen Titel ist derzeit kein Trailer verfügbar.');
        node('frameTrailerIntro').textContent='Du kannst dir stattdessen die Filminfos ansehen.';
      }
    }).catch(error=>{
      if(error.name==='AbortError' || token!==seq)return;
      showStatus('Trailer sind gerade nicht erreichbar.');
      node('frameTrailerIntro').textContent='Du kannst weiterhin die Filminfos öffnen.';
      console.warn('[FRAME TRAILER]',error.message);
    }).finally(()=>{
      if(token===seq)previewRequest=null;
    });

    return true;
  }

  function play() {
    if(!current?.video || overlay.hidden)return;
    const {key}=current.video;
    if(!/^[a-zA-Z0-9_-]{11}$/.test(key))return;
    const iframe=document.createElement('iframe');
    iframe.title='Trailer zu '+current.title;
    iframe.src='https://www.youtube-nocookie.com/embed/'+key+'?autoplay=1&playsinline=1&rel=0';
    iframe.allow='accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.referrerPolicy='strict-origin-when-cross-origin';
    iframe.setAttribute('allowfullscreen','');
    player.replaceChildren(iframe);
    player.hidden=false;
    status.hidden=true;
    playButton.hidden=true;
  }

  function showDetails() {
    if(!current || overlay.hidden)return;
    if(current.onDetails){
      const callback=current.onDetails;
      close();
      try{callback();}catch(error){console.warn('[FRAME TRAILER]',error);}
      return;
    }
    if(detailsRequest)return;
    if(!current.tmdbId){
      facts.replaceChildren();
      const p=document.createElement('p');
      p.className='frame-trailer-description';
      p.textContent='Für diesen Titel sind gerade keine zusätzlichen Informationen verfügbar.';
      facts.appendChild(p);
      facts.hidden=false;
      detailsButton.hidden=true;
      return;
    }
    const token=seq;
    detailsRequest=new AbortController();
    detailsButton.disabled=true;
    detailsButton.textContent='Infos werden geladen …';
    fetch('/api/details?type='+encodeURIComponent(current.type)+'&id='+current.tmdbId,{
      headers:{accept:'application/json'},
      signal:detailsRequest.signal
    }).then(async response=>{
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.details)throw new Error('Keine zusätzlichen Infos.');
      return data.details;
    }).then(data=>{
      if(token!==seq || overlay.hidden)return;
      facts.replaceChildren();
      const desc=document.createElement('p');
      desc.className='frame-trailer-description';
      desc.textContent=data.description||'Keine ausführliche Beschreibung verfügbar.';
      facts.appendChild(desc);
      for(const fact of (data.facts||[]).slice(0,5)){
        if(!fact?.value)continue;
        const row=document.createElement('div');
        row.className='frame-trailer-fact-row';
        const label=document.createElement('strong');
        label.textContent=fact.label||'Info';
        const value=document.createElement('span');
        value.textContent=fact.value;
        row.append(label,value);
        facts.appendChild(row);
      }
      facts.hidden=false;
      detailsButton.hidden=true;
    }).catch(error=>{
      if(error.name==='AbortError' || token!==seq)return;
      facts.replaceChildren();
      const paragraph=document.createElement('p');
      paragraph.className='frame-trailer-description';
      paragraph.textContent='Mehr Infos sind gerade nicht verfügbar.';
      facts.appendChild(paragraph);
      facts.hidden=false;
      detailsButton.disabled=false;
      detailsButton.textContent='Nochmal versuchen';
    }).finally(()=>{if(token===seq)detailsRequest=null;});
  }

  node('frameTrailerClose').addEventListener('click',()=>close());
  node('frameTrailerBack').addEventListener('click',()=>close());
  playButton.addEventListener('click',play);
  detailsButton.addEventListener('click',showDetails);

  overlay.addEventListener('pointerdown',event=>event.stopPropagation());
  overlay.addEventListener('pointerup',event=>event.stopPropagation());
  overlay.addEventListener('click',event=>{
    if(event.target===overlay)close();
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
