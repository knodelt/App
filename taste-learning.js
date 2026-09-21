(() => {
  const STORAGE_KEY = 'frame-online-learning-v1';
  const VERSION = 1;
  const MAX_EVENTS = 400;
  const MAX_EXAMPLES = 180;
  const EXPLORATION_RATE = 0.15;

  const GROUP_SCALE = {
    genre:1,
    director:1,
    creator:1,
    actor:.7,
    keyword:.82,
    trait:.9,
    language:.32,
    runtime:.45,
    decade:.3,
    person:.8,
    other:.6
  };

  const FALLBACK_GENRES = {
    Action:'genre:28', Abenteuer:'genre:12', Animation:'genre:16', 'Komödie':'genre:35',
    Comedy:'genre:35', Crime:'genre:80', Doku:'genre:99', Drama:'genre:18',
    Familie:'genre:10751', Fantasy:'genre:14', Horror:'genre:27', Mystery:'genre:9648',
    Romance:'genre:10749', 'Sci-Fi':'genre:878', Thriller:'genre:53', Western:'genre:37'
  };

  function emptyState() {
    return {
      version:VERSION,
      bias:0,
      weights:{},
      steps:0,
      examples:[],
      events:[],
      featureCache:{},
      updatedAt:Date.now()
    };
  }

  function load() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return value && value.version === VERSION ? {...emptyState(), ...value} : emptyState();
    } catch {
      return emptyState();
    }
  }

  let model = load();
  let activeShown = null;
  let lastTopId = '';
  let trainingSerial = 0;

  function save() {
    model.updatedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(model)); } catch {}
  }

  function clamp(value,min,max) { return Math.min(max,Math.max(min,value)); }
  function sigmoid(value) {
    const z = clamp(Number(value) || 0,-20,20);
    return 1 / (1 + Math.exp(-z));
  }

  function confidence(seen) {
    return clamp(1 - Math.exp(-(Number(seen)||0) / 5),0,.995);
  }

  function event(type, detail = {}) {
    model.events.push({
      type,
      at:Date.now(),
      ...detail
    });
    if (model.events.length > MAX_EVENTS) model.events.splice(0, model.events.length - MAX_EVENTS);
    save();
    render();
  }

  function featureGroup(feature) {
    if (feature?.group) return feature.group;
    const key = String(feature?.key || '');
    if (key.startsWith('person:director:')) return 'director';
    if (key.startsWith('person:creator:')) return 'creator';
    if (key.startsWith('person:actor:')) return 'actor';
    if (key.startsWith('person:')) return 'person';
    return key.split(':')[0] || 'other';
  }

  function normalizeFeatures(features = []) {
    const seen = new Set();
    return features
      .map(feature => {
        const key = String(feature?.key || '');
        if (!key || seen.has(key)) return null;
        seen.add(key);
        const group = featureGroup(feature);
        return {
          key,
          label:String(feature?.label || key).slice(0,90),
          group,
          value:Number((GROUP_SCALE[group] ?? GROUP_SCALE.other).toFixed(3))
        };
      })
      .filter(Boolean)
      .slice(0,28);
  }

  function fallbackFeatures(item) {
    const features = [];
    for (const tag of (item?.tags || [])) {
      const key = FALLBACK_GENRES[tag];
      if (key) features.push({key,label:tag === 'Comedy' ? 'Komödie' : tag,group:'genre'});
    }
    if (item?.year && /^\d{4}$/.test(String(item.year))) {
      const year = Number(item.year);
      features.push({
        key:`decade:${Math.floor(year/10)*10}s`,
        label:`${Math.floor(year/10)*10}er`,
        group:'decade'
      });
    }
    return normalizeFeatures(features);
  }

  async function getFeatures(item) {
    if (!item) return [];
    const tmdbId = Number(item.tmdbId || 0);
    const type = item.type;
    const cacheKey = tmdbId && type ? `${type}:${tmdbId}` : '';
    if (cacheKey && Array.isArray(model.featureCache[cacheKey])) {
      return model.featureCache[cacheKey];
    }

    if (cacheKey && ['movie','series','person'].includes(type)) {
      try {
        const response = await fetch(`/api/taste-features?type=${encodeURIComponent(type)}&id=${encodeURIComponent(tmdbId)}`, {
          headers:{accept:'application/json'},
          cache:'no-store'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok || !Array.isArray(payload.features)) {
          throw new Error(payload.message || `features ${response.status}`);
        }
        const features = normalizeFeatures(payload.features);
        model.featureCache[cacheKey] = features;
        const keys = Object.keys(model.featureCache);
        if (keys.length > 220) delete model.featureCache[keys[0]];
        save();
        return features;
      } catch (error) {
        console.warn('[FRAME ONLINE LEARNING]', error.message);
      }
    }
    return fallbackFeatures(item);
  }

  function dot(features) {
    let value = Number(model.bias || 0);
    for (const feature of features) {
      const entry = model.weights[feature.key];
      if (!entry) continue;
      value += Number(entry.w || 0) * Number(feature.value || 1);
    }
    return value;
  }

  function ensureWeight(feature) {
    const key = feature.key;
    if (!model.weights[key]) {
      model.weights[key] = {
        w:0,
        seen:0,
        label:feature.label || key,
        group:feature.group || 'other'
      };
    }
    return model.weights[key];
  }

  function trainPoint(example, rateScale = 1) {
    const target = example.action === 'like' ? .97 : example.action === 'save' ? .76 : .03;
    const pred = sigmoid(dot(example.features));
    const error = target - pred;
    const lr = (.24 / Math.sqrt(1 + model.steps / 22)) * clamp(rateScale,.55,1.35);
    const l2 = .0025;

    model.bias = clamp(Number(model.bias || 0) + lr * error * .35,-2.5,2.5);

    for (const feature of example.features) {
      const entry = ensureWeight(feature);
      const x = Number(feature.value || 1);
      entry.w = clamp(Number(entry.w || 0) + lr * (error * x - l2 * Number(entry.w || 0)),-4.5,4.5);
      entry.seen = Number(entry.seen || 0) + 1;
      entry.label = feature.label || entry.label;
      entry.group = feature.group || entry.group;
    }

    model.steps += 1;
  }

  function mostRecentOpposite(example) {
    const wantsNegative = example.action === 'like' || example.action === 'save';
    for (let i = model.examples.length - 1; i >= 0; i -= 1) {
      const candidate = model.examples[i];
      if (candidate.id === example.id) continue;
      if (wantsNegative && candidate.action === 'dislike') return candidate;
      if (!wantsNegative && (candidate.action === 'like' || candidate.action === 'save')) return candidate;
    }
    return null;
  }

  function trainPair(positive, negative) {
    if (!positive?.features?.length || !negative?.features?.length) return;

    const pos = new Map(positive.features.map(feature => [feature.key,feature]));
    const neg = new Map(negative.features.map(feature => [feature.key,feature]));
    const keys = new Set([...pos.keys(),...neg.keys()]);

    let diff = 0;
    for (const key of keys) {
      const p = pos.get(key);
      const n = neg.get(key);
      const x = Number(p?.value || 0) - Number(n?.value || 0);
      if (!x) continue;
      diff += Number(model.weights[key]?.w || 0) * x;
    }

    const gradient = 1 - sigmoid(diff);
    const lr = .13 / Math.sqrt(1 + model.steps / 30);

    for (const key of keys) {
      const p = pos.get(key);
      const n = neg.get(key);
      const x = Number(p?.value || 0) - Number(n?.value || 0);
      if (!x) continue;
      const feature = p || n;
      const entry = ensureWeight(feature);
      entry.w = clamp(Number(entry.w || 0) + lr * gradient * x,-4.5,4.5);
      entry.seen = Number(entry.seen || 0) + .55;
    }

    model.steps += 1;
  }

  function behaviorScale(meta = {}) {
    const dwell = Number(meta.dwellMs || 0);
    const dwellBoost = dwell >= 9000 ? 1.12 : dwell >= 4000 ? 1.06 : dwell < 700 ? .9 : 1;
    const detailBoost = meta.detailsOpened ? 1.08 : 1;
    return clamp(dwellBoost * detailBoost,.82,1.22);
  }

  function trainExample(example, {pairwise=true} = {}) {
    trainPoint(example, behaviorScale(example.meta));
    if (!pairwise) return;

    const opposite = mostRecentOpposite(example);
    if (!opposite) return;

    if (example.action === 'dislike') trainPair(opposite,example);
    else trainPair(example,opposite);
  }

  function compactExample(example) {
    return {
      id:example.id,
      tmdbId:Number(example.tmdbId || 0) || null,
      type:example.type || '',
      title:String(example.title || '').slice(0,100),
      action:example.action,
      features:(example.features || []).slice(0,28),
      meta:{
        dwellMs:Math.min(60000,Math.max(0,Number(example.meta?.dwellMs || 0))),
        detailsOpened:Boolean(example.meta?.detailsOpened)
      },
      at:Number(example.at || Date.now())
    };
  }

  function upsertAndTrain(example) {
    model.examples = model.examples.filter(entry => entry.id !== example.id);
    model.examples.push(compactExample(example));
    if (model.examples.length > MAX_EXAMPLES) model.examples.splice(0, model.examples.length - MAX_EXAMPLES);
    trainExample(example);
    save();
    expose();
    render();
    document.dispatchEvent(new CustomEvent('frame:online-model-changed', {
      detail:{examples:model.examples.length,steps:model.steps}
    }));
  }

  function rebuild() {
    const examples = [...model.examples].sort((a,b)=>a.at-b.at);
    model.bias = 0;
    model.weights = {};
    model.steps = 0;
    const replayed = [];
    for (const example of examples) {
      model.examples = replayed;
      trainExample(example);
      replayed.push(example);
    }
    model.examples = replayed;
    save();
    expose();
    render();
    document.dispatchEvent(new CustomEvent('frame:online-model-changed', {
      detail:{examples:model.examples.length,steps:model.steps,rebuild:true}
    }));
  }

  async function learnSwipe(id,action,item,meta={}) {
    const serial = ++trainingSerial;
    const features = await getFeatures(item);
    if (serial < trainingSerial - 6) return;
    if (!features.length) return;

    upsertAndTrain({
      id,
      tmdbId:item?.tmdbId || null,
      type:item?.type || '',
      title:item?.title || '',
      action,
      features,
      meta,
      at:Date.now()
    });
  }

  function finishActiveShown(id = '') {
    if (!activeShown) return {dwellMs:0,detailsOpened:false};
    if (id && activeShown.id !== id) return {dwellMs:0,detailsOpened:false};
    const meta = {
      dwellMs:Math.max(0,Date.now() - activeShown.startedAt),
      detailsOpened:Boolean(activeShown.detailsOpened)
    };
    activeShown = null;
    return meta;
  }

  function inspectTopCard() {
    const card = document.querySelector('#cardDeck .top-card');
    const id = card?.dataset?.id || '';
    if (!id || id === lastTopId) return;

    if (activeShown) {
      event('dwell',{
        id:activeShown.id,
        ms:Math.min(60000,Date.now()-activeShown.startedAt),
        detailsOpened:Boolean(activeShown.detailsOpened)
      });
    }

    lastTopId = id;
    const item = catalog.find(entry => entry.id === id);
    activeShown = {
      id,
      startedAt:Date.now(),
      detailsOpened:false,
      imageMode:false
    };
    event('shown',{
      id,
      title:item?.title || '',
      type:item?.type || ''
    });
  }

  function observeDeck() {
    const deck = document.querySelector('#cardDeck');
    if (!deck) return;

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.target?.classList?.contains('top-card')) {
          const card = mutation.target;
          if (card.classList.contains('detail-open') && activeShown?.id === card.dataset.id && !activeShown.detailsOpened) {
            activeShown.detailsOpened = true;
            event('details',{id:card.dataset.id});
          }
          if (card.classList.contains('image-only') && activeShown?.id === card.dataset.id && !activeShown.imageMode) {
            activeShown.imageMode = true;
            event('image_mode',{id:card.dataset.id});
          }
        }
      }
      queueMicrotask(inspectTopCard);
    });
    observer.observe(deck,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    inspectTopCard();
  }

  function modelSnapshot() {
    const featureWeights = Object.entries(model.weights)
      .map(([key,entry]) => ({
        key,
        label:entry.label || key,
        group:entry.group || 'other',
        weight:Number(Number(entry.w || 0).toFixed(4)),
        seen:Number(Number(entry.seen || 0).toFixed(2)),
        confidence:Number(confidence(entry.seen).toFixed(3))
      }))
      .filter(entry => Math.abs(entry.weight) >= .015)
      .sort((a,b)=>Math.abs(b.weight*b.confidence)-Math.abs(a.weight*a.confidence))
      .slice(0,70);

    return {
      version:VERSION,
      algorithm:'online-logistic-pairwise-v1',
      bias:Number(Number(model.bias || 0).toFixed(4)),
      steps:Number(model.steps || 0),
      examples:model.examples.length,
      explorationRate:EXPLORATION_RATE,
      featureWeights
    };
  }

  function expose() {
    window.getFrameOnlineModel = modelSnapshot;
  }

  async function bootstrapHistoricalLearning() {
    if (model.examples.length || model.steps || !Object.keys(state?.swipes || {}).length) return;

    let history = {};
    try { history = JSON.parse(localStorage.getItem('frame-recommendation-history-v1') || '{}') || {}; }
    catch {}

    const entries = Object.entries(state.swipes || {}).slice(-80);
    const examples = [];

    for (const [id,action] of entries) {
      const catalogItem = catalog.find(item => item.id === id);
      const historyItem = history[id];
      const item = catalogItem || (historyItem ? {
        id,
        tmdbId:historyItem.tmdbId,
        type:historyItem.type,
        title:historyItem.title || '',
        tags:historyItem.tags || []
      } : null);

      if (!item) continue;
      const features = await getFeatures(item);
      if (!features.length) continue;
      examples.push(compactExample({
        id,
        tmdbId:item.tmdbId || null,
        type:item.type || '',
        title:item.title || '',
        action,
        features,
        meta:{dwellMs:0,detailsOpened:false},
        at:Number(historyItem?.updatedAt || Date.now())
      }));
    }

    if (!examples.length) return;
    model.examples = examples.sort((a,b)=>a.at-b.at).slice(-MAX_EXAMPLES);
    rebuild();
    event('history_bootstrap',{examples:model.examples.length});
  }

  function ensureUi() {
    if (document.querySelector('#onlineLearningCard')) return;
    const anchor = document.querySelector('#tasteDnaInsights') || document.querySelector('#tasteDnaQuestionCard');
    if (!anchor) return;

    const card = document.createElement('article');
    card.id = 'onlineLearningCard';
    card.className = 'online-learning-card';
    card.innerHTML = `
      <div class="online-learning-head">
        <div>
          <span>ECHTES ONLINE-LEARNING</span>
          <h2>FRAME trainiert mit</h2>
        </div>
        <b>LIVE</b>
      </div>
      <p>Nach jedem Swipe passt ein kleines Rankingmodell seine Gewichte selbst an. SUPER und MIST werden zusätzlich paarweise miteinander verglichen.</p>
      <div class="online-learning-stats">
        <div><strong id="onlineExamples">0</strong><small>Trainingsentscheidungen</small></div>
        <div><strong id="onlineSteps">0</strong><small>Lernupdates</small></div>
        <div><strong id="onlineExplore">15%</strong><small>Exploration</small></div>
      </div>
      <div class="online-learning-factors" id="onlineLearningFactors"></div>`;
    anchor.insertAdjacentElement('afterend',card);
  }

  function injectStyles() {
    if (document.querySelector('#frameOnlineLearningStyles')) return;
    const style = document.createElement('style');
    style.id = 'frameOnlineLearningStyles';
    style.textContent = `
      .online-learning-card {
        margin:14px 0 0; padding:17px; border:1px solid rgba(255,255,255,.09);
        border-radius:22px; background:#141417;
      }
      .online-learning-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
      .online-learning-head span { color:#b9f36a; font-size:9px; font-weight:800; letter-spacing:.08em; }
      .online-learning-head h2 {
        margin:4px 0 0; color:#f7f5f2; font-family:Fraunces,Georgia,serif;
        font-size:23px; line-height:1; letter-spacing:-.025em;
      }
      .online-learning-head > b {
        padding:6px 8px; border-radius:999px; background:rgba(185,243,106,.1);
        color:#b9f36a; font-size:9px; font-weight:800;
      }
      .online-learning-card > p { margin:11px 0 0; color:#88837d; font-size:10px; line-height:1.5; }
      .online-learning-stats {
        display:grid; grid-template-columns:repeat(3,1fr); gap:7px; margin-top:13px;
      }
      .online-learning-stats div {
        padding:10px 8px; border-radius:14px; background:#1a1a1f; min-width:0;
      }
      .online-learning-stats strong { display:block; color:#f7f5f2; font-size:17px; }
      .online-learning-stats small { display:block; margin-top:3px; color:#77726c; font-size:8px; line-height:1.25; }
      .online-learning-factors { display:grid; gap:6px; margin-top:12px; }
      .online-factor {
        display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:9px;
        padding:8px 10px; border-radius:12px; background:#19191d;
      }
      .online-factor span { min-width:0; color:#cfcac3; font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .online-factor b { font-size:9px; color:#b9f36a; }
      .online-factor.negative b { color:#ff8291; }
      .online-learning-empty { color:#77726c; font-size:10px; line-height:1.45; }
    `;
    document.head.appendChild(style);
  }

  function render() {
    ensureUi();
    const snapshot = modelSnapshot();
    const examples = document.querySelector('#onlineExamples');
    const steps = document.querySelector('#onlineSteps');
    const explore = document.querySelector('#onlineExplore');
    const factors = document.querySelector('#onlineLearningFactors');
    if (examples) examples.textContent = snapshot.examples;
    if (steps) steps.textContent = snapshot.steps;
    if (explore) explore.textContent = `${Math.round(snapshot.explorationRate*100)}%`;
    if (!factors) return;

    const top = snapshot.featureWeights.slice(0,7);
    factors.innerHTML = top.length
      ? top.map(entry => `<div class="online-factor${entry.weight < 0 ? ' negative' : ''}"><span>${escapeHtml(entry.label)}</span><b>${entry.weight >= 0 ? '+' : ''}${entry.weight.toFixed(2)} · ${Math.round(entry.confidence*100)}%</b></div>`).join('')
      : '<p class="online-learning-empty">Noch kein trainiertes Modell. Der erste SUPER/MIST-Swipe startet das Lernen.</p>';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g,char => ({
      '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
    }[char]));
  }

  injectStyles();
  expose();

  const originalRecordSwipe = recordSwipe;
  recordSwipe = function frameRecordSwipeWithOnlineLearning(id,action) {
    const item = catalog.find(entry => entry.id === id);
    const meta = finishActiveShown(id);
    event('swipe',{
      id,
      action,
      dwellMs:Math.min(60000,meta.dwellMs),
      detailsOpened:Boolean(meta.detailsOpened)
    });

    originalRecordSwipe(id,action);
    if (item) learnSwipe(id,action,item,meta);
  };

  document.addEventListener('frame:recommendation-rejected', eventObject => {
    const item = eventObject.detail?.item;
    if (!item?.tmdbId) return;
    const id = `tmdb-${item.type}-${item.tmdbId}`;
    event('recommendation_rejected',{id,title:item.title || ''});
    learnSwipe(id,'dislike',{
      id,
      tmdbId:item.tmdbId,
      type:item.type,
      title:item.title,
      year:item.year,
      tags:item.tags || []
    },{dwellMs:0,detailsOpened:false});
  });

  document.addEventListener('frame:recommendations-rendered', () => {
    const hero = document.querySelector('#recommendHero');
    const id = hero?.dataset?.tmdbId;
    if (id) event('recommendations_shown',{hero:`${hero.dataset.mediaType}:${id}`});
  });

  document.querySelector('#recommendView')?.addEventListener('click', eventObject => {
    const details = eventObject.target.closest('[data-rec-action="details"]');
    if (details) event('recommendation_details',{key:details.dataset.recKey || ''});
  },true);

  document.addEventListener('frame:swipe-undone', eventObject => {
    const id = eventObject.detail?.id;
    if (!id) return;
    model.examples = model.examples.filter(example => example.id !== id);
    event('undo',{id});
    rebuild();
  });

  document.addEventListener('frame:taste-reset', () => {
    model = emptyState();
    lastTopId = '';
    activeShown = null;
    save();
    expose();
    render();
    document.dispatchEvent(new CustomEvent('frame:online-model-changed', {
      detail:{examples:0,steps:0,reset:true}
    }));
  });

  window.addEventListener('storage', eventObject => {
    if (eventObject.key !== STORAGE_KEY) return;
    model = load();
    expose();
    render();
  });

  const uiObserver = new MutationObserver(() => render());
  const tasteView = document.querySelector('#tasteView');
  if (tasteView) uiObserver.observe(tasteView,{childList:true,subtree:false});

  observeDeck();
  render();
  queueMicrotask(() => bootstrapHistoricalLearning());
})();
