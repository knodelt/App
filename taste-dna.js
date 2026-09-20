(() => {
  const STORAGE_KEY = 'frame-taste-dna-v2';
  const VERSION = 2;

  const STATIC_QUESTIONS = [
    {
      id:'pace',
      title:'Wie soll sich ein guter Film anfühlen?',
      copy:'FRAME trennt Tempo von Genre – damit ein langsamer Thriller nicht wie ein Actionfilm behandelt wird.',
      options:[
        {id:'slow', label:'Langsam & atmosphärisch', effects:[
          {key:'trait:slow', label:'Slow Burn', group:'trait', weight:2.8},
          {key:'trait:fast', label:'Schnelles Tempo', group:'trait', weight:-1.1}
        ]},
        {id:'fast', label:'Schnell & direkt', effects:[
          {key:'trait:fast', label:'Schnelles Tempo', group:'trait', weight:2.8},
          {key:'trait:slow', label:'Slow Burn', group:'trait', weight:-1.1}
        ]}
      ]
    },
    {
      id:'focus',
      title:'Was zieht dich stärker in einen Film?',
      copy:'Handlung und Figuren werden getrennt gewichtet.',
      options:[
        {id:'character', label:'Figuren & Beziehungen', effects:[
          {key:'trait:character', label:'Figurengetrieben', group:'trait', weight:2.8},
          {key:'trait:plot', label:'Plot-getrieben', group:'trait', weight:-.8}
        ]},
        {id:'plot', label:'Plot & Wendungen', effects:[
          {key:'trait:plot', label:'Plot-getrieben', group:'trait', weight:2.8},
          {key:'trait:character', label:'Figurengetrieben', group:'trait', weight:-.8}
        ]}
      ]
    },
    {
      id:'world',
      title:'Welche Welt reizt dich eher?',
      copy:'Das hilft FRAME besonders bei Drama, Sci-Fi und Fantasy.',
      options:[
        {id:'realistic', label:'Realistisch & nahbar', effects:[
          {key:'trait:realistic', label:'Realistisch', group:'trait', weight:2.5},
          {key:'trait:fantastical', label:'Fantastische Welten', group:'trait', weight:-.7}
        ]},
        {id:'fantastical', label:'Fremde & fantastische Welten', effects:[
          {key:'trait:fantastical', label:'Fantastische Welten', group:'trait', weight:2.5},
          {key:'trait:realistic', label:'Realistisch', group:'trait', weight:-.7}
        ]}
      ]
    },
    {
      id:'tone',
      title:'Welche Grundstimmung trifft dich eher?',
      copy:'Genre bleibt wichtig, aber Tonalität entscheidet oft darüber, ob ein Film wirklich passt.',
      options:[
        {id:'dark', label:'Düster & intensiv', effects:[
          {key:'trait:dark', label:'Düster', group:'trait', weight:2.7},
          {key:'trait:light', label:'Leicht', group:'trait', weight:-.9}
        ]},
        {id:'light', label:'Leicht & warm', effects:[
          {key:'trait:light', label:'Leicht', group:'trait', weight:2.7},
          {key:'trait:dark', label:'Düster', group:'trait', weight:-.9}
        ]}
      ]
    },
    {
      id:'complexity',
      title:'Was macht dir beim Ende mehr Spaß?',
      copy:'Damit unterscheidet FRAME klare Unterhaltung von Filmen, die noch lange im Kopf arbeiten.',
      options:[
        {id:'mindfuck', label:'Rätseln & Mindfuck', effects:[
          {key:'trait:mindfuck', label:'Mindfuck', group:'trait', weight:2.8},
          {key:'trait:clear', label:'Klare Auflösung', group:'trait', weight:-.8}
        ]},
        {id:'clear', label:'Klar & befriedigend', effects:[
          {key:'trait:clear', label:'Klare Auflösung', group:'trait', weight:2.5},
          {key:'trait:mindfuck', label:'Mindfuck', group:'trait', weight:-.8}
        ]}
      ]
    }
  ];

  const GROUP_MULTIPLIER = {
    genre:1,
    director:1.25,
    creator:1.2,
    actor:.68,
    keyword:1,
    trait:.88,
    language:.35,
    runtime:.42,
    decade:.24,
    person:1.1
  };

  const PAIRABLE_GROUPS = new Set(['genre','director','creator','actor','keyword','trait','person']);

  function emptyData() {
    return { version:VERSION, items:{}, answers:{}, featureWeights:[], pairWeights:[], updatedAt:Date.now() };
  }

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return parsed && parsed.version === VERSION ? {...emptyData(), ...parsed} : emptyData();
    } catch {
      return emptyData();
    }
  }

  let data = load();

  function save() {
    data.updatedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function actionWeight(action) {
    return action === 'like' ? 3 : action === 'save' ? 1.25 : action === 'dislike' ? -3 : 0;
  }

  function confidence(count, divisor = 3) {
    return clamp(1 - Math.exp(-Math.max(0, count) / divisor), 0, .99);
  }

  function addWeight(map, feature, rawWeight, count = 1) {
    if (!feature?.key || !Number.isFinite(rawWeight) || rawWeight === 0) return;
    const multiplier = GROUP_MULTIPLIER[feature.group] ?? 1;
    const current = map.get(feature.key) || {
      key:feature.key,
      label:feature.label || feature.key,
      group:feature.group || 'other',
      weight:0,
      count:0
    };
    current.weight += rawWeight * multiplier;
    current.count += count;
    map.set(feature.key, current);
  }

  function syncItemsToSwipes() {
    const active = state?.swipes || {};
    Object.keys(data.items || {}).forEach(id => {
      if (!active[id]) delete data.items[id];
      else data.items[id].action = active[id];
    });
  }

  function recompute({emit=true} = {}) {
    syncItemsToSwipes();

    const features = new Map();
    const pairs = new Map();

    Object.values(data.items || {}).forEach(item => {
      const delta = actionWeight(item.action);
      if (!delta) return;
      const itemFeatures = Array.isArray(item.features) ? item.features : [];

      itemFeatures.forEach(feature => addWeight(features, feature, delta));

      const pairable = itemFeatures
        .filter(feature => PAIRABLE_GROUPS.has(feature.group))
        .filter((feature,index,array) => array.findIndex(other => other.key === feature.key) === index)
        .slice(0,8);

      for (let i = 0; i < pairable.length; i += 1) {
        for (let j = i + 1; j < pairable.length; j += 1) {
          const a = pairable[i];
          const b = pairable[j];
          const [first, second] = a.key < b.key ? [a,b] : [b,a];
          const key = `${first.key}|${second.key}`;
          const current = pairs.get(key) || {
            key,
            a:first.key,
            b:second.key,
            labelA:first.label,
            labelB:second.label,
            weight:0,
            count:0
          };
          current.weight += delta * .58;
          current.count += 1;
          pairs.set(key,current);
        }
      }
    });

    Object.values(data.answers || {}).forEach(answer => {
      (answer.effects || []).forEach(effect => {
        addWeight(features, effect, Number(effect.weight) || 0, 1.6);
      });
    });

    data.featureWeights = [...features.values()]
      .map(entry => ({
        ...entry,
        weight:Number(entry.weight.toFixed(2)),
        confidence:Number(confidence(entry.count, 2.8).toFixed(3))
      }))
      .filter(entry => Math.abs(entry.weight) >= .3)
      .sort((a,b) => Math.abs(b.weight * b.confidence) - Math.abs(a.weight * a.confidence))
      .slice(0,50);

    data.pairWeights = [...pairs.values()]
      .map(entry => ({
        ...entry,
        weight:Number(entry.weight.toFixed(2)),
        confidence:Number(confidence(entry.count, 2.2).toFixed(3))
      }))
      .filter(entry => Math.abs(entry.weight) >= .45)
      .sort((a,b) => Math.abs(b.weight * b.confidence) - Math.abs(a.weight * a.confidence))
      .slice(0,60);

    save();
    render();
    expose();

    if (emit) {
      document.dispatchEvent(new CustomEvent('frame:taste-dna-changed', {
        detail:{ answeredCount:Object.keys(data.answers || {}).length }
      }));
    }
  }

  function expose() {
    window.getFrameTasteDNA = () => ({
      version:VERSION,
      featureWeights:(data.featureWeights || []).slice(0,40),
      pairWeights:(data.pairWeights || []).slice(0,40),
      answeredCount:Object.keys(data.answers || {}).length
    });
  }

  function featureGroupFromKey(key) {
    if (key.startsWith('person:director:')) return 'director';
    if (key.startsWith('person:creator:')) return 'creator';
    if (key.startsWith('person:actor:')) return 'actor';
    if (key.startsWith('person:')) return 'person';
    return key.split(':')[0] || 'other';
  }

  function fallbackFeatures(item) {
    const tags = Array.isArray(item?.tags) ? item.tags : [];
    const known = {
      Action:'genre:28', Abenteuer:'genre:12', Animation:'genre:16', 'Komödie':'genre:35',
      Comedy:'genre:35', Crime:'genre:80', Doku:'genre:99', Drama:'genre:18', Familie:'genre:10751',
      Fantasy:'genre:14', Horror:'genre:27', Mystery:'genre:9648', Romance:'genre:10749',
      'Sci-Fi':'genre:878', Thriller:'genre:53', Western:'genre:37'
    };
    return tags.map(tag => known[tag] ? {
      key:known[tag],
      label:tag === 'Comedy' ? 'Komödie' : tag,
      group:'genre'
    } : null).filter(Boolean);
  }

  async function enrichItem(id, item) {
    if (!item?.tmdbId || !['movie','series','person'].includes(item.type)) return;
    const entry = data.items[id];
    if (!entry || entry.enriched) return;

    try {
      const response = await fetch(`/api/taste-features?type=${encodeURIComponent(item.type)}&id=${encodeURIComponent(item.tmdbId)}`, {
        headers:{accept:'application/json'},
        cache:'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok || !Array.isArray(payload.features)) throw new Error(payload.message || `Taste features ${response.status}`);
      if (!data.items[id] || !state.swipes?.[id]) return;
      data.items[id].features = payload.features.slice(0,24).map(feature => ({
        key:String(feature.key || ''),
        label:String(feature.label || feature.key || '').slice(0,80),
        group:String(feature.group || featureGroupFromKey(String(feature.key || '')))
      })).filter(feature => feature.key);
      data.items[id].enriched = true;
      recompute();
    } catch (error) {
      console.warn('[FRAME TASTE DNA]', error.message);
    }
  }

  function rememberSwipe(id, action, item) {
    if (!id || !item) return;
    const current = data.items[id] || {};
    data.items[id] = {
      ...current,
      id,
      action,
      title:item.title || current.title || '',
      type:item.type || current.type || '',
      tmdbId:Number(item.tmdbId || current.tmdbId) || null,
      features:current.features?.length ? current.features : fallbackFeatures(item),
      enriched:Boolean(current.enriched),
      updatedAt:Date.now()
    };
    recompute();
    enrichItem(id,item);
  }

  function sharedContextQuestion() {
    const positives = Object.values(data.items || {})
      .filter(item => item.action === 'like' && Array.isArray(item.features) && item.features.length)
      .sort((a,b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0,6);

    let best = null;
    for (let i = 0; i < positives.length; i += 1) {
      for (let j = i + 1; j < positives.length; j += 1) {
        const a = positives[i];
        const b = positives[j];
        const bKeys = new Set(b.features.filter(f => PAIRABLE_GROUPS.has(f.group)).map(f => f.key));
        const shared = a.features
          .filter(f => PAIRABLE_GROUPS.has(f.group) && bKeys.has(f.key))
          .filter((f,index,array) => array.findIndex(other => other.key === f.key) === index)
          .slice(0,4);
        if (!shared.length) continue;
        const id = `context:${[a.id,b.id].sort().join(':')}`;
        if (data.answers[id]) continue;
        if (!best || shared.length > best.shared.length) best = {id,a,b,shared};
      }
    }
    if (!best) return null;

    return {
      id:best.id,
      title:`Du mochtest „${best.a.title}“ und „${best.b.title}“. Was war bei beiden wichtig?`,
      copy:'Damit lernt FRAME nicht nur einzelne Likes, sondern den gemeinsamen Grund dahinter.',
      options:best.shared.map((feature,index) => ({
        id:`shared-${index}`,
        label:feature.label,
        effects:[{...feature, weight:2.7}]
      }))
    };
  }

  function nextQuestion(skipId = '') {
    const contextual = sharedContextQuestion();
    const candidates = [
      contextual,
      ...STATIC_QUESTIONS.filter(question => !data.answers[question.id])
    ].filter(Boolean).filter(question => question.id !== skipId);

    if (candidates.length) return candidates[0];

    const repeatable = STATIC_QUESTIONS.filter(question => question.id !== skipId);
    return repeatable[Math.floor(Math.random() * repeatable.length)] || STATIC_QUESTIONS[0];
  }

  let currentQuestionId = '';

  function ensureUi() {
    const view = document.querySelector('#tasteView');
    const dnaCard = view?.querySelector('.dna-card');
    if (!view || !dnaCard || document.querySelector('#tasteDnaQuestionCard')) return;

    const questionCard = document.createElement('article');
    questionCard.id = 'tasteDnaQuestionCard';
    questionCard.className = 'taste-dna-question';
    questionCard.innerHTML = `
      <div class="taste-dna-top">
        <div>
          <span>TASTE DNA 2.0</span>
          <h2>Geschmack schärfen</h2>
        </div>
        <b id="tasteDnaAnswerCount">0 Fragen</b>
      </div>
      <p class="taste-dna-question-copy" id="tasteDnaQuestionCopy"></p>
      <h3 id="tasteDnaQuestionTitle"></h3>
      <div class="taste-dna-options" id="tasteDnaOptions"></div>
      <button class="taste-dna-next" id="tasteDnaNext" type="button">Andere Frage</button>`;
    dnaCard.insertAdjacentElement('afterend', questionCard);

    const insight = document.createElement('article');
    insight.id = 'tasteDnaInsights';
    insight.className = 'taste-dna-insights';
    insight.innerHTML = `
      <div class="taste-dna-top">
        <div>
          <span>ZUSAMMENHÄNGE</span>
          <h2>Was FRAME gerade erkennt</h2>
        </div>
      </div>
      <div class="taste-dna-chipset" id="tasteDnaFeatureChips"></div>
      <div class="taste-dna-relations" id="tasteDnaRelations"></div>`;
    questionCard.insertAdjacentElement('afterend', insight);

    questionCard.addEventListener('click', event => {
      const option = event.target.closest('[data-taste-option]');
      if (option) answerQuestion(option.dataset.tasteOption);
      if (event.target.closest('#tasteDnaNext')) {
        const current = currentQuestionId;
        renderQuestion(nextQuestion(current));
      }
    });
  }

  function injectStyles() {
    if (document.querySelector('#frameTasteDnaStyles')) return;
    const style = document.createElement('style');
    style.id = 'frameTasteDnaStyles';
    style.textContent = `
      .taste-dna-question,.taste-dna-insights {
        margin:14px 0 0; padding:17px; border:1px solid rgba(255,255,255,.09);
        border-radius:22px; background:#141417;
      }
      .taste-dna-top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
      .taste-dna-top span { color:#ff6070; font-size:9px; font-weight:800; letter-spacing:.08em; }
      .taste-dna-top h2 {
        margin:4px 0 0; color:#f7f5f2; font-family:Fraunces,Georgia,serif;
        font-size:23px; line-height:1; letter-spacing:-.025em;
      }
      .taste-dna-top > b {
        flex:0 0 auto; padding:6px 8px; border-radius:999px; background:#1d1d22;
        color:#9a9690; font-size:9px; font-weight:800;
      }
      .taste-dna-question h3 {
        margin:8px 0 11px; color:#f2eee8; font-size:14px; line-height:1.35;
      }
      .taste-dna-question-copy { margin:12px 0 0; color:#86817b; font-size:10px; line-height:1.45; }
      .taste-dna-options { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
      .taste-dna-option {
        min-height:48px; padding:9px 10px; border:1px solid rgba(255,255,255,.10);
        border-radius:14px; background:#1a1a1f; color:#f1ede7;
        font-size:11px; line-height:1.25; font-weight:750; text-align:left;
      }
      .taste-dna-option:active { transform:scale(.98); }
      .taste-dna-next {
        width:100%; margin-top:9px; padding:9px; border:0; background:transparent;
        color:#77726c; font-size:10px; font-weight:700;
      }
      .taste-dna-chipset { display:flex; flex-wrap:wrap; gap:6px; margin-top:13px; }
      .taste-dna-chip {
        padding:6px 9px; border-radius:999px; border:1px solid rgba(255,255,255,.09);
        background:#1b1b20; color:#d9d4cd; font-size:10px; font-weight:700;
      }
      .taste-dna-chip.negative { color:#d8969e; }
      .taste-dna-relations { display:grid; gap:7px; margin-top:11px; }
      .taste-dna-relation {
        display:flex; align-items:center; justify-content:space-between; gap:10px;
        padding:9px 10px; border-radius:13px; background:#19191d;
        color:#c9c4bd; font-size:10px; line-height:1.3;
      }
      .taste-dna-relation b { color:#ff7c8a; font-size:9px; white-space:nowrap; }
      .taste-dna-empty { color:#77726c; font-size:10px; line-height:1.45; margin-top:12px; }
      @media (max-width:360px) { .taste-dna-options { grid-template-columns:1fr; } }
    `;
    document.head.appendChild(style);
  }

  function renderQuestion(question = nextQuestion()) {
    ensureUi();
    if (!question) return;
    currentQuestionId = question.id;
    const title = document.querySelector('#tasteDnaQuestionTitle');
    const copy = document.querySelector('#tasteDnaQuestionCopy');
    const options = document.querySelector('#tasteDnaOptions');
    if (!title || !copy || !options) return;

    title.textContent = question.title;
    copy.textContent = question.copy || '';
    options.innerHTML = question.options.map(option =>
      `<button class="taste-dna-option" type="button" data-taste-option="${option.id}">${escapeHtml(option.label)}</button>`
    ).join('');
    options.dataset.questionId = question.id;
    options._question = question;
  }

  function answerQuestion(optionId) {
    const host = document.querySelector('#tasteDnaOptions');
    const question = host?._question;
    if (!question) return;
    const option = question.options.find(entry => entry.id === optionId);
    if (!option) return;

    data.answers[question.id] = {
      id:question.id,
      optionId,
      label:option.label,
      effects:(option.effects || []).map(effect => ({...effect})),
      updatedAt:Date.now()
    };
    recompute();
    try { showToast('Geschmack geschärft.'); } catch {}
    renderQuestion(nextQuestion(question.id));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
    }[char]));
  }

  function render() {
    ensureUi();

    const count = Object.keys(data.answers || {}).length;
    const countNode = document.querySelector('#tasteDnaAnswerCount');
    if (countNode) countNode.textContent = `${count} Frage${count === 1 ? '' : 'n'}`;

    const chipHost = document.querySelector('#tasteDnaFeatureChips');
    const relationHost = document.querySelector('#tasteDnaRelations');
    if (!chipHost || !relationHost) return;

    const strongest = (data.featureWeights || [])
      .filter(entry => Math.abs(entry.weight * entry.confidence) >= .65)
      .slice(0,8);

    chipHost.innerHTML = strongest.length
      ? strongest.map(entry => `<span class="taste-dna-chip${entry.weight < 0 ? ' negative' : ''}">${escapeHtml(entry.label)} ${entry.weight > 0 ? '+' : '−'}</span>`).join('')
      : '<p class="taste-dna-empty">Noch zu wenig Signale. Ein paar Swipes oder Fragen reichen, damit hier echte Muster sichtbar werden.</p>';

    const relations = (data.pairWeights || [])
      .filter(entry => Math.abs(entry.weight * entry.confidence) >= .55)
      .slice(0,5);

    relationHost.innerHTML = relations.length
      ? relations.map(entry => `<div class="taste-dna-relation"><span>${escapeHtml(entry.labelA)} + ${escapeHtml(entry.labelB)}</span><b>${Math.round(entry.confidence * 100)}% sicher</b></div>`).join('')
      : '';
  }

  function resetTasteDna() {
    data = emptyData();
    save();
    render();
    renderQuestion(nextQuestion());
    expose();
    document.dispatchEvent(new CustomEvent('frame:taste-dna-changed', {detail:{answeredCount:0}}));
  }

  injectStyles();
  expose();
  ensureUi();
  recompute({emit:false});
  renderQuestion(nextQuestion());

  const originalRecordSwipe = recordSwipe;
  recordSwipe = function frameRecordSwipeWithTasteDna(id, action) {
    const item = catalog.find(entry => entry.id === id);
    originalRecordSwipe(id,action);
    if (item) rememberSwipe(id,action,item);
  };

  document.addEventListener('frame:swipe-undone', () => recompute());
  document.addEventListener('frame:taste-reset', resetTasteDna);
  document.addEventListener('frame:recommendation-rejected', event => {
    const item = event.detail?.item;
    if (!item?.tmdbId) return;
    const id = `tmdb-${item.type}-${item.tmdbId}`;
    rememberSwipe(id,'dislike',{
      id,
      tmdbId:item.tmdbId,
      type:item.type,
      title:item.title,
      tags:item.tags || []
    });
  });
})();
