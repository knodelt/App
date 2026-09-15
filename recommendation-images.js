(() => {
  const ART = new Map([
    ['Prisoners', '/xzONGMTfv5BTiUNvBhb6pcKGXLm.jpg'],
    ['Enemy', '/flo1t3tcwQ08b2J5DvlwDasE6Dp.jpg'],
    ['Blade Runner 2049', '/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg'],
    ['The Prestige', '/c5o7FN2vzI7xlU6IF1y64mgcH9E.jpg'],
    ['Sharp Objects', '/1SGovj2qDdkJexvhFiXllj9EYfu.jpg']
  ]);

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
        background:linear-gradient(180deg,rgba(0,0,0,.03) 24%,rgba(0,0,0,.22) 50%,rgba(0,0,0,.9) 100%) !important;
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
    const heroPath = ART.get(heroTitle);
    if (heroArt && heroPath) {
      heroArt.style.backgroundImage = `url("${tmdbImage(heroPath, 'w780')}")`;
    }

    document.querySelectorAll('#recommendList .rec-row').forEach(row => {
      const title = row.querySelector('.rec-row-copy strong')?.textContent?.trim();
      const thumb = row.querySelector('.rec-thumb');
      const path = ART.get(title);
      if (thumb && path) {
        thumb.style.backgroundImage = `url("${tmdbImage(path, 'w342')}")`;
      }
    });
  }

  injectStyles();

  if (typeof renderRecommendations === 'function') {
    const baseRenderRecommendations = renderRecommendations;
    renderRecommendations = function frameRenderRecommendationsWithImages() {
      baseRenderRecommendations();
      applyArtwork();
    };
  }

  applyArtwork();

  const recommendView = document.querySelector('#recommendView');
  if (recommendView) {
    new MutationObserver(() => queueMicrotask(applyArtwork)).observe(recommendView, {
      childList:true,
      subtree:true
    });
  }
})();