(() => {
  const STORAGE_KEY = 'frame-onboarding-v1';

  const steps = [
    {
      view:'discover',
      target:'.top-card',
      kicker:'SCHRITT 1 · 8',
      title:'Das ist dein Film-Feed.',
      copy:'Entscheide einfach nach Gefühl. FRAME lernt aus deinen Swipes, welche Filme, Serien und People wirklich zu dir passen.',
      extra:'gestures',
      panel:'top'
    },
    {
      view:'discover',
      target:'#discoverView .actions',
      kicker:'SCHRITT 2 · 8',
      title:'Drei schnelle Entscheidungen.',
      copy:'Links = SUPER · hoch = MERKEN · rechts = MIST. Du kannst auch die Buttons antippen. Tippen auf die Karte zeigt nur das Bild, halten öffnet Details.',
      panel:'top'
    },
    {
      view:'discover',
      target:'.undo-row',
      kicker:'SCHRITT 3 · 8',
      title:'Vertippt? Kein Problem.',
      copy:'SWIPE RÜCKGÄNGIG nimmt genau deine letzte Entscheidung zurück – inklusive Watchlist und gelerntem Geschmack.',
      panel:'top'
    },
    {
      view:'discover',
      target:'#moodTrigger',
      kicker:'SCHRITT 4 · 8',
      title:'Was passt heute?',
      copy:'Mit Stimmung sagst du FRAME, ob heute eher Horror, Drama, Action, Feel-Good oder etwas anderes dran ist. Das verändert nur den heutigen Abend – nicht deinen langfristigen Geschmack.',
      panel:'bottom'
    },
    {
      view:'recommend',
      target:'#dailyDropPanel',
      kicker:'SCHRITT 5 · 8',
      title:'Dein FRAME Daily Drop.',
      copy:'Unter Heute bekommst du jeden Tag sieben Titel. Ein kurzer Drop statt endloser Suche: SUPER, MERKEN oder MIST – danach ist für heute Schluss.',
      extra:'daily',
      panel:'top',
      scroll:true
    },
    {
      view:'recommend',
      target:'#roomPanel',
      kicker:'SCHRITT 6 · 8',
      title:'Hidden Match für zwei.',
      copy:'Eine zweite Person spielt denselben Daily Drop verdeckt. Erst wenn ihr beide entschieden habt, zeigt FRAME eure gemeinsamen SUPER- oder MERKEN-Treffer.',
      extra:'matches',
      panel:'top',
      scroll:true
    },
    {
      view:'recommend',
      target:'.bottom-nav',
      kicker:'SCHRITT 7 · 8',
      title:'Und wenn ihr euch nicht entscheiden könnt?',
      copy:'Just Pick One nimmt gemeinsame Matches zuerst. Gibt es keine, nutzt FRAME Watchlist und Geschmack und entscheidet für euch. Im Profil siehst du außerdem, was FRAME über deinen Geschmack lernt.',
      extra:'pick',
      panel:'top'
    },
    {
      view:'discover',
      target:'',
      kicker:'SCHRITT 8 · 8',
      title:'Viel Spaß mit FRAME.',
      copy:'Du bist startklar. Swipe los, merk dir deine Favoriten und lass FRAME mit jeder Entscheidung ein bisschen besser werden.',
      extra:'start',
      final:true,
      finalPage:true,
      panel:'center'
    }
  ];

  let current = 0;
  let root = null;
  let focus = null;
  let open = false;
  let transitioning = false;
  let transitionTimer = null;

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
      .frame-welcome {
        position:fixed; inset:0; z-index:340;
        display:flex; align-items:center; justify-content:center;
        padding:18px;
        background:rgba(7,7,10,.88);
        -webkit-backdrop-filter:blur(18px); backdrop-filter:blur(18px);
      }
      .frame-welcome[hidden] { display:none !important; }
      .frame-welcome-card {
        position:relative; overflow:hidden;
        width:min(100%,430px);
        padding:26px 22px 22px;
        border-radius:30px;
        background:
          radial-gradient(circle at 86% 8%, rgba(255,255,255,.34), transparent 26%),
          linear-gradient(145deg,#ffc0b5 0%,#ff8f9a 46%,#ff536c 100%);
        color:#171316;
        box-shadow:0 28px 90px rgba(0,0,0,.52);
      }
      .frame-welcome-card::after {
        content:"F"; position:absolute; right:-12px; top:76px;
        color:rgba(23,19,22,.08);
        font:700 190px/.75 Fraunces,Georgia,serif;
        pointer-events:none;
      }
      .frame-welcome-mark {
        display:grid; place-items:center;
        width:50px; height:50px; border-radius:15px;
        background:#171316; color:#fff;
        font:700 31px/1 Fraunces,Georgia,serif;
        box-shadow:0 12px 30px rgba(23,19,22,.16);
      }
      .frame-welcome-kicker {
        display:block; margin-top:24px;
        color:rgba(23,19,22,.62);
        font:800 10px/1 Manrope,system-ui,sans-serif;
        letter-spacing:.09em;
      }
      .frame-welcome h2 {
        position:relative; z-index:1;
        margin:7px 0 0;
        max-width:330px;
        color:#171316;
        font:650 40px/.92 Fraunces,Georgia,serif;
        letter-spacing:-.045em;
      }
      .frame-welcome-lead {
        position:relative; z-index:1;
        margin:14px 0 0; max-width:350px;
        color:rgba(23,19,22,.78);
        font:650 14px/1.45 Manrope,system-ui,sans-serif;
      }
      .frame-welcome-time {
        position:relative; z-index:1;
        margin:7px 0 0;
        color:rgba(23,19,22,.58);
        font:700 11px/1.4 Manrope,system-ui,sans-serif;
      }
      .frame-welcome-points {
        position:relative; z-index:1;
        display:grid; gap:7px; margin:20px 0 0;
      }
      .frame-welcome-point {
        display:flex; align-items:center; gap:9px;
        padding:10px 11px; border-radius:14px;
        background:rgba(255,255,255,.30);
        border:1px solid rgba(255,255,255,.26);
        color:#211a1e;
        font:800 11px/1.25 Manrope,system-ui,sans-serif;
      }
      .frame-welcome-point span {
        display:grid; place-items:center;
        width:25px; height:25px; border-radius:8px;
        background:rgba(23,19,22,.10);
        font-size:13px;
      }
      .frame-welcome-actions {
        position:relative; z-index:1;
        display:grid; gap:9px; margin-top:22px;
      }
      .frame-welcome-start,
      .frame-welcome-skip {
        min-height:49px; border-radius:15px;
        font:800 12px/1 Manrope,system-ui,sans-serif;
      }
      .frame-welcome-start {
        border:0; background:#171316; color:#fff;
      }
      .frame-welcome-skip {
        border:1px solid rgba(23,19,22,.18);
        background:rgba(255,255,255,.24);
        color:#2d2429;
      }
      .frame-welcome-note {
        position:relative; z-index:1;
        margin:10px 0 0;
        color:rgba(23,19,22,.48);
        font:650 9px/1.35 Manrope,system-ui,sans-serif;
        text-align:center;
      }

      .frame-tutorial {
        position:fixed; inset:0; z-index:300; pointer-events:auto;
      }
      .frame-tutorial[hidden] { display:none !important; }
      .frame-tutorial-focus {
        position:fixed; z-index:301; pointer-events:none;
        border:2px solid rgba(255,255,255,.92);
        border-radius:22px;
        box-shadow:0 0 0 9999px rgba(4,4,6,.78),0 0 0 5px rgba(255,77,95,.14);
        transition:
          opacity .16s ease,
          top .26s cubic-bezier(.22,.61,.36,1),
          left .26s cubic-bezier(.22,.61,.36,1),
          width .26s cubic-bezier(.22,.61,.36,1),
          height .26s cubic-bezier(.22,.61,.36,1),
          border-radius .22s ease;
        will-change:opacity,top,left,width,height;
      }
      .frame-tutorial-focus.no-target {
        inset:0 !important; width:0 !important; height:0 !important; border:0 !important;
        box-shadow:0 0 0 9999px rgba(4,4,6,.84);
      }
      .frame-tutorial-panel {
        position:fixed; z-index:303; left:14px; right:14px;
        top:auto; bottom:auto;
        width:auto; max-width:430px; margin:0 auto;
        padding:17px;
        border:1px solid rgba(255,255,255,.26);
        border-radius:24px;
        background:
          radial-gradient(circle at 86% 8%, rgba(255,255,255,.34), transparent 26%),
          linear-gradient(145deg,#ffc0b5 0%,#ff8f9a 46%,#ff536c 100%);
        color:#171316;
        box-shadow:0 20px 62px rgba(0,0,0,.48);
        transition:
          opacity .16s ease,
          transform .20s cubic-bezier(.22,.61,.36,1);
        will-change:opacity,transform;
      }

      .frame-tutorial.is-changing .frame-tutorial-panel {
        opacity:0;
        transform:translateY(7px) scale(.985);
        pointer-events:none;
      }
      .frame-tutorial.is-changing .frame-tutorial-focus {
        opacity:0;
      }
      .frame-tutorial-top {
        display:flex; align-items:flex-start; justify-content:space-between; gap:12px;
      }
      .frame-tutorial-kicker {
        display:block; margin-bottom:5px; color:rgba(23,19,22,.62);
        font:800 9px/1 Manrope,system-ui,sans-serif; letter-spacing:.08em;
      }
      .frame-tutorial-title {
        margin:0; color:#171316; font:650 24px/.98 Fraunces,Georgia,serif;
        letter-spacing:-.035em;
      }
      .frame-tutorial-skip {
        flex:0 0 auto; min-height:31px; padding:6px 9px;
        border:1px solid rgba(23,19,22,.12); border-radius:999px; background:rgba(255,255,255,.24); color:#2d2429;
        font-size:9px; font-weight:800;
      }
      .frame-tutorial-copy {
        margin:9px 0 0; color:rgba(23,19,22,.78); font-size:10.8px; line-height:1.45;
      }
      .frame-tutorial-gesture {
        display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:11px;
      }
      .frame-tutorial-gesture span {
        display:grid; place-items:center; min-height:39px;
        border:1px solid rgba(255,255,255,.26); border-radius:12px;
        background:rgba(255,255,255,.24); color:#211a1e;
        font-size:9px; font-weight:800; text-align:center;
      }
      .frame-tutorial-gesture span:nth-child(1) b,
      .frame-tutorial-gesture span:nth-child(2) b,
      .frame-tutorial-gesture span:nth-child(3) b { color:#171316; }
      .frame-tutorial-gesture b { display:block; margin-bottom:2px; font-size:16px; line-height:1; }

      .frame-tutorial-feature {
        display:grid; gap:6px; margin-top:11px;
      }
      .frame-tutorial-feature div {
        display:grid; grid-template-columns:29px minmax(0,1fr); gap:8px; align-items:center;
        padding:8px 9px; border-radius:12px;
        background:rgba(255,255,255,.24); border:1px solid rgba(255,255,255,.26);
      }
      .frame-tutorial-feature b {
        display:grid; place-items:center;
        width:29px; height:29px; border-radius:9px;
        background:rgba(23,19,22,.10); color:#171316;
        font-size:13px;
      }
      .frame-tutorial-feature span {
        color:#2b2328; font-size:9.5px; line-height:1.3;
      }
      .frame-tutorial-feature strong { color:#171316; }

      .frame-tutorial-footer {
        display:flex; align-items:center; gap:8px; margin-top:12px;
      }
      .frame-tutorial-dots { display:flex; gap:4px; flex:1 1 auto; }
      .frame-tutorial-dot { width:5px; height:5px; border-radius:50%; background:rgba(23,19,22,.22); }
      .frame-tutorial-dot.active { width:16px; border-radius:99px; background:#171316; }
      .frame-tutorial-back,
      .frame-tutorial-next {
        min-height:40px; padding:8px 13px; border-radius:13px;
        font-size:10.5px; font-weight:800;
      }
      .frame-tutorial-back {
        border:1px solid rgba(23,19,22,.14); background:rgba(255,255,255,.22); color:#2d2429;
      }
      .frame-tutorial-back[hidden] { display:none; }
      .frame-tutorial-next { border:0; background:#171316; color:#fff; }

      .frame-tutorial.final-step {
        display:flex;
        align-items:center;
        justify-content:center;
        padding:14px;
        box-sizing:border-box;
      }
      .frame-tutorial.final-step .frame-tutorial-focus {
        display:none !important;
      }
      .frame-tutorial-panel.final-page {
        position:relative;
        left:auto; right:auto;
        top:auto !important; bottom:auto !important;
        width:min(100%,430px);
        max-width:430px;
        max-height:calc(100vh - 28px);
        max-height:calc(100dvh - 28px);
        overflow-y:auto;
        overscroll-behavior:contain;
        -webkit-overflow-scrolling:touch;
        box-sizing:border-box;
        padding:27px 22px 22px;
        border-radius:30px;
        text-align:center;
        box-shadow:0 28px 90px rgba(0,0,0,.54);
        scrollbar-width:none;
      }
      .frame-tutorial-panel.final-page::-webkit-scrollbar { display:none; }
      .frame-tutorial.is-changing .frame-tutorial-panel.final-page {
        transform:translateY(7px) scale(.985);
      }
      .frame-tutorial-panel.final-page .frame-tutorial-top {
        display:block;
      }
      .frame-tutorial-panel.final-page .frame-tutorial-kicker {
        margin-bottom:10px;
      }
      .frame-tutorial-panel.final-page .frame-tutorial-title {
        max-width:330px;
        margin:0 auto;
        font-size:38px;
        line-height:.94;
        letter-spacing:-.045em;
      }
      .frame-tutorial-panel.final-page .frame-tutorial-copy {
        max-width:340px;
        margin:14px auto 0;
        font-size:12px;
        line-height:1.48;
      }
      .frame-tutorial-panel.final-page .frame-tutorial-skip,
      .frame-tutorial-panel.final-page .frame-tutorial-dots {
        display:none;
      }
      .frame-tutorial-panel.final-page .frame-tutorial-footer {
        display:grid;
        grid-template-columns:1fr;
        gap:8px;
        margin-top:20px;
      }
      .frame-tutorial-panel.final-page .frame-tutorial-back {
        order:2;
        justify-self:center;
        min-height:34px;
        border:0;
        background:transparent;
        color:rgba(23,19,22,.55);
      }
      .frame-tutorial-panel.final-page .frame-tutorial-next {
        order:1;
        width:100%;
        min-height:58px;
        padding:12px 18px;
        border-radius:17px;
        font-size:14px;
        font-weight:900;
        letter-spacing:.055em;
        box-shadow:0 13px 30px rgba(23,19,22,.18);
      }
      .frame-tutorial-finish {
        display:grid;
        place-items:center;
        gap:8px;
        margin-top:18px;
      }
      .frame-tutorial-finish-mark {
        display:grid;
        place-items:center;
        width:60px; height:60px;
        border-radius:19px;
        background:rgba(23,19,22,.11);
        color:#171316;
        font:700 32px/1 Fraunces,Georgia,serif;
      }
      .frame-tutorial-finish strong {
        color:#171316;
        font-size:12px;
      }
      .frame-tutorial-finish span {
        max-width:300px;
        color:rgba(23,19,22,.67);
        font-size:10px;
        line-height:1.4;
      }

      @media (max-height:700px) {
        .frame-tutorial-panel.final-page {
          padding:20px 18px 17px;
          border-radius:24px;
        }
        .frame-tutorial-panel.final-page .frame-tutorial-title {
          font-size:31px;
        }
        .frame-tutorial-panel.final-page .frame-tutorial-copy {
          margin-top:10px;
          font-size:10.5px;
        }
        .frame-tutorial-panel.final-page .frame-tutorial-footer {
          margin-top:14px;
        }
        .frame-tutorial-panel.final-page .frame-tutorial-next {
          min-height:52px;
        }
        .frame-tutorial-finish {
          margin-top:12px;
          gap:6px;
        }
        .frame-tutorial-finish-mark {
          width:50px; height:50px;
          border-radius:16px;
          font-size:27px;
        }
        .frame-tutorial-finish span {
          font-size:9px;
        }

        .frame-welcome-card { padding:20px 18px 17px; border-radius:25px; }
        .frame-welcome-kicker { margin-top:17px; }
        .frame-welcome h2 { font-size:34px; }
        .frame-welcome-points { margin-top:14px; gap:5px; }
        .frame-welcome-point { padding:8px 9px; }
        .frame-welcome-actions { margin-top:15px; }
        .frame-tutorial-panel { padding:13px; border-radius:19px; }
        .frame-tutorial-title { font-size:21px; }
        .frame-tutorial-copy { font-size:10px; }
      }

      @media (max-height:540px) {
        .frame-tutorial.final-step { padding:8px; }
        .frame-tutorial-panel.final-page {
          max-height:calc(100dvh - 16px);
          padding:14px 16px 12px;
          border-radius:20px;
        }
        .frame-tutorial-panel.final-page .frame-tutorial-kicker {
          margin-bottom:5px;
        }
        .frame-tutorial-panel.final-page .frame-tutorial-title {
          font-size:27px;
        }
        .frame-tutorial-panel.final-page .frame-tutorial-copy {
          margin-top:7px;
          font-size:9.5px;
          line-height:1.35;
        }
        .frame-tutorial-finish {
          margin-top:8px;
          gap:4px;
        }
        .frame-tutorial-finish-mark {
          width:42px; height:42px;
          border-radius:13px;
          font-size:23px;
        }
        .frame-tutorial-finish strong { font-size:10px; }
        .frame-tutorial-finish span { font-size:8.5px; }
        .frame-tutorial-panel.final-page .frame-tutorial-footer {
          margin-top:9px;
        }
        .frame-tutorial-panel.final-page .frame-tutorial-next {
          min-height:46px;
          font-size:12px;
        }
        .frame-tutorial-panel.final-page .frame-tutorial-back {
          min-height:26px;
          padding:4px 10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureUi() {
    if (root) return;
    injectStyles();

    const welcome = document.createElement('div');
    welcome.className = 'frame-welcome';
    welcome.hidden = true;
    welcome.innerHTML = `
      <section class="frame-welcome-card" role="dialog" aria-modal="true" aria-labelledby="frameWelcomeTitle">
        <div class="frame-welcome-mark">F</div>
        <span class="frame-welcome-kicker">DEIN FILMGESCHMACK · DEINE ENTSCHEIDUNG</span>
        <h2 id="frameWelcomeTitle">Willkommen bei FRAME</h2>
        <p class="frame-welcome-lead">Entdecke Filme, Serien und People, die wirklich zu dir passen.</p>
        <p class="frame-welcome-time">Wir zeigen dir in unter 20 Sekunden, wie FRAME funktioniert.</p>

        <div class="frame-welcome-points">
          <div class="frame-welcome-point"><span>↔</span>Swipe nach Gefühl</div>
          <div class="frame-welcome-point"><span>⌑</span>Für später merken</div>
          <div class="frame-welcome-point"><span>✦</span>Persönliche Empfehlungen bekommen</div>
        </div>

        <div class="frame-welcome-actions">
          <button class="frame-welcome-start" type="button">Kurze Tour starten</button>
          <button class="frame-welcome-skip" type="button">Direkt loslegen</button>
        </div>
        <p class="frame-welcome-note">Du kannst die Tour später im Profil erneut öffnen.</p>
      </section>`;
    document.body.appendChild(welcome);

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

    welcome.querySelector('.frame-welcome-start').addEventListener('click', () => {
      closeWelcome();
      startTour();
    });
    welcome.querySelector('.frame-welcome-skip').addEventListener('click', () => {
      closeWelcome();
      markSeen();
    });

    root.querySelector('.frame-tutorial-skip').addEventListener('click', () => closeTutorial(true));
    root.querySelector('.frame-tutorial-back').addEventListener('click', () => {
      if (current > 0) changeStep(current - 1);
    });
    root.querySelector('.frame-tutorial-next').addEventListener('click', () => {
      if (current >= steps.length - 1) closeTutorial(true);
      else changeStep(current + 1);
    });

    const reposition = () => { if (open) requestAnimationFrame(positionFocus); };
    window.addEventListener('resize', reposition, {passive:true});
    window.visualViewport?.addEventListener('resize', reposition, {passive:true});
    window.visualViewport?.addEventListener('scroll', reposition, {passive:true});
    window.addEventListener('orientationchange', () => setTimeout(reposition,180), {passive:true});

    const deck = document.querySelector('#cardDeck');
    if (deck) {
      new MutationObserver(() => {
        if (open && steps[current]?.target === '.top-card') requestAnimationFrame(positionFocus);
      }).observe(deck,{childList:true,subtree:false});
    }
  }

  function welcomeNode() {
    return document.querySelector('.frame-welcome');
  }

  function showWelcome() {
    ensureUi();
    welcomeNode().hidden = false;
  }

  function closeWelcome() {
    const node = welcomeNode();
    if (node) node.hidden = true;
  }

  function setStepView(step) {
    if (!step?.view) return;
    try {
      if (typeof switchView === 'function') switchView(step.view);
    } catch {}
  }

  function targetForStep() {
    return document.querySelector(steps[current]?.target || '');
  }

  function scrollTargetIntoView(step) {
    const target = targetForStep();
    if (!target || !step?.scroll) return;
    try { target.scrollIntoView({behavior:'auto',block:'center',inline:'nearest'}); } catch {}
  }

  function positionFocus() {
    if (!focus || !open) return;
    const target = targetForStep();
    const panel = root?.querySelector('.frame-tutorial-panel');
    if (!panel) return;

    if (steps[current]?.finalPage) {
      focus.className = 'frame-tutorial-focus';
      panel.style.top = '';
      panel.style.bottom = '';
      return;
    }

    panel.style.transform = '';

    if (!target) {
      focus.className = 'frame-tutorial-focus no-target';
      return;
    }

    const rect = target.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportHeight = viewport?.height || window.innerHeight;
    const viewportBottom = viewportTop + viewportHeight;

    const pad = steps[current]?.target === '.top-card' ? 5 : 7;
    const left = Math.max(6,rect.left-pad);
    const top = Math.max(viewportTop+6,rect.top-pad);
    const width = Math.min(window.innerWidth-left-6,rect.width+pad*2);
    const height = Math.min(viewportBottom-top-6,rect.height+pad*2);

    focus.className = 'frame-tutorial-focus';
    focus.style.left = `${left}px`;
    focus.style.top = `${top}px`;
    focus.style.width = `${Math.max(0,width)}px`;
    focus.style.height = `${Math.max(0,height)}px`;

    if (steps[current]?.target === '#moodTrigger') focus.style.borderRadius = '999px';
    else if (steps[current]?.target === '.bottom-nav') focus.style.borderRadius = '20px';
    else focus.style.borderRadius = '22px';

    panel.style.top = 'auto';
    panel.style.bottom = 'auto';

    const gap = 13;
    const safeTop = viewportTop + 9;
    const safeBottom = viewportBottom - 10;
    const panelHeight = panel.offsetHeight;
    const spaceAbove = Math.max(0,rect.top-gap-safeTop);
    const spaceBelow = Math.max(0,safeBottom-rect.bottom-gap);

    let side = steps[current]?.panel || (spaceAbove >= spaceBelow ? 'top' : 'bottom');
    if (side === 'top' && spaceAbove < panelHeight && spaceBelow >= panelHeight) side = 'bottom';
    if (side === 'bottom' && spaceBelow < panelHeight && spaceAbove >= panelHeight) side = 'top';

    const placeAbove = () => {
      const y = Math.max(safeTop,Math.min(rect.top-gap-panelHeight,safeBottom-panelHeight));
      panel.style.top = `${y}px`;
      return {top:y,bottom:y+panelHeight};
    };
    const placeBelow = () => {
      const y = Math.max(safeTop,Math.min(rect.bottom+gap,safeBottom-panelHeight));
      panel.style.top = `${y}px`;
      return {top:y,bottom:y+panelHeight};
    };

    let placed = side === 'bottom' ? placeBelow() : placeAbove();
    const targetTop = rect.top-pad;
    const targetBottom = rect.bottom+pad;

    if (placed.bottom > targetTop && placed.top < targetBottom) {
      if (side === 'bottom' && spaceAbove > 85) placed = placeAbove();
      else if (side === 'top' && spaceBelow > 85) placed = placeBelow();
    }
  }

  function extraMarkup(type) {
    if (type === 'gestures') {
      return `
        <div class="frame-tutorial-gesture">
          <span><b>←</b>SUPER</span>
          <span><b>↑</b>MERKEN</span>
          <span><b>→</b>MIST</span>
        </div>`;
    }
    if (type === 'daily') {
      return `
        <div class="frame-tutorial-feature">
          <div><b>7</b><span><strong>Today’s 7:</strong> sieben kurze Entscheidungen pro Tag.</span></div>
        </div>`;
    }
    if (type === 'matches') {
      return `
        <div class="frame-tutorial-feature">
          <div><b>◌</b><span><strong>Hidden:</strong> die Entscheidungen der anderen Person bleiben zunächst geheim.</span></div>
          <div><b>♥</b><span><strong>Match:</strong> SUPER oder MERKEN bei demselben Titel wird danach sichtbar.</span></div>
        </div>`;
    }
    if (type === 'pick') {
      return `
        <div class="frame-tutorial-feature">
          <div><b>1</b><span><strong>Just Pick One:</strong> FRAME macht aus Auswahl eine Entscheidung.</span></div>
        </div>`;
    }
    if (type === 'start') {
      return `
        <div class="frame-tutorial-finish">
          <div class="frame-tutorial-finish-mark">F</div>
          <strong>Dein Feed wartet.</strong>
          <span>Viel Spaß beim Entdecken – und keine Sorge: FRAME wird mit jedem Swipe persönlicher.</span>
        </div>`;
    }
    return '';
  }

  function changeStep(nextIndex) {
    if (!root || !open || transitioning) return;
    if (nextIndex < 0 || nextIndex >= steps.length || nextIndex === current) return;

    transitioning = true;
    root.classList.add('is-changing');
    if (transitionTimer) clearTimeout(transitionTimer);

    transitionTimer = setTimeout(() => {
      current = nextIndex;
      renderStep();

      // renderStep changes view and positions the new target after a short layout settle.
      transitionTimer = setTimeout(() => {
        root.classList.remove('is-changing');
        transitioning = false;
        transitionTimer = null;
      }, 150);
    }, 150);
  }

  function renderStep() {
    const step = steps[current];
    if (!step || !root) return;

    setStepView(step);

    const panel = root.querySelector('.frame-tutorial-panel');
    root.classList.toggle('final-step', Boolean(step.finalPage));
    if (panel && !step.finalPage) {
      panel.style.top = '';
      panel.style.bottom = '';
      panel.style.transform = '';
    }
    panel?.classList.toggle('final-page', Boolean(step.finalPage));

    root.querySelector('.frame-tutorial-kicker').textContent = step.kicker;
    root.querySelector('.frame-tutorial-title').textContent = step.title;
    root.querySelector('.frame-tutorial-copy').textContent = step.copy;
    root.querySelector('.frame-tutorial-back').hidden = current === 0;
    root.querySelector('.frame-tutorial-next').textContent = step.final ? 'LOS SWIPEN' : 'Weiter';
    root.querySelector('.frame-tutorial-extra').innerHTML = extraMarkup(step.extra);
    root.querySelector('.frame-tutorial-dots').innerHTML = steps
      .map((_,index) => `<span class="frame-tutorial-dot${index===current?' active':''}"></span>`)
      .join('');

    setTimeout(() => {
      scrollTargetIntoView(step);
      requestAnimationFrame(() => requestAnimationFrame(positionFocus));
    },55);
  }

  function startTour() {
    ensureUi();
    closeWelcome();
    current = 0;
    open = true;
    transitioning = false;
    if (transitionTimer) {
      clearTimeout(transitionTimer);
      transitionTimer = null;
    }
    root.classList.remove('is-changing');
    root.hidden = false;
    renderStep();
  }

  function showFirstUse() {
    ensureUi();
    if (seen()) return;
    showWelcome();
  }

  function closeTutorial(remember = true) {
    if (!root) return;
    open = false;
    transitioning = false;
    if (transitionTimer) {
      clearTimeout(transitionTimer);
      transitionTimer = null;
    }
    root.classList.remove('is-changing','final-step');
    root.hidden = true;
    if (remember) markSeen();
    try {
      if (typeof switchView === 'function') switchView('discover');
    } catch {}
  }

  window.frameStartTutorial = () => startTour();
  window.frameShowWelcome = () => {
    ensureUi();
    showWelcome();
  };

  document.querySelector('#tutorialReplayButton')?.addEventListener('click', () => {
    ensureUi();
    showWelcome();
  });

  if (!seen()) {
    window.addEventListener('load', () => {
      setTimeout(showFirstUse,650);
    },{once:true});
  }
})();
