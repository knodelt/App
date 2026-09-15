(() => {
  const artwork = new Map();
  let loading = null;

  function tmdbImage(path, size = 'w780') {
    return path ? `https://image.tmdb.org/t/p/${size}${path}` : '';
  }

  function injectStyles() {
    if (document.querySelector('#frameRecommendationImageStyles')) return;
    const style = document.createElement('style');
    style.id = 'frameRecommendationImageStyles';
    style.textContent = `
      .rec-art {
        background-size:cover !important;
        background-position:center 28% !important;
        background-repeat:no-repeat !important;
      }
      .rec-art::after {
        background:linear-gradient(180deg,rgba(0,0,0,.02) 18%,rgba(0,0,0,.18) 48%,rgba(0,0,0,.9) 100%) !important;
      }
      .rec-thumb {
        background-size:cover !important;
        background-position:center !important;
        background-repeat:no-repeat !important;
      }
      .rec-row-copy strong,
      .rec-copy h2 { text-shadow:0 2px 16px rgba(0,0,0,.22); }
    `;
    document.head.appendChild(style);
  }

  function applyArtwork() {
    const heroTitle = document.querySelector('#recommendHero .rec-copy h2')?.textContent?.trim();
    const heroArt = document.querySelector('#recommendHero .rec-art');
    const hero = artwork.get(heroTitle);
    if (heroArt && hero) {
      const path = hero.backdrop || hero.poster;
      if (path) heroArt.style.backgroundImage = `url("${tmdbImage(path, 'w780')}")`;
    }

    document.querySelectorAll('#recommendList .rec-row').forEach(row => {
      const title = row.querySelector('.rec-row-copy strong')?.textContent?.trim();
      const thumb = row.querySelector('.rec-thumb');
      const item = artwork.get(title);
      if (thumb && item) {
        const path = item.poster || item.backdrop;
        if (path) thumb.style.backgroundImage = `url("${tmdbImage(path, 'w342')}")`;
      }
    });
  }

  async function loadArtwork() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const response = await fetch('/api/recommendation-art', { headers: { accept:'application/json' } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(data.items)) throw new Error(data.message || `Artwork ${response.status}`);
        data.items.forEach(item => {
          if (item?.title) artwork.set(item.title, item);
        });
        applyArtwork();
      } catch (error) {
        console.warn('[FRAME RECOMMENDATION ART]', error.message);
      }
    })();
    return loading;
  }

  injectStyles();

  if (typeof renderRecommendations === 'function') {
    const baseRenderRecommendations = renderRecommendations;
    renderRecommendations = function frameRenderRecommendationsWithImages() {
      baseRenderRecommendations();
      applyArtwork();
      loadArtwork();
    };
  }

  applyArtwork();
  loadArtwork();

  const recommendView = document.querySelector('#recommendView');
  if (recommendView) {
    new MutationObserver(() => queueMicrotask(applyArtwork)).observe(recommendView, {
      childList:true,
      subtree:true
    });
  }
})();

(() => {
  if (document.querySelector('script[data-frame-streaming]')) return;
  const script = document.createElement('script');
  script.src = '/streaming-availability.js';
  script.defer = true;
  script.dataset.frameStreaming = '1';
  document.head.appendChild(script);
})();
