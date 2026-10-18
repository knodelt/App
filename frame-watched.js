(() => {
  'use strict';
  // Explicit post-viewing feedback. Kept separate from initial swipe intent.
  const RATINGS = new Set(['like','dislike']);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const safePoster = path => /^\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(String(path||'')) ? path : '';
  const posterUrl = (path,size='w342') => safePoster(path) ? 'https://image.tmdb.org/t/p/'+size+path : '';
  const watched = () => {
    if (!state.watched || typeof state.watched !== 'object' || Array.isArray(state.watched)) state.watched={};
    return state.watched;
  };
  let activeItem=null;
  let lastTrigger=null;

  function normalizeItem(original) {
    if(!original || !['movie','series'].includes(original.type))return null;
    const tmdbId=Number(original.tmdbId||0);
    const id=original.id || (Number.isSafeInteger(tmdbId)&&tmdbId>0?'tmdb-'+original.type+'-'+tmdbId:'');
    if(!id || !/^[a-zA-Z0-9:_-]{1,100}$/.test(String(id)))return null;
    return {
      id:String(id),tmdbId:Number.isSafeInteger(tmdbId)&&tmdbId>0?tmdbId:null,
      type:original.type,title:String(original.title||'').slice(0,160),
      year:String(original.year||'').slice(0,4),
      blurb:String(original.blurb||original.description||'').slice(0,450),
      poster:safePoster(original.poster),
      tags:(Array.isArray(original.tags)?original.tags:[])
        .filter(x=>typeof x==='string').slice(0,12).map(x=>x.slice(0,60)),
      source:original.source|| (tmdbId?'tmdb':'frame'),
      art:'linear-gradient(145deg,#47353f,#171319)'
    };
  }

  function get(id) { return watched()[String(id||'')]||null; }
  function entries() {
    return Object.values(watched()).filter(x=>x?.item?.id && RATINGS.has(x.rating))
      .sort((a,b)=>Number(b.watchedAt||0)-Number(a.watchedAt||0));
  }
  function render() {
    const all=entries();
    const list=document.querySelector('#watchedList');
    const count=document.querySelector('#watchedCount');
    const profileCount=document.querySelector('#frameWatchedCount');
    if(count)count.textContent=String(all.length);
    if(profileCount)profileCount.textContent=String(all.length);
    if(!list)return;
    list.innerHTML=all.length?all.map(entry=>{
      const item=entry.item,poster=posterUrl(item.poster);
      return '<article class="frame-watched-card">'+
        '<div class="frame-watched-poster"'+(poster?' style="background-image:url(\''+poster+'\')"':'')+'></div>'+
        '<div class="frame-watched-card-content"><span class="frame-watched-meta">'+
        (item.type==='series'?'SERIE':'FILM')+' · '+escapeHtml(item.year||'—')+'</span>'+
        '<strong>'+escapeHtml(item.title||'Film')+'</strong>'+
        '<span class="frame-watched-rating '+(entry.rating==='like'?'positive':'negative')+'">'+
        (entry.rating==='like'?'♥ Hat gefallen':'✕ Hat nicht gefallen')+'</span>'+
        '<div class="frame-watched-card-actions">'+
        '<button type="button" data-watched-action="edit" data-watched-id="'+escapeHtml(item.id)+'">Ändern</button>'+
        '<button type="button" data-watched-action="undo" data-watched-id="'+escapeHtml(item.id)+'">Entfernen</button></div>'+
        '</div></article>';
    }).join(''):'<div class="frame-watched-empty"><strong>Dein Filmgedächtnis beginnt hier.</strong><p>Markiere einen Titel in „Für dich“ oder deiner Merkliste als gesehen und sag FRAME, wie er dir gefallen hat.</p></div>';
  }

  function ensureModal() {
    let modal=document.querySelector('#frameWatchedModal');
    if(modal)return modal;
    modal=document.createElement('div');
    modal.id='frameWatchedModal';
    modal.className='frame-watched-overlay';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-labelledby','frameWatchedTitle');
    modal.hidden=true;
    modal.innerHTML=
      '<div class="frame-watched-dialog">'+
      '<button class="frame-watched-close" type="button" aria-label="Schließen">×</button>'+
      '<div class="frame-watched-dialog-poster" aria-hidden="true"></div>'+
      '<div class="frame-watched-dialog-content">'+
      '<span class="frame-watched-eyebrow">FRAME · DEINE ECHTE BEWERTUNG</span>'+
      '<h2 id="frameWatchedTitle">Schon gesehen?</h2>'+
      '<p class="frame-watched-dialog-title" id="frameWatchedFilm"></p>'+
      '<p class="frame-watched-dialog-intro">Hat dir dieser Film oder diese Serie nach dem Anschauen wirklich gefallen?</p>'+
      '<div class="frame-watched-choices">'+
      '<button class="frame-watched-liked" type="button" data-watched-rating="like"><span>♥</span> Hat gefallen</button>'+
      '<button class="frame-watched-disliked" type="button" data-watched-rating="dislike"><span>✕</span> Hat nicht gefallen</button>'+
      '</div>'+
      '<p class="frame-watched-detail-hint">Deine echte Bewertung zählt stärker als ein Swipe. Du kannst sie später ändern.</p>'+
      '</div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click',event=>{
      if(event.target===modal || event.target.closest('.frame-watched-close')){close();return;}
      const button=event.target.closest('[data-watched-rating]');
      if(button&&activeItem)rate(activeItem,button.dataset.watchedRating);
    });
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!modal.hidden)close();
    });
    return modal;
  }
  function open(input) {
    const item=normalizeItem(input);
    if(!item)return;
    activeItem=item;
    lastTrigger=document.activeElement;
    const modal=ensureModal();
    modal.querySelector('#frameWatchedFilm').textContent=item.title;
    const poster=posterUrl(item.poster,'w780');
    modal.querySelector('.frame-watched-dialog-poster').style.backgroundImage=poster
      ? 'linear-gradient(180deg,rgba(9,8,13,.1),rgba(9,8,13,.91)),url("'+poster+'")'
      : 'linear-gradient(145deg,#653f52,#131218)';
    const previous=get(item.id);
    modal.querySelector('#frameWatchedTitle').textContent=previous?'Deine Bewertung ändern.':'Schon gesehen?';
    modal.hidden=false;
    modal.querySelector('.frame-watched-close')?.focus({preventScroll:true});
  }
  function close() {
    const modal=document.querySelector('#frameWatchedModal');
    if(modal)modal.hidden=true;
    activeItem=null;
    try{lastTrigger?.focus?.({preventScroll:true});}catch{}
    lastTrigger=null;
  }

  function dispatch(action,id,item,rating,previous) {
    document.dispatchEvent(new CustomEvent('frame:watched-'+action,{
      detail:{id,item,rating,previous}
    }));
  }
  function rate(input,rating) {
    if(!RATINGS.has(rating))return false;
    const item=normalizeItem(input);
    if(!item)return false;
    const store=watched(),previous=store[item.id]||null;
    const wasSaved=previous?.wasSaved ?? (state.saved||[]).includes(item.id);
    const result={
      item, rating, wasSaved:Boolean(wasSaved),
      watchedAt:Date.now()
    };
    // Do not erase the original SUPER/MERKEN/MIST signal.
    store[item.id]=result;
    state.saved=(state.saved||[]).filter(id=>id!==item.id);
    try{persist();}
    catch {
      if(previous)store[item.id]=previous;
      else delete store[item.id];
      if(wasSaved && !state.saved.includes(item.id))state.saved.push(item.id);
      showToast('Bewertung konnte nicht gespeichert werden.');
      return false;
    }
    close();
    render();
    renderWatchlist();
    renderTaste();
    dispatch('rated',item.id,item,rating,previous?.rating||null);
    showToast(rating==='like'?'Gesehen · Hat gefallen. FRAME lernt dazu.':'Gesehen · Hat nicht gefallen. FRAME lernt dazu.');
    return true;
  }
  function remove(id) {
    const store=watched(),entry=store[id];
    if(!entry)return;
    delete store[id];
    if(entry.wasSaved && !state.saved.includes(id)){
      state.saved.push(id);
      state.savedItems={...(state.savedItems||{}),[id]:entry.item};
    }
    try{persist();}
    catch{
      store[id]=entry;
      state.saved=state.saved.filter(savedId=>savedId!==id||!entry.wasSaved);
      showToast('Konnte die Änderung nicht speichern.');
      return;
    }
    render();
    renderWatchlist();
    renderTaste();
    dispatch('removed',id,entry.item,null,entry.rating);
    showToast('Gesehen zurückgenommen.');
  }
  window.FrameWatched={open,rate,remove,get,entries,normalizeItem};
  document.querySelector('#openWatchedFromFrame')?.addEventListener('click',()=>{
    render();switchView('watched');
  });
  document.querySelector('#watchedBack')?.addEventListener('click',()=>switchView('taste'));
  document.querySelector('#watchedList')?.addEventListener('click',event=>{
    const b=event.target.closest('[data-watched-action]');
    if(!b)return;
    const id=b.dataset.watchedId;
    const entry=get(id);
    if(!entry)return;
    if(b.dataset.watchedAction==='edit')open(entry.item);
    if(b.dataset.watchedAction==='undo' && confirm('Gesehen-Eintrag und Bewertung entfernen?'))remove(id);
  });
  document.addEventListener('frame:recommendations-rendered',render);
  document.addEventListener('frame:taste-reset',render);
  render();
})();