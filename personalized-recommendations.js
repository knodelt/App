(() => {
  const HISTORY_KEY = 'frame-recommendation-history-v1';
  const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
  let history = loadHistory();
  let lastSignature = '';
  let requestSerial = 0;
  let cachedItems = [];
  let lastSignalCount = 0;
  let shownRecommendations = 6;
  let loading = false;
  function weeklySelection(items){
    if(!Array.isArray(items)||items.length<2)return [...(items||[])];
    // Pick within the top four ranked recommendations. Rotation changes
    // each Monday; high-affinity titles remain in the full list.
    const now=new Date();
    const monday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-(now.getDay()+6)%7);
    const week=Math.floor(Date.UTC(monday.getFullYear(),monday.getMonth(),monday.getDate())/(7*86400000));
    const index=((week%Math.min(items.length,4))+Math.min(items.length,4))%Math.min(items.length,4);
    return [items[index],...items.filter((item,i)=>i!==index)];
  }
  const READY_ANNOUNCED_KEY = 'frame-for-you-ready-announced-v1';
  const READY_VIEWED_KEY = 'frame-for-you-ready-viewed-v1';
  let readyNoticeReturnFocus = null;
  let lastReadinessProbe = 0;
  let readyProbeAttempts = 0;

  function invalidateRecommendations() {
    ++requestSerial;
    loading = false;
    cachedItems = [];
    shownRecommendations = 6;
    lastSignature = '';
  }

  function recommendationSurfaceVisible() {
    return Boolean(document.querySelector('#personalizedView')?.classList.contains('active'));
  }

  function setRecommendationModal(open) {
    const modal = document.querySelector('#recommendationModal');
    if (!modal) return;
    if (open && !recommendationSurfaceVisible()) switchView('personalized');
    if (!open && recommendationSurfaceVisible()) switchView('discover');
    modal.classList.toggle('open', Boolean(open));
    modal.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      hideReadyNotice();
      queueMicrotask(() => refreshRecommendations());
    }
  }


  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); window.FrameCloud?.changed?.(); } catch {}
  }

  function parseTmdbId(id) {
    const match = String(id || '').match(/^tmdb-(movie|series|person)-(\d+)$/);
    return match ? { type:match[1], tmdbId:Number(match[2]) } : null;
  }

  function snapshotItem(item, action) {
    if (!item?.id) return null;
    const parsed = parseTmdbId(item.id);
    return {
      id:item.id,
      tmdbId:Number(item.tmdbId || parsed?.tmdbId) || null,
      type:item.type || parsed?.type || null,
      title:item.title || '',
      tags:Array.isArray(item.tags) ? item.tags.slice(0,10) : [],
      action,
      updatedAt:Date.now()
    };
  }

  function syncHistory() {
    let changed = false;
    const activeIds = new Set(Object.keys(state.swipes || {}));

    Object.keys(history).forEach(id => {
      if (!activeIds.has(id)) {
        delete history[id];
        changed = true;
      }
    });

    Object.entries(state.swipes || {}).forEach(([id, action]) => {
      const item = catalog.find(entry => entry.id === id);
      if (item) {
        const next = snapshotItem(item, action);
        const previous = history[id];
        if (!previous || previous.action !== action || previous.title !== next.title || previous.tmdbId !== next.tmdbId) {
          history[id] = next;
          changed = true;
        }
        return;
      }

      const parsed = parseTmdbId(id);
      if (parsed && !history[id]) {
        history[id] = {
          id,
          tmdbId:parsed.tmdbId,
          type:parsed.type,
          title:'',
          tags:[],
          action,
          updatedAt:Date.now()
        };
        changed = true;
      } else if (history[id] && history[id].action !== action) {
        history[id].action = action;
        changed = true;
      }
    });

    if (changed) saveHistory();
  }

  function actionWeight(action) {
    return action === 'like' ? 3 : action === 'save' ? 1 : action === 'dislike' ? -3 : 0;
  }

  function buildPayload() {
    syncHistory();
    const watchedItems=Object.values(state.watched||{})
      .filter(entry=>entry?.item?.id && ['like','dislike'].includes(entry.rating));
    const byId=new Map();
    Object.values(history).filter(entry=>state.swipes?.[entry.id]).forEach(entry=>{
      byId.set(entry.id,{
        ...entry,action:state.swipes[entry.id],watched:false,
        updatedAt:Number(entry.updatedAt||0)
      });
    });
    for(const entry of watchedItems){
      const item=entry.item,previous=byId.get(item.id)||{};
      byId.set(item.id,{
        ...previous,id:item.id,type:item.type,tmdbId:item.tmdbId||previous.tmdbId,
        title:item.title||previous.title,
        tags:item.tags?.length?item.tags:(previous.tags||[]),
        action:entry.rating,watched:true,
        updatedAt:Number(entry.watchedAt||Date.now())
      });
    }
    const entries=[...byId.values()].sort((a,b)=>b.updatedAt-a.updatedAt);
    const tagMap=new Map();
    for(const entry of entries){
      const weight=actionWeight(entry.action)*(entry.watched?2.5:1);
      for(const tag of entry.tags||[]){
        if(!tag||String(tag).length>60)continue;
        tagMap.set(tag,(tagMap.get(tag)||0)+weight);
      }
    }
    const tagWeights=[...tagMap.entries()]
      .filter(([,weight])=>weight!==0)
      .sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))
      .slice(0,30).map(([tag,weight])=>({tag,weight}));
    const signals=entries
      .filter(entry=>entry.tmdbId&&['movie','series','person'].includes(entry.type))
      .slice(0,100).map(entry=>({
        tmdbId:entry.tmdbId,type:entry.type,title:entry.title,
        action:entry.action,watched:entry.watched
      }));

    return {
      signals,
      tagWeights,
      tasteDNA: window.getFrameTasteDNA?.() || {version:2,featureWeights:[],pairWeights:[],answeredCount:0},
      onlineModel: window.getFrameOnlineModel?.() || {version:1,algorithm:'online-logistic-pairwise-v1',steps:0,examples:0,explorationRate:.15,featureWeights:[]},
      mood: window.getFrameMood?.() || 'any'
    };
  }

  // The very first FRAME cards are curated local seeds. Their user votes
  // matter for taste learning even though they do not always have TMDB IDs.
  // Server-side candidate generation uses TMDB seeds when available and
  // otherwise also learns from genre/tag weights, DNA and the online model.
  function readinessStats() {
    syncHistory();
    const media = Object.entries(state.swipes || {}).filter(([id, action]) => {
      if (!['like','save','dislike'].includes(action)) return false;
      const known = history[id] || catalog.find(item => item.id === id);
      const type = known?.type || parseTmdbId(id)?.type;
      return type === 'movie' || type === 'series';
    });
    const positives = media.filter(([,action]) => action === 'like' || action === 'save').length;
    const negatives = media.filter(([,action]) => action === 'dislike').length;
    // A balanced profile can start after eight real media decisions; someone
    // who simply likes everything can still get a first mix after twelve.
    const ready = media.length >= 8 && positives >= 3 && (negatives >= 2 || media.length >= 12);
    const percent = ready ? 100 : Math.min(99, Math.round(
      Math.min(1,media.length / 8) * 55 +
      Math.min(1,positives / 3) * 30 +
      Math.min(1,negatives / 2) * 15
    ));
    return {ready,media:media.length,positives,negatives,percent};
  }

  function readyFlag(key) {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  }

  function setReadyFlag(key) {
    try { localStorage.setItem(key, '1'); } catch {}
  }

  function updateReadyIndicator(ready = readinessStats().ready) {
    const dot = document.querySelector('#forYouNewIndicator');
    if (dot) dot.hidden = !(ready && readyFlag(READY_ANNOUNCED_KEY) && !readyFlag(READY_VIEWED_KEY));
  }

  function hideReadyNotice({restoreFocus = false} = {}) {
    const notice = document.querySelector('#forYouReadyNotice');
    const wasVisible = Boolean(notice && !notice.hidden);
    if (notice) notice.hidden = true;
    if (restoreFocus && wasVisible && readyNoticeReturnFocus?.isConnected) {
      readyNoticeReturnFocus.focus({preventScroll:true});
    }
    readyNoticeReturnFocus = null;
  }

  function markRecommendationsViewed() {
    if (!readinessStats().ready) return;
    setReadyFlag(READY_ANNOUNCED_KEY);
    setReadyFlag(READY_VIEWED_KEY);
    hideReadyNotice();
    updateReadyIndicator(true);
  }

  function isOnboardingActive() {
    const welcome = document.querySelector('.frame-welcome');
    const tour = document.querySelector('.frame-tutorial');
    return Boolean((welcome && !welcome.hidden) || (tour && !tour.hidden));
  }

  function announceReadyIfNeeded() {
    // Opening the tab acknowledges the notification, including on later visits.
    if (recommendationSurfaceVisible()) {
      markRecommendationsViewed();
      return;
    }
    if (readyFlag(READY_ANNOUNCED_KEY)) {
      updateReadyIndicator(true);
      return;
    }
    if (isOnboardingActive()) return;

    // Announce only after a successful API response with several real titles.
    setReadyFlag(READY_ANNOUNCED_KEY);
    updateReadyIndicator(true);
    const notice = document.querySelector('#forYouReadyNotice');
    if (!notice) return;
    readyNoticeReturnFocus = document.activeElement?.focus ? document.activeElement : null;
    notice.hidden = false;
    queueMicrotask(() => notice.querySelector('#forYouReadyOpen')?.focus({preventScroll:true}));
  }

  function renderLearningProgress(stats) {
    const hero = document.querySelector('#recommendHero');
    const list = document.querySelector('#recommendList');
    const reasons = document.querySelector('#reasonChips');
    if (!hero || !list || !reasons) return;
    const missing = stats.media < 8
      ? `Noch ${8 - stats.media} Film- oder Serienentscheidungen für deine ersten Tipps.`
      : stats.positives < 3
        ? `Noch ${3 - stats.positives} positive Entscheidungen mit SUPER oder MERKEN.`
        : stats.negatives < 2
          ? `Zwei MIST helfen beim Eingrenzen – alternativ lernt FRAME nach zwölf Entscheidungen auch ohne MIST.`
          : 'FRAME prüft gerade deine Vorschläge.';
    hero.innerHTML = `<div class="for-you-learning">
      <span class="eyebrow">FRAME lernt</span>
      <strong>Dein Geschmack nimmt Form an.</strong>
      <p>${missing} So vermeidest du beliebige Empfehlungen.</p>
      <div class="for-you-learning-progress" role="progressbar" aria-label="Fortschritt bis zu persönlichen Empfehlungen" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${stats.percent}"><span style="width:${stats.percent}%"></span></div>
      <small>${stats.media} Titel · ${stats.positives} SUPER/MERKEN · ${stats.negatives} MIST</small>
      <button type="button" id="forYouKeepSwiping">Weiter swipen</button>
    </div>`;
    hero.removeAttribute('data-tmdb-id');
    hero.removeAttribute('data-media-type');
    list.innerHTML = '';
    reasons.innerHTML = '<span>Aus deinen Entscheidungen entsteht dein persönliches Profil</span>';
    hero.querySelector('#forYouKeepSwiping')?.addEventListener('click', () => switchView('discover'));
  }

  function probeReadyInBackground() {
    if (readyFlag(READY_ANNOUNCED_KEY) || recommendationSurfaceVisible() || loading) return;
    if (!readinessStats().ready || readyProbeAttempts >= 3) return;
    const now = Date.now();
    if (now - lastReadinessProbe < 5000) {
      scheduleReadyProbe(5200 - (now - lastReadinessProbe));
      return;
    }
    lastReadinessProbe = now;
    readyProbeAttempts += 1;
    queueMicrotask(() => refreshRecommendations({background:true}));
  }

  function injectStyles() {
    if (document.querySelector('#framePersonalizedRecommendationStyles')) return;
    const style = document.createElement('style');
    style.id = 'framePersonalizedRecommendationStyles';
    style.textContent = `
      .recommend-loading,
      .recommend-error {
        min-height:210px; display:grid; place-content:center; text-align:center;
        border:1px dashed rgba(255,255,255,.10); border-radius:24px;
        color:#77736d; padding:30px; font-size:11px; line-height:1.55;
      }
      .recommend-loading b,
      .recommend-error b { display:block; color:var(--cream); font-family:"Playfair Display",serif; font-size:24px; margin-bottom:7px; }
      #recommendHero .rec-art {
        background-size:cover !important;
        background-position:center 28% !important;
        background-repeat:no-repeat !important;
      }
      #recommendList .rec-row { position:relative; }
      #recommendList .rec-thumb {
        width:60px;
        flex:0 0 60px;
        aspect-ratio:2/3;
        height:auto;
        display:block;
        object-fit:cover;
        object-position:center top;
        border-radius:10px;
        background:#17171b;
      }
      #recommendList .rec-thumb-fallback {
        width:60px;
        flex:0 0 60px;
        aspect-ratio:2/3;
        border-radius:10px;
        background:linear-gradient(145deg,#51483d,#18181b);
      }
      .rec-reason-mini { display:block; color:#8f8a83; font-size:10px; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:220px; }
      .rec-description-mini {
        display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden;
        margin-top:5px; color:#aaa59e; font-size:11px; line-height:1.35;
      }
      .rec-hero-description {
        margin:8px 0 0 !important; max-width:94%; color:#d5d0c8 !important;
        font-size:12px !important; line-height:1.4; text-transform:none !important; letter-spacing:0 !important;
        display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden;
      }
      .rec-actions { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
      .rec-action {
        min-height:34px; padding:7px 11px; border-radius:999px;
        border:1px solid rgba(255,255,255,.13); background:rgba(15,15,18,.72);
        color:#f2eee8; font:700 11px/1 Manrope,system-ui,sans-serif;
        -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
      }
      .rec-action.remove { color:#ff8a98; border-color:rgba(255,111,135,.28); }
      .rec-action.save {color:#c2edc8;border-color:rgba(151,227,166,.35);background:rgba(18,60,39,.8);}
      .rec-action.save.is-saved {color:#a7dfa8;background:rgba(33,87,49,.52);}
      .rec-action.save:disabled {cursor:default;opacity:1;}
      .rec-action.watched {color:#ffd4ab;border-color:rgba(255,193,131,.3);background:rgba(76,45,25,.34);}
      .rec-action.watched.is-watched {color:#c8e9cc;border-color:rgba(157,225,178,.3);}
      .rec-detail-bottom-actions .rec-detail-watched {
        grid-column:1 / -1;min-height:43px;border:1px solid rgba(255,190,126,.24);
        border-radius:13px;background:rgba(255,180,110,.11);color:#ffe4c4;font-weight:800;
      }
      .rec-detail-bottom-actions .rec-detail-save {
        grid-column:1 / -1;min-height:44px;border-radius:13px;
        border:1px solid rgba(151,227,166,.32);background:rgba(31,76,48,.25);
        color:#c7eac8;font-weight:800;
      }
      .rec-detail-bottom-actions .rec-detail-save:disabled {opacity:1;color:#a7dfa8;}

      #recommendList .rec-row { cursor:pointer; }
      #recommendList .rec-row-copy { min-width:0; }
      #recommendList .rec-actions { margin-top:7px; }
      #recommendList .rec-action { min-height:30px; padding:6px 9px; font-size:10px; }
      .profile-signal-note { color:#77726c; font-size:9px; letter-spacing:.02em; margin:8px 0 0 2px; }

      .rec-detail-modal {
        position:fixed; inset:0; z-index:160; display:flex; align-items:flex-end; justify-content:center;
        background:rgba(5,5,7,.72); opacity:0; pointer-events:none;
        -webkit-backdrop-filter:blur(12px); backdrop-filter:blur(12px);
        transition:opacity .18s ease;
      }
      .rec-detail-modal.open { opacity:1; pointer-events:auto; }
      .rec-detail-sheet {
        width:min(100%,520px); max-height:86dvh; overflow:auto; overscroll-behavior:contain;
        border-radius:28px 28px 0 0; border:1px solid rgba(255,255,255,.12); border-bottom:0;
        background:#111114; box-shadow:0 -24px 70px rgba(0,0,0,.55);
        transform:translateY(16px); transition:transform .2s ease;
      }
      .rec-detail-modal.open .rec-detail-sheet { transform:none; }
      .rec-detail-art {
        height:220px; position:relative; background:#1a1a1f center 25%/cover no-repeat;
        border-radius:27px 27px 0 0; overflow:hidden;
      }
      .rec-detail-art::after {
        content:""; position:absolute; inset:0;
        background:linear-gradient(180deg,rgba(0,0,0,.02),rgba(0,0,0,.18) 52%,#111114 100%);
      }
      .rec-detail-close {
        position:absolute; z-index:3; top:14px; right:14px; width:40px; height:40px; border:0;
        border-radius:50%; background:rgba(10,10,12,.62); color:#fff; font-size:24px;
        -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
      }
      .rec-detail-content { padding:0 20px calc(24px + env(safe-area-inset-bottom)); margin-top:-22px; position:relative; z-index:2; }
      .rec-detail-type { color:#ff6070; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; }
      .rec-detail-title {
        margin:5px 0 8px; color:#fff; font-family:Fraunces,Georgia,serif; font-size:38px; line-height:.94; letter-spacing:-.035em;
      }
      .rec-detail-primary { margin:0 0 14px; color:#a9a49e; font-size:12px; font-weight:700; }
      .rec-detail-description { margin:0; color:#ddd8d1; font-size:14px; line-height:1.55; }
      .rec-detail-facts { display:grid; gap:10px; margin-top:18px; }
      .rec-detail-fact { display:grid; grid-template-columns:72px minmax(0,1fr); gap:10px; }
      .rec-detail-fact b { color:#77726d; font-size:10px; text-transform:uppercase; letter-spacing:.04em; }
      .rec-detail-fact span { color:#d4cfc8; font-size:12px; line-height:1.4; }
      .rec-detail-streaming { margin-top:18px; }
      .rec-detail-streaming > b { display:block; margin-bottom:8px; color:#77726d; font-size:10px; text-transform:uppercase; }
      .rec-detail-provider-list { display:flex; flex-wrap:wrap; gap:7px; }
      .rec-detail-provider {
        padding:7px 10px; border-radius:999px; border:1px solid rgba(255,255,255,.12);
        background:#19191d; color:#eee9e2; font-size:11px; font-weight:700;
      }
      .rec-detail-bottom-actions { display:grid; grid-template-columns:1fr 1fr; gap:9px; margin-top:20px; }
      .rec-detail-bottom-actions button {
        min-height:46px; border-radius:14px; border:1px solid rgba(255,255,255,.12);
        background:#1a1a1f; color:#f4f0ea; font:800 12px/1 Manrope,system-ui,sans-serif;
      }
      .rec-detail-bottom-actions .remove { color:#ff8291; }
      .rec-detail-loading { color:#8b8680; font-size:12px; margin-top:14px; }
    `;
    document.head.appendChild(style);
  }

  function imageUrl(path, size='w780') {
    return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : '';
  }

  function setDataset(node, item) {
    if (!node || !item) return;
    node.dataset.tmdbId = String(item.tmdbId || '');
    node.dataset.mediaType = item.type || '';
  }

  function saveButtonMarkup(item) {
    const key=recommendationKey(item);
    const id=recommendationStateId(item);
    const seen=Boolean(state.watched?.[id]);
    const saved=Boolean(state.saved?.includes(id));
    return '<button class="rec-action save'+(saved||seen?' is-saved':'')+'" type="button" '+
      'data-rec-action="save" data-rec-key="'+escapeHtml(key)+'"'+
      (saved||seen?' disabled aria-pressed="true"':' aria-pressed="false"')+'>'+
      (seen?'✓ Gesehen':saved?'✓ Gemerkt':'+ Merken')+'</button>';
  }

  function watchedButtonMarkup(item) {
    const checked=Boolean(state.watched?.[recommendationStateId(item)]);
    return '<button class="rec-action watched'+(checked?' is-watched':'')+
      '" type="button" data-rec-action="watched" data-rec-key="'+escapeHtml(recommendationKey(item))+'">'+
      (checked?'✓ Gesehen · Ändern':'✓ Gesehen?')+'</button>';
  }

  function updateSaveButtons() {
    document.querySelectorAll('#personalizedView [data-rec-action="save"], #recommendDetailModal [data-detail-action="save"]')
      .forEach(button=>{
        const modal=button.closest('#recommendDetailModal');
        const key=modal?.dataset.recKey||button.dataset.recKey||'';
        const item=findRecommendation(key);
        if(!item)return;
        const id=recommendationStateId(item);
        const saved=Boolean(state.saved?.includes(id));
        const seen=Boolean(state.watched?.[id]);
        button.disabled=saved||seen;
        button.classList.toggle('is-saved',saved||seen);
        button.setAttribute('aria-pressed',String(saved||seen));
        button.textContent=seen?'✓ Gesehen':saved?'✓ Gemerkt':'+ Merken';
      });
    document.querySelectorAll('#personalizedView [data-rec-action="watched"], #recommendDetailModal [data-detail-action="watched"]')
      .forEach(button=>{
        const modal=button.closest('#recommendDetailModal');
        const key=modal?.dataset.recKey||button.dataset.recKey||'';
        const item=findRecommendation(key);
        if(!item)return;
        const seen=Boolean(state.watched?.[recommendationStateId(item)]);
        button.classList.toggle('is-watched',seen);
        button.textContent=seen?'✓ Gesehen · Ändern':'✓ Gesehen?';
      });
  }

  function renderPersonalized(items, signalCount) {
    lastSignalCount=Number(signalCount)||0;
    const ordered=weeklySelection(items);
    const heroHost = document.querySelector('#recommendHero');
    const listHost = document.querySelector('#recommendList');
    const reasonHost = document.querySelector('#reasonChips');
    if (!heroHost || !listHost || !reasonHost) return;

    if (!items.length) {
      heroHost.innerHTML = '<div class="recommend-error"><div><b>Noch kein Treffer.</b>Swipe ein paar weitere Filme oder Serien – dann versucht FRAME es erneut.</div></div>';
      heroHost.removeAttribute('data-tmdb-id');
      heroHost.removeAttribute('data-media-type');
      listHost.innerHTML = '';
      reasonHost.innerHTML = '<span>Mehr Signale nötig</span>';
      return;
    }

    const hero = ordered[0];
    setDataset(heroHost, hero);
    const heroImage = imageUrl(hero.backdrop || hero.poster, 'w780');
    heroHost.innerHTML = `
      <div class="rec-art" style="${heroImage ? `background-image:linear-gradient(180deg,rgba(0,0,0,.02) 18%,rgba(0,0,0,.18) 48%,rgba(0,0,0,.9) 100%),url('${heroImage}')` : 'background:linear-gradient(145deg,#37342f,#17171a 55%,#09090b)'}"></div>
      <div class="rec-copy">
        <span class="frame-weekly-pick">DEIN WOCHEN-FOKUS · WECHSELT MONTAGS</span>
        <span class="rec-score">${hero.match}% MATCH</span>
        <h2>${escapeHtml(hero.title)}</h2>
        <p>${hero.type === 'series' ? 'Serie' : 'Film'} · ${escapeHtml(hero.year || '—')}</p>
        <p class="rec-hero-description">${escapeHtml(hero.description || '')}</p>
        <div class="rec-actions">
          ${saveButtonMarkup(hero)}
          ${watchedButtonMarkup(hero)}
          <button class="rec-action details" type="button" data-rec-action="details" data-rec-key="${hero.type}:${hero.tmdbId}">Details</button>
          <button class="rec-action remove" type="button" data-rec-action="remove" data-rec-key="${hero.type}:${hero.tmdbId}">Nicht für mich</button>
        </div>
      </div>`;

    const reasons = (hero.reasons || []).slice(0,3);
    reasonHost.innerHTML = (reasons.length ? reasons : ['Aus deinem Swipe-Profil'])
      .map(reason => `<span>${escapeHtml(reason)}</span>`).join('');

    listHost.innerHTML = ordered.slice(1,shownRecommendations).map(item => {
      const poster = imageUrl(item.poster, 'w342');
      const fallback = imageUrl(item.backdrop, 'w342');
      const image = poster || fallback;
      const reason = (item.reasons || [])[0] || 'Aus deinem Profil';
      const thumb = image
        ? `<img class="rec-thumb${poster ? '' : ' is-backdrop'}" src="${escapeHtml(image)}" alt="Poster von ${escapeHtml(item.title)}" loading="lazy" decoding="async">`
        : '<div class="rec-thumb-fallback" aria-hidden="true"></div>';
      return `<article class="rec-row" data-tmdb-id="${item.tmdbId}" data-media-type="${item.type}">
        ${thumb}
        <div class="rec-row-copy">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${item.type === 'series' ? 'Serie' : 'Film'} · ${escapeHtml(item.year || '—')}</small>
          <span class="rec-reason-mini">${escapeHtml(reason)}</span>
          <span class="rec-description-mini">${escapeHtml(item.description || '')}</span>
          <div class="rec-actions">
            ${saveButtonMarkup(item)}
            ${watchedButtonMarkup(item)}
            <button class="rec-action details" type="button" data-rec-action="details" data-rec-key="${item.type}:${item.tmdbId}">Details</button>
            <button class="rec-action remove" type="button" data-rec-action="remove" data-rec-key="${item.type}:${item.tmdbId}">Entfernen</button>
          </div>
        </div>
        <span class="rec-row-score">${item.match}%</span>
      </article>`;
    }).join('');
    if(ordered.length>shownRecommendations){
      const remaining=ordered.length-shownRecommendations;
      listHost.insertAdjacentHTML('beforeend',
        '<button id="forYouShowMore" type="button" class="for-you-more" '+
        'aria-label="Weitere persönliche Filmempfehlungen anzeigen">'+
        'Weitere '+remaining+' passende '+(remaining===1?'Empfehlung':'Empfehlungen')+' anzeigen <span aria-hidden="true">↓</span></button>');
    }

    let note = document.querySelector('#recommendSignalNote');
    if (!note) {
      note = document.createElement('p');
      note.id = 'recommendSignalNote';
      note.className = 'profile-signal-note';
      document.querySelector('.why-panel')?.appendChild(note);
    }
    if (note) {
      const dna = window.getFrameTasteDNA?.() || {};
      const learned = window.getFrameOnlineModel?.() || {};
      note.textContent = `${signalCount} Swipes · ${Number(dna.answeredCount || 0)} Fragen · ${Number(learned.examples || 0)} trainierte Entscheidungen`;
    }

    updateSaveButtons();
    document.dispatchEvent(new CustomEvent('frame:recommendations-rendered'));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
    }[char]));
  }

  function recommendationKey(item) {
    return item ? `${item.type}:${item.tmdbId}` : '';
  }

  function findRecommendation(key) {
    return cachedItems.find(item => recommendationKey(item) === key) || null;
  }

  function recommendationStateId(item) {
    return item ? `tmdb-${item.type}-${item.tmdbId}` : '';
  }

  function saveRecommendation(item) {
    if(!item || !['movie','series'].includes(item.type))return;
    const idNumber=Number(item.tmdbId);
    if(!Number.isSafeInteger(idNumber)||idNumber<=0)return;
    const id=recommendationStateId(item);
    if(state.watched?.[id]){
      updateSaveButtons();
      showToast('Schon gesehen. Deine Bewertung findest du in FRAMELOG.');
      return;
    }
    if(state.saved?.includes(id)){
      updateSaveButtons();
      showToast('Dieser Titel ist bereits in deiner Merkliste.');
      return;
    }

    const safePoster=/^\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(String(item.poster||''))
      ? item.poster : null;
    const title=String(item.title||'').slice(0,160);
    const tags=(Array.isArray(item.tags)?item.tags:[])
      .filter(tag=>typeof tag==='string').slice(0,12).map(tag=>tag.slice(0,60));
    const card={
      id,tmdbId:idNumber,source:'tmdb',type:item.type,title,
      year:String(item.year||'').slice(0,4),
      meta:item.type==='series'?'Serie':'Film',
      subtitle:tags.slice(0,2).join(' · '),
      blurb:String(item.description||'').slice(0,450),
      tags,symbol:'✦',poster:safePoster,
      art:'linear-gradient(145deg,#47353f,#171319)'
    };

    // The very same state used by a MERKEN swipe, plus the metadata needed
    // to display personalized titles even after a reload or feed reshuffle.
    state.saved=Array.isArray(state.saved)?state.saved:[];
    state.saved.push(id);
    state.savedItems={...(state.savedItems||{}),[id]:card};
    state.swipes[id]='save';
    try{persist();}
    catch(error){
      state.saved=state.saved.filter(savedId=>savedId!==id);
      delete state.savedItems[id];
      delete state.swipes[id];
      showToast('Konnte den Film nicht speichern.');
      return;
    }
    history[id]=snapshotItem(card,'save');
    saveHistory();
    renderWatchlist();
    renderTaste();

    updateReadyIndicator();
    updateSaveButtons();
    showToast('Gemerkt. FRAME berücksichtigt das für neue Vorschläge.');
    document.dispatchEvent(new CustomEvent('frame:recommendation-saved',{detail:{id,item:card}}));
    document.dispatchEvent(new CustomEvent('frame:watchlist-updated',{detail:{id,saved:true}}));
    // New MERKEN signal should influence the next recommendations immediately.
    // Keep existing cards visible until the background response has arrived.
    lastSignature='';
    if(recommendationSurfaceVisible())
      queueMicrotask(()=>refreshRecommendations({background:true}));
  }

  function rejectRecommendation(item) {
    if (!item) return;
    const id = recommendationStateId(item);
    state.swipes[id] = 'dislike';
    state.saved = (state.saved || []).filter(savedId => savedId !== id);
    history[id] = {
      id,
      tmdbId:Number(item.tmdbId),
      type:item.type,
      title:item.title || '',
      tags:Array.isArray(item.tags) ? item.tags.slice(0,10) : [],
      action:'dislike',
      updatedAt:Date.now()
    };
    persist();
    saveHistory();
    cachedItems = cachedItems.filter(entry => recommendationKey(entry) !== recommendationKey(item));
    lastSignature = '';

    try { renderTaste(); } catch {}
    showToast('Entfernt. Dein Geschmack wurde angepasst.');
    document.dispatchEvent(new CustomEvent('frame:recommendation-rejected', {detail:{item}}));
    closeRecommendationDetails();
    queueMicrotask(() => refreshRecommendations({force:true}));
  }

  let detailSerial = 0;

  function ensureRecommendationDetailModal() {
    let modal = document.querySelector('#recommendDetailModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'recommendDetailModal';
    modal.className = 'rec-detail-modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML = `
      <section class="rec-detail-sheet" role="dialog" aria-modal="true" aria-label="Film Details">
        <div class="rec-detail-art">
          <button class="rec-detail-close" type="button" aria-label="Details schließen">×</button>
        </div>
        <div class="rec-detail-content">
          <span class="rec-detail-type"></span>
          <h2 class="rec-detail-title"></h2>
          <p class="rec-detail-primary"></p>
          <p class="rec-detail-description"></p>
          <div class="rec-detail-facts"></div>
          <div class="rec-detail-streaming">
            <b>Streaming · Deutschland</b>
            <div class="rec-detail-provider-list"><span class="rec-detail-loading">Wird geladen …</span></div>
          </div>
          <div class="rec-detail-bottom-actions">
            <button class="rec-detail-save" type="button" data-detail-action="save" aria-pressed="false">+ Merken</button>
            <button class="rec-detail-watched" type="button" data-detail-action="watched">✓ Gesehen?</button>
            <button type="button" data-detail-action="close">Schließen</button>
            <button class="remove" type="button" data-detail-action="remove">Nicht für mich</button>
          </div>
        </div>
      </section>`;
    document.body.appendChild(modal);

    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('.rec-detail-close') || event.target.closest('[data-detail-action="close"]')) {
        closeRecommendationDetails();
        return;
      }
      if (event.target.closest('[data-detail-action="watched"]')) {
        window.FrameWatched?.open(findRecommendation(modal.dataset.recKey || ''));
        return;
      }
      if (event.target.closest('[data-detail-action="save"]')) {
        saveRecommendation(findRecommendation(modal.dataset.recKey || ''));
        return;
      }
      if (event.target.closest('[data-detail-action="remove"]')) {
        const key = modal.dataset.recKey || '';
        rejectRecommendation(findRecommendation(key));
      }
    });
    return modal;
  }

  function closeRecommendationDetails() {
    const modal = document.querySelector('#recommendDetailModal');
    if (!modal) return;
    detailSerial += 1;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
    modal.removeAttribute('data-rec-key');
  }

  async function openRecommendationDetails(item) {
    if (!item) return;
    const serial = ++detailSerial;
    const modal = ensureRecommendationDetailModal();
    modal.dataset.recKey = recommendationKey(item);
    updateSaveButtons();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');

    const art = modal.querySelector('.rec-detail-art');
    const image = imageUrl(item.backdrop || item.poster, 'w780');
    art.style.backgroundImage = image ? `url("${image}")` : 'linear-gradient(145deg,#2a2930,#111114)';

    modal.querySelector('.rec-detail-type').textContent = item.type === 'series' ? 'Serie' : 'Film';
    modal.querySelector('.rec-detail-title').textContent = item.title || '';
    modal.querySelector('.rec-detail-primary').textContent = `${item.year || '—'} · ${item.match || '—'}% Match`;
    modal.querySelector('.rec-detail-description').textContent = item.description || 'Noch keine Beschreibung verfügbar.';
    modal.querySelector('.rec-detail-facts').innerHTML = '<p class="rec-detail-loading">Details werden geladen …</p>';
    modal.querySelector('.rec-detail-provider-list').innerHTML = '<span class="rec-detail-loading">Wird geladen …</span>';

    const detailsUrl = `/api/details?type=${encodeURIComponent(item.type)}&id=${encodeURIComponent(item.tmdbId)}`;
    const availabilityUrl = `/api/availability?type=${encodeURIComponent(item.type)}&id=${encodeURIComponent(item.tmdbId)}`;

    const [detailResult, availabilityResult] = await Promise.allSettled([
      fetch(detailsUrl, {headers:{accept:'application/json'}, cache:'no-store'}).then(r => r.json().then(data => ({ok:r.ok,data}))),
      fetch(availabilityUrl, {headers:{accept:'application/json'}, cache:'no-store'}).then(r => r.json().then(data => ({ok:r.ok,data})))
    ]);
    if (serial !== detailSerial || !modal.classList.contains('open')) return;

    if (detailResult.status === 'fulfilled' && detailResult.value.ok && detailResult.value.data?.details) {
      const details = detailResult.value.data.details;
      if (details.description) modal.querySelector('.rec-detail-description').textContent = details.description;
      modal.querySelector('.rec-detail-primary').textContent =
        [item.year || '—', details.primaryMeta || '', `${item.match || '—'}% Match`].filter(Boolean).join(' · ');
      const facts = Array.isArray(details.facts) ? details.facts : [];
      modal.querySelector('.rec-detail-facts').innerHTML = facts.length
        ? facts.map(fact => `<div class="rec-detail-fact"><b>${escapeHtml(fact.label)}</b><span>${escapeHtml(fact.value)}</span></div>`).join('')
        : '<p class="rec-detail-loading">Keine weiteren Angaben vorhanden.</p>';
    } else {
      modal.querySelector('.rec-detail-facts').innerHTML = '<p class="rec-detail-loading">Weitere Details gerade nicht erreichbar.</p>';
    }

    const providerHost = modal.querySelector('.rec-detail-provider-list');
    if (availabilityResult.status === 'fulfilled' && availabilityResult.value.ok) {
      const offers = Array.isArray(availabilityResult.value.data?.offers) ? availabilityResult.value.data.offers.slice(0,5) : [];
      providerHost.innerHTML = offers.length
        ? offers.map(offer => `<span class="rec-detail-provider">${escapeHtml(offer.provider)} · ${escapeHtml(offer.label || 'Verfügbar')}</span>`).join('')
        : '<span class="rec-detail-loading">Aktuell kein Anbieter in Deutschland gefunden.</span>';
    } else {
      providerHost.innerHTML = '<span class="rec-detail-loading">Streaming gerade nicht erreichbar.</span>';
    }
  }

  async function refreshRecommendations({force=false, background=false} = {}) {
    const payload = buildPayload();
    const stats = readinessStats();
    if (!stats.ready) {
      invalidateRecommendations();
      updateReadyIndicator(false);
      if (recommendationSurfaceVisible()) renderLearningProgress(stats);
      return [];
    }
    if (loading && !force) return [];

    const signature = JSON.stringify(payload);
    if (!force && signature === lastSignature && cachedItems.length) {
      if (recommendationSurfaceVisible()) renderPersonalized(cachedItems, payload.signals.length);
      if (cachedItems.filter(item => item.tmdbId && ['movie','series'].includes(item.type)).length >= 3) {
        announceReadyIfNeeded();
      }
      return cachedItems;
    }

    const serial = ++requestSerial;
    loading = true;
    let shouldRetry = Boolean(background);
    const heroHost = document.querySelector('#recommendHero');
    if (!background && recommendationSurfaceVisible() && heroHost && !cachedItems.length) {
      heroHost.innerHTML = '<div class="recommend-loading"><div><b>FRAME rechnet.</b>Dein persönlicher Filmraum wird neu zusammengestellt.</div></div>';
    }

    try {
      const response = await fetch('/api/recommendations', {
        method:'POST',
        headers:{ 'content-type':'application/json', accept:'application/json' },
        body:JSON.stringify(payload),
        cache:'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !Array.isArray(data.items)) throw new Error(data.message || `Recommendations ${response.status}`);
      if (serial !== requestSerial) return [];

      cachedItems = data.items;
      shownRecommendations=6;
      lastSignature = signature;
      if (recommendationSurfaceVisible()) {
        renderPersonalized(cachedItems, data.profileSignals ?? payload.signals.length);
      }
      // A notification means the server actually returned several distinct titles,
      // not merely that the local swipe counter reached a number.
      const validIds = new Set(cachedItems
        .filter(item => item.tmdbId && ['movie','series'].includes(item.type))
        .map(item => `${item.type}:${item.tmdbId}`));
      if (validIds.size >= 3) {
        shouldRetry = false;
        readyProbeAttempts = 0;
        announceReadyIfNeeded();
      }
      return cachedItems;
    } catch (error) {
      console.warn('[FRAME PERSONALIZED]', error.message);
      if (serial !== requestSerial) return [];
      if (recommendationSurfaceVisible()) {
        if (cachedItems.length) renderPersonalized(cachedItems, payload.signals.length);
        else if (heroHost) heroHost.innerHTML = '<div class="recommend-error"><div><b>Gerade keine Empfehlungen.</b>Der TMDB-Dienst ist momentan nicht erreichbar. Deine Swipes bleiben gespeichert.</div></div>';
      }
      return [];
    } finally {
      if (serial === requestSerial) {
        loading = false;
        if (shouldRetry && !readyFlag(READY_ANNOUNCED_KEY)) {
          scheduleReadyProbe(6300);
        }
      }
    }
  }

  injectStyles();
  syncHistory();
  updateReadyIndicator();
  let readyProbeTimer = null;
  function scheduleReadyProbe(delay = 900) {
    if (readyProbeTimer) clearTimeout(readyProbeTimer);
    readyProbeTimer = null;
    if (readyFlag(READY_ANNOUNCED_KEY) || !readinessStats().ready) return;
    readyProbeTimer = setTimeout(() => {
      readyProbeTimer = null;
      probeReadyInBackground();
    }, delay);
  }

  const originalRecordSwipe = recordSwipe;
  recordSwipe = function frameRecordSwipeWithHistory(id, action) {
    const item = catalog.find(entry => entry.id === id);
    const snapshot = item ? snapshotItem(item, action) : null;
    if (snapshot) {
      history[id] = snapshot;
      saveHistory();
    }
    invalidateRecommendations();
    const beforeReady = readinessStats().ready;
    originalRecordSwipe(id, action);
    const afterReady = readinessStats().ready;
    if (!beforeReady && afterReady && !readyFlag(READY_ANNOUNCED_KEY)) {
      try { showToast('Für dich: Dein Profil wird ausgewertet …'); } catch {}
    }
    readyProbeAttempts = 0;

    updateReadyIndicator();
    if (recommendationSurfaceVisible()) {
      queueMicrotask(() => refreshRecommendations({force:true}));
    } else {
      scheduleReadyProbe();
    }
  };

  renderRecommendations = function frameRenderPersonalizedRecommendations() {
    if (recommendationSurfaceVisible()) queueMicrotask(() => refreshRecommendations());
  };
  // Existing users with a trained profile should be informed after a fresh
  // verification, without requiring an extra swipe.
  window.addEventListener('load', () => scheduleReadyProbe(850));

  const recommendOpen = document.querySelector('#recommendShortcut');
  const recommendClose = document.querySelector('#recommendationClose');
  const recommendSurface = document.querySelector('#recommendationModal');

  recommendOpen?.addEventListener('click', () => setRecommendationModal(true));
  recommendClose?.addEventListener('click', () => setRecommendationModal(false));
  document.querySelector('#forYouReadyOpen')?.addEventListener('click', () => setRecommendationModal(true));
  document.querySelector('#forYouReadyDismiss')?.addEventListener('click', () => hideReadyNotice({restoreFocus:true}));
  document.querySelector('#forYouReadyNotice')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) hideReadyNotice({restoreFocus:true});
  });
  document.querySelector('#forYouReadyNotice')?.addEventListener('keydown', event => {
    const popup = document.querySelector('#forYouReadyNotice');
    if (!popup || popup.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      hideReadyNotice({restoreFocus:true});
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...popup.querySelectorAll('button:not([disabled])')];
    if (focusable.length < 2) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  document.addEventListener('frame:view-changed', event => {
    const visible = event.detail?.target === 'personalized';
    recommendSurface?.classList.toggle('open', visible);
    recommendSurface?.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (visible) hideReadyNotice();
  });
  document.addEventListener('frame:onboarding-complete', () => {
    if (readyFlag(READY_ANNOUNCED_KEY)) return;
    const current = readinessStats();
    if (!current.ready) return;
    if (cachedItems.filter(item => item.tmdbId && ['movie','series'].includes(item.type)).length >= 3) announceReadyIfNeeded();
    else probeReadyInBackground();
  });
  recommendSurface?.addEventListener('click', event => {
    if(event.target.closest('#forYouShowMore')){
      event.preventDefault();
      shownRecommendations=Math.min(shownRecommendations+6,cachedItems.length);
      renderPersonalized(cachedItems,lastSignalCount);
      return;
    }
    const actionButton = event.target.closest('[data-rec-action]');
    if (actionButton) {
      event.preventDefault();
      event.stopPropagation();
      const item = findRecommendation(actionButton.dataset.recKey || '');
      if (actionButton.dataset.recAction === 'watched') window.FrameWatched?.open(item);
      if (actionButton.dataset.recAction === 'save') saveRecommendation(item);
      if (actionButton.dataset.recAction === 'remove') rejectRecommendation(item);
      if (actionButton.dataset.recAction === 'details') openRecommendationDetails(item);
      return;
    }

    const row = event.target.closest('#recommendList .rec-row');
    if (row) {
      const key = `${row.dataset.mediaType}:${row.dataset.tmdbId}`;
      openRecommendationDetails(findRecommendation(key));
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && recommendationSurfaceVisible()) setRecommendationModal(false);
  });

  document.addEventListener('frame:watchlist-updated', () => updateSaveButtons());
  document.addEventListener('frame:watched-rated', () => {
    updateSaveButtons();
    invalidateRecommendations();
    if(recommendationSurfaceVisible())queueMicrotask(()=>refreshRecommendations({force:true}));
  });
  document.addEventListener('frame:watched-removed', () => {
    updateSaveButtons();
    invalidateRecommendations();
    if(recommendationSurfaceVisible())queueMicrotask(()=>refreshRecommendations({force:true}));
  });

  document.addEventListener('frame:mood-changed', () => {
    invalidateRecommendations();
    if (recommendationSurfaceVisible()) {
      queueMicrotask(() => refreshRecommendations({force:true}));
    }
  });

  document.addEventListener('frame:taste-dna-changed', () => {
    invalidateRecommendations();

    if (recommendationSurfaceVisible()) {
      queueMicrotask(() => refreshRecommendations({force:true}));
    } else {
      scheduleReadyProbe(1500);
    }
  });

  document.addEventListener('frame:online-model-changed', () => {
    invalidateRecommendations();
    if (recommendationSurfaceVisible()) {
      queueMicrotask(() => refreshRecommendations({force:true}));
    } else {
      scheduleReadyProbe(1500);
    }
  });

  document.addEventListener('frame:swipe-undone', () => {
    syncHistory();
    invalidateRecommendations();

    updateReadyIndicator();
    hideReadyNotice();
    try { renderTaste(); } catch {}
    if (recommendationSurfaceVisible()) {
      queueMicrotask(() => refreshRecommendations({force:true}));
    } else {
      scheduleReadyProbe();
    }
  });

  document.addEventListener('frame:taste-reset', () => {
    history = {};
    saveHistory();
    invalidateRecommendations();
    if (readyProbeTimer) clearTimeout(readyProbeTimer);
    readyProbeTimer = null;
    lastReadinessProbe = 0;
    readyProbeAttempts = 0;
    try {
      localStorage.removeItem(READY_ANNOUNCED_KEY);
      localStorage.removeItem(READY_VIEWED_KEY);
    } catch {}
    hideReadyNotice();
    updateReadyIndicator(false);
  });

  window.addEventListener('storage', event => {
    if (event.key === 'frame-state' || event.key === HISTORY_KEY) {
      history = loadHistory();
      invalidateRecommendations();

      updateReadyIndicator();
      scheduleReadyProbe();
    }
    if (event.key === READY_ANNOUNCED_KEY || event.key === READY_VIEWED_KEY) {
      updateReadyIndicator();
    }
  });
})();
