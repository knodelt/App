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
        display:inline-flex; align-items:center; gap:4px; min-width:0; max-width:100%;
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

      #recommendHero .streaming-block {
        position:absolute; z-index:4; left:20px; right:20px; bottom:78px;
        margin:0;
      }
      #recommendHero .streaming-offers { max-height:56px; overflow:hidden; }
      #recommendHero .streaming-chip { background:rgba(7,7,10,.48); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); }
      #recommendHero .streaming-credit { color:rgba(245,240,232,.42); }

      .rec-row { min-height:92px; }
      .rec-row-copy .streaming-block { margin-top:6px; }
      .rec-row-copy .streaming-offers { flex-wrap:nowrap; overflow:hidden; }
      .rec-row-copy .streaming-chip { padding:4px 6px; font-size:7px; }
      .rec-row-copy .streaming-chip:nth-child(n+2) { display:none; }
      .rec-row-copy .streaming-credit { display:none; }

      @media (max-width:380px) {
        .mini-card .streaming-chip b { max-width:74px; }
        #recommendHero .streaming-chip:nth-child(n+3) { display:none; }
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

  function formatPrice(value) {
    if (!Number.isFinite(Number(value))) return null;
    return new Intl.NumberFormat('de-DE', { style:'currency', currency:'EUR' }).format(Number(value));
  }

  function offerText(offer) {
    const price = formatPrice(offer.price);
    if (price) return `${offer.label} ${price}`;
    if (offer.type === 'rent' || offer.type === 'buy') return `${offer.label} · Preis n. v.`;
    return offer.label;
  }

  function ensureBlock(host, key) {
    let block = host.querySelector(`.streaming-block[data-stream-key="${CSS.escape(key)}"]`);
    if (block) return block;
    host.querySelectorAll('.streaming-block').forEach(node => node.remove());
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

    if (data?.source === 'watchmode') credit.textContent = 'Verfügbarkeit & Preise · Watchmode';
    else credit.textContent = 'Verfügbarkeit · JustWatch via TMDB';
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

  async function decorateRecommendations() {
    await loadRecommendationIds();

    const heroTitle = document.querySelector('#recommendHero .rec-copy h2')?.textContent?.trim();
    const hero = recommendationIds.get(heroTitle);
    const heroHost = document.querySelector('#recommendHero');
    if (hero && heroHost) {
      const key = cacheKey(hero);
      const block = ensureBlock(heroHost, key);
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
