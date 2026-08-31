(() => {
  let page = 1;
  let loading = false;
  let exhausted = false;
  let configured = null;

  const knownIds = new Set(catalog.map(item => item.id));

  function remainingCards() {
    return catalog.filter(item => (state.filter === 'all' || item.type === state.filter) && !state.swipes[item.id]).length;
  }

  function mergeItems(items = []) {
    let added = 0;
    for (const item of items) {
      if (!item?.id || knownIds.has(item.id)) continue;
      catalog.push(item);
      knownIds.add(item.id);
      added += 1;
    }
    return added;
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

    try {
      const response = await fetch(`/api/feed?page=${page}`, { headers: { accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (data.code === 'TMDB_NOT_CONFIGURED') configured = false;
        throw new Error(data.message || `Feed ${response.status}`);
      }

      configured = true;
      const added = mergeItems(data.items || []);
      page = Number(data.page || page) + 1;
      exhausted = data.hasMore === false || added === 0;
      setLiveCredit(true);
      baseRenderDeck();

      if (remainingCards() < 10 && !exhausted) queueMicrotask(() => loadMore({ silent: true }));
    } catch (error) {
      console.warn('[FRAME TMDB]', error.message);
      setLiveCredit(false);
      if (!silent && configured !== false) showToast('TMDB-Feed gerade nicht erreichbar.');
    } finally {
      loading = false;
    }
  }

  const baseRenderDeck = renderDeck;
  renderDeck = function enhancedRenderDeck() {
    baseRenderDeck();
    if (remainingCards() < 10) queueMicrotask(() => loadMore({ silent: true }));
  };

  document.querySelectorAll('.filter').forEach(button => {
    button.addEventListener('click', () => queueMicrotask(() => {
      if (remainingCards() < 10) loadMore({ silent: true });
    }));
  });

  setLiveCredit(false);
  loadMore({ silent: true });
})();
