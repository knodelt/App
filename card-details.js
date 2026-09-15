(() => {
  const HOLD_MS = 520;
  const MOVE_TOLERANCE = 12;
  const boundCards = new WeakSet();
  let activeRequest = null;

  function injectStyles() {
    if (document.querySelector('#frameLongPressStyles')) return;
    const style = document.createElement('style');
    style.id = 'frameLongPressStyles';
    style.textContent = `
      .swipe-card .card-art,
      .swipe-card .card-copy,
      .swipe-card .card-top { transition: opacity .2s ease, filter .28s ease, transform .28s ease; }

      .card-detail {
        position:absolute; inset:0; z-index:25;
        display:flex; flex-direction:column; justify-content:flex-end;
        padding:66px 18px 16px;
        background:
          linear-gradient(180deg,
            rgba(7,7,10,.04) 0%,
            rgba(7,7,10,.08) 24%,
            rgba(7,7,10,.18) 46%,
            rgba(7,7,10,.42) 70%,
            rgba(7,7,10,.68) 100%);
        backdrop-filter:blur(2.5px) saturate(.86);
        -webkit-backdrop-filter:blur(2.5px) saturate(.86);
        opacity:0; pointer-events:none; transform:scale(1.012);
        transition:opacity .2s ease, transform .22s ease;
        overflow:hidden;
      }
      .card-detail::before {
        content:"";
        position:absolute; inset:0; pointer-events:none;
        background:
          radial-gradient(circle at 50% 18%, transparent 0%, transparent 30%, rgba(4,4,7,.10) 58%, rgba(4,4,7,.34) 100%);
      }
      .swipe-card.detail-open .card-detail { opacity:1; pointer-events:auto; transform:none; }
      .swipe-card.detail-open > .card-copy,
      .swipe-card.detail-open > .card-top,
      .swipe-card.detail-open > .swipe-stamp { opacity:0; pointer-events:none; }
      .swipe-card.detail-open .card-art {
        filter:brightness(.64) saturate(.82) contrast(.94) blur(.45px);
        transform:scale(1.032);
      }

      .detail-close {
        position:absolute; z-index:3; top:17px; right:17px; width:38px; height:38px;
        border-radius:50%; border:1px solid rgba(255,255,255,.18);
        background:rgba(8,8,10,.26); color:#f4ede2; font-size:23px; line-height:1;
        display:grid; place-items:center; padding:0;
        backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
        box-shadow:0 8px 24px rgba(0,0,0,.16);
      }

      .detail-body {
        position:relative; z-index:2;
        min-height:0; overflow:hidden;
        padding:18px 16px 15px;
        border:1px solid rgba(255,255,255,.095);
        border-radius:22px;
        background:
          linear-gradient(180deg, rgba(13,13,16,.26) 0%, rgba(13,13,16,.50) 42%, rgba(10,10,13,.72) 100%);
        backdrop-filter:blur(10px) saturate(.88);
        -webkit-backdrop-filter:blur(10px) saturate(.88);
        box-shadow:0 18px 46px rgba(0,0,0,.20), inset 0 1px 0 rgba(255,255,255,.025);
      }
      .detail-kicker { margin:0 0 7px; color:var(--gold); font-size:9px; font-weight:700; letter-spacing:.18em; }
      .detail-title {
        margin:0; font-family:"Playfair Display",serif; font-size:clamp(28px,8vw,36px);
        line-height:.98; letter-spacing:-.035em; max-width:92%;
        display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden;
        text-shadow:0 2px 18px rgba(0,0,0,.42);
      }
      .detail-fact-row { display:flex; flex-wrap:wrap; gap:6px; margin:12px 0 13px; max-height:29px; overflow:hidden; }
      .detail-fact-row span {
        border:1px solid rgba(255,255,255,.13); background:rgba(7,7,10,.28);
        border-radius:999px; padding:6px 9px; color:#ded8ce; font-size:9px; white-space:nowrap;
        backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
      }
      .detail-description {
        margin:0; color:#f0eae1; font-size:14px; line-height:1.48;
        display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:7; overflow:hidden;
        text-shadow:0 1px 10px rgba(0,0,0,.26);
      }
      .detail-notes { display:grid; gap:7px; margin-top:14px; }
      .detail-note { display:grid; grid-template-columns:62px minmax(0,1fr); gap:9px; align-items:start; }
      .detail-note b { color:#908b82; font-size:8px; line-height:1.35; letter-spacing:.1em; text-transform:uppercase; }
      .detail-note span {
        color:#d1cbc1; font-size:10.5px; line-height:1.35;
        display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden;
      }
      .detail-status { height:17px; margin:10px 0 0; color:#747069; font-size:8px; letter-spacing:.08em; }
      .detail-footer {
        position:relative; z-index:2;
        margin:9px 0 0; color:rgba(245,240,232,.34); font-size:7px; letter-spacing:.12em; text-align:center;
        text-shadow:0 1px 8px rgba(0,0,0,.45);
      }
      .swipe-card.detail-open { touch-action:none; }

      @media (max-height:740px) {
        .card-detail { padding:60px 15px 13px; }
        .detail-body { padding:15px 14px 12px; border-radius:19px; }
        .detail-title { font-size:27px; }
        .detail-description { font-size:12.5px; line-height:1.42; -webkit-line-clamp:5; }
        .detail-notes { margin-top:10px; gap:5px; }
        .detail-note:nth-child(n+3) { display:none; }
        .detail-footer { display:none; }
      }
      @media (max-height:650px) {
        .card-detail { padding-top:54px; }
        .detail-body { padding:13px; }
        .detail-description { -webkit-line-clamp:4; }
        .detail-fact-row { margin:9px 0 9px; }
        .detail-note:nth-child(n+2) { display:none; }
      }
    `;
    document.head.appendChild(style);
  }

  function findItem(card) {
    try { return catalog.find(item => item.id === card.dataset.id) || null; }
    catch { return null; }
  }

  function makeOverlay(card, item) {
    let overlay = card.querySelector('.card-detail');
    if (overlay) return overlay;

    overlay = document.createElement('section');
    overlay.className = 'card-detail';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <button class="detail-close" type="button" aria-label="Info schließen">×</button>
      <div class="detail-body">
        <p class="detail-kicker"></p>
        <h3 class="detail-title"></h3>
        <div class="detail-fact-row"></div>
        <p class="detail-description"></p>
        <div class="detail-notes"></div>
        <p class="detail-status"></p>
      </div>
      <p class="detail-footer">GEDRÜCKT HALTEN = INFO · × = SCHLIESSEN</p>`;

    const stop = event => event.stopPropagation();
    ['pointerdown','pointermove','pointerup','pointercancel'].forEach(type => overlay.addEventListener(type, stop));
    overlay.addEventListener('contextmenu', event => event.preventDefault());
    overlay.querySelector('.detail-close').addEventListener('click', event => {
      event.stopPropagation();
      closeDetails(card);
    });

    card.appendChild(overlay);
    renderDetails(overlay, item, null, false);
    return overlay;
  }

  function renderDetails(overlay, item, remote, loading) {
    const data = remote || {};
    const kicker = item.type === 'movie' ? 'FILM · MEHR INFO' : item.type === 'series' ? 'SERIE · MEHR INFO' : 'PERSON · MEHR INFO';
    overlay.querySelector('.detail-kicker').textContent = kicker;
    overlay.querySelector('.detail-title').textContent = item.title || 'Unbekannt';

    const factRow = overlay.querySelector('.detail-fact-row');
    factRow.replaceChildren();
    const primaryFacts = [item.year, data.primaryMeta || item.meta, item.subtitle].filter(Boolean).slice(0, 3);
    primaryFacts.forEach(value => {
      const span = document.createElement('span');
      span.textContent = value;
      factRow.appendChild(span);
    });

    overlay.querySelector('.detail-description').textContent = data.description || item.blurb || 'Noch keine Beschreibung verfügbar.';

    const notes = overlay.querySelector('.detail-notes');
    notes.replaceChildren();
    (data.facts || []).slice(0, 3).forEach(fact => {
      if (!fact?.value) return;
      const row = document.createElement('div');
      row.className = 'detail-note';
      const label = document.createElement('b');
      const value = document.createElement('span');
      label.textContent = fact.label || 'Info';
      value.textContent = fact.value;
      row.append(label, value);
      notes.appendChild(row);
    });

    overlay.querySelector('.detail-status').textContent = loading ? 'Zusatzinfos werden geladen …' : (item.source === 'tmdb' ? 'DETAILS · TMDB' : 'DETAILS · FRAME');
  }

  function closeDetails(card) {
    card.classList.remove('detail-open');
    card.querySelector('.card-detail')?.setAttribute('aria-hidden', 'true');
    if (activeRequest) {
      activeRequest.abort();
      activeRequest = null;
    }
  }

  async function openDetails(card) {
    const item = findItem(card);
    if (!item || card.classList.contains('detail-open')) return;

    if (typeof drag !== 'undefined') drag = null;
    card.classList.remove('dragging');
    card.style.transform = '';
    card.querySelectorAll('.swipe-stamp').forEach(stamp => { stamp.style.opacity = 0; });

    const overlay = makeOverlay(card, item);
    card.classList.add('detail-open');
    overlay.setAttribute('aria-hidden', 'false');
    renderDetails(overlay, item, null, item.source === 'tmdb' && item.tmdbId);

    try { navigator.vibrate?.(12); } catch {}

    if (item.source !== 'tmdb' || !item.tmdbId) return;

    activeRequest?.abort();
    activeRequest = new AbortController();
    try {
      const response = await fetch(`/api/details?v=2&type=${encodeURIComponent(item.type)}&id=${encodeURIComponent(item.tmdbId)}`, {
        headers: { accept: 'application/json' },
        signal: activeRequest.signal,
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.details) throw new Error(payload?.message || `Details ${response.status}`);
      if (!card.classList.contains('detail-open')) return;
      renderDetails(overlay, item, payload.details, false);
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.warn('[FRAME DETAILS]', error.message);
      if (card.classList.contains('detail-open')) renderDetails(overlay, item, null, false);
    } finally {
      activeRequest = null;
    }
  }

  function bindCard(card) {
    if (!card || boundCards.has(card)) return;
    boundCards.add(card);

    let timer = null;
    let startX = 0;
    let startY = 0;
    let moved = false;

    const cancelTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    card.addEventListener('pointerdown', event => {
      if (card.classList.contains('detail-open')) return;
      if (typeof event.button === 'number' && event.button !== 0) return;
      startX = event.clientX;
      startY = event.clientY;
      moved = false;
      cancelTimer();
      timer = setTimeout(() => {
        timer = null;
        if (!moved) openDetails(card);
      }, HOLD_MS);
    }, { passive:true });

    card.addEventListener('pointermove', event => {
      if (!timer) return;
      const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (distance > MOVE_TOLERANCE) {
        moved = true;
        cancelTimer();
      }
    }, { passive:true });

    ['pointerup','pointercancel','pointerleave'].forEach(type => card.addEventListener(type, cancelTimer, { passive:true }));
    card.addEventListener('contextmenu', event => event.preventDefault());
  }

  function bindTopCard() {
    bindCard(document.querySelector('.top-card'));
  }

  injectStyles();
  const hint = document.querySelector('.gesture-hint');
  if (hint) hint.textContent = 'Links = super · hoch = merken · rechts = Mist · halten = Info';

  bindTopCard();
  const deck = document.querySelector('#cardDeck');
  if (deck) {
    new MutationObserver(() => queueMicrotask(bindTopCard)).observe(deck, { childList:true, subtree:false });
  }
})();