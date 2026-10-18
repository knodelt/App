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


  // Turn real model features and saved decisions into explainable, evidence-
  // based insights. Avoid inventing traits or trends from weak signals.
  const STORY_GROUPS = new Set(['genre','trait','keyword']);
  const FRIENDLY_LABELS = {
    'based on novel or book':'Buchverfilmungen',
    'science fiction':'Science-Fiction',
    'sci-fi':'Science-Fiction',
    'action & adventure':'Action & Abenteuer',
    'action & adventures':'Action & Abenteuer',
    'plot-driven':'Handlung im Vordergrund',
    'character-driven':'Figuren im Mittelpunkt',
    'slow burn':'Langsam erzählte Geschichten',
    'mindfuck':'Rätselhafte Geschichten',
    'romance':'Romantik',
    'crime':'Krimi',
    'comedy':'Komödie',
    'family':'Familie',
    'adventure':'Abenteuer',
    'animation':'Animation',
    'fantasy':'Fantasy'
  };
  function friendlyLabel(value) {
    const raw=String(value||'').replace(/\\s+/g,' ').trim().slice(0,64);
    return FRIENDLY_LABELS[raw.toLowerCase()] || raw;
  }

  function tasteEvidence() {
    const evidence=new Map();
    for(const example of model.examples||[]) {
      if(!['like','save','dislike'].includes(example.action))continue;
      const perItem=new Set();
      for(const feature of example.features||[]) {
        if(!STORY_GROUPS.has(feature.group) || !feature.key || perItem.has(feature.key))continue;
        perItem.add(feature.key);
        const record=evidence.get(feature.key)||{
          key:feature.key,label:friendlyLabel(feature.label),
          group:feature.group,pos:0,neg:0
        };
        if(example.action==='dislike')record.neg++;
        else record.pos++;
        evidence.set(feature.key,record);
      }
    }
    return evidence;
  }

  function buildTasteStory(snapshot) {
    const evidence=tasteEvidence();
    const candidates=(snapshot.featureWeights||[])
      .filter(feature=>STORY_GROUPS.has(feature.group))
      .map(feature=>{
        const record=evidence.get(feature.key);
        if(!record)return null;
        return {...record,weight:feature.weight,confidence:feature.confidence,
          strength:Math.abs(feature.weight)*(feature.confidence||0)};
      })
      .filter(item=>item &&
        item.pos+item.neg>=2 && item.confidence>=.18 && Math.abs(item.weight)>=.045 &&
        (item.weight>0?item.pos>item.neg:item.neg>item.pos))
      .sort((a,b)=>b.strength-a.strength);

    // At least two genuine decisions supporting the direction are required.
    const liked=candidates.filter(item=>item.weight>0&&item.pos>=2).slice(0,3);
    const skipped=candidates.filter(item=>item.weight<0&&item.neg>=2).slice(0,2);

    let sentence='Dein Geschmack bekommt gerade Konturen.';
    if(liked.length>=2) {
      sentence=liked[0].label+' und '+liked[1].label+
        ' fallen bei deinen bisherigen Bewertungen besonders positiv auf.';
    }else if(liked.length===1) {
      sentence=liked[0].label+' scheint dich bisher besonders anzusprechen.';
    }else if(skipped.length) {
      sentence='Bei '+skipped[0].label+' sagst du bisher eher MIST. FRAME sucht weiter nach deinen Favoriten.';
    }

    const insights=[];
    if(liked[0])insights.push({
      icon:'✦',eyebrow:'DAS ZIEHT DICH AN',
      title:liked[0].label,
      copy:'Bei '+liked[0].pos+' bewerteten Titeln mit diesem Merkmal hast du SUPER oder MERKEN gewählt.',
      tone:'positive'
    });
    if(liked[1])insights.push({
      icon:'↗',eyebrow:'AUCH DAS PASST',
      title:liked[1].label,
      copy:'Dieses Merkmal taucht ebenfalls mehrfach bei deinen positiven Entscheidungen auf.',
      tone:'positive'
    });
    if(skipped[0])insights.push({
      icon:'↘',eyebrow:'EHER NICHT DEIN DING',
      title:skipped[0].label,
      copy:'Hier hast du bei '+skipped[0].neg+' bewerteten Titeln MIST gewählt.',
      tone:'negative'
    });

    const actual=(model.examples||[]).filter(item=>['like','save','dislike'].includes(item.action));
    const newest=actual.length?actual[actual.length-1]:null;
    const recent=newest?{
      title:String(newest.title||'Dieser Titel').slice(0,90),
      action:newest.action==='like'?'SUPER':newest.action==='save'?'MERKEN':'MIST'
    }:null;

    // Compare equally sized sets of eight past/recent decisions. A feature
    // has to occur at least twice in BOTH sets to call it a change.
    const older=actual.slice(-16,-8),latest=actual.slice(-8);
    const trendOptions=[];
    if(older.length===8 && latest.length===8) {
      const ratios=(list,key)=>{
        const relevant=list.filter(item=>(item.features||[]).some(f=>f.key===key));
        if(relevant.length<2)return null;
        return relevant.filter(item=>item.action!=='dislike').length/relevant.length;
      };
      for(const item of candidates) {
        const before=ratios(older,item.key),after=ratios(latest,item.key);
        if(before===null || after===null)continue;
        const delta=after-before;
        if(Math.abs(delta)<.4)continue;
        trendOptions.push({...item,delta});
      }
      trendOptions.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
    }
    const trend=trendOptions[0]||null;

    let expectation='FRAME probiert weiterhin unterschiedliche Filme und Serien aus, um deine Vorlieben genauer zu erkennen.';
    if(liked.length>=2) {
      expectation='Bei neuen Vorschlägen kann FRAME '+liked[0].label+' und '+liked[1].label+
        ' stärker berücksichtigen'+(skipped.length?' und '+skipped[0].label+' vorsichtiger gewichten.':'.');
    }else if(liked.length===1) {
      expectation='FRAME kann '+liked[0].label+' bei künftigen Vorschlägen stärker berücksichtigen. Weitere Swipes schärfen die Auswahl.';
    }else if(skipped.length) {
      expectation='FRAME kann '+skipped[0].label+' bei weiteren Vorschlägen vorsichtiger gewichten und andere Richtungen ausprobieren.';
    }

    return {sentence,liked,skipped,insights,recent,trend,expectation,hasSignals:actual.length>0};
  }

  function ensureUi() {
    if(document.querySelector('#onlineLearningCard'))return;
    const anchor=document.querySelector('#tasteDnaInsights')||document.querySelector('#tasteDnaQuestionCard');
    if(!anchor)return;
    const card=document.createElement('article');
    card.id='onlineLearningCard';
    card.className='online-learning-card';
    card.setAttribute('aria-labelledby','onlineLearningHeadline');
    card.innerHTML=`
      <div class="online-learning-head">
        <div>
          <span class="online-kicker">FRAME · DEIN GESCHMACK</span>
          <h2 id="onlineLearningHeadline">FRAME versteht dich immer besser.</h2>
        </div>
        <span class="online-live"><i aria-hidden="true"></i> LIVE</span>
      </div>
      <p class="online-learning-intro">Nicht nur was du magst. Sondern welche Muster deine Entscheidungen verbinden.</p>
      <section class="online-portrait" aria-labelledby="onlinePortraitLabel">
        <div class="online-portrait-rings" aria-hidden="true"></div>
        <span id="onlinePortraitLabel" class="online-small-kicker">DEIN GESCHMACK IN EINEM SATZ</span>
        <p id="onlinePortraitSentence">FRAME liest deine ersten Signale …</p>
        <div class="online-portrait-tags" id="onlinePortraitTags"></div>
      </section>
      <div class="online-section-heading">
        <span>WAS FRAME SCHON ERKENNT</span>
        <span class="online-section-mark" aria-hidden="true">✦</span>
      </div>
      <div class="online-insights" id="onlineLearningInsights"></div>
      <section class="online-trend" aria-labelledby="onlineTrendHeading">
        <span class="online-small-kicker">DEIN GESCHMACK IN BEWEGUNG</span>
        <h3 id="onlineTrendHeading">Was sich verändert</h3>
        <p id="onlineTrendCopy"></p>
        <div class="online-latest" id="onlineLatestSignal"></div>
      </section>
      <section class="online-outlook" aria-labelledby="onlineOutlookHeading">
        <span class="online-outlook-icon" aria-hidden="true">↗</span>
        <div>
          <h3 id="onlineOutlookHeading">Das könnte FRAME dir jetzt zeigen</h3>
          <p id="onlineOutlookCopy"></p>
        </div>
      </section>
      <p class="online-learning-note">Aus deinen tatsächlichen Bewertungen abgeleitet. Erste Hinweise sind keine festen Schubladen.</p>`;
    anchor.insertAdjacentElement('afterend',card);
  }

  function injectStyles() {
    if(document.querySelector('#frameOnlineLearningStyles'))return;
    const style=document.createElement('style');
    style.id='frameOnlineLearningStyles';
    style.textContent=`
      .online-learning-card {
        margin:16px 0 4px;
        padding:clamp(17px,4.5vw,24px);
        color:#f6f3f4;
        background:linear-gradient(155deg,#18161e 0%,#111116 54%,#131119 100%);
        border:1px solid rgba(255,255,255,.11);
        border-radius:27px;
        box-shadow:0 20px 45px rgba(0,0,0,.2);
        font-family:Manrope,system-ui,sans-serif;
      }
      .online-learning-head {display:flex;align-items:flex-start;gap:12px;justify-content:space-between;}
      .online-kicker,.online-small-kicker,.online-section-heading>span:first-child {
        color:#ff8a9e;font:800 10px/1.3 Manrope,system-ui,sans-serif;letter-spacing:.105em;
      }
      .online-learning-head h2 {
        margin:8px 0 0;max-width:320px;color:#fff;
        font:650 clamp(29px,8.3vw,38px)/.99 Fraunces,Georgia,serif;
        letter-spacing:-.045em;
      }
      .online-live {
        display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;
        padding:8px 9px;border:1px solid rgba(188,244,139,.2);border-radius:999px;
        color:#c1ed9a;background:rgba(156,227,124,.08);
        font:800 9px/1 Manrope,system-ui,sans-serif;
      }
      .online-live i {display:block;width:6px;height:6px;border-radius:50%;background:#b1ea91;box-shadow:0 0 0 3px rgba(177,234,145,.13);animation:onlinePulse 2.3s ease-in-out infinite;}
      @keyframes onlinePulse {50%{opacity:.48;transform:scale(.85)}}
      .online-learning-intro {margin:14px 0 0;color:#ada6b1;font:500 12px/1.55 Manrope,system-ui,sans-serif;}
      .online-portrait {
        position:relative;isolation:isolate;overflow:hidden;
        margin-top:21px;padding:23px 19px 20px;min-height:178px;
        border-radius:21px;border:1px solid rgba(255,255,255,.16);
        background:radial-gradient(ellipse at 95% -10%,rgba(255,154,164,.32),transparent 60%),
                   radial-gradient(ellipse at -15% 110%,rgba(131,85,174,.27),transparent 60%),
                   linear-gradient(145deg,#413040,#25202f 65%,#1d1a25);
      }
      .online-portrait-rings {
        position:absolute;z-index:-1;right:-66px;top:-116px;
        width:260px;height:260px;border:1px solid rgba(255,255,255,.17);
        border-radius:50%;box-shadow:0 0 0 32px rgba(255,255,255,.035),0 0 0 80px rgba(255,255,255,.025);
        pointer-events:none;
      }
      .online-portrait .online-small-kicker {color:#ffd2d8;position:relative;}
      #onlinePortraitSentence {
        position:relative;margin:15px 0 0;max-width:340px;
        font:650 clamp(20px,5.8vw,27px)/1.18 Fraunces,Georgia,serif;
        letter-spacing:-.025em;color:#fff;
        overflow-wrap:anywhere;
      }
      .online-portrait-tags {position:relative;display:flex;flex-wrap:wrap;gap:6px;margin-top:17px;}
      .online-taste-tag {
        border:1px solid rgba(255,255,255,.16);border-radius:999px;
        padding:7px 10px;background:rgba(255,255,255,.085);
        font:700 10px/1.2 Manrope,system-ui,sans-serif;color:#fff1f3;
      }
      .online-taste-tag.negative {color:#e8d9de;background:rgba(10,9,13,.24);}
      .online-section-heading {display:flex;justify-content:space-between;align-items:center;margin:23px 2px 11px;}
      .online-section-heading>span:first-child {color:#b6abb5;}
      .online-section-mark {color:#ff829b;font-size:22px;}
      .online-insights {display:grid;gap:9px;}
      .online-insight {
        display:grid;grid-template-columns:43px minmax(0,1fr);gap:12px;
        padding:15px 14px;border-radius:17px;
        border:1px solid rgba(255,255,255,.065);background:rgba(255,255,255,.035);
      }
      .online-insight-icon {
        display:grid;place-items:center;width:43px;height:43px;
        border-radius:14px;background:rgba(182,235,154,.08);color:#c5ed9c;
        font:700 24px/1 Fraunces,Georgia,serif;
      }
      .online-insight.negative .online-insight-icon {color:#ff9aaa;background:rgba(255,117,147,.1);}
      .online-insight span {display:block;color:#998f9f;font:800 9px/1.3 Manrope,system-ui,sans-serif;letter-spacing:.09em;}
      .online-insight strong {
        display:block;margin-top:4px;color:#f9f5f7;
        font:700 15px/1.25 Manrope,system-ui,sans-serif;
        overflow-wrap:anywhere;
      }
      .online-insight p {margin:6px 0 0;color:#b8afbb;font:500 11px/1.55 Manrope,system-ui,sans-serif;}
      .online-insight-empty {
        border:1px dashed rgba(255,255,255,.13);border-radius:15px;
        padding:15px;color:#b7acb7;font:500 12px/1.6 Manrope,system-ui,sans-serif;
      }
      .online-trend {margin-top:21px;padding:17px;border:1px solid rgba(255,255,255,.09);border-radius:19px;background:rgba(255,255,255,.026);}
      .online-trend h3 {margin:7px 0 0;font:650 23px/1.1 Fraunces,Georgia,serif;color:#fff;}
      .online-trend>p {margin:10px 0 0;color:#c4b9c6;font:500 11.5px/1.6 Manrope,system-ui,sans-serif;}
      .online-latest {margin-top:13px;padding-top:11px;border-top:1px solid rgba(255,255,255,.08);color:#afa5b1;font:600 10px/1.5 Manrope,system-ui,sans-serif;}
      .online-latest strong {color:#ffc2ce;font-weight:800;}
      .online-outlook {
        display:grid;grid-template-columns:38px minmax(0,1fr);gap:10px;
        margin-top:10px;padding:17px 14px;border-radius:19px;
        background:linear-gradient(120deg,rgba(245,119,147,.14),rgba(122,89,160,.11));
        border:1px solid rgba(241,137,165,.15);
      }
      .online-outlook-icon {
        display:grid;place-items:center;width:38px;height:38px;border-radius:13px;
        background:rgba(255,255,255,.1);color:#ffd4dc;font-size:21px;
      }
      .online-outlook h3 {margin:1px 0 0;color:#ffbccc;font:800 10px/1.4 Manrope,system-ui,sans-serif;letter-spacing:.045em;}
      .online-outlook p {margin:8px 0 0;color:#e9dde8;font:600 12px/1.5 Manrope,system-ui,sans-serif;}
      .online-learning-note {margin:13px 2px 0;color:#78717f;font:500 9px/1.5 Manrope,system-ui,sans-serif;}
      @media (max-width:360px) {
        .online-learning-card {padding:15px;}
        .online-learning-head h2 {font-size:27px;}
        .online-portrait {padding:20px 15px;}
      }
      @media (prefers-reduced-motion:reduce) {.online-live i{animation:none;}}
    `;
    document.head.appendChild(style);
  }

  function render() {
    ensureUi();
    const card=document.querySelector('#onlineLearningCard');
    if(!card)return;
    const story=buildTasteStory(modelSnapshot());
    const sentence=card.querySelector('#onlinePortraitSentence');
    const tags=card.querySelector('#onlinePortraitTags');
    const insights=card.querySelector('#onlineLearningInsights');
    const trend=card.querySelector('#onlineTrendCopy');
    const latest=card.querySelector('#onlineLatestSignal');
    const outlook=card.querySelector('#onlineOutlookCopy');
    if(sentence)sentence.textContent=story.sentence;
    if(tags){
      const chips=[
        ...story.liked.slice(0,2).map(entry=>({label:entry.label,negative:false})),
        ...story.skipped.slice(0,1).map(entry=>({label:entry.label,negative:true}))
      ];
      tags.innerHTML=chips.length
        ? chips.map(entry=>'<span class="online-taste-tag'+(entry.negative?' negative':'')+'">'+
            (entry.negative?'− ':'✦ ')+escapeHtml(entry.label)+'</span>').join('')
        : '<span class="online-taste-tag">Dein Profil wächst mit jedem Swipe</span>';
    }
    if(insights){
      insights.innerHTML=story.insights.length
        ? story.insights.map(item=>'<div class="online-insight'+(item.tone==='negative'?' negative':'')+'">'+
          '<div class="online-insight-icon" aria-hidden="true">'+escapeHtml(item.icon)+'</div>'+
          '<div><span>'+escapeHtml(item.eyebrow)+'</span><strong>'+escapeHtml(item.title)+'</strong>'+
          '<p>'+escapeHtml(item.copy)+'</p></div></div>').join('')
        : '<p class="online-insight-empty">Noch sind die Muster nicht eindeutig. Bewerte ein paar weitere Titel mit SUPER, MERKEN oder MIST – dann werden hier echte Zusammenhänge sichtbar.</p>';
    }
    if(trend){
      trend.textContent=story.trend
        ? 'In deinen letzten acht Entscheidungen kam '+story.trend.label+
          (story.trend.delta>0?' häufiger positiv an als zuvor.':' häufiger bei MIST vor als zuvor.')
        : 'Noch keine klare Veränderung. Sobald wiederkehrende Unterschiede zwischen älteren und neueren Bewertungen erkennbar sind, zeigt FRAME sie dir.';
    }
    if(latest){
      latest.innerHTML=story.recent
        ? 'ZULETZT GELERNT · '+escapeHtml(story.recent.title)+' · <strong>'+escapeHtml(story.recent.action)+'</strong>'
        : 'DEIN NÄCHSTER SWIPE WIRD ZUM ERSTEN SIGNAL';
    }
    if(outlook)outlook.textContent=story.expectation;
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
