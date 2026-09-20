(() => {
  const availabilityCache = new Map();
  const inFlight = new Map();

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

      .swipe-card .card-copy .streaming-block {
        margin-top:9px;
        width:100%;
      }
      .swipe-card .card-copy .streaming-label {
        display:block;
        margin:0 0 5px;
        color:rgba(255,255,255,.62);
        font-size:9px;
        font-weight:700;
        letter-spacing:.04em;
        text-transform:none;
      }
      .swipe-card .card-copy .streaming-offers {
        flex-wrap:nowrap;
        overflow:hidden;
        gap:6px;
      }
      .swipe-card .card-copy .streaming-chip {
        flex:0 1 auto;
        padding:5px 8px;
        border-radius:999px;
        background:rgba(10,10,13,.56);
        border-color:rgba(255,255,255,.14);
        -webkit-backdrop-filter:blur(10px);
        backdrop-filter:blur(10px);
        font-size:9px;
      }
      .swipe-card .card-copy .streaming-chip b {
        max-width:112px;
      }
      .swipe-card .card-copy .streaming-chip:nth-child(n+3) {
        display:none;
      }
      .swipe-card .card-copy .streaming-credit {
        display:none;
      }
      .swipe-card .card-copy .streaming-empty {
        font-size:9px;
        color:rgba(255,255,255,.55);
      }

      .mini-card .streaming-block { margin-top:8px; }
      .mini-card .streaming-offers { display:grid; gap:4px; }
      .mini-card .streaming-chip { width:max-content; max-width:100%; }
      .mini-card .streaming-chip b { max-width:92px; }

      #recommendHero .rec-copy {
        left:20px; right:20px; bottom:18px;
        display:flex; flex-direction:column; align-items:flex-start;
      }
      #recommendHero .rec-copy .streaming-block { width:100%; margin-top:9px; }
      #recommendHero .rec-copy .streaming-label,
      #recommendHero .rec-copy .streaming-credit { display:none; }
      #recommendHero .rec-copy .streaming-offers { width:100%; flex-wrap:nowrap; overflow:hidden; }
      #recommendHero .rec-copy .streaming-chip {
        flex:0 1 auto; padding:5px 8px; background:rgba(7,7,10,.52);
        backdrop-filter:blur(9px); -webkit-backdrop-filter:blur(9px);
      }
      #recommendHero .rec-copy .streaming-chip b { max-width:118px; }
      #recommendHero .rec-copy .streaming-chip:nth-child(n+3) { display:none; }

      .rec-row { min-height:92px; }
      .rec-row-copy .streaming-block { margin-top:6px; }
      .rec-row-copy .streaming-offers { flex-wrap:nowrap; overflow:hidden; }
      .rec-row-copy .streaming-chip { padding:4px 6px; font-size:7px; }
      .rec-row-copy .streaming-chip:nth-child(n+2) { display:none; }
      .rec-row-copy .streaming-credit { display:none; }

      @media (max-width:380px) {
        .mini-card .streaming-chip b { max-width:74px; }
        #recommendHero .rec-copy .streaming-chip b { max-width:92px; }
      }
    `;
    document.head.appendChild(style);
  }

  function itemFromDataset(node) {
    const tmdbId = Number(node?.dataset?.tmdbId);
    const type = node?.dataset?.mediaType;
    if (!Number.isFinite(tmdbId) || tmdbId < 1 || !['movie','series'].includes(type)) return null;
    return { tmdbId, type };
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

  function offerText(offer) { return offer?.label || 'Verfügbar'; }

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
    try { return state.saved.map(id => catalog.find(item => item.id === id)).filter(Boolean); }
    catch { return []; }
  }

  function decorateSwipeDeck() {
    document.querySelectorAll('#cardDeck .swipe-card').forEach(card => {
      const item = itemFromDataset(card);
      const copy = card.querySelector('.card-copy');
      if (!item || !copy) return;

      const key = cacheKey(item);
      const block = ensureBlock(copy, key);
      const signalRow = copy.querySelector('.signal-row');
      if (signalRow && block.nextElementSibling !== signalRow) {
        copy.insertBefore(block, signalRow);
      }

      if (block.dataset.loaded === '1') return;
      block.dataset.loaded = '1';
      getAvailability(item).then(data => {
        if (data && block.isConnected) {
          renderBlock(block, data, 2);
        } else if (block.isConnected) {
          const empty = block.querySelector('.streaming-empty');
          if (empty) empty.textContent = 'Streaming gerade nicht erreichbar.';
        }
      });
    });
  }

  function decorateWatchlist() {
    const cards = [...document.querySelectorAll('#watchlistGrid .mini-card')];
    const items = watchlistItems();
    cards.forEach((card,index) => {
      const item = items[index];
      if (!item || !['movie','series'].includes(item.type) || !item.tmdbId) return;
      const copy = card.querySelector('.mini-copy');
      if (!copy) return;
      const key = cacheKey(item);
      const block = ensureBlock(copy,key);
      if (block.dataset.loaded === '1') return;
      block.dataset.loaded = '1';
      getAvailability(item).then(data => {
        if (data && block.isConnected) renderBlock(block,data,2);
        else if (block.isConnected) block.querySelector('.streaming-empty').textContent = 'Verfügbarkeit gerade nicht erreichbar.';
      });
    });
  }

  function decorateRecommendations() {
    const heroHost = document.querySelector('#recommendHero');
    const heroCopy = heroHost?.querySelector('.rec-copy');
    const hero = itemFromDataset(heroHost);
    if (hero && heroCopy) {
      const key = cacheKey(hero);
      const block = ensureBlock(heroCopy,key);
      if (block.dataset.loaded !== '1') {
        block.dataset.loaded = '1';
        getAvailability(hero).then(data => {
          if (data && block.isConnected) renderBlock(block,data,2);
        });
      }
    }

    document.querySelectorAll('#recommendList .rec-row').forEach(row => {
      const item = itemFromDataset(row);
      const copy = row.querySelector('.rec-row-copy');
      if (!item || !copy) return;
      const key = cacheKey(item);
      const block = ensureBlock(copy,key);
      if (block.dataset.loaded === '1') return;
      block.dataset.loaded = '1';
      getAvailability(item).then(data => {
        if (data && block.isConnected) renderBlock(block,data,1);
      });
    });
  }

  injectStyles();
  decorateSwipeDeck();
  decorateWatchlist();
  decorateRecommendations();

  const cardDeck = document.querySelector('#cardDeck');
  if (cardDeck) new MutationObserver(() => queueMicrotask(decorateSwipeDeck)).observe(cardDeck,{childList:true,subtree:true});

  const watchGrid = document.querySelector('#watchlistGrid');
  if (watchGrid) new MutationObserver(() => queueMicrotask(decorateWatchlist)).observe(watchGrid,{childList:true,subtree:true});

  const recommendView = document.querySelector('#recommendView');
  if (recommendView) new MutationObserver(() => queueMicrotask(decorateRecommendations)).observe(recommendView,{childList:true,subtree:true});

  document.addEventListener('frame:recommendations-rendered', () => queueMicrotask(decorateRecommendations));
})();
