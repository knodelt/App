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
      .rec-reason-mini { display:block; color:#706c66; font-size:7px; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px; }
      .profile-signal-note { color:#5d5953; font-size:7px; letter-spacing:.08em; margin:6px 0 0 2px; }
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

  window.addEventListener('storage', event => {
    if (event.key === 'frame-state' || event.key === HISTORY_KEY) {
      history = loadHistory();
      cachedItems = [];
      lastSignature = '';
      updateProfileStrength();
    }
  });
})();
