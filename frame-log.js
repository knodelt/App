(() => {
  'use strict';

  const root=document.querySelector('#frameLogView');
  if(!root)return;

  const $=selector=>root.querySelector(selector);
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  // Use an allowlist for image paths and never put arbitrary content in a CSS URL.
  const safePoster=value=>/^\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(String(value||''))?value:'';
  const posterUrl=value=>safePoster(value)?'https://image.tmdb.org/t/p/w342'+value:'';
  const labelType=type=>type==='series'?'Serie':type==='person'?'Person':'Film';
  const shortDate=value=>{
    if(!value)return '';
    const d=typeof value==='number'?new Date(value):new Date(String(value)+'T12:00:00');
    return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('de-DE',{day:'numeric',month:'long',year:'numeric'}).format(d):'';
  };
  const validId=value=>/^[a-zA-Z0-9:_-]{1,100}$/.test(String(value||''));
  const ensureObjects=()=>{
    if(!state.frameLogItems||typeof state.frameLogItems!=='object'||Array.isArray(state.frameLogItems))state.frameLogItems={};
    if(!state.frameLogMeta||typeof state.frameLogMeta!=='object'||Array.isArray(state.frameLogMeta))state.frameLogMeta={};
  };

  let filter='all';
  let displayed=35;
  let selectedId=null;
  let focusBeforeDetail=null;
  let historyCache={};
  // Older saved films can have a title but no poster or TMDB identifier.
  const artAttempts=new Set(),artQueue=[],artQueued=new Set();
  let artRunning=0;

  function history() {
    try {
      const raw=JSON.parse(localStorage.getItem('frame-recommendation-history-v1')||'{}');
      return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
    }catch{return {};}
  }
  function normalizeItem(input,id){
    if(!input||!validId(id))return null;
    const parsed=String(id).match(/^tmdb-(movie|series|person)-(\d+)$/);
    const type=['movie','series','person'].includes(input.type)?input.type:parsed?.[1];
    if(!type)return null;
    const tmdbId=Number(input.tmdbId||parsed?.[2]||0);
    return {
      id, type,tmdbId:Number.isSafeInteger(tmdbId)&&tmdbId>0?tmdbId:null,
      title:String(input.title||'').slice(0,160),
      year:String(input.year||'').slice(0,4),
      poster:safePoster(input.poster),
      blurb:String(input.blurb||input.description||'').slice(0,450),
      tags:Array.isArray(input.tags)?input.tags.filter(tag=>typeof tag==='string').slice(0,12).map(tag=>tag.slice(0,60)):[],
      source:input.source|| (tmdbId?'tmdb':'frame'),
      art:'linear-gradient(145deg,#47353f,#171319)'
    };
  }
  function remember(item,at=Date.now()){
    const id=item?.id||(item?.type&&item?.tmdbId?'tmdb-'+item.type+'-'+item.tmdbId:null);
    const normalized=normalizeItem(item,id);
    if(!normalized)return;
    ensureObjects();
    const old=state.frameLogItems[id];
    state.frameLogItems[id]={
      item:{...old?.item,...normalized,
        title:normalized.title||old?.item?.title||'',
        poster:normalized.poster||old?.item?.poster||'',
        year:normalized.year||old?.item?.year||'',
        blurb:normalized.blurb||old?.item?.blurb||'',
        tags:normalized.tags.length?normalized.tags:(old?.item?.tags||[])
      },
      addedAt:Number(old?.addedAt)||at
    };
    try{persist();}catch(e){console.warn('[FRAMELOG] snapshot was not saved',e);}
  }

  function getItem(id){
    const live=Array.isArray(catalog)?catalog.find(item=>item.id===id):null;
    const sources=[state.watched?.[id]?.item,state.frameLogItems?.[id]?.item,state.savedItems?.[id],live,historyCache[id]];
    let output=null;
    for(const source of sources){
      const next=normalizeItem(source,id);
      if(!next)continue;
      if(!output)output=next;
      else{
        for(const key of ['title','year','poster','blurb','source']){
          if(!output[key]&&next[key])output[key]=next[key];
        }
        if(!output.tags.length&&next.tags.length)output.tags=next.tags;
        if(!output.tmdbId&&next.tmdbId)output.tmdbId=next.tmdbId;
      }
    }
    if(output&&!output.title){
      output.title=output.tmdbId?labelType(output.type)+' #'+output.tmdbId:'Titel ohne Namen';
    }
    return output;
  }

  function records(){
    ensureObjects();
    historyCache=history();
    const ids=new Set([
      ...Object.keys(state.swipes||{}),
      ...(Array.isArray(state.saved)?state.saved:[]),
      ...Object.keys(state.watched||{})
    ]);
    const entries=[];
    for(const id of ids){
      if(!validId(id))continue;
      const item=getItem(id);
      if(!item)continue;
      const swipe=state.swipes?.[id];
      const saved=Boolean(state.saved?.includes(id))&&!state.watched?.[id];
      const watched=state.watched?.[id];
      const watchedRating=['like','dislike'].includes(watched?.rating)?watched.rating:null;
      if(!saved&&!watchedRating&&!['like','dislike','save'].includes(swipe))continue;
      const meta=state.frameLogMeta[id]||{};
      const loggedAt=Number(watched?.watchedAt)||Number(state.frameLogItems[id]?.addedAt)||
        Number(historyCache[id]?.updatedAt)||0;
      entries.push({id,item,swipe,saved,watched:watchedRating,
        watchedOn:meta.viewedOn||(watchedRating?new Date(watched.watchedAt||Date.now()).toISOString().slice(0,10):''),
        note:String(meta.note||''),sortAt:loggedAt});
    }
    return entries.sort((a,b)=>b.sortAt-a.sortAt||a.item.title.localeCompare(b.item.title,'de'));
  }

  function inTab(entry){
    if(filter==='watched')return Boolean(entry.watched);
    if(filter==='saved')return entry.saved;
    if(filter==='like')return entry.swipe==='like';
    if(filter==='dislike')return entry.swipe==='dislike';
    return true;
  }
  function status(entry){
    if(entry.watched)return {
      cls:entry.watched==='like'?'liked':'disliked',
      label:entry.watched==='like'?'♥ Gesehen · Hat gefallen':'✕ Gesehen · Hat nicht gefallen'
    };
    if(entry.saved)return {cls:'saved',label:'⌑ Merkliste · Noch nicht gesehen'};
    if(entry.swipe==='like')return {cls:'interest',label:'♥ SUPER · Interessiert dich'};
    if(entry.swipe==='dislike')return {cls:'skip',label:'✕ MIST · Kein Interesse'};
    return {cls:'saved',label:'⌑ MERKEN'};
  }

  function scheduleMissingArtwork(items){
    if(!root.classList.contains('active'))return;
    for(const entry of items){
      if(!['movie','series','person'].includes(entry.item.type)||
          entry.item.poster || artAttempts.has(entry.id)||artQueued.has(entry.id))continue;
      if(!entry.item.title || entry.item.title==='Titel ohne Namen')continue;
      artQueued.add(entry.id);
      artQueue.push({id:entry.id,item:entry.item});
    }
    pumpArtwork();
  }
  function pumpArtwork(){
    while(artRunning<2 && artQueue.length){
      const entry=artQueue.shift();
      artQueued.delete(entry.id);
      if(artAttempts.has(entry.id))continue;
      artAttempts.add(entry.id);
      artRunning++;
      void resolveArtwork(entry).finally(()=>{
        artRunning--;
        pumpArtwork();
      });
    }
  }
  async function resolveArtwork(entry){
    const {id,item}=entry;
    try{
      const query=new URLSearchParams({
        type:item.type,title:item.title.slice(0,120),savedId:id
      });
      if(Number.isSafeInteger(Number(item.tmdbId)) && Number(item.tmdbId)>0){
        query.set('id',String(item.tmdbId));
      }
      if(/^(18|19|20|21)\d{2}$/.test(String(item.year||'')))query.set('year',String(item.year));
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),12000);
      let payload;
      try{
        const response=await fetch('/api/framelog-art?'+query.toString(),{
          signal:controller.signal,headers:{accept:'application/json'}
        });
        if(!response.ok)return;
        payload=await response.json();
      }finally{
        clearTimeout(timeout);
      }
      if(!payload?.found || !safePoster(payload.poster))return;
      ensureObjects();
      const current=getItem(id);
      if(!current || current.poster)return;
      const old=state.frameLogItems[id];
      const restored={
        ...current,
        poster:payload.poster,
        year:/^\d{4}$/.test(String(current.year||''))?current.year:
          (/^\d{4}$/.test(String(payload.year||''))?String(payload.year):current.year),
        tmdbId:current.tmdbId||(
          Number.isSafeInteger(Number(payload.tmdbId))?Number(payload.tmdbId):null)
      };
      state.frameLogItems[id]={
        item:{...old?.item,...restored},
        addedAt:Number(old?.addedAt)||Date.now()
      };
      try{persist();}catch(error){console.warn('[FRAMELOG ART] Could not cache artwork',error);}
      render();
    }catch(error){
      if(error?.name!=='AbortError')console.warn('[FRAMELOG ART]',error);
    }
  }

  function render(){
    const all=records(),found=all.filter(inTab);
    const seen=all.filter(entry=>entry.watched);
    const saved=all.filter(entry=>entry.saved);
    const liked=seen.filter(entry=>entry.watched==='like');
    const values=[
      ['#frameLogSeenCount',seen.length],['#frameLogLikedCount',liked.length],
      ['#frameLogSavedCount',saved.length],['#frameLogResultCount',found.length+' Titel'],
      ['#frameLogProfileCount',all.length+' Titel']
    ];
    for(const [selector,value] of values){
      const n=document.querySelector(selector);if(n)n.textContent=String(value);
    }
    const host=$('#frameLogList');
    if(!host)return;
    const list=found.slice(0,displayed);
    host.innerHTML=list.length?list.map(entry=>{
      const poster=posterUrl(entry.item.poster);
      const badge=status(entry);
      const historical=entry.watched&&['like','dislike','save'].includes(entry.swipe)
        ? '<span class="frame-log-history">Zuvor: '+
          (entry.swipe==='like'?'SUPER':entry.swipe==='dislike'?'MIST':'MERKEN')+'</span>' : '';
      const timestamp=entry.watched
        ? shortDate(entry.watchedOn)
        : shortDate(entry.sortAt);
      const dateLabel=timestamp
        ? (entry.watched?'Gesehen am ':'Erfasst am ')+timestamp : 'Früher bewertet';
      return '<article class="frame-log-card">'+
        '<div class="frame-log-poster"'+(poster?' style="background-image:url(\''+poster+'\')"':'')+'>'+
        (poster?'':'<span aria-hidden="true">F</span>')+'</div>'+
        '<div class="frame-log-item-copy"><span class="frame-log-meta">'+
        escapeHtml(labelType(entry.item.type))+' · '+escapeHtml(entry.item.year||'—')+'</span>'+
        '<strong>'+escapeHtml(entry.item.title)+'</strong>'+
        '<span class="frame-log-date">'+escapeHtml(dateLabel)+'</span>'+
        '<span class="frame-log-status '+badge.cls+'">'+escapeHtml(badge.label)+'</span>'+
        historical+
        (entry.note?'<span class="frame-log-note-indicator">✎ Mit Notiz</span>':'')+
        '<button type="button" class="frame-log-item-action" data-frame-log-open="'+escapeHtml(entry.id)+'">Details &amp; bearbeiten <span aria-hidden="true">→</span></button>'+
        '</div></article>';
    }).join(''):'<div class="frame-log-empty"><span>✦</span><strong>Hier beginnt deine Filmgeschichte.</strong><p>'+
      (filter==='all'?'Swipe einen Film, speichere etwas für später oder bewerte einen bereits gesehenen Titel.':
        filter==='watched'?'Noch kein Film als gesehen bewertet. Tippe bei einer Filmkarte auf „Gesehen?“.':
        filter==='saved'?'Deine Merkliste ist noch leer. Merke dir einen Film in Framing oder „Für dich“.':
        'Hier erscheinen deine '+(filter==='like'?'SUPER-':'MIST-')+'Bewertungen.')+'</p></div>';
    let more=$('#frameLogMore');
    if(found.length>displayed){
      if(!more){
        more=document.createElement('button');more.id='frameLogMore';more.type='button';
        more.className='frame-log-more';
        root.insertBefore(more,host.nextSibling);
      }
      more.hidden=false;more.textContent='Weitere Filme anzeigen · '+(found.length-displayed);
    }else if(more)more.hidden=true;
    scheduleMissingArtwork(list);
  }

  function ensureDetail(){
    let shell=document.querySelector('#frameLogDetail');
    if(shell)return shell;
    shell=document.createElement('div');
    shell.className='frame-log-detail-overlay';shell.id='frameLogDetail';shell.hidden=true;
    shell.setAttribute('role','dialog');shell.setAttribute('aria-modal','true');
    shell.setAttribute('aria-labelledby','frameLogDetailTitle');
    shell.innerHTML='<section class="frame-log-detail-panel">'+
      '<button type="button" class="frame-log-detail-close" aria-label="Schließen">×</button>'+
      '<div class="frame-log-detail-top"><span class="frame-log-detail-kicker">FRAMELOG · DEIN EINTRAG</span>'+
      '<h2 id="frameLogDetailTitle"></h2><p id="frameLogDetailStatus"></p></div>'+
      '<div class="frame-log-detail-content">'+
      '<div class="frame-log-detail-actions">'+
      '<button type="button" data-frame-log-detail-action="watched">✓ Gesehen bewerten</button>'+
      '<button type="button" data-frame-log-detail-action="save">⌑ Merken</button>'+
      '<button type="button" data-frame-log-detail-action="unsave">Aus Merkliste entfernen</button>'+
      '<button type="button" data-frame-log-detail-action="unwatch">Gesehen zurücknehmen</button>'+
      '</div>'+
      '<div class="frame-log-editor" id="frameLogEditor">'+
      '<label for="frameLogDate">Datum des Filmabends</label>'+
      '<input type="date" id="frameLogDate" />'+
      '<label for="frameLogNote">Deine Notiz <span>(optional)</span></label>'+
      '<textarea id="frameLogNote" rows="3" maxlength="600" placeholder="Was ist dir im Kopf geblieben?"></textarea>'+
      '<button type="button" id="frameLogSaveNote">Eintrag speichern</button></div>'+
      '</div></section>';
    document.body.appendChild(shell);
    shell.addEventListener('click',event=>{
      if(event.target===shell||event.target.closest('.frame-log-detail-close')){closeDetail();return;}
      const action=event.target.closest('[data-frame-log-detail-action]')?.dataset.frameLogDetailAction;
      if(action)handleDetailAction(action);
    });
    shell.querySelector('#frameLogSaveNote')?.addEventListener('click',saveNote);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!shell.hidden)closeDetail();});
    return shell;
  }
  function openDetail(id){
    const entry=records().find(entry=>entry.id===id);
    if(!entry)return;
    selectedId=id;focusBeforeDetail=document.activeElement;
    const shell=ensureDetail();
    shell.querySelector('#frameLogDetailTitle').textContent=entry.item.title;
    shell.querySelector('#frameLogDetailStatus').textContent=status(entry).label;
    shell.querySelector('[data-frame-log-detail-action="watched"]').hidden=
      !['movie','series'].includes(entry.item.type);
    shell.querySelector('[data-frame-log-detail-action="watched"]').textContent=
      entry.watched?'♥ Gesehen-Bewertung ändern':'✓ Gesehen bewerten';
    shell.querySelector('[data-frame-log-detail-action="save"]').hidden=entry.saved||Boolean(entry.watched);
    shell.querySelector('[data-frame-log-detail-action="unsave"]').hidden=!entry.saved;
    shell.querySelector('[data-frame-log-detail-action="unwatch"]').hidden=!entry.watched;
    const editor=shell.querySelector('#frameLogEditor');
    editor.hidden=!entry.watched;
    shell.querySelector('#frameLogDate').value=entry.watched?entry.watchedOn:'';
    shell.querySelector('#frameLogNote').value=entry.note;
    shell.hidden=false;
    shell.querySelector('.frame-log-detail-close')?.focus({preventScroll:true});
  }
  function closeDetail(){
    const shell=document.querySelector('#frameLogDetail');
    if(shell)shell.hidden=true;
    selectedId=null;
    try{focusBeforeDetail?.focus?.({preventScroll:true});}catch{}
    focusBeforeDetail=null;
  }
  function saveNote(){
    const id=selectedId,entry=records().find(x=>x.id===id);
    if(!id||!entry?.watched)return;
    const shell=ensureDetail();
    const viewedOn=shell.querySelector('#frameLogDate').value;
    const note=shell.querySelector('#frameLogNote').value.trim().slice(0,600);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(viewedOn) || !Number.isFinite(Date.parse(viewedOn+'T12:00:00'))){
      showToast('Bitte ein gültiges Datum wählen.');return;
    }
    ensureObjects();
    const previous=state.frameLogMeta[id];
    state.frameLogMeta[id]={viewedOn,note};
    try{persist();}
    catch{
      if(previous)state.frameLogMeta[id]=previous;
      else delete state.frameLogMeta[id];
      showToast('Notiz konnte nicht gespeichert werden.');return;
    }
    closeDetail();render();showToast('FRAMELOG-Eintrag gespeichert.');
  }
  function handleDetailAction(action){
    const id=selectedId,entry=records().find(x=>x.id===id);
    if(!entry)return;
    if(action==='watched'){
      const item=entry.item;closeDetail();window.FrameWatched?.open(item);return;
    }
    if(action==='unwatch'){
      if(!confirm('Gesehen-Eintrag und Bewertung zurücknehmen?'))return;
      closeDetail();
      window.FrameWatched?.remove(id);
      if(state.frameLogMeta)delete state.frameLogMeta[id];
      try{persist();}catch{}
      render();return;
    }
    if(action==='save'){
      if(state.saved?.includes(id)||state.watched?.[id])return;
      const oldList=[...(state.saved||[])];
      const oldItem=state.savedItems?.[id];
      state.saved=[...oldList,id];
      state.savedItems={...(state.savedItems||{}),[id]:entry.item};
      try{persist();}
      catch{
        state.saved=oldList;
        if(oldItem)state.savedItems[id]=oldItem;
        else delete state.savedItems[id];
        showToast('Konnte den Film nicht merken.');return;
      }
      document.dispatchEvent(new CustomEvent('frame:watchlist-updated',{detail:{id,saved:true}}));
      renderTaste();closeDetail();render();showToast('Zur Merkliste hinzugefügt.');return;
    }
    if(action==='unsave'){
      const oldList=[...(state.saved||[])];
      const previousSwipe=state.swipes?.[id];
      const previousItem=state.savedItems?.[id];
      state.saved=oldList.filter(x=>x!==id);
      if(state.swipes[id]==='save')delete state.swipes[id];
      if(state.savedItems)delete state.savedItems[id];
      try{persist();}
      catch{
        state.saved=oldList;
        if(previousSwipe)state.swipes[id]=previousSwipe;
        if(previousItem)state.savedItems[id]=previousItem;
        showToast('Merkliste konnte nicht geändert werden.');return;
      }
      document.dispatchEvent(new CustomEvent('frame:watchlist-updated',{detail:{id,saved:false}}));
      renderTaste();closeDetail();render();showToast('Aus der Merkliste entfernt.');
    }
  }

  function setTab(value){
    if(!['all','watched','saved','like','dislike'].includes(value))return;
    filter=value;displayed=35;
    root.querySelectorAll('[data-frame-log-tab]').forEach(button=>{
      const active=button.dataset.frameLogTab===filter;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
    });
    render();
  }
  root.querySelector('#frameLogTabs')?.addEventListener('click',event=>{
    const tab=event.target.closest('[data-frame-log-tab]');
    if(tab)setTab(tab.dataset.frameLogTab);
  });
  root.querySelector('#frameLogList')?.addEventListener('click',event=>{
    const button=event.target.closest('[data-frame-log-open]');
    if(button)openDetail(button.dataset.frameLogOpen);
  });
  root.addEventListener('click',event=>{
    if(event.target?.id==='frameLogMore'){displayed+=35;render();}
  });
  document.addEventListener('frame:swipe-recorded',event=>{
    const item=event.detail?.item;if(item)remember(item);
    render();
  });
  document.addEventListener('frame:recommendation-saved',event=>{
    const item=event.detail?.item;if(item)remember(item);
    render();
  });
  document.addEventListener('frame:recommendation-rejected',event=>{
    const item=event.detail?.item;if(item)remember(item);
    render();
  });
  document.addEventListener('frame:watched-rated',event=>{
    if(event.detail?.item)remember(event.detail.item);
    render();
  });
  document.addEventListener('frame:watched-removed',render);
  document.addEventListener('frame:watchlist-updated',render);
  document.addEventListener('frame:swipe-undone',render);
  document.addEventListener('frame:feed-loaded',render);
  document.addEventListener('frame:taste-reset',()=>{
    filter='all';displayed=35;
    setTab('all');render();
  });
  document.addEventListener('frame:view-changed',event=>{
    if(event.detail?.target==='framelog')render();
    else closeDetail();
  });
  render();
  window.FrameLog={render,records,setTab};
})();