(() => {
  const availabilityCache = new Map();
  const recommendationIds = new Map();
  const inFlight = new Map();
  let recommendationMapLoading = null;

  function injectStyles() {
    if (document.querySelector('#frameStreamingStyles')) return;
    const style = document.createElement('style');
    style.id = 'frameStreamingStyles';
    style.textContent = `
      .streaming-block { margin-top:9px; min-width:0; }
      .streaming-label {
        display:block; margin:0 0 5px; color:#8c877f; font-size:7px;
        letter-spacing:.10em; text-transform:uppercase;
      }
      .streaming-offers { display:flex; flex-wrap:wrap; gap:5px; min-width:0; }
      .streaming-chip {
        display:inline-flex; align-items:center; gap:5px; min-width:0; max-width:100%;
        border:1px solid rgba(255,255,255,.11); border-radius:999px;
        background:rgba(255,255,255,.045); padding:5px 7px;
        color:#d8d2c9; font-size:8px; line-height:1; white-space:nowrap;
      }
      .streaming-chip b { color:#f0e9dd; font-weight:600; overflow:hidden; text-overflow:ellipsis; max-width:105px; }
      .streaming-chip em { color:var(--gold); font-style:normal; }
      .streaming-credit { margin:5px 0 0; color:#4e4b46; font-size:6px; letter-spacing:.06em; }
      .streaming-empty { color:#65615b; font-size:8px; }

      .mini-card .streaming-block { margin-top:8px; }
      .mini-card .streaming-offers { display:grid; gap:4px; }
      .mini-card .streaming-chip { width:max-content; max-width:100%; }
      .mini-card .streaming-chip b { max-width:92px; }

      .hero-streaming-strip {
        margin:10px 2px 0;
        padding:10px 12px 9px;
        border:1px solid rgba(255,255,255,.08);
        border-radius:15px;
        background:#101014;
        min-height:48px;
      }
      .hero-streaming-strip .streaming-block { margin:0; }
      .hero-streaming-strip .streaming-offers {
        flex-wrap:nowrap;
        overflow:hidden;
      }
      .hero-streaming-strip .streaming-chip { flex:0 1 auto; }
      .hero-streaming-strip .streaming-chip:nth-child(n+4) { display:none; }
      .hero-streaming-strip .streaming-credit { margin-top:6px; }

      .rec-row { min-height:92px; }
      .rec-row-copy .streaming-block { margin-top:6px; }
      .rec-row-copy .streaming-offers { flex-wrap:nowrap; overflow:hidden; }
      .rec-row-copy .streaming-chip { padding:4px 6px; font-size:7px; }
      .rec-row-copy .streaming-chip:nth-child(n+2) { display:none; }
      .rec-row-copy .streaming-credit { display:none; }

      @media (max-width:380px) {
        .mini-card .streaming-chip b { max-width:74px; }
        .hero-streaming-strip .streaming-chip:nth-child(n+3) { display:none; }
      }
    `;
    document.head.appendChild(style);
  }

  function cacheKey(item) {
    return item?.tmdbId && (item.type === 'movie' || item.type === 'series')
      ? `${item.type}:${item.tmdbId}`
      : null;
  }

  async function getAvailability(item) {
    const key = cacheKey(item);
    if (!key) return null;
    if (availabilityCache.has(key)) return availabilityCache.get(key);
    if (inFlight.has(key)) return inFlight.get(key);

    const promise = (async () => {
      try {
        const response = await fetch(`/api/availability?type=${encodeURIComponent(item.type)}&id=${encodeURIComponent(item.tmdbId)}`, {
          headers:{ accept:'application/json' }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.message || `Availability ${response.status}`);
        availabilityCache.set(key, data);
        return data;
      } catch (error) {
        console.warn('[FRAME STREAMING]', error.message);
        return null;
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, promise);
    return promise;
  }

  function offerText(offer) {
    return offer?.label || 'Verfügbar';
  }

  function ensureBlock(host, key) {
    let block = host.querySelector(`:scope > .streaming-block[data-stream-key="${CSS.escape(key)}"]`);
    if (block) return block;
    host.querySelectorAll(':scope > .streaming-block').forEach(node => node.remove());
    block = document.createElement('div');
    block.className = 'streaming-block';
    block.dataset.streamKey = key;
    block.innerHTML = '<span class="streaming-label">STREAMING · DE</span><div class="streaming-offers"><span class="streaming-empty">Verfügbarkeit wird geladen …</span></div><p class="streaming-credit"></p>';
    host.appendChild(block);
    return block;
  }

  function renderBlock(block, data, maxOffers = 2) {
    const offersHost = block.querySelector('.streaming-offers');
    const credit = block.querySelector('.streaming-credit');
    offersHost.replaceChildren();

    const offers = Array.isArray(data?.offers) ? data.offers.slice(0, maxOffers) : [];
    if (!offers.length) {
      const empty = document.createElement('span');
      empty.className = 'streaming-empty';
      empty.textContent = 'Aktuell kein Anbieter in Deutschland gefunden.';
      offersHost.appendChild(empty);
    } else {
      offers.forEach(offer => {
        const chip = document.createElement('span');
        chip.className = 'streaming-chip';
        const provider = document.createElement('b');
        provider.textContent = offer.provider;
        const detail = document.createElement('em');
        detail.textContent = offerText(offer);
        chip.append(provider, detail);
        offersHost.appendChild(chip);
      });
    }

    credit.textContent = 'Verfügbarkeit · JustWatch via TMDB';
  }

  function watchlistItems() {
    try {
      return state.saved.map(id => catalog.find(item => item.id === id)).filter(Boolean);
    } catch {
      return [];
    }
  }

  function decorateWatchlist() {
    const cards = [...document.querySelectorAll('#watchlistGrid .mini-card')];
    const items = watchlistItems();
    cards.forEach((card, index) => {
      const item = items[index];
      if (!item || !['movie','series'].includes(item.type) || !item.tmdbId) return;
      const copy = card.querySelector('.mini-copy');
      if (!copy) return;
      const key = cacheKey(item);
      const block = ensureBlock(copy, key);
      if (block.dataset.loaded === '1') return;
      block.dataset.loaded = '1';
      getAvailability(item).then(data => {
        if (data && block.isConnected) renderBlock(block, data, 2);
        else if (block.isConnected) block.querySelector('.streaming-empty').textContent = 'Verfügbarkeit gerade nicht erreichbar.';
      });
    });
  }

  async function loadRecommendationIds() {
    if (recommendationMapLoading) return recommendationMapLoading;
    recommendationMapLoading = (async () => {
      try {
        const response = await fetch('/api/recommendation-art', { headers:{ accept:'application/json' } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(data.items)) throw new Error(data.message || `Recommendation IDs ${response.status}`);
        data.items.forEach(item => {
          if (!item?.title || !item?.tmdbId) return;
          recommendationIds.set(item.title, {
            title:item.title,
            tmdbId:item.tmdbId,
            type:item.mediaType === 'tv' ? 'series' : 'movie'
          });
        });
      } catch (error) {
        console.warn('[FRAME STREAMING RECOMMENDATIONS]', error.message);
      }
    })();
    return recommendationMapLoading;
  }

  function ensureHeroStrip() {
    const hero = document.querySelector('#recommendHero');
    if (!hero) return null;
    let strip = document.querySelector('#recommendHeroStreaming');
    if (!strip) {
      strip = document.createElement('div');
      strip.id = 'recommendHeroStreaming';
      strip.className = 'hero-streaming-strip';
      hero.insertAdjacentElement('afterend', strip);
    }
    return strip;
  }

  async function decorateRecommendations() {
    await loadRecommendationIds();

    document.querySelectorAll('#recommendHero .streaming-block').forEach(node => node.remove());

    const heroTitle = document.querySelector('#recommendHero .rec-copy h2')?.textContent?.trim();
    const hero = recommendationIds.get(heroTitle);
    const heroStrip = ensureHeroStrip();
    if (hero && heroStrip) {
      const key = cacheKey(hero);
      const block = ensureBlock(heroStrip, key);
      if (block.dataset.loaded !== '1') {
        block.dataset.loaded = '1';
        getAvailability(hero).then(data => {
          if (data && block.isConnected) renderBlock(block, data, 3);
        });
      }
    }

    document.querySelectorAll('#recommendList .rec-row').forEach(row => {
      const title = row.querySelector('.rec-row-copy strong')?.textContent?.trim();
      const item = recommendationIds.get(title);
      const copy = row.querySelector('.rec-row-copy');
      if (!item || !copy) return;
      const key = cacheKey(item);
      const block = ensureBlock(copy, key);
      if (block.dataset.loaded === '1') return;
      block.dataset.loaded = '1';
      getAvailability(item).then(data => {
        if (data && block.isConnected) renderBlock(block, data, 1);
      });
    });
  }

  injectStyles();
  decorateWatchlist();
  decorateRecommendations();

  const watchGrid = document.querySelector('#watchlistGrid');
  if (watchGrid) new MutationObserver(() => queueMicrotask(decorateWatchlist)).observe(watchGrid, { childList:true, subtree:true });

  const recommendView = document.querySelector('#recommendView');
  if (recommendView) new MutationObserver(() => queueMicrotask(decorateRecommendations)).observe(recommendView, { childList:true, subtree:true });
})();
