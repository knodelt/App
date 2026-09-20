(() => {
  const STORAGE_KEY = 'frame-mood-v1';
  const MOODS = [
    { id:'any', label:'Egal', note:'Überrasch mich' },
    { id:'drama', label:'Drama', note:'Emotional & intensiv' },
    { id:'horror', label:'Horror', note:'Düster & unheimlich' },
    { id:'tension', label:'Spannung', note:'Thriller, Mystery, Crime' },
    { id:'action', label:'Action', note:'Tempo & Adrenalin' },
    { id:'laugh', label:'Lachen', note:'Leicht & lustig' },
    { id:'mindfuck', label:'Mindfuck', note:'Sci-Fi & Mystery' },
    { id:'feelgood', label:'Feel-Good', note:'Warm & entspannt' },
    { id:'romance', label:'Romantik', note:'Liebe & Gefühle' }
  ];

  function todayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2,'0');
    const d = String(now.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  function validMood(value) {
    return MOODS.some(mood => mood.id === value) ? value : 'any';
  }

  function loadMood() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (saved.date !== todayKey()) return 'any';
      return validMood(saved.mood);
    } catch {
      return 'any';
    }
  }

  let currentMood = loadMood();

  function moodLabel(id = currentMood) {
    return MOODS.find(mood => mood.id === id)?.label || 'Egal';
  }

  function saveMood() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mood:currentMood, date:todayKey() }));
    } catch {}
  }

  function exposeMood() {
    window.frameMood = currentMood;
    window.getFrameMood = () => currentMood;
  }

  function updateTrigger() {
    const trigger = document.querySelector('#moodTrigger');
    const text = document.querySelector('#moodTriggerText');
    if (!trigger || !text) return;
    text.textContent = currentMood === 'any' ? 'Stimmung · Egal' : `Heute · ${moodLabel()}`;
    trigger.classList.toggle('active', currentMood !== 'any');
    trigger.setAttribute('aria-label', `Stimmung wählen. Aktuell: ${moodLabel()}`);
  }

  function ensureSheet() {
    let overlay = document.querySelector('#moodSheet');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'moodSheet';
    overlay.className = 'mood-sheet-overlay';
    overlay.setAttribute('aria-hidden','true');
    overlay.innerHTML = `
      <section class="mood-sheet" role="dialog" aria-modal="true" aria-labelledby="moodSheetTitle">
        <div class="mood-sheet-head">
          <div>
            <span>FILMABEND</span>
            <h2 id="moodSheetTitle">Worauf hast du heute Bock?</h2>
            <p>Nur für heute. Dein langfristiger Geschmack bleibt unverändert.</p>
          </div>
          <button class="mood-sheet-close" type="button" aria-label="Stimmung schließen">×</button>
        </div>
        <div class="mood-options">
          ${MOODS.map(mood => `
            <button class="mood-option" type="button" data-mood="${mood.id}">
              <strong>${mood.label}</strong>
              <small>${mood.note}</small>
            </button>`).join('')}
        </div>
      </section>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target.closest('.mood-sheet-close')) {
        closeSheet();
        return;
      }
      const option = event.target.closest('[data-mood]');
      if (option) setMood(option.dataset.mood);
    });
    return overlay;
  }

  function renderSelection() {
    const overlay = document.querySelector('#moodSheet');
    if (!overlay) return;
    overlay.querySelectorAll('[data-mood]').forEach(button => {
      button.classList.toggle('active', button.dataset.mood === currentMood);
    });
  }

  function openSheet() {
    const overlay = ensureSheet();
    renderSelection();
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden','false');
  }

  function closeSheet() {
    const overlay = document.querySelector('#moodSheet');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden','true');
  }

  function setMood(value) {
    const nextMood = validMood(value);
    const changed = nextMood !== currentMood;
    currentMood = nextMood;
    saveMood();
    exposeMood();
    updateTrigger();
    renderSelection();
    closeSheet();

    if (!changed) return;

    document.dispatchEvent(new CustomEvent('frame:mood-changed', {
      detail:{ mood:currentMood, label:moodLabel() }
    }));

    if (typeof window.frameRandomizeFeed === 'function') {
      window.frameRandomizeFeed({ fresh:true, mood:currentMood });
    }

    try {
      showToast(currentMood === 'any'
        ? 'Stimmung zurückgesetzt.'
        : `Heute: ${moodLabel()}. Feed wird angepasst.`);
    } catch {}
  }

  exposeMood();
  updateTrigger();

  document.querySelector('#moodTrigger')?.addEventListener('click', openSheet);

  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return;
    currentMood = loadMood();
    exposeMood();
    updateTrigger();
    document.dispatchEvent(new CustomEvent('frame:mood-changed', {
      detail:{ mood:currentMood, label:moodLabel() }
    }));
  });
})();
