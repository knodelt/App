(() => {
  const HISTORY_KEY = 'frame-recommendation-history-v1';
  const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
  let history = loadHistory();
  let lastSignature = '';
  let requestSerial = 0;
  let cachedItems = [];
  let loading = false;

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}') || {}; }
    catch { return {}; }
  }

  function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
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
    const entries = Object.values(history)
      .filter(entry => state.swipes?.[entry.id])
      .sort((a,b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

    const tagMap = new Map();
    entries.forEach(entry => {
      const weight = actionWeight(state.swipes[entry.id]);
      (entry.tags || []).forEach(tag => {
        if (!tag || String(tag).length > 60) return;
        tagMap.set(tag, (tagMap.get(tag) || 0) + weight);
      });
    });

    const tagWeights = [...tagMap.entries()]
      .filter(([,weight]) => weight !== 0)
      .sort((a,b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0,30)
      .map(([tag,weight]) => ({tag,weight}));

    const signals = entries
      .filter(entry => entry.tmdbId && ['movie','series','person'].includes(entry.type))
      .slice(0,100)
      .map(entry => ({
        tmdbId:entry.tmdbId,
        type:entry.type,
        title:entry.title,
        action:state.swipes[entry.id]
      }));

    return { signals, tagWeights };
  }

  function profileStrength() {
    const actions = Object.keys(state.swipes || {}).length;
    if (!actions) return 0;
    return Math.min(99, Math.round(100 * (1 - Math.exp(-actions / 55))));
  }

  function updateProfileStrength() {
    const strength = profileStrength();
    const taste = document.querySelector('#tastePercent');
    const dna = document.querySelector('#dnaScore');
    const progress = document.querySelector('#dnaProgress');
    if (taste) taste.textContent = strength;
    if (dna) dna.textContent = strength;
    if (progress) progress.style.width = `${strength}%`;

    const label = document.querySelector('.dna-topline span:first-child');
    if (label) label.textContent = 'PROFILSTÄRKE';
    const copy = document.querySelector('.dna-card > p');
    if (copy) copy.textContent = 'Wie sicher FRAME deinen Geschmack einschätzen kann. Das Profil wird mit unterschiedlichen Swipes langsam präziser.';
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

  function renderPersonalized(items, signalCount) {
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

    const hero = items[0];
    setDataset(heroHost, hero);
    const heroImage = imageUrl(hero.backdrop || hero.poster, 'w780');
    heroHost.innerHTML = `
      <div class="rec-art" style="${heroImage ? `background-image:linear-gradient(180deg,rgba(0,0,0,.02) 18%,rgba(0,0,0,.18) 48%,rgba(0,0,0,.9) 100%),url('${heroImage}')` : 'background:linear-gradient(145deg,#37342f,#17171a 55%,#09090b)'}"></div>
      <div class="rec-copy">
        <span class="rec-score">${hero.match}% MATCH</span>
        <h2>${escapeHtml(hero.title)}</h2>
        <p>${hero.type === 'series' ? 'Serie' : 'Film'} · ${escapeHtml(hero.year || '—')}</p>
        <p class="rec-hero-description">${escapeHtml(hero.description || '')}</p>
        <div class="rec-actions">
          <button class="rec-action details" type="button" data-rec-action="details" data-rec-key="${hero.type}:${hero.tmdbId}">Details</button>
          <button class="rec-action remove" type="button" data-rec-action="remove" data-rec-key="${hero.type}:${hero.tmdbId}">Nicht für mich</button>
        </div>
      </div>`;

    const reasons = (hero.reasons || []).slice(0,3);
    reasonHost.innerHTML = (reasons.length ? reasons : ['Aus deinem Swipe-Profil'])
      .map(reason => `<span>${escapeHtml(reason)}</span>`).join('');

    listHost.innerHTML = items.slice(1,7).map(item => {
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
            <button class="rec-action details" type="button" data-rec-action="details" data-rec-key="${item.type}:${item.tmdbId}">Details</button>
            <button class="rec-action remove" type="button" data-rec-action="remove" data-rec-key="${item.type}:${item.tmdbId}">Entfernen</button>
          </div>
        </div>
        <span class="rec-row-score">${item.match}%</span>
      </article>`;
    }).join('');

    let note = document.querySelector('#recommendSignalNote');
    if (!note) {
      note = document.createElement('p');
      note.id = 'recommendSignalNote';
      note.className = 'profile-signal-note';
      document.querySelector('.why-panel')?.appendChild(note);
    }
    if (note) note.textContent = `${signalCount} persönliche TMDB-Signale · nur für diese Abfrage`;

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
    updateProfileStrength();
    try { renderTaste(); } catch {}
    showToast('Entfernt. Dein Geschmack wurde angepasst.');
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

  async function refreshRecommendations({force=false} = {}) {
    if (loading && !force) return;
    const payload = buildPayload();
    const signature = JSON.stringify(payload);

    if (!force && signature === lastSignature && cachedItems.length) {
      renderPersonalized(cachedItems, payload.signals.length);
      return;
    }

    const serial = ++requestSerial;
    loading = true;
    const heroHost = document.querySelector('#recommendHero');
    if (heroHost && !cachedItems.length) {
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
      if (serial !== requestSerial) return;
      cachedItems = data.items;
      lastSignature = signature;
      renderPersonalized(cachedItems, data.profileSignals ?? payload.signals.length);
    } catch (error) {
      console.warn('[FRAME PERSONALIZED]', error.message);
      if (serial !== requestSerial) return;
      if (cachedItems.length) renderPersonalized(cachedItems, payload.signals.length);
      else if (heroHost) heroHost.innerHTML = '<div class="recommend-error"><div><b>Gerade keine Empfehlungen.</b>Der TMDB-Dienst ist momentan nicht erreichbar. Deine Swipes bleiben gespeichert.</div></div>';
    } finally {
      if (serial === requestSerial) loading = false;
    }
  }

  injectStyles();
  syncHistory();

  const originalRecordSwipe = recordSwipe;
  recordSwipe = function frameRecordSwipeWithHistory(id, action) {
    const item = catalog.find(entry => entry.id === id);
    const snapshot = item ? snapshotItem(item, action) : null;
    if (snapshot) {
      history[id] = snapshot;
      saveHistory();
    }
    cachedItems = [];
    lastSignature = '';
    originalRecordSwipe(id, action);
    updateProfileStrength();
    if (document.querySelector('#recommendView')?.classList.contains('active')) {
      queueMicrotask(() => refreshRecommendations({force:true}));
    }
  };

  const originalRenderTaste = renderTaste;
  renderTaste = function frameRenderTasteWithStrength() {
    originalRenderTaste();
    updateProfileStrength();
  };

  renderRecommendations = function frameRenderPersonalizedRecommendations() {
    updateProfileStrength();
    queueMicrotask(() => refreshRecommendations());
  };

  updateProfileStrength();

  document.querySelectorAll('.nav-item').forEach(button => {
    if (button.dataset.target === 'recommend') {
      button.addEventListener('click', () => queueMicrotask(() => refreshRecommendations()));
    }
  });

  const recommendView = document.querySelector('#recommendView');
  recommendView?.addEventListener('click', event => {
    const actionButton = event.target.closest('[data-rec-action]');
    if (actionButton) {
      event.preventDefault();
      event.stopPropagation();
      const item = findRecommendation(actionButton.dataset.recKey || '');
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

  window.addEventListener('storage', event => {
    if (event.key === 'frame-state' || event.key === HISTORY_KEY) {
      history = loadHistory();
      cachedItems = [];
      lastSignature = '';
      updateProfileStrength();
    }
  });
})();
