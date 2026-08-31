const catalog = [
  { id:'dune2', type:'movie', title:'Dune: Part Two', year:'2024', meta:'166 min', subtitle:'Sci-Fi · Drama', tags:['Sci-Fi','Epic','Denis Villeneuve','Düster'], symbol:'Ⅱ', art:'linear-gradient(145deg,#8f5a36 0%,#3b2520 42%,#111116 100%)' },
  { id:'severance', type:'series', title:'Severance', year:'2022', meta:'2 Staffeln', subtitle:'Mystery · Drama', tags:['Mystery','Sci-Fi','Slow Burn','Mindbend'], symbol:'⌁', art:'linear-gradient(145deg,#315a67 0%,#182c34 48%,#101114 100%)' },
  { id:'gyllenhaal', type:'person', title:'Jake Gyllenhaal', year:'ACTOR', meta:'42 Credits', subtitle:'Nightcrawler · Prisoners · Enemy', tags:['Thriller','Drama','Mystery','Intensiv'], symbol:'JG', art:'linear-gradient(150deg,#5c4d46 0%,#292526 48%,#111113 100%)' },
  { id:'menu', type:'movie', title:'The Menu', year:'2022', meta:'107 min', subtitle:'Thriller · Satire', tags:['Thriller','Satire','Düster','Anya Taylor-Joy'], symbol:'✣', art:'linear-gradient(140deg,#6b281f 0%,#29181a 46%,#0d0d10 100%)' },
  { id:'succession', type:'series', title:'Succession', year:'2018', meta:'4 Staffeln', subtitle:'Drama · Satire', tags:['Drama','Dialog','Satire','Prestige TV'], symbol:'S', art:'linear-gradient(145deg,#76593c 0%,#30261f 48%,#101012 100%)' },
  { id:'anya', type:'person', title:'Anya Taylor-Joy', year:'ACTOR', meta:'28 Credits', subtitle:'The Queen’s Gambit · The Menu', tags:['Drama','Thriller','Stylish','Anya Taylor-Joy'], symbol:'ATJ', art:'linear-gradient(145deg,#684155 0%,#2c1d27 48%,#101014 100%)' },
  { id:'oppenheimer', type:'movie', title:'Oppenheimer', year:'2023', meta:'180 min', subtitle:'Drama · History', tags:['Christopher Nolan','Drama','Biopic','Intensiv'], symbol:'O', art:'linear-gradient(145deg,#9b5426 0%,#3b2119 43%,#0b0b0e 100%)' },
  { id:'bear', type:'series', title:'The Bear', year:'2022', meta:'4 Staffeln', subtitle:'Drama · Comedy', tags:['Drama','Stress','Food','Character'], symbol:'B', art:'linear-gradient(145deg,#315267 0%,#222e35 48%,#0e0f12 100%)' },
  { id:'nolan', type:'person', title:'Christopher Nolan', year:'DIRECTOR', meta:'12 Features', subtitle:'Inception · Interstellar · Memento', tags:['Christopher Nolan','Sci-Fi','Mindbend','Epic'], symbol:'CN', art:'linear-gradient(145deg,#384a58 0%,#1f272e 48%,#0c0d10 100%)' },
  { id:'hereditary', type:'movie', title:'Hereditary', year:'2018', meta:'127 min', subtitle:'Horror · Mystery', tags:['Horror','Düster','Slow Burn','A24'], symbol:'△', art:'linear-gradient(145deg,#4d4a32 0%,#29291e 43%,#0b0c0c 100%)' },
  { id:'white-lotus', type:'series', title:'The White Lotus', year:'2021', meta:'3 Staffeln', subtitle:'Drama · Satire', tags:['Satire','Mystery','Luxury','Drama'], symbol:'WL', art:'linear-gradient(145deg,#697b54 0%,#2c3427 45%,#0d0e0d 100%)' },
  { id:'gosling', type:'person', title:'Ryan Gosling', year:'ACTOR', meta:'39 Credits', subtitle:'Drive · Blade Runner 2049 · Barbie', tags:['Drama','Stylish','Sci-Fi','Comedy'], symbol:'RG', art:'linear-gradient(145deg,#70496c 0%,#302238 47%,#101014 100%)' },
  { id:'parasite', type:'movie', title:'Parasite', year:'2019', meta:'132 min', subtitle:'Thriller · Drama', tags:['Thriller','Satire','Korea','Twist'], symbol:'P', art:'linear-gradient(145deg,#48564a 0%,#222c25 50%,#0c0e0d 100%)' },
  { id:'dark', type:'series', title:'Dark', year:'2017', meta:'3 Staffeln', subtitle:'Mystery · Sci-Fi', tags:['Mystery','Sci-Fi','Mindbend','Düster'], symbol:'∞', art:'linear-gradient(145deg,#364a44 0%,#1c2925 50%,#0b0c0c 100%)' },
  { id:'cruise', type:'person', title:'Tom Cruise', year:'ACTOR', meta:'50 Credits', subtitle:'Mission: Impossible · Top Gun', tags:['Action','Blockbuster','Stunts','Tom Cruise'], symbol:'TC', art:'linear-gradient(145deg,#485b73 0%,#242d3a 48%,#0d0e11 100%)' }
];

const recommendations = [
  { title:'Prisoners', year:'2013', type:'Film', tags:['Jake Gyllenhaal','Thriller','Mystery','Düster'], art:'linear-gradient(145deg,#5c594f,#292923 48%,#0b0c0c)' },
  { title:'Enemy', year:'2013', type:'Film', tags:['Jake Gyllenhaal','Denis Villeneuve','Mystery','Mindbend'], art:'linear-gradient(145deg,#9a7a3f,#43331e 46%,#0e0d0b)' },
  { title:'Blade Runner 2049', year:'2017', type:'Film', tags:['Sci-Fi','Denis Villeneuve','Ryan Gosling','Düster'], art:'linear-gradient(145deg,#a44e31,#40231f 46%,#0d0d10)' },
  { title:'The Prestige', year:'2006', type:'Film', tags:['Christopher Nolan','Mystery','Twist','Drama'], art:'linear-gradient(145deg,#624d35,#2d241b 48%,#0c0b0a)' },
  { title:'Sharp Objects', year:'2018', type:'Serie', tags:['Mystery','Drama','Slow Burn','Düster'], art:'linear-gradient(145deg,#625249,#2e2724 48%,#0c0c0d)' }
];

const defaultState = { swipes:{}, saved:[], filter:'all', secret:0 };
let state = loadState();
let activeItems = [];
let drag = null;
let toastTimer;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function loadState() {
  try { return { ...defaultState, ...JSON.parse(localStorage.getItem('frame-state') || '{}') }; }
  catch { return structuredClone(defaultState); }
}
function persist() { localStorage.setItem('frame-state', JSON.stringify(state)); }
function swipedIds() { return Object.keys(state.swipes); }
function typeLabel(type) { return type === 'movie' ? 'FILM' : type === 'series' ? 'SERIE' : 'PERSON'; }

function filteredCatalog() {
  return catalog.filter(item => (state.filter === 'all' || item.type === state.filter) && !state.swipes[item.id]);
}

function renderDeck() {
  const deck = $('#cardDeck');
  activeItems = filteredCatalog();
  deck.innerHTML = '';
  $('#emptyState').hidden = activeItems.length > 0;
  deck.hidden = activeItems.length === 0;

  activeItems.slice(0,3).reverse().forEach((item, reverseIndex, arr) => {
    const card = document.createElement('article');
    const isTop = reverseIndex === arr.length - 1;
    card.className = `swipe-card${isTop ? ' top-card' : ''}`;
    card.dataset.id = item.id;
    card.style.setProperty('--art', item.art);
    card.innerHTML = `
      <div class="card-art">
        <span class="art-symbol">${item.symbol}</span><span class="art-lines"></span>
      </div>
      <div class="card-top"><span class="type-badge">${typeLabel(item.type)}</span><span class="match-badge">FRAME ${getPreviewMatch(item)}%</span></div>
      <span class="swipe-stamp like">SUPER</span><span class="swipe-stamp save">MERKEN</span><span class="swipe-stamp dislike">MIST</span>
      <div class="card-copy">
        <div class="card-meta"><span>${item.year}</span><i></i><span>${item.meta}</span></div>
        <h2 class="card-title">${item.title}</h2>
        <p class="card-sub">${item.subtitle}</p>
        <div class="signal-row">${item.tags.slice(0,3).map(t=>`<span>${t}</span>`).join('')}</div>
      </div>`;
    deck.appendChild(card);
  });
  bindTopCard();
  updateUI();
}

function bindTopCard() {
  const card = $('.top-card');
  if (!card) return;
  card.addEventListener('pointerdown', startDrag);
  card.addEventListener('pointermove', moveDrag);
  card.addEventListener('pointerup', endDrag);
  card.addEventListener('pointercancel', endDrag);
}

function startDrag(e) {
  const card = e.currentTarget;
  card.setPointerCapture(e.pointerId);
  card.classList.add('dragging');
  drag = { card, x:e.clientX, y:e.clientY, dx:0, dy:0 };
}
function moveDrag(e) {
  if (!drag) return;
  drag.dx = e.clientX - drag.x;
  drag.dy = e.clientY - drag.y;
  const rotate = drag.dx * .045;
  drag.card.style.transform = `translate(${drag.dx}px, ${drag.dy}px) rotate(${rotate}deg)`;
  const like = drag.card.querySelector('.swipe-stamp.like');
  const dislike = drag.card.querySelector('.swipe-stamp.dislike');
  const save = drag.card.querySelector('.swipe-stamp.save');
  like.style.opacity = drag.dx < 0 ? Math.min(1, Math.abs(drag.dx)/85) : 0;
  dislike.style.opacity = drag.dx > 0 ? Math.min(1, drag.dx/85) : 0;
  save.style.opacity = drag.dy < -25 && Math.abs(drag.dy) > Math.abs(drag.dx) ? Math.min(1, Math.abs(drag.dy)/95) : 0;
}
function endDrag() {
  if (!drag) return;
  const { card, dx, dy } = drag;
  card.classList.remove('dragging');
  if (dy < -85 && Math.abs(dy) > Math.abs(dx) * .8) animateSwipe('save', card);
  else if (dx < -90) animateSwipe('like', card);
  else if (dx > 90) animateSwipe('dislike', card);
  else { card.style.transform = ''; $$('.swipe-stamp', card).forEach(s => s.style.opacity = 0); }
  drag = null;
}

function animateSwipe(action, card = $('.top-card')) {
  if (!card) return;
  const id = card.dataset.id;
  card.style.pointerEvents = 'none';
  if (action === 'like') card.style.transform = 'translate(-125vw, 20px) rotate(-19deg)';
  if (action === 'dislike') card.style.transform = 'translate(125vw, 20px) rotate(19deg)';
  if (action === 'save') card.style.transform = 'translate(0, -115vh) scale(.9)';
  card.style.opacity = '.2';
  setTimeout(() => recordSwipe(id, action), 220);
}

function recordSwipe(id, action) {
  state.swipes[id] = action;
  if (action === 'save' && !state.saved.includes(id)) state.saved.push(id);
  persist();
  const labels = {like:'Super. Geschmack gespeichert.', dislike:'Mist. Wird berücksichtigt.', save:'Auf die Watchlist gesetzt.'};
  showToast(labels[action]);
  renderDeck();
}

function getTasteWeights() {
  const weights = {};
  Object.entries(state.swipes).forEach(([id, action]) => {
    const item = catalog.find(x=>x.id===id); if (!item) return;
    const delta = action === 'like' ? 3 : action === 'dislike' ? -3 : 1;
    item.tags.forEach(tag => weights[tag] = (weights[tag] || 0) + delta);
  });
  return weights;
}
function scoreRecommendation(rec) {
  const w = getTasteWeights();
  const raw = rec.tags.reduce((sum,t)=>sum+(w[t]||0),0);
  const confidence = Math.min(18, swipedIds().length * 1.4);
  return Math.max(48, Math.min(98, Math.round(68 + raw*2.1 + confidence)));
}
function getPreviewMatch(item) {
  const w = getTasteWeights();
  const raw = item.tags.reduce((sum,t)=>sum+(w[t]||0),0);
  return Math.max(52, Math.min(96, Math.round(71 + raw*1.4)));
}

function renderWatchlist() {
  const grid = $('#watchlistGrid');
  const items = state.saved.map(id=>catalog.find(x=>x.id===id)).filter(Boolean);
  $('#watchlistCount').textContent = items.length;
  if (!items.length) {
    grid.innerHTML = '<div class="empty-list"><b>Noch ist es hier still.</b>Swipe eine Karte nach oben und sie landet hier für später.</div>';
    return;
  }
  grid.innerHTML = items.map(item=>`<article class="mini-card"><div class="mini-art" style="--art:${item.art}"></div><div class="mini-copy"><strong>${item.title}</strong><small>${typeLabel(item.type)} · ${item.year}</small></div></article>`).join('');
}

function renderRecommendations() {
  const ranked = [...recommendations].sort((a,b)=>scoreRecommendation(b)-scoreRecommendation(a));
  const hero = ranked[0];
  const score = scoreRecommendation(hero);
  $('#recommendHero').innerHTML = `<div class="rec-art" style="--art:${hero.art}"></div><div class="rec-copy"><span class="rec-score">${score}% MATCH</span><h2>${hero.title}</h2><p>${hero.type} · ${hero.year}</p></div>`;
  const weights = getTasteWeights();
  const reasons = hero.tags.map(tag=>({tag, score:weights[tag]||0})).sort((a,b)=>b.score-a.score).slice(0,3);
  $('#reasonChips').innerHTML = (reasons.length ? reasons : hero.tags.slice(0,3).map(tag=>({tag,score:0}))).map(r=>`<span>${r.score>0?'♥ ':''}${r.tag}</span>`).join('');
  $('#recommendList').innerHTML = ranked.slice(1,4).map(rec=>`<article class="rec-row"><div class="rec-thumb" style="--art:${rec.art}"></div><div class="rec-row-copy"><strong>${rec.title}</strong><small>${rec.type} · ${rec.year}</small></div><span class="rec-row-score">${scoreRecommendation(rec)}%</span></article>`).join('');
}

function renderTaste() {
  const entries = Object.entries(getTasteWeights()).sort((a,b)=>b[1]-a[1]);
  const positives = entries.filter(([,v])=>v>0).slice(0,8);
  const negatives = entries.filter(([,v])=>v<0).sort((a,b)=>a[1]-b[1]).slice(0,6);
  $('#positiveTags').innerHTML = positives.length ? positives.map(([t,v])=>`<span>${t} +${v}</span>`).join('') : '<span>Noch keine Signale</span>';
  $('#negativeTags').innerHTML = negatives.length ? negatives.map(([t,v])=>`<span>${t} ${v}</span>`).join('') : '<span>Noch keine Cuts</span>';

  const actions = Object.values(state.swipes);
  const progress = Math.min(100, 12 + actions.length * 5);
  $('#dnaScore').textContent = progress;
  $('#tastePercent').textContent = progress;
  $('#dnaProgress').style.width = progress + '%';
  $('#swipeCount').textContent = actions.length;
  $('#frameIndex').textContent = String(actions.length * 24).padStart(3,'0');
  $('#likedStat').textContent = actions.filter(a=>a==='like').length;
  $('#savedStat').textContent = actions.filter(a=>a==='save').length;
  $('#dislikedStat').textContent = actions.filter(a=>a==='dislike').length;
}

function updateUI() { renderWatchlist(); renderRecommendations(); renderTaste(); }

function switchView(target) {
  $$('.view').forEach(v=>v.classList.toggle('active', v.dataset.view===target));
  $$('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.target===target));
  if (target !== 'discover') updateUI();
  window.scrollTo({top:0, behavior:'smooth'});
}

function showToast(text) {
  const toast = $('#toast'); toast.textContent = text; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>toast.classList.remove('show'), 1500);
}

$$('.nav-item').forEach(n=>n.addEventListener('click',()=>switchView(n.dataset.target)));
$('#profileShortcut').addEventListener('click',()=>switchView('taste'));
$$('.filter').forEach(btn=>btn.addEventListener('click',()=>{
  state.filter = btn.dataset.filter; persist();
  $$('.filter').forEach(b=>b.classList.toggle('active',b===btn));
  renderDeck();
}));
$('#likeButton').addEventListener('click',()=>animateSwipe('like'));
$('#saveButton').addEventListener('click',()=>animateSwipe('save'));
$('#dislikeButton').addEventListener('click',()=>animateSwipe('dislike'));
$('#reshuffleButton').addEventListener('click',()=>{ state.swipes={}; state.saved=[]; persist(); renderDeck(); showToast('Neuer Schnitt. Neuer Feed.'); });
$('#resetButton').addEventListener('click',()=>{ state={...defaultState, swipes:{}, saved:[]}; persist(); renderDeck(); switchView('discover'); showToast('FRAME auf Anfang gesetzt.'); });

let brandTaps = 0;
$('#brandButton').addEventListener('click',()=>{
  brandTaps++;
  if (brandTaps === 5) { showToast('FRAME 24 // PROJECTOR ONLINE'); state.secret = Math.max(state.secret||0,1); persist(); brandTaps=0; }
});
let roomTaps = 0;
$('#mysteryCode').addEventListener('click',(e)=>{
  roomTaps++; e.currentTarget.classList.add('awake');
  setTimeout(()=>e.currentTarget.classList.remove('awake'),500);
  if(roomTaps===3){ e.currentTarget.textContent='ROOM 237'; showToast('Du hast die falsche Tür gefunden.'); state.secret=Math.max(state.secret||0,2); persist(); roomTaps=0; }
});
$('#tinyCredit').addEventListener('click',(e)=>{
  if ((state.secret||0) >= 2) { e.currentTarget.textContent='FRAME / 1.21 / SEE YOU IN THE NEXT CUT'; showToast('Zeitcode verschoben.'); }
});

$$('.filter').forEach(b=>b.classList.toggle('active', b.dataset.filter===state.filter));
renderDeck();

if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
