/* FRAME TONIGHT · deterministic, provider-neutral movie selection.
 * Uses the existing on-device movie collection. No additional API or LLM calls.
 */
(()=>{
'use strict';
const KEY='frame-tonight-v1', qs=id=>document.getElementById(id);
const MOODS={
  any:{label:'Offen für alles',tags:[]},
  relax:{label:'Runterkommen',tags:['komödie','comedy','familie','family','feelgood','romantik','romance','animation','leicht']},
  tension:{label:'Spannung',tags:['thriller','mystery','crime','krimi','action','horror','düster','twist']},
  laugh:{label:'Lachen',tags:['komödie','comedy','satire','animation','humor','feelgood']},
  think:{label:'Kopfkino',tags:['sci-fi','science fiction','mystery','drama','mindbend','biopic','history','twist']},
  surprise:{label:'Überrasch mich',tags:[]}
};
const TIMES=new Set([0,90,120,150,180]);
const day=()=>new Date().toLocaleDateString('sv-SE');
const text=(v,max=200)=>String(v??'').slice(0,max);
const canon=s=>text(s,100).toLocaleLowerCase('de-DE').trim();
const seed=s=>{let n=2166136261;for(const x of s){n^=x.charCodeAt(0);n=Math.imul(n,16777619)}return n>>>0};
const blank=()=>({day:day(),mood:'any',limit:0,picks:[],excluded:[],cards:[]});
function read(){
  try{
    const x=JSON.parse(localStorage.getItem(KEY)||'null');
    if(x?.day!==day()||!MOODS[x.mood]||!TIMES.has(x.limit))return blank();
    return {day:day(),mood:x.mood,limit:x.limit,
      picks:Array.isArray(x.picks)?x.picks.filter(a=>typeof a==='string').slice(0,3):[],
      excluded:Array.isArray(x.excluded)?x.excluded.filter(a=>typeof a==='string').slice(0,80):[],
      // Keep verified movie runtimes across reloads and account cloud sync.
      cards:Array.isArray(x.cards)?x.cards.slice(0,24).map(normalize).filter(Boolean):[]};
  }catch{return blank()}
}
let form=read(),ready=form.picks.length>0,current=[],remoteItems=[...form.cards];
let remoteHasMore=false,remotePage=1,requestId=0,working=false,lastError='';
function savePref(){
  try{
    const value=JSON.stringify(form);
    if(localStorage.getItem(KEY)!==value){
      localStorage.setItem(KEY,value);
      window.FrameCloud?.changed?.();
    }
  }catch{}
}
function runtime(item){
  for(const v of [item.runtime,item.runtimeMinutes,item.duration,item.meta]){
    if(typeof v==='number'&&v>=45&&v<=400)return Math.round(v);
    if(typeof v==='string'){
      const match=v.match(/(?:^|\s)(\d{2,3})\s*min(?:uten)?\.?\b/i);
      if(match && +match[1]>=45&&+match[1]<=400)return +match[1];
    }
  }
  return null;
}
function normalize(item){
  if(!item||item.type!=='movie'||typeof item.title!=='string'||!item.title.trim())return null;
  const id=text(item.id,100);
  if(!/^[\w:-]{1,100}$/.test(id))return null;
  const t=Array.isArray(item.tags)?item.tags.filter(v=>typeof v==='string').slice(0,12).map(x=>text(x,60)):[];
  const poster=/^\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(item.poster||'')?item.poster:null;
  return {id,type:'movie',title:text(item.title,160),year:text(item.year,6),
    tmdbId:Number.isSafeInteger(+item.tmdbId)&&+item.tmdbId>0?+item.tmdbId:null,
    source:text(item.source||'frame',24),minutes:runtime(item),
    meta:text(item.meta,50),subtitle:text(item.subtitle,150),
    blurb:text(item.blurb||item.description,450),tags:t,poster,
    art:text(item.art,180)};
}
function pool(){
  const all=[...remoteItems,...(typeof catalog!=='undefined'&&Array.isArray(catalog)?catalog:[])];
  all.push(...Object.values(state.savedItems||{}));
  for(const record of Object.values(state.frameLogItems||{}))if(record?.item)all.push(record.item);
  const result=[],seen=new Set(),titles=new Set();
  for(const candidate of all){
    const item=normalize(candidate);if(!item)continue;
    const key=item.tmdbId?'tmdb:'+item.tmdbId:canon(item.title)+'|'+item.year;
    const titleKey=canon(item.title)+'|'+item.year;
    if(seen.has(key)||titles.has(titleKey))continue;
    seen.add(key);titles.add(titleKey);result.push(item);
  }
  return result;
}
function tags(item){
  const rawTags=Array.isArray(item?.tags)?item.tags:[];
  const t=new Set([...rawTags,...text(item?.subtitle,150).split(/[·,\/]/)].map(canon).filter(Boolean));
  const alias={'science fiction':'sci-fi','science-fiction':'sci-fi','scifi':'sci-fi','komödie':'comedy','krimi':'crime','romantik':'romance'};
  for(const x of [...t])if(alias[x])t.add(alias[x]);
  return [...t];
}
function blocked(item){
  const ids=[item.id,item.tmdbId?'tmdb-movie-'+item.tmdbId:null].filter(Boolean);
  return form.excluded.includes(item.id)||ids.some(id=>state.swipes?.[id]==='dislike'||!!state.watched?.[id]);
}
function tasteWeights(items){
  const lookup=new Map(items.map(i=>[i.id,i])),weights=new Map();
  // FRAME keeps feedback history even when the shuffled discovery feed no
  // longer contains a swiped title. Include those saved signals as well.
  let history={},dna={};
  try{history=JSON.parse(localStorage.getItem('frame-recommendation-history-v1')||'{}')||{};}catch{}
  try{dna=JSON.parse(localStorage.getItem('frame-taste-dna-v2')||'{}')||{};}catch{}
  const add=(item,n)=>{
    if(!item||n===0)return;
    for(const t of tags(item)){
      weights.set(t,Math.min(10,Math.max(-10,(weights.get(t)||0)+n)));
    }
  };
  for(const [id,action] of Object.entries(state.swipes||{})){
    const item=lookup.get(id)||history[id]||state.savedItems?.[id]||state.frameLogItems?.[id]?.item;
    if(action==='like')add(item,3);
    if(action==='save')add(item,1.5);
    if(action==='dislike')add(item,-3);
  }
  for(const [id,record] of Object.entries(state.watched||{})){
    const item=lookup.get(id)||record?.item||history[id]||state.savedItems?.[id];
    if(record?.rating==='like')add(item,2);
    if(record?.rating==='dislike')add(item,-2);
  }
  // Existing Taste DNA contains confidence-weighted features. Reuse only
  // recognizable genre/trait labels; no LLM or external processing.
  for(const feature of Array.isArray(dna.featureWeights)?dna.featureWeights:[]){
    if(!['genre','trait','keyword'].includes(feature?.group))continue;
    const label=canon(feature.label||feature.key?.split(':').pop()||'');
    const amount=Number(feature.weight)*Number(feature.confidence??1);
    if(!label||!Number.isFinite(amount))continue;
    weights.set(label,Math.min(10,Math.max(-10,(weights.get(label)||0)+Math.max(-4,Math.min(4,amount*.35)))));
  }
  return weights;
}

function candidates(){
  const items=pool(),weights=tasteWeights(items);
  const output=[];
  for(const item of items){
    if(blocked(item))continue;
    if(form.limit && (item.minutes===null||item.minutes>form.limit))continue;
    const ts=tags(item),moodMatches=ts.filter(t=>MOODS[form.mood].tags.includes(t));
    if(!['any','surprise'].includes(form.mood)&&!moodMatches.length)continue;
    const positive=ts.filter(t=>(weights.get(t)||0)>0).sort((a,b)=>(weights.get(b)||0)-(weights.get(a)||0));
    const boost=positive.slice(0,3).reduce((n,t)=>n+Math.min(5,weights.get(t)||0),0);
    const negative=ts.reduce((n,t)=>n+Math.min(0,weights.get(t)||0),0);
    const saved=state.saved?.includes(item.id)||state.swipes?.[item.id]==='save';
    const liked=state.swipes?.[item.id]==='like';
    const rand=seed(day()+':'+item.id+':'+form.mood)%997/997;
    const score=form.mood==='surprise'?rand*18+(saved?5:0)
      :35+Math.min(18,boost*2)+negative*2+Math.min(16,moodMatches.length*6)+(saved?14:0)+(liked?9:0)+rand*2;
    const reason=saved?'Schon auf deiner Merkliste':
      positive.length?'Weil dir '+positive[0]+' gefällt':
      moodMatches.length?'Trifft deine Stimmung: '+MOODS[form.mood].label:
      liked?'Hattest du bereits als SUPER markiert':'Eine neue Entdeckung für heute';
    output.push({...item,score,reason,category:moodMatches[0]||ts[0]||'Film'});
  }
  return output.sort((a,b)=>b.score-a.score);
}
function pick(replace=false){
  const list=candidates(),lookup=new Map(list.map(x=>[x.id,x]));
  if(!replace&&form.picks.length){
    const old=form.picks.map(id=>lookup.get(id)).filter(Boolean);
    if(old.length===Math.min(3,list.length)&&old.length>0){current=old;return current;}
  }
  const chosen=[],groups=new Set();
  while(chosen.length<3&&list.length){
    let win=0,val=-Infinity;
    list.forEach((x,i)=>{
      const n=x.score-(groups.has(x.category)?8:0);
      if(n>val){val=n;win=i;}
    });
    const item=list.splice(win,1)[0];chosen.push(item);groups.add(item.category);
  }
  current=chosen;form.picks=chosen.map(x=>x.id);return chosen;
}
function node(tag,cls,content){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(content!==undefined)n.textContent=content;
  return n;
}
function snapshot(item){
  return {id:item.id,type:'movie',tmdbId:item.tmdbId,source:item.source,
    title:item.title,year:item.year,meta:item.meta,runtime:item.minutes,subtitle:item.subtitle,
    blurb:item.blurb,tags:[...item.tags],poster:item.poster,art:item.art};
}
function mark(item){
  if(!Array.isArray(state.saved))state.saved=[];
  if(state.saved.includes(item.id))return;
  state.saved.push(item.id);
  if(!state.savedItems||typeof state.savedItems!=='object')state.savedItems={};
  state.savedItems[item.id]=snapshot(item);
  if(!state.swipes[item.id])state.swipes[item.id]='save';
  persist();
  document.dispatchEvent(new CustomEvent('frame:watchlist-updated',{
    detail:{id:item.id,saved:true,item:snapshot(item)}
  }));
  window.FrameLog?.render?.();renderTaste();
  if(typeof showToast==='function')showToast('In FRAMELOG gemerkt');
  renderResults();
}
async function skip(item){
  if(!form.excluded.includes(item.id))form.excluded.push(item.id);
  form.picks=[];pick(true);savePref();renderResults();
  if(current.length>=3||!remoteHasMore||working)return;
  const stamp=++requestId;
  working=true;
  try{
    await fetchVerifiedMovies(Math.min(4,remotePage+1),false);
    if(stamp!==requestId)return;
    form.picks=[];pick(true);savePref();renderResults();
  }catch(error){
    if(stamp===requestId){
      console.warn('[FRAME TONIGHT] Weitere Filme nicht verfügbar:',String(error?.message||error).slice(0,100));
    }
  }finally{if(stamp===requestId)working=false;}
}
function renderResults(){
  const host=qs('frameTonightResults'),summary=qs('frameTonightSummary');
  host.replaceChildren();
  if(!ready){
    host.hidden=true;qs('frameTonightEmpty').hidden=false;
    summary.textContent='Wähle eine Stimmung und die verfügbare Zeit.';
    return;
  }
  const chosen=pick(false);
  host.hidden=false;qs('frameTonightEmpty').hidden=true;
  summary.textContent=chosen.length===3?'Drei Filme. Ohne endlose Suche.':
    chosen.length?'Aktuell passen nur '+chosen.length+' Filme zu deinen Vorgaben.':
    lastError?'Filme konnten nicht nachgeladen werden. '+lastError:
    'Noch kein Treffer – wähle eine andere Stimmung oder mehr Zeit.';
  if(!chosen.length){
    host.append(node('p','tonight-no-result',
      'FRAME zeigt ausschließlich Filme mit bestätigter Laufzeit. Versuche eine andere Stimmung oder eine längere Zeit.'));
    return;
  }
  for(let i=0;i<chosen.length;i++){
    const item=chosen[i],card=node('article','tonight-card'+(i===0?' tonight-feature':'')),
      picture=node('div','tonight-card-art');
    if(item.poster){
      const img=document.createElement('img');
      img.loading='lazy';img.decoding='async';img.alt='';
      img.onerror=()=>{img.remove();picture.append(node('span','tonight-monogram','F'));};
      img.src='https://image.tmdb.org/t/p/w342'+item.poster;
      picture.append(img);
    }else picture.append(node('span','tonight-monogram','F'));
    picture.append(node('span','tonight-number',String(i+1).padStart(2,'0')));
    const body=node('div','tonight-card-copy');
    const meta=[item.year,item.minutes?item.minutes+' MIN':'DAUER UNBEKANNT'].filter(Boolean).join(' · ');
    body.append(node('span','tonight-card-meta',meta),node('h3','',item.title));
    body.append(node('p','tonight-why',item.reason));
    if(item.blurb)body.append(node('p','tonight-blurb',item.blurb));
    const buttons=node('div','tonight-card-actions'),
      save=node('button','tonight-action-primary',state.saved?.includes(item.id)?'✓ Gemerkt':'+ Merken'),
      watched=node('button','tonight-action-secondary','Gesehen?'),
      later=node('button','tonight-action-quiet','Nicht heute');
    save.type=watched.type=later.type='button';
    save.disabled=!!state.saved?.includes(item.id);
    save.addEventListener('click',()=>mark(item));
    watched.addEventListener('click',()=>window.FrameWatched?.open?.(snapshot(item)));
    later.addEventListener('click',()=>skip(item));
    buttons.append(save,watched,later);body.append(buttons);
    card.append(picture,body);host.append(card);
  }
  host.append(node('p','tonight-proof',
    'Regelbasiert aus '+candidates().length+' passenden Filmen · keine externen KI-Anfragen · keine erfundenen Match-Prozente.'));
}
function renderInputs(){
  qs('frameTonightDate').textContent=new Intl.DateTimeFormat('de-DE',{
    weekday:'long',day:'numeric',month:'long'
  }).format(new Date());
  qs('frameTonightMoods').querySelectorAll('[data-tonight-mood]').forEach(btn=>{
    const yes=btn.dataset.tonightMood===form.mood;
    btn.setAttribute('aria-pressed',String(yes));
    btn.classList.toggle('selected',yes);
  });
  qs('frameTonightTimes').querySelectorAll('[data-tonight-minutes]').forEach(btn=>{
    const yes=Number(btn.dataset.tonightMinutes)===form.limit;
    btn.setAttribute('aria-pressed',String(yes));btn.classList.toggle('selected',yes);
  });
  qs('frameTonightGo').textContent=ready?'Neu auswählen':'Meine drei Filme finden';
}
function resetChoice(){
  requestId++;working=false;
  qs('frameTonightGo').disabled=false;
  form.picks=[];form.excluded=[];form.cards=[];remoteItems=[];
  remotePage=1;remoteHasMore=false;ready=false;lastError='';
  savePref();renderInputs();renderResults();
}
// The standard Discover feed has ratings but no runtime. Ask the Worker for
// time-filtered movies and verify their actual lengths before recommending.
async function fetchVerifiedMovies(page=1,replace=true){
  const expectedMood=form.mood,expectedMinutes=form.limit,stamp=requestId;
  const r=await fetch('/api/tonight?minutes='+expectedMinutes+'&mood='+encodeURIComponent(expectedMood)+'&page='+page,{
    headers:{accept:'application/json'},cache:'no-store'
  });
  const data=await r.json().catch(()=>({}));
  if(stamp!==requestId||form.mood!==expectedMood||form.limit!==expectedMinutes)return false;
  if(!r.ok||!data.ok||!Array.isArray(data.items)||!data.verifiedRuntimes)
    throw Error(data.error||'Filmquelle gerade nicht erreichbar.');
  const incoming=data.items.map(normalize).filter(item=>item&&item.minutes!==null
    &&(!form.limit||item.minutes<=form.limit));
  const seen=new Set();
  remoteItems=(replace?[]:remoteItems).concat(incoming).filter(item=>{
    if(seen.has(item.id))return false;
    seen.add(item.id);return true;
  }).slice(0,24);
  remoteHasMore=!!data.hasMore;
  remotePage=page;
  form.cards=remoteItems;
  return true;
}
async function generate(){
  const stamp=++requestId;
  const button=qs('frameTonightGo');
  working=true;button.disabled=true;button.textContent='Prüfe Filmlängen …';
  qs('frameTonightSummary').textContent='Suche Filme mit bestätigter Laufzeit.';
  lastError='';
  try{
    await fetchVerifiedMovies(1,true);
    if(stamp!==requestId)return;
    // If the first page was sparse, add a second page, but never request
    // unbounded pages or silently relax the actual runtime limit.
    if(remoteHasMore&&candidates().length<3)await fetchVerifiedMovies(2,false);
  }catch(error){
    if(stamp!==requestId)return;
    lastError='Bitte erneut versuchen oder anderes Zeitlimit wählen.';
    console.warn('[FRAME TONIGHT]',String(error?.message||error).slice(0,100));
  }finally{
    if(stamp===requestId){
      working=false;button.disabled=false;
      ready=true;form.picks=[];pick(true);savePref();
      renderInputs();renderResults();
      qs('frameTonightSummary').scrollIntoView({block:'nearest',behavior:'smooth'});
    }
  }
}
function open(){
  if(typeof switchView==='function')switchView('tonight');
  renderInputs();renderResults();
}
qs('frameTonightGo')?.addEventListener('click',generate);
qs('frameTonightMoods')?.addEventListener('click',event=>{
  const button=event.target.closest('[data-tonight-mood]');
  if(!button||!MOODS[button.dataset.tonightMood])return;
  form.mood=button.dataset.tonightMood;resetChoice();
});
qs('frameTonightTimes')?.addEventListener('click',event=>{
  const button=event.target.closest('[data-tonight-minutes]');
  if(!button)return;
  const minutes=Number(button.dataset.tonightMinutes);
  if(!TIMES.has(minutes))return;
  form.limit=minutes;resetChoice();
});
document.addEventListener('frame:view-changed',event=>{
  if(event.detail?.target==='tonight'){
    form=read();remoteItems=[...form.cards];ready=!!form.picks.length;renderInputs();renderResults();
  }
});
document.addEventListener('frame:feed-loaded',()=>{
  if(!qs('tonightView')?.classList.contains('active')||!ready)return;
  if(current.length<3)renderResults();
});
document.addEventListener('frame:taste-reset',()=>{
  requestId++;form=blank();remoteItems=[];ready=false;try{localStorage.removeItem(KEY)}catch{}
  if(qs('tonightView')?.classList.contains('active')){renderInputs();renderResults();}
});
window.FrameTonight={open};
renderInputs();renderResults();
})();