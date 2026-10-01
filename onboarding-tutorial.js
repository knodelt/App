(() => {
  const STORAGE_KEY = 'frame-onboarding-v1';

  const steps = [
    {
      target:'.top-card',
      kicker:'SCHRITT 1 · 5',
      title:'Das ist dein Film-Feed.',
      copy:'Einfach nach Gefühl entscheiden. FRAME lernt mit jedem Swipe ein bisschen genauer, was wirklich zu dir passt.',
      gesture:true
    },
    {
      target:'#discoverView .actions',
      kicker:'SCHRITT 2 · 5',
      title:'Drei schnelle Entscheidungen.',
      copy:'Links = SUPER · hoch = MERKEN · rechts = MIST. Du kannst auch einfach die drei Buttons antippen.',
      actions:true
    },
    {
      target:'.undo-row',
      kicker:'SCHRITT 3 · 5',
      title:'Vertippt? Kein Problem.',
      copy:'Mit SWIPE RÜCKGÄNGIG holst du genau die letzte Entscheidung zurück – inklusive Geschmack und Watchlist.'
    },
    {
      target:'#moodTrigger',
      kicker:'SCHRITT 4 · 5',
      title:'Was passt heute?',
      copy:'Über Stimmung sagst du FRAME, ob heute eher Horror, Drama, Action, Feel-Good oder etwas anderes dran ist.'
    },
    {
      target:'.bottom-nav',
      kicker:'SCHRITT 5 · 5',
      title:'Je mehr du swipest, desto besser wird FRAME.',
      copy:'Unter Für dich entstehen persönliche Treffer. Im Profil siehst du, was FRAME über deinen Geschmack gelernt hat.',
      final:true
    }
  ];

  let current = 0;
  let root = null;
  let focus = null;
  let open = false;

  function seen() {
    try { return localStorage.getItem(STORAGE_KEY) === 'done'; }
    catch { return false; }
  }

  function markSeen() {
    try { localStorage.setItem(STORAGE_KEY,'done'); } catch {}
  }

  function injectStyles() {
    if (document.querySelector('#frameTutorialStyles')) return;
    const style = document.createElement('style');
    style.id = 'frameTutorialStyles';
    style.textContent = `
      .frame-tutorial {
        position:fixed; inset:0; z-index:300; pointer-events:auto;
      }
      .frame-tutorial[hidden] { display:none !important; }
      .frame-tutorial-focus {
        position:fixed; z-index:301; pointer-events:none;
        border:2px solid rgba(255,255,255,.92);
        border-radius:22px;
        box-shadow:0 0 0 9999px rgba(4,4,6,.78), 0 0 0 5px rgba(255,77,95,.14);
        transition:top .2s ease,left .2s ease,width .2s ease,height .2s ease,border-radius .2s ease;
      }
      .frame-tutorial-focus.no-target {
        inset:0 !important; width:0 !important; height:0 !important; border:0 !important;
        box-shadow:0 0 0 9999px rgba(4,4,6,.84);
      }
      .frame-tutorial-panel {
        position:fixed; z-index:303; left:14px; right:14px;
        bottom:calc(14px + env(safe-area-inset-bottom));
        width:auto; max-width:430px; margin:0 auto;
        padding:18px;
        border:1px solid rgba(255,255,255,.12);
        border-radius:24px;
        background:rgba(18,18,21,.97);
        color:#f7f5f2;
        box-shadow:0 22px 70px rgba(0,0,0,.5);
        -webkit-backdrop-filter:blur(20px); backdrop-filter:blur(20px);
      }
      .frame-tutorial-top {
        display:flex; align-items:flex-start; justify-content:space-between; gap:12px;
      }
      .frame-tutorial-kicker {
        display:block; margin-bottom:5px; color:#ff6070;
        font:800 9px/1 Manrope,system-ui,sans-serif; letter-spacing:.08em;
      }
      .frame-tutorial-title {
        margin:0; color:#fff; font:650 27px/.98 Fraunces,Georgia,serif;
        letter-spacing:-.035em;
      }
      .frame-tutorial-skip {
        flex:0 0 auto; min-height:32px; padding:6px 9px; border:0; border-radius:999px;
        background:#202025; color:#99948e; font-size:9px; font-weight:800;
      }
      .frame-tutorial-copy {
        margin:11px 0 0; color:#b9b4ad; font-size:12px; line-height:1.48;
      }
      .frame-tutorial-gesture {
        display:grid; grid-template-columns:repeat(3,1fr); gap:7px; margin-top:13px;
      }
      .frame-tutorial-gesture span {
        display:grid; place-items:center; min-height:43px; border:1px solid rgba(255,255,255,.09);
        border-radius:13px; background:#1a1a1f; color:#ddd8d1;
        font-size:10px; font-weight:800; text-align:center;
      }
      .frame-tutorial-gesture span:nth-child(1) b { color:#b9f36a; }
      .frame-tutorial-gesture span:nth-child(2) b { color:#f7c85f; }
      .frame-tutorial-gesture span:nth-child(3) b { color:#ff7a86; }
      .frame-tutorial-gesture b {
        display:block; margin-bottom:2px; font-size:17px; line-height:1;
      }
      .frame-tutorial-footer {
        display:flex; align-items:center; gap:10px; margin-top:15px;
      }
      .frame-tutorial-dots {
        display:flex; gap:5px; flex:1 1 auto;
      }
      .frame-tutorial-dot {
        width:6px; height:6px; border-radius:50%; background:#3b393d;
      }
      .frame-tutorial-dot.active { width:18px; border-radius:99px; background:#ff4d5f; }
      .frame-tutorial-back,
      .frame-tutorial-next {
        min-height:42px; padding:9px 14px; border-radius:13px; font-size:11px; font-weight:800;
      }
      .frame-tutorial-back {
        border:1px solid rgba(255,255,255,.10); background:#1a1a1f; color:#aaa59e;
      }
      .frame-tutorial-back[hidden] { display:none; }
      .frame-tutorial-next {
        border:0; background:#f7f5f2; color:#0b0b0d;
      }
      .tutorial-replay-note {
        display:block; margin-top:6px; color:#696661; font-size:9px; text-align:center;
      }
      @media (max-height:700px) {
        .frame-tutorial-panel { padding:15px; border-radius:20px; }
        .frame-tutorial-title { font-size:23px; }
        .frame-tutorial-copy { font-size:11px; }
        .frame-tutorial-gesture span { min-height:38px; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureUi() {
    if (root) return;
    injectStyles();

    root = document.createElement('div');
    root.className = 'frame-tutorial';
    root.hidden = true;
    root.innerHTML = `
      <div class="frame-tutorial-focus"></div>
      <section class="frame-tutorial-panel" role="dialog" aria-modal="true" aria-labelledby="frameTutorialTitle">
        <div class="frame-tutorial-top">
          <div>
            <span class="frame-tutorial-kicker"></span>
            <h2 class="frame-tutorial-title" id="frameTutorialTitle"></h2>
          </div>
          <button class="frame-tutorial-skip" type="button">Überspringen</button>
        </div>
        <p class="frame-tutorial-copy"></p>
        <div class="frame-tutorial-extra"></div>
        <div class="frame-tutorial-footer">
          <div class="frame-tutorial-dots"></div>
          <button class="frame-tutorial-back" type="button">Zurück</button>
          <button class="frame-tutorial-next" type="button">Weiter</button>
        </div>
      </section>`;
    document.body.appendChild(root);

    focus = root.querySelector('.frame-tutorial-focus');

    root.querySelector('.frame-tutorial-skip').addEventListener('click', () => closeTutorial(true));
    root.querySelector('.frame-tutorial-back').addEventListener('click', () => {
      if (current > 0) {
        current -= 1;
        renderStep();
      }
    });
    root.querySelector('.frame-tutorial-next').addEventListener('click', () => {
      if (current >= steps.length - 1) closeTutorial(true);
      else {
        current += 1;
        renderStep();
      }
    });

    window.addEventListener('resize', () => { if (open) positionFocus(); }, {passive:true});
    window.addEventListener('orientationchange', () => setTimeout(() => { if (open) positionFocus(); },180), {passive:true});

    const deck = document.querySelector('#cardDeck');
    if (deck) {
      new MutationObserver(() => {
        if (open && current === 0) requestAnimationFrame(positionFocus);
      }).observe(deck,{childList:true,subtree:false});
    }
  }

  function targetForStep() {
    return document.querySelector(steps[current]?.target || '');
  }

  function positionFocus() {
    if (!focus || !open) return;
    const target = targetForStep();
    if (!target) {
      focus.className = 'frame-tutorial-focus no-target';
      return;
    }

    const rect = target.getBoundingClientRect();
    const pad = current === 0 ? 5 : 7;
    const left = Math.max(6,rect.left-pad);
    const top = Math.max(6,rect.top-pad);
    const width = Math.min(window.innerWidth-left-6,rect.width+pad*2);
    const height = Math.min(window.innerHeight-top-6,rect.height+pad*2);

    focus.className = 'frame-tutorial-focus';
    focus.style.left = `${left}px`;
    focus.style.top = `${top}px`;
    focus.style.width = `${Math.max(0,width)}px`;
    focus.style.height = `${Math.max(0,height)}px`;

    if (steps[current].target === '#moodTrigger') focus.style.borderRadius = '999px';
    else if (steps[current].target === '.bottom-nav') focus.style.borderRadius = '20px';
    else focus.style.borderRadius = '22px';
  }

  function renderStep() {
    const step = steps[current];
    if (!step || !root) return;

    root.querySelector('.frame-tutorial-kicker').textContent = step.kicker;
    root.querySelector('.frame-tutorial-title').textContent = step.title;
    root.querySelector('.frame-tutorial-copy').textContent = step.copy;
    root.querySelector('.frame-tutorial-back').hidden = current === 0;
    root.querySelector('.frame-tutorial-next').textContent = step.final ? 'Los swipen' : 'Weiter';

    const extra = root.querySelector('.frame-tutorial-extra');
    extra.innerHTML = step.gesture ? `
      <div class="frame-tutorial-gesture">
        <span><b>←</b>SUPER</span>
        <span><b>↑</b>MERKEN</span>
        <span><b>→</b>MIST</span>
      </div>`
      : step.actions ? '<p class="tutorial-replay-note">Tippen = Bild · halten = Details</p>'
      : '';

    root.querySelector('.frame-tutorial-dots').innerHTML = steps
      .map((_,index) => `<span class="frame-tutorial-dot${index === current ? ' active' : ''}"></span>`)
      .join('');

    requestAnimationFrame(() => requestAnimationFrame(positionFocus));
  }

  function openTutorial({replay=false} = {}) {
    ensureUi();
    if (!replay && seen()) return;

    try {
      if (typeof switchView === 'function') switchView('discover');
    } catch {}

    current = 0;
    open = true;
    root.hidden = false;
    renderStep();
  }

  function closeTutorial(remember = true) {
    if (!root) return;
    open = false;
    root.hidden = true;
    if (remember) markSeen();
  }

  window.frameStartTutorial = () => openTutorial({replay:true});

  document.querySelector('#tutorialReplayButton')?.addEventListener('click', () => openTutorial({replay:true}));

  if (!seen()) {
    window.addEventListener('load', () => {
      setTimeout(() => openTutorial(),850);
    }, {once:true});
  }
})();
