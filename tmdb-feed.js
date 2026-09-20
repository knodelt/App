(() => {
  const START_PAGE_MAX = 5;
  const fallbackItems = catalog.map(item => item);

  const MOOD_TAGS = {
    drama:['Drama'],
    horror:['Horror','Mystery'],
    tension:['Thriller','Mystery','Crime'],
    action:['Action','Abenteuer'],
    laugh:['Komödie','Comedy','Satire'],
    mindfuck:['Mystery','Sci-Fi','Mindbend'],
    feelgood:['Komödie','Comedy','Familie','Food','Character'],
    romance:['Romance','Drama']
  };

  let currentMood = window.getFrameMood?.() || 'any';
  let page = randomStartPage();
  let loading = false;
  let exhausted = false;
  let configured = null;
  let generation = 0;
  let preferFreshItems = true;
  let feedNonce = makeNonce();

  const knownIds = new Set(catalog.map(item => item.id));

  function randomUnit() {
    try {
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      return values[0] / 4294967296;
    } catch {
      return Math.random();
    }
  }

  function randomStartPage() {
    return 1 + Math.floor(randomUnit() * START_PAGE_MAX);
  }

  function makeNonce() {
    return Math.floor(randomUnit() * 1e9).toString(36);
  }

  function shuffle(items = []) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(randomUnit() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function matchesMood(item, mood = currentMood) {
    if (!mood || mood === 'any') return true;
    if (item?.type === 'person') return false;
    const tags = MOOD_TAGS[mood] || [];
    return tags.some(tag => (item?.tags || []).some(itemTag => String(itemTag).toLowerCase() === tag.toLowerCase()));
  }

  function shuffleCatalog() {
    const shuffled = shuffle(catalog);
    catalog.splice(0, catalog.length, ...shuffled);
  }

  function keepFallbackOnly() {
    const fallback = fallbackItems.filter(item => matchesMood(item));
    catalog.splice(0, catalog.length, ...shuffle(fallback.length ? fallback : fallbackItems));
    knownIds.clear();
    catalog.forEach(item => knownIds.add(item.id));
  }

  function remainingCards() {
    return catalog.filter(item => (state.filter === 'all' || item.type === state.filter) && !state.swipes[item.id]).length;
  }

  function mergeItems(items = [], { prefer = false } = {}) {
    const fresh = [];
    for (const item of shuffle(items)) {
      if (!item?.id || knownIds.has(item.id)) continue;
      fresh.push(item);
      knownIds.add(item.id);
    }
    if (!fresh.length) return 0;
    if (prefer) catalog.unshift(...fresh);
    else catalog.push(...fresh);
    return fresh.length;
  }

  function setLiveCredit(isLive) {
    let credit = document.querySelector('.media-credit');
    if (!credit) {
      credit = document.createElement('p');
      credit.className = 'media-credit';
      document.querySelector('.gesture-hint')?.insertAdjacentElement('afterend', credit);
    }
    if (credit) {
      credit.textContent = isLive ? 'DATEN & BILDER · TMDB · LIVE' : 'DATEN & BILDER · TMDB';
      credit.style.color = isLive ? 'var(--gold)' : '';
    }

    if (!document.querySelector('.tmdb-legal')) {
      const legal = document.createElement('p');
      legal.className = 'tmdb-legal';
      legal.textContent = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';
      document.querySelector('#tinyCredit')?.insertAdjacentElement('afterend', legal);
    }
  }

  async function loadMore({ silent = true } = {}) {
    if (loading || exhausted || configured === false) return;
    loading = true;
    const requestGeneration = generation;
    const requestPage = page;

    try {
      const response = await fetch(`/api/feed?page=${requestPage}&market=de-v4&seed=${feedNonce}&mood=${encodeURIComponent(currentMood)}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));

      if (requestGeneration !== generation) return;

      if (!response.ok) {
        if (data.code === 'TMDB_NOT_CONFIGURED') configured = false;
        throw new Error(data.message || `Feed ${response.status}`);
      }

      configured = true;
      const added = mergeItems(data.items || [], { prefer: preferFreshItems });
      preferFreshItems = false;
      page = Number(data.page || requestPage) + 1;
      exhausted = data.hasMore === false || added === 0;
      setLiveCredit(true);
      baseRenderDeck();

      if (remainingCards() < 10 && !exhausted) queueMicrotask(() => loadMore({ silent: true }));
    } catch (error) {
      if (requestGeneration !== generation) return;
      console.warn('[FRAME TMDB]', error.message);
      setLiveCredit(false);
      if (!silent && configured !== false) showToast('TMDB-Feed gerade nicht erreichbar.');
    } finally {
      if (requestGeneration === generation) loading = false;
    }
  }

  const baseRenderDeck = renderDeck;
  renderDeck = function enhancedRenderDeck() {
    baseRenderDeck();
    if (remainingCards() < 10) queueMicrotask(() => loadMore({ silent: true }));
  };

  window.frameRandomizeFeed = function frameRandomizeFeed({ fresh = true, mood } = {}) {
    generation += 1;
    loading = false;
    exhausted = false;
    configured = null;
    currentMood = mood || window.getFrameMood?.() || 'any';
    page = randomStartPage();
    feedNonce = makeNonce();
    preferFreshItems = true;

    if (fresh) keepFallbackOnly();
    else shuffleCatalog();

    baseRenderDeck();
    queueMicrotask(() => loadMore({ silent: true }));
  };

  document.querySelectorAll('.filter').forEach(button => {
    button.addEventListener('click', () => queueMicrotask(() => {
      if (remainingCards() < 10) loadMore({ silent: true });
    }));
  });

  document.addEventListener('frame:mood-changed', event => {
    currentMood = event.detail?.mood || window.getFrameMood?.() || 'any';
  });

  setLiveCredit(false);
  if (currentMood !== 'any') keepFallbackOnly();
  else shuffleCatalog();
  baseRenderDeck();
  loadMore({ silent: true });
})();
