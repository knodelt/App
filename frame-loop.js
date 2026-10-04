(() => {
  const STORAGE_KEY = 'frame-loop-v1';
  const MODE_KEY = 'frame-loop-mode-v1';
  const POSITIVE = new Set(['like', 'save']);
  const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

  let loop = loadLoop();
  let mode = safeGet(MODE_KEY) === 'partner' ? 'partner' : 'user';

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }

  function loadLoop() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
      return {
        room: {
          active: Boolean(parsed.room && parsed.room.active),
          partnerName: String(parsed.room && parsed.room.partnerName || '').slice(0, 24)
        },
        daily: parsed.daily || null,
        pickHistory: Array.isArray(parsed.pickHistory) ? parsed.pickHistory.slice(-12) : []
      };
    } catch {
      return { room:{ active:false, partnerName:'' }, daily:null, pickHistory:[] };
    }
  }

  function saveLoop() {
    safeSet(STORAGE_KEY, JSON.stringify(loop));
  }

  function todayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function formatToday() {
    try {
      return new Intl.DateTimeFormat('de-DE', { weekday:'long', day:'2-digit', month:'long' }).format(new Date());
    } catch {
      return 'Heute';
    }
  }

  function hash(text) {
    let h = 2166136261;
    const value = String(text || '');
    for (let i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function snapshot(item) {
    return {
      id: item.id,
      tmdbId: item.tmdbId || null,
      source: item.source || null,
      type: item.type,
      title: item.title || '',
      year: item.year || '',
      meta: item.meta || '',
      subtitle: item.subtitle || '',
      blurb: item.blurb || '',
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 10) : [],
      symbol: item.symbol || 'F',
      poster: item.poster || null,
      art: item.art || 'linear-gradient(145deg,#34343a,#141418 55%,#0b0b0d)'
    };
  }

  function mediaPool() {
    if (!Array.isArray(catalog)) return [];
    const media = catalog.filter(item => item && item.id && (item.type === 'movie' || item.type === 'series'));
    const fresh = media.filter(item => !state.swipes[item.id]);
    const preferred = fresh.length >= 7 ? fresh : media;
    const date = todayKey();
    return [...preferred].sort((a, b) => hash(date + ':' + a.id) - hash(date + ':' + b.id));
  }

  function ensureDaily() {
    const date = todayKey();
    const valid = loop.daily && loop.daily.date === date && Array.isArray(loop.daily.items) && loop.daily.items.length >= 1;

    if (!valid) {
      mode = 'user';
      safeSet(MODE_KEY, mode);
      const items = mediaPool().slice(0, 7).map(snapshot);
      loop.daily = {
        date,
        items,
        catalogSize: Array.isArray(catalog) ? catalog.length : items.length,
        userVotes: {},
        partnerVotes: {},
        completedByUser: false,
        completedByPartner: false
      };
      saveLoop();
    }

    loop.daily.userVotes = loop.daily.userVotes || {};
    loop.daily.partnerVotes = loop.daily.partnerVotes || {};

    loop.daily.items.forEach(item => {
      if (!catalog.some(entry => entry.id === item.id)) catalog.push({ ...item });
      if (state.swipes[item.id] && !loop.daily.userVotes[item.id]) {
        loop.daily.userVotes[item.id] = state.swipes[item.id];
      }
    });

    loop.daily.completedByUser = loop.daily.items.length > 0 && loop.daily.items.every(item => loop.daily.userVotes[item.id]);
    loop.daily.completedByPartner = loop.daily.items.length > 0 && loop.daily.items.every(item => loop.daily.partnerVotes[item.id]);
    saveLoop();
    return loop.daily;
  }

  function currentVotes() {
    const daily = ensureDaily();
    return mode === 'partner' ? daily.partnerVotes : daily.userVotes;
  }

  function nextItem() {
    const daily = ensureDaily();
    const votes = currentVotes();
    return daily.items.find(item => !votes[item.id]) || null;
  }

  function imageUrl(path, size) {
    if (!path) return '';
    return TMDB_IMAGE_BASE + '/' + (size || 'w500') + path;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function positive(action) {
    return POSITIVE.has(action);
  }

  function commonMatches() {
    const daily = ensureDaily();
    return daily.items.filter(item => positive(daily.userVotes[item.id]) && positive(daily.partnerVotes[item.id]));
  }

  function hiddenPending() {
    const daily = ensureDaily();
    if (!loop.room.active || mode !== 'user') return [];
    return daily.items.filter(item => !daily.userVotes[item.id] && positive(daily.partnerVotes[item.id]));
  }

  function setMode(next) {
    mode = next === 'partner' ? 'partner' : 'user';
    safeSet(MODE_KEY, mode);
    renderAll();
  }

  function activateRoom() {
    const input = document.querySelector('#partnerNameInput');
    const name = String(input && input.value || loop.room.partnerName || 'Partner').trim().slice(0, 24) || 'Partner';
    loop.room = { active:true, partnerName:name };
    saveLoop();
    setMode('partner');
    showToast(name + ' übernimmt den Daily Drop.');
  }

  function deactivateRoom() {
    loop.room = { active:false, partnerName:'' };
    ensureDaily().partnerVotes = {};
    loop.daily.completedByPartner = false;
    saveLoop();
    setMode('user');
    showToast('Room beendet.');
  }

  function vote(action) {
    const daily = ensureDaily();
    const item = nextItem();
    if (!item) return;

    if (mode === 'partner') {
      daily.partnerVotes[item.id] = action;
      daily.completedByPartner = daily.items.every(entry => daily.partnerVotes[entry.id]);
      saveLoop();
      renderAll();
      if (daily.completedByPartner) showToast('Drop von ' + (loop.room.partnerName || 'Partner') + ' abgeschlossen.');
      return;
    }

    daily.userVotes[item.id] = action;
    daily.completedByUser = daily.items.every(entry => daily.userVotes[entry.id]);
    saveLoop();

    if (typeof recordSwipe === 'function') {
      recordSwipe(item.id, action);
    } else {
      state.swipes[item.id] = action;
      if (action === 'save' && !state.saved.includes(item.id)) state.saved.push(item.id);
      persist();
    }

    renderAll();
    const isMatch = positive(action) && positive(daily.partnerVotes[item.id]);
    if (isMatch) {
      showToast('IT’S A FRAME — ihr wollt beide ' + item.title + '.');
    } else if (daily.completedByUser) {
      showToast('Daily Drop abgeschlossen.');
    }
  }

  function renderProgress() {
    const daily = ensureDaily();
    const votes = currentVotes();
    const done = daily.items.filter(item => votes[item.id]).length;
    const total = daily.items.length || 7;
    const orb = document.querySelector('#dropProgress');
    if (orb) orb.textContent = done + '/' + total;

    const label = document.querySelector('#dropModeLabel');
    if (label) label.textContent = mode === 'partner' ? (loop.room.partnerName || 'PARTNER').toUpperCase() : 'DEIN DROP';

    const date = document.querySelector('#dropDateLabel');
    if (date) date.textContent = formatToday();

    const bar = document.querySelector('#dropProgressBar');
    if (bar) {
      bar.innerHTML = daily.items.map(item => '<span class="' + (votes[item.id] ? 'done' : '') + '"></span>').join('');
    }
  }

  function renderDrop() {
    const daily = ensureDaily();
    const item = nextItem();
    const art = document.querySelector('#dropArt');
    const title = document.querySelector('#dropTitle');
    const meta = document.querySelector('#dropMeta');
    const sub = document.querySelector('#dropSub');
    const count = document.querySelector('#dropCardIndex');
    const controls = document.querySelector('#dropActions');
    const done = document.querySelector('#dropDone');

    if (!daily.items.length) {
      if (title) title.textContent = 'Drop wird vorbereitet';
      if (meta) meta.textContent = 'FRAME DAILY';
      if (sub) sub.textContent = 'Sobald der Feed geladen ist, stehen hier sieben Titel bereit.';
      if (controls) controls.hidden = true;
      if (done) done.hidden = true;
      return;
    }

    const votes = currentVotes();
    const completed = daily.items.filter(entry => votes[entry.id]).length;

    if (!item) {
      if (art) {
        art.style.backgroundImage = 'linear-gradient(145deg,rgba(255,77,95,.25),rgba(20,20,24,.95))';
        art.innerHTML = '<span class="drop-finish-mark">✓</span>';
      }
      if (title) title.textContent = mode === 'partner' ? 'Drop abgegeben.' : 'Für heute fertig.';
      if (meta) meta.textContent = mode === 'partner' ? (loop.room.partnerName || 'Partner') : 'TODAY’S 7';
      if (sub) sub.textContent = mode === 'partner'
        ? 'Gib das Handy zurück. Deine Entscheidungen bleiben verborgen.'
        : (loop.room.active ? 'Jetzt siehst du, ob zwischen euch ein FRAME entstanden ist.' : 'Morgen wartet automatisch ein neuer Drop.');
      if (controls) controls.hidden = true;
      if (done) done.hidden = false;
      return;
    }

    const index = daily.items.findIndex(entry => entry.id === item.id) + 1;
    const poster = imageUrl(item.poster, 'w780');
    if (art) {
      art.style.backgroundImage = (poster ? 'linear-gradient(180deg,rgba(0,0,0,.02),rgba(0,0,0,.72)),url("' + poster + '"),' : '') + item.art;
      art.innerHTML = '<span id="dropCardIndex" class="drop-card-index">' + String(index).padStart(2, '0') + '</span>';
    }
    if (title) title.textContent = item.title;
    if (meta) meta.textContent = (item.type === 'movie' ? 'FILM' : 'SERIE') + ' · ' + (item.year || '—') + ' · ' + (completed + 1) + '/' + daily.items.length;
    if (sub) sub.textContent = item.subtitle || item.blurb || 'Heute für dich ausgewählt.';
    if (count) count.textContent = String(index).padStart(2, '0');
    if (controls) controls.hidden = false;
    if (done) done.hidden = true;
  }

  function renderRoom() {
    const nameInput = document.querySelector('#partnerNameInput');
    const roomButton = document.querySelector('#roomButton');
    const modeButton = document.querySelector('#dropModeButton');
    const endButton = document.querySelector('#roomEndButton');

    if (nameInput) {
      nameInput.value = loop.room.partnerName || '';
      nameInput.disabled = loop.room.active;
    }

    if (roomButton) {
      roomButton.hidden = loop.room.active;
      roomButton.textContent = 'ROOM STARTEN';
    }

    if (modeButton) {
      modeButton.hidden = !loop.room.active;
      modeButton.textContent = mode === 'partner'
        ? 'ZURÜCK ZU MIR'
        : (loop.room.partnerName || 'Partner').toUpperCase() + ' ÜBERNIMMT';
    }

    if (endButton) endButton.hidden = !loop.room.active;
  }

  function renderMatchStatus() {
    const title = document.querySelector('#hiddenMatchTitle');
    const copy = document.querySelector('#hiddenMatchCopy');
    const badge = document.querySelector('#hiddenMatchBadge');
    const list = document.querySelector('#matchList');
    if (!title || !copy || !badge || !list) return;

    if (!loop.room.active) {
      badge.textContent = '?';
      title.textContent = 'Room noch nicht aktiv.';
      copy.textContent = 'Trag einen Namen ein. Danach kann die zweite Person denselben Daily Drop verdeckt spielen.';
      list.innerHTML = '';
      return;
    }

    if (mode === 'partner') {
      badge.textContent = '◌';
      title.textContent = (loop.room.partnerName || 'Partner') + ' entscheidet.';
      copy.textContent = 'Deine bisherigen Entscheidungen werden hier absichtlich nicht gezeigt.';
      list.innerHTML = '';
      return;
    }

    const pending = hiddenPending();
    const matches = commonMatches();

    if (pending.length) {
      badge.textContent = '!';
      title.textContent = pending.length === 1 ? 'Ein Hidden Match wartet.' : pending.length + ' Hidden Matches warten.';
      copy.textContent = 'Mindestens einer deiner nächsten Titel wurde von ' + (loop.room.partnerName || 'Partner') + ' bereits positiv gewählt. Welcher, bleibt geheim.';
    } else if (matches.length) {
      badge.textContent = '♥';
      title.textContent = matches.length === 1 ? 'IT’S A FRAME.' : matches.length + ' gemeinsame Frames.';
      copy.textContent = 'Das sind eure Titel, bei denen ihr unabhängig voneinander auf Super oder Merken gegangen seid.';
    } else {
      badge.textContent = '…';
      title.textContent = 'Noch kein gemeinsamer Treffer.';
      copy.textContent = 'Sobald ihr beide denselben Titel positiv bewertet, taucht er hier auf.';
    }

    list.innerHTML = matches.slice(0, 5).map(item =>
      '<div class="match-chip"><span>♥</span><b>' + escapeHtml(item.title) + '</b><small>' + escapeHtml(item.year || '') + '</small></div>'
    ).join('');
  }

  function candidateItems() {
    const daily = ensureDaily();
    const common = commonMatches();
    if (common.length) return { label:'GEMEINSAMER MATCH', items:common };

    const saved = state.saved
      .map(id => catalog.find(item => item.id === id) || daily.items.find(item => item.id === id))
      .filter(item => item && item.type !== 'person');
    if (saved.length) return { label:'DEINE WATCHLIST', items:saved };

    const liked = Object.entries(state.swipes)
      .filter(([, action]) => positive(action))
      .map(([id]) => catalog.find(item => item.id === id) || daily.items.find(item => item.id === id))
      .filter(item => item && item.type !== 'person');
    if (liked.length) return { label:'DEIN GESCHMACK', items:liked };

    const fallback = daily.items.length ? daily.items : mediaPool().slice(0, 7);
    return { label:'FRAME PICK', items:fallback };
  }

  function choosePick() {
    const bucket = candidateItems();
    const seen = new Set(loop.pickHistory.slice(-4));
    let candidates = bucket.items.filter(item => !seen.has(item.id));
    if (!candidates.length) candidates = bucket.items.slice();
    if (!candidates.length) {
      showToast('Noch nicht genug Titel für eine Entscheidung.');
      return;
    }

    const scored = candidates.map(item => {
      let score = 70;
      try { if (typeof getPreviewMatch === 'function') score = getPreviewMatch(item); } catch {}
      return { item, score };
    }).sort((a, b) => b.score - a.score || hash(todayKey() + ':' + a.item.id) - hash(todayKey() + ':' + b.item.id));

    const top = scored.slice(0, Math.min(3, scored.length));
    const pick = top[loop.pickHistory.length % top.length] || scored[0];
    loop.pickHistory.push(pick.item.id);
    loop.pickHistory = loop.pickHistory.slice(-12);
    saveLoop();
    renderPick(pick.item, pick.score, bucket.label);
  }

  function renderPick(item, score, sourceLabel) {
    const result = document.querySelector('#pickResult');
    const art = document.querySelector('#pickArt');
    const source = document.querySelector('#pickSource');
    const title = document.querySelector('#pickTitle');
    const meta = document.querySelector('#pickMeta');
    const scoreNode = document.querySelector('#pickScore');
    const button = document.querySelector('#pickButton');
    if (!result || !art || !source || !title || !meta || !scoreNode || !button) return;

    const poster = imageUrl(item.poster, 'w500');
    art.style.backgroundImage = (poster ? 'linear-gradient(180deg,rgba(0,0,0,.02),rgba(0,0,0,.58)),url("' + poster + '"),' : '') + item.art;
    source.textContent = sourceLabel;
    title.textContent = item.title;
    meta.textContent = (item.type === 'movie' ? 'Film' : 'Serie') + ' · ' + (item.year || '—') + (item.meta ? ' · ' + item.meta : '');
    scoreNode.textContent = score + '%';
    result.hidden = false;
    button.textContent = 'NOCH EINMAL ENTSCHEIDEN';
  }

  function renderAll() {
    ensureDaily();
    renderProgress();
    renderDrop();
    renderRoom();
    renderMatchStatus();
  }

  function syncSwipe(detail) {
    if (!detail || !detail.id) return;
    const daily = ensureDaily();
    if (!daily.items.some(item => item.id === detail.id)) return;
    daily.userVotes[detail.id] = detail.action;
    daily.completedByUser = daily.items.every(item => daily.userVotes[item.id]);
    saveLoop();
    renderAll();
  }

  function undoSwipe(detail) {
    if (!detail || !detail.id) return;
    const daily = ensureDaily();
    if (!daily.items.some(item => item.id === detail.id)) return;
    delete daily.userVotes[detail.id];
    daily.completedByUser = false;
    saveLoop();
    renderAll();
  }

  function bind() {
    document.querySelector('#dropLikeButton')?.addEventListener('click', () => vote('like'));
    document.querySelector('#dropSaveButton')?.addEventListener('click', () => vote('save'));
    document.querySelector('#dropDislikeButton')?.addEventListener('click', () => vote('dislike'));

    document.querySelector('#roomButton')?.addEventListener('click', activateRoom);
    document.querySelector('#dropModeButton')?.addEventListener('click', () => setMode(mode === 'partner' ? 'user' : 'partner'));
    document.querySelector('#roomEndButton')?.addEventListener('click', deactivateRoom);
    document.querySelector('#pickButton')?.addEventListener('click', choosePick);

    document.addEventListener('frame:swipe-recorded', event => syncSwipe(event.detail));
    document.addEventListener('frame:swipe-undone', event => undoSwipe(event.detail));
    document.addEventListener('frame:view-changed', event => {
      if (event.detail && event.detail.target === 'recommend') renderAll();
    });
    document.addEventListener('frame:feed-loaded', event => {
      const daily = ensureDaily();
      const noVotes = Object.keys(daily.userVotes || {}).length === 0 && Object.keys(daily.partnerVotes || {}).length === 0;
      const grew = Number(event.detail && event.detail.catalogSize || catalog.length) > Number(daily.catalogSize || 0);
      if (noVotes && grew) {
        loop.daily = null;
        ensureDaily();
        renderAll();
      }
    });
    document.addEventListener('frame:taste-reset', () => {
      const daily = ensureDaily();
      daily.userVotes = {};
      daily.completedByUser = false;
      loop.pickHistory = [];
      saveLoop();
      renderAll();
      document.querySelector('#pickResult')?.setAttribute('hidden', '');
      const pickButton = document.querySelector('#pickButton');
      if (pickButton) pickButton.textContent = 'FRAME ENTSCHEIDET';
    });

    const nav = document.querySelector('.nav-item[data-target="recommend"] small');
    if (nav) nav.textContent = 'Heute';
  }

  ensureDaily();
  bind();
  renderAll();
})();