(() => {
  const HOLD_MS = 520;
  const MOVE_TOLERANCE = 12;
  let activeRequest = null;

  function injectStyles() {
    if (document.querySelector('#frameWatchlistControlsStyles')) return;
    const style = document.createElement('style');
    style.id = 'frameWatchlistControlsStyles';
    style.textContent = `
      .mini-card { position:relative; }
      .mini-art { touch-action:manipulation; user-select:none; -webkit-user-select:none; }
      .watch-remove {
        position:absolute; z-index:4; top:10px; right:10px;
        width:34px; height:34px; border-radius:50%;
        border:1px solid rgba(255,255,255,.18);
        background:rgba(8,8,10,.54); color:#f3eee6;
        display:grid; place-items:center; padding:0;
        font-size:19px; line-height:1;
        backdrop-filter:blur(11px); -webkit-backdrop-filter:blur(11px);
        box-shadow:0 7px 20px rgba(0,0,0,.24);
      }
      .watch-remove:active { transform:scale(.92); }
      .watch-hold-hint {
        display:block; margin-top:5px; color:#5f5b55;
        font-size:7px; letter-spacing:.08em; text-transform:uppercase;
      }

      .watch-detail-shell {
        position:fixed; z-index:90; inset:0;
        display:grid; place-items:center;
        padding:max(18px, env(safe-area-inset-top)) 18px max(82px, calc(70px + env(safe-area-inset-bottom)));
        background:rgba(5,5,8,.72);
        backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
        opacity:0; pointer-events:none; transition:opacity .2s ease;
      }
      .watch-detail-shell.open { opacity:1; pointer-events:auto; }
      .watch-detail-card {
        position:relative; width:min(100%, 450px); height:min(72dvh, 650px);
        border-radius:28px; overflow:hidden;
        border:1px solid rgba(255,255,255,.12);
        background:#101014;
        box-shadow:0 28px 80px rgba(0,0,0,.52);
      }
      .watch-detail-bg {
        position:absolute; inset:0;
        background-image:
          linear-gradient(180deg,rgba(6,6,9,.05) 0%,rgba(6,6,9,.12) 35%,rgba(6,6,9,.66) 68%,rgba(6,6,9,.94) 100%),
          var(--poster, var(--art));
        background-size:cover; background-position:center 18%; background-repeat:no-repeat;
        filter:brightness(.70) saturate(.86);
      }
      .watch-detail-close {
        position:absolute; z-index:4; top:16px; right:16px;
        width:40px; height:40px; border-radius:50%;
        border:1px solid rgba(255,255,255,.2); background:rgba(8,8,10,.38);
        color:#f5f0e8; font-size:23px; display:grid; place-items:center; padding:0;
        backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
      }
      .watch-detail-content {
        position:absolute; z-index:3; left:16px; right:16px; bottom:16px;
        max-height:72%; overflow:hidden;
        padding:18px 17px 15px; border-radius:22px;
        border:1px solid rgba(255,255,255,.1);
        background:linear-gradient(180deg,rgba(12,12,15,.48),rgba(9,9,12,.82));
        backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
      }
      .watch-detail-kicker { margin:0 0 7px; color:var(--gold); font-size:9px; font-weight:700; letter-spacing:.18em; }
      .watch-detail-title {
        margin:0; font-family:"Playfair Display",serif; font-size:clamp(28px,8vw,38px);
        line-height:.98; letter-spacing:-.035em;
        display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden;
      }
      .watch-detail-meta { display:flex; flex-wrap:wrap; gap:6px; margin:12px 0; max-height:30px; overflow:hidden; }
      .watch-detail-meta span {
        border:1px solid rgba(255,255,255,.13); background:rgba(255,255,255,.055);
        border-radius:999px; padding:6px 9px; color:#ddd7cf; font-size:9px; white-space:nowrap;
      }
      .watch-detail-description {
        margin:0; color:#eee9e1; font-size:13px; line-height:1.46;
        display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:6; overflow:hidden;
      }
      .watch-detail-facts { display:grid; gap:7px; margin-top:13px; }
      .watch-detail-fact { display:grid; grid-template-columns:70px minmax(0,1fr); gap:8px; }
      .watch-detail-fact b { color:#8d8881; font-size:8px; letter-spacing:.09em; text-transform:uppercase; }
      .watch-detail-fact span {
        color:#d1cbc2; font-size:10.5px; line-height:1.35;
        display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden;
      }
      .watch-detail-status { margin:10px 0 0; color:#77726b; font-size:8px; letter-spacing:.08em; min-height:11px; }
      .watch-detail-remove {
        width:100%; margin-top:12px; min-height:42px; border-radius:14px;
        border:1px solid rgba(255,113,109,.22); background:rgba(255,113,109,.08);
        color:#ff8a86; font-size:9px; font-weight:700; letter-spacing:.12em;
      }
      @media (max-height:740px) {
        .watch-detail-card { height:min(70dvh, 560px); }
        .watch-detail-content { max-height:76%; padding:15px 14px 13px; }
        .watch-detail-description { font-size:12px; -webkit-line-clamp:4; }
        .watch-detail-facts { gap:5px; margin-top:10px; }
        .watch-detail-fact:nth-child(n+3) { display:none; }
      }
    `;
    document.head.appendChild(style);
  }

  function getItem(id) {
    try { return catalog.find(item => item.id === id) || null; }
    catch { return null; }
  }

  function removeFromWatchlist(id) {
    state.saved = state.saved.filter(savedId => savedId !== id);
    if (state.swipes[id] === 'save') delete state.swipes[id];
    persist();
    renderWatchlist();
    renderTaste();
    showToast('Aus der Watchlist entfernt.');
  }

  function decorateWatchlist() {
    document.querySelectorAll('#watchlistGrid .mini-card').forEach((card, index) => {
      if (card.dataset.watchReady === '1') return;
      const id = state.saved[index];
      const item = getItem(id);
      if (!id || !item) return;

      card.dataset.watchReady = '1';
      card.dataset.id = id;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'watch-remove';
      remove.setAttribute('aria-label', `${item.title} aus Watchlist entfernen`);
      remove.textContent = '×';
      remove.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        removeFromWatchlist(id);
      });
      card.appendChild(remove);

      const copy = card.querySelector('.mini-copy');
      if (copy && !copy.querySelector('.watch-hold-hint')) {
        const hint = document.createElement('small');
        hint.className = 'watch-hold-hint';
        hint.textContent = 'Bild halten = Details';
        copy.appendChild(hint);
      }

      bindLongPress(card.querySelector('.mini-art'), item);
    });
  }

  function ensureModal() {
    let shell = document.querySelector('#watchDetailShell');
    if (shell) return shell;

    shell = document.createElement('div');
    shell.id = 'watchDetailShell';
    shell.className = 'watch-detail-shell';
    shell.setAttribute('aria-hidden', 'true');
    shell.innerHTML = `
      <article class="watch-detail-card">
        <div class="watch-detail-bg"></div>
        <button class="watch-detail-close" type="button" aria-label="Details schließen">×</button>
        <div class="watch-detail-content">
          <p class="watch-detail-kicker"></p>
          <h3 class="watch-detail-title"></h3>
          <div class="watch-detail-meta"></div>
          <p class="watch-detail-description"></p>
          <div class="watch-detail-facts"></div>
          <p class="watch-detail-status"></p>
          <button class="watch-detail-remove" type="button">AUS WATCHLIST ENTFERNEN</button>
        </div>
      </article>`;

    document.body.appendChild(shell);
    shell.querySelector('.watch-detail-close').addEventListener('click', closeModal);
    shell.addEventListener('click', event => {
      if (event.target === shell) closeModal();
    });
    return shell;
  }

  function closeModal() {
    const shell = document.querySelector('#watchDetailShell');
    if (!shell) return;
    shell.classList.remove('open');
    shell.setAttribute('aria-hidden', 'true');
    activeRequest?.abort();
    activeRequest = null;
  }

  function renderModal(item, details = null, loading = false) {
    const shell = ensureModal();
    const bg = shell.querySelector('.watch-detail-bg');
    bg.style.setProperty('--art', item.art || 'linear-gradient(145deg,#303039,#0d0d10)');
    if (item.poster) bg.style.setProperty('--poster', `url("${posterUrl(item.poster, 'w780')}")`);
    else bg.style.removeProperty('--poster');

    shell.querySelector('.watch-detail-kicker').textContent = `${typeLabel(item.type)} · WATCHLIST`;
    shell.querySelector('.watch-detail-title').textContent = item.title;
    shell.querySelector('.watch-detail-description').textContent = details?.description || item.blurb || 'Noch keine Beschreibung verfügbar.';

    const meta = shell.querySelector('.watch-detail-meta');
    meta.replaceChildren();
    [item.year, details?.primaryMeta || item.meta, item.subtitle].filter(Boolean).slice(0,3).forEach(text => {
      const span = document.createElement('span');
      span.textContent = text;
      meta.appendChild(span);
    });

    const facts = shell.querySelector('.watch-detail-facts');
    facts.replaceChildren();
    const fallbackFacts = item.tags?.length ? [{ label:'Stichworte', value:item.tags.slice(0,4).join(' · ') }] : [];
    (details?.facts?.length ? details.facts : fallbackFacts).slice(0,3).forEach(fact => {
      const row = document.createElement('div');
      row.className = 'watch-detail-fact';
      const label = document.createElement('b');
      const value = document.createElement('span');
      label.textContent = fact.label;
      value.textContent = fact.value;
      row.append(label, value);
      facts.appendChild(row);
    });

    shell.querySelector('.watch-detail-status').textContent = loading ? 'Zusatzinfos werden geladen …' : (item.source === 'tmdb' ? 'DETAILS · TMDB' : 'DETAILS · FRAME');
    const remove = shell.querySelector('.watch-detail-remove');
    remove.onclick = () => {
      removeFromWatchlist(item.id);
      closeModal();
    };
  }

  async function openModal(item) {
    const shell = ensureModal();
    renderModal(item, null, item.source === 'tmdb' && item.tmdbId);
    shell.classList.add('open');
    shell.setAttribute('aria-hidden', 'false');
    try { navigator.vibrate?.(12); } catch {}

    if (item.source !== 'tmdb' || !item.tmdbId) return;

    activeRequest?.abort();
    activeRequest = new AbortController();
    try {
      const response = await fetch(`/api/details?type=${encodeURIComponent(item.type)}&id=${encodeURIComponent(item.tmdbId)}&v=3`, {
        headers:{ accept:'application/json' },
        cache:'no-store',
        signal:activeRequest.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.details) throw new Error(payload?.message || `Details ${response.status}`);
      if (shell.classList.contains('open')) renderModal(item, payload.details, false);
    } catch (error) {
      if (error.name !== 'AbortError') console.warn('[FRAME WATCHLIST DETAILS]', error.message);
      if (shell.classList.contains('open')) renderModal(item, null, false);
    } finally {
      activeRequest = null;
    }
  }

  function bindLongPress(target, item) {
    if (!target || target.dataset.longPressReady === '1') return;
    target.dataset.longPressReady = '1';
    let timer = null;
    let startX = 0;
    let startY = 0;

    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    target.addEventListener('pointerdown', event => {
      startX = event.clientX;
      startY = event.clientY;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        openModal(item);
      }, HOLD_MS);
    }, { passive:true });

    target.addEventListener('pointermove', event => {
      if (!timer) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_TOLERANCE) cancel();
    }, { passive:true });

    ['pointerup','pointercancel','pointerleave'].forEach(type => target.addEventListener(type, cancel, { passive:true }));
    target.addEventListener('contextmenu', event => event.preventDefault());
  }

  injectStyles();

  if (typeof renderWatchlist === 'function') {
    const baseRenderWatchlist = renderWatchlist;
    renderWatchlist = function frameRenderWatchlistWithControls() {
      baseRenderWatchlist();
      queueMicrotask(decorateWatchlist);
    };
  }

  decorateWatchlist();

  const grid = document.querySelector('#watchlistGrid');
  if (grid) new MutationObserver(() => queueMicrotask(decorateWatchlist)).observe(grid, { childList:true });
})();