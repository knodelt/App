const MOVIE_GENRES = {
  Action:28, Abenteuer:12, Animation:16, 'Komödie':35, Crime:80, Doku:99, Drama:18,
  Familie:10751, Fantasy:14, Historie:36, Horror:27, Musik:10402, Mystery:9648,
  Romance:10749, 'Sci-Fi':878, 'TV-Film':10770, Thriller:53, Krieg:10752, Western:37
};
const TV_GENRES = {
  'Action & Adventure':10759, Animation:16, 'Komödie':35, Crime:80, Doku:99, Drama:18,
  Familie:10751, Kids:10762, Mystery:9648, News:10763, Reality:10764,
  'Sci-Fi & Fantasy':10765, Soap:10766, Talk:10767, 'War & Politics':10768, Western:37
};
const MOOD_GENRES = {
  drama:{ label:'Drama', movie:[18], series:[18] },
  horror:{ label:'Horror', movie:[27], series:[9648] },
  tension:{ label:'Spannung', movie:[53,9648,80], series:[9648,80] },
  action:{ label:'Action', movie:[28,12], series:[10759] },
  laugh:{ label:'Lachen', movie:[35], series:[35] },
  mindfuck:{ label:'Mindfuck', movie:[878,9648], series:[10765,9648] },
  feelgood:{ label:'Feel-Good', movie:[35,10751], series:[35,10751] },
  romance:{ label:'Romantik', movie:[10749], series:[18,35] }
};

const GENRE_NAMES = new Map();
Object.entries({...MOVIE_GENRES, ...TV_GENRES}).forEach(([name,id]) => {
  if (!GENRE_NAMES.has(id)) GENRE_NAMES.set(id, name);
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store'
    }
  });
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

const LOCAL_MARKET_LANGUAGES = new Set(['ja', 'zh', 'ko']);

function isGermanyRelevantCandidate(item, type = 'movie') {
  const voteCount = Number(item?.vote_count || 0);
  const popularity = Number(item?.popularity || 0);
  const originalLanguage = String(item?.original_language || '').toLowerCase();
  const hasLocalizedOverview = Boolean(String(item?.overview || '').trim());

  const baseVoteFloor = type === 'series' ? 70 : 100;
  const basePopularityFloor = type === 'series' ? 14 : 16;
  if (voteCount < baseVoteFloor && popularity < basePopularityFloor) return false;

  if (!hasLocalizedOverview && voteCount < 350 && popularity < 30) return false;

  if (LOCAL_MARKET_LANGUAGES.has(originalLanguage)) {
    const internationallyVisible = voteCount >= 600 || popularity >= 40;
    const stronglyLocalizedOrMajor = hasLocalizedOverview || voteCount >= 1400 || popularity >= 65;
    if (!internationallyVisible || !stronglyLocalizedOrMajor) return false;
  }

  return true;
}

async function tmdb(path, env, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  Object.entries(params).forEach(([key,value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    headers:{ accept:'application/json', authorization:`Bearer ${env.TMDB_API_TOKEN}` },
    cf:{ cacheEverything:true, cacheTtl:900 }
  });
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  return response.json();
}

function mediaDate(item, type) {
  return type === 'series' ? item.first_air_date : item.release_date;
}

function mediaTitle(item, type) {
  return type === 'series' ? (item.name || item.original_name) : (item.title || item.original_title);
}

function genreMapFor(type) { return type === 'series' ? TV_GENRES : MOVIE_GENRES; }

function normalizeSignal(raw) {
  const type = raw?.type;
  const action = raw?.action;
  const tmdbId = Number(raw?.tmdbId);
  if (!['movie','series','person'].includes(type)) return null;
  if (!['like','save','dislike'].includes(action)) return null;
  if (!Number.isFinite(tmdbId) || tmdbId < 1) return null;
  return {
    type,
    action,
    tmdbId,
    title:String(raw?.title || '').slice(0,100)
  };
}

function positiveSignalWeight(action) {
  return action === 'like' ? 3 : action === 'save' ? 1 : -3;
}

export async function handlePersonalizedRecommendations(request, env) {
  if (!env.TMDB_API_TOKEN) return json({ok:false, code:'TMDB_NOT_CONFIGURED', message:'TMDB_API_TOKEN fehlt.'}, 503);
  if (request.method !== 'POST') return json({ok:false, code:'METHOD_NOT_ALLOWED'}, 405);

  let body;
  try { body = await request.json(); }
  catch { return json({ok:false, code:'BAD_JSON'}, 400); }

  const mood = String(body?.mood || 'any').toLowerCase();
  const moodConfig = MOOD_GENRES[mood] || null;

  const signals = (Array.isArray(body?.signals) ? body.signals : [])
    .slice(0,100)
    .map(normalizeSignal)
    .filter(Boolean);
  const tagWeights = (Array.isArray(body?.tagWeights) ? body.tagWeights : [])
    .slice(0,30)
    .map(entry => ({ tag:String(entry?.tag || '').slice(0,60), weight:clamp(Number(entry?.weight) || 0, -30, 30) }))
    .filter(entry => entry.tag && entry.weight !== 0);

  const tasteDNA = body?.tasteDNA && typeof body.tasteDNA === 'object' ? body.tasteDNA : {};
  const dnaFeatures = (Array.isArray(tasteDNA.featureWeights) ? tasteDNA.featureWeights : [])
    .slice(0,40)
    .map(entry => ({
      key:String(entry?.key || '').slice(0,100),
      label:String(entry?.label || '').slice(0,100),
      weight:clamp(Number(entry?.weight) || 0,-30,30),
      confidence:clamp(Number(entry?.confidence) || 0,0,1)
    }))
    .filter(entry => entry.key && entry.weight !== 0);
  const dnaPairs = (Array.isArray(tasteDNA.pairWeights) ? tasteDNA.pairWeights : [])
    .slice(0,40)
    .map(entry => ({
      a:String(entry?.a || '').slice(0,100),
      b:String(entry?.b || '').slice(0,100),
      labelA:String(entry?.labelA || '').slice(0,100),
      labelB:String(entry?.labelB || '').slice(0,100),
      weight:clamp(Number(entry?.weight) || 0,-24,24),
      confidence:clamp(Number(entry?.confidence) || 0,0,1)
    }))
    .filter(entry => entry.a && entry.b && entry.weight !== 0);
  const dnaFeatureMap = new Map(dnaFeatures.map(entry => [entry.key,entry]));

  const onlineModel = body?.onlineModel && typeof body.onlineModel === 'object' ? body.onlineModel : {};
  const onlineFeatureWeights = (Array.isArray(onlineModel.featureWeights) ? onlineModel.featureWeights : [])
    .slice(0,70)
    .map(entry => ({
      key:String(entry?.key || '').slice(0,100),
      label:String(entry?.label || '').slice(0,100),
      weight:clamp(Number(entry?.weight) || 0,-5,5),
      confidence:clamp(Number(entry?.confidence) || 0,0,1)
    }))
    .filter(entry => entry.key && entry.weight !== 0);
  const onlineFeatureMap = new Map(onlineFeatureWeights.map(entry => [entry.key,entry]));
  const onlineBias = clamp(Number(onlineModel?.bias) || 0,-3,3);
  const onlineExamples = clamp(Number(onlineModel?.examples) || 0,0,500);
  const explorationRate = clamp(Number(onlineModel?.explorationRate) || .15,.05,.25);

  const excluded = {
    movie:new Set(signals.filter(s => s.type === 'movie').map(s => s.tmdbId)),
    series:new Set(signals.filter(s => s.type === 'series').map(s => s.tmdbId))
  };
  const positives = signals.filter(s => positiveSignalWeight(s.action) > 0);
  const likedMovies = positives.filter(s => s.type === 'movie').sort((a,b)=>positiveSignalWeight(b.action)-positiveSignalWeight(a.action)).slice(0,2);
  const likedSeries = positives.filter(s => s.type === 'series').sort((a,b)=>positiveSignalWeight(b.action)-positiveSignalWeight(a.action)).slice(0,2);
  const likedPeople = positives.filter(s => s.type === 'person').sort((a,b)=>positiveSignalWeight(b.action)-positiveSignalWeight(a.action)).slice(0,2);

  const movieGenreWeights = new Map();
  const tvGenreWeights = new Map();
  for (const {tag,weight} of tagWeights) {
    if (MOVIE_GENRES[tag]) movieGenreWeights.set(MOVIE_GENRES[tag], (movieGenreWeights.get(MOVIE_GENRES[tag]) || 0) + weight);
    if (TV_GENRES[tag]) tvGenreWeights.set(TV_GENRES[tag], (tvGenreWeights.get(TV_GENRES[tag]) || 0) + weight);
  }

  const topGenreIds = map => [...map.entries()].filter(([,w])=>w>0).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id])=>id);
  const negativeGenreIds = map => [...map.entries()].filter(([,w])=>w<0).sort((a,b)=>a[1]-b[1]).slice(0,4).map(([id])=>id);
  const topMovieGenres = topGenreIds(movieGenreWeights);
  const topTvGenres = topGenreIds(tvGenreWeights);
  const badMovieGenres = negativeGenreIds(movieGenreWeights);
  const badTvGenres = negativeGenreIds(tvGenreWeights);
  const discoverMovieGenres = moodConfig ? moodConfig.movie : topMovieGenres;
  const discoverTvGenres = moodConfig ? moodConfig.series : topTvGenres;

  const candidates = new Map();
  function addCandidate(item, type, boost = 0, reason = '', featureHints = []) {
    if (!item || !['movie','series'].includes(type)) return;
    const id = Number(item.id);
    if (!Number.isFinite(id) || id < 1 || excluded[type].has(id) || item.adult === true) return;
    if (!item.poster_path && !item.backdrop_path) return;
    if (!isGermanyRelevantCandidate(item, type)) return;
    const title = mediaTitle(item, type);
    if (!title) return;
    const key = `${type}:${id}`;
    const current = candidates.get(key) || {
      tmdbId:id,
      type,
      title,
      year:String(mediaDate(item,type) || '').slice(0,4) || '—',
      description:String(item.overview || '').trim(),
      poster:item.poster_path || null,
      backdrop:item.backdrop_path || null,
      genreIds:Array.isArray(item.genre_ids) ? item.genre_ids : [],
      originalLanguage:String(item.original_language || '').toLowerCase(),
      voteAverage:Number(item.vote_average || 0),
      popularity:Number(item.popularity || 0),
      affinity:0,
      reasons:new Set(),
      featureHints:new Set()
    };
    current.affinity += boost;
    if (reason) current.reasons.add(reason);
    (featureHints || []).forEach(key => { if (key) current.featureHints.add(String(key)); });
    if (!current.description && item.overview) current.description = String(item.overview).trim();
    candidates.set(key, current);
  }

  const tasks = [];

  const positiveDnaPeople = dnaFeatures
    .filter(entry => /^person:(director|creator|actor):\d+$/.test(entry.key) && entry.weight > 0 && entry.confidence >= .2)
    .sort((a,b) => (b.weight*b.confidence) - (a.weight*a.confidence))
    .slice(0,2);

  const positiveDnaKeywords = dnaFeatures
    .filter(entry => /^keyword:\d+$/.test(entry.key) && entry.weight > 0 && entry.confidence >= .2)
    .sort((a,b) => (b.weight*b.confidence) - (a.weight*a.confidence))
    .slice(0,2);
  likedMovies.forEach(signal => tasks.push(
    tmdb(`/movie/${signal.tmdbId}/recommendations`, env, {language:'de-DE', page:1})
      .then(data => (data.results || []).slice(0,16).forEach(item => addCandidate(item,'movie',10, signal.title ? `Wegen ${signal.title}` : 'Aus deinen Film-Likes')))
  ));
  likedSeries.forEach(signal => tasks.push(
    tmdb(`/tv/${signal.tmdbId}/recommendations`, env, {language:'de-DE', page:1})
      .then(data => (data.results || []).slice(0,16).forEach(item => addCandidate(item,'series',10, signal.title ? `Wegen ${signal.title}` : 'Aus deinen Serien-Likes')))
  ));
  likedPeople.forEach(signal => tasks.push(
    tmdb(`/person/${signal.tmdbId}/combined_credits`, env, {language:'de-DE'})
      .then(data => {
        const works = [...(data.cast || []), ...(data.crew || [])]
          .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
          .sort((a,b)=>Number(b.popularity||0)-Number(a.popularity||0))
          .slice(0,18);
        works.forEach(item => addCandidate(item, item.media_type === 'tv' ? 'series' : 'movie', 8, signal.title ? `Mit ${signal.title}` : 'Aus deinen Personen-Likes'));
      })
  ));

  positiveDnaPeople.forEach(feature => {
    const personId = Number(feature.key.split(':').pop());
    if (!Number.isFinite(personId)) return;
    tasks.push(
      tmdb(`/person/${personId}/combined_credits`, env, {language:'de-DE'})
        .then(data => {
          const works = [...(data.cast || []), ...(data.crew || [])]
            .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
            .sort((a,b)=>Number(b.popularity||0)-Number(a.popularity||0))
            .slice(0,16);
          const boost = clamp(feature.weight * feature.confidence,1,7);
          works.forEach(item => addCandidate(
            item,
            item.media_type === 'tv' ? 'series' : 'movie',
            boost,
            feature.label ? `Deine DNA: ${feature.label}` : 'Passt zu deiner Taste DNA',
            [feature.key]
          ));
        })
    );
  });

  positiveDnaKeywords.forEach(feature => {
    const keywordId = Number(feature.key.split(':').pop());
    if (!Number.isFinite(keywordId)) return;
    const boost = clamp(feature.weight * feature.confidence,.8,5);
    tasks.push(
      tmdb('/discover/movie', env, {
        language:'de-DE', region:'DE', include_adult:false, sort_by:'popularity.desc', page:1,
        watch_region:'DE', with_watch_monetization_types:'flatrate|free|ads|rent|buy',
        'vote_count.gte':100, with_keywords:keywordId
      }).then(data => (data.results || []).slice(0,12).forEach(item =>
        addCandidate(item,'movie',boost,feature.label ? `Thema: ${feature.label}` : 'Passt zu deinen Themen',[feature.key])
      ))
    );
    tasks.push(
      tmdb('/discover/tv', env, {
        language:'de-DE', sort_by:'popularity.desc', page:1,
        watch_region:'DE', with_watch_monetization_types:'flatrate|free|ads|rent|buy',
        'vote_count.gte':60, with_keywords:keywordId
      }).then(data => (data.results || []).slice(0,10).forEach(item =>
        addCandidate(item,'series',boost,feature.label ? `Thema: ${feature.label}` : 'Passt zu deinen Themen',[feature.key])
      ))
    );
  });

  tasks.push(
    tmdb('/discover/movie', env, {
      language:'de-DE', region:'DE', include_adult:false, sort_by:'popularity.desc', page:1,
      watch_region:'DE',
      with_watch_monetization_types:'flatrate|free|ads|rent|buy',
      'vote_count.gte':100,
      with_genres:discoverMovieGenres.join('|'),
      without_genres:badMovieGenres.join(',')
    }).then(data => (data.results || []).slice(0,20).forEach(item => addCandidate(
      item,
      'movie',
      moodConfig ? 8 : (topMovieGenres.length ? 3 : 1),
      moodConfig ? `Heute: ${moodConfig.label}` : 'Passt zu deinem Genreprofil'
    )))
  );
  tasks.push(
    tmdb('/discover/tv', env, {
      language:'de-DE', sort_by:'popularity.desc', page:1,
      watch_region:'DE',
      with_watch_monetization_types:'flatrate|free|ads|rent|buy',
      'vote_count.gte':60,
      with_genres:discoverTvGenres.join('|'),
      without_genres:badTvGenres.join(',')
    }).then(data => (data.results || []).slice(0,20).forEach(item => addCandidate(
      item,
      'series',
      moodConfig ? 8 : (topTvGenres.length ? 3 : 1),
      moodConfig ? `Heute: ${moodConfig.label}` : 'Passt zu deinem Genreprofil'
    )))
  );

  try { await Promise.all(tasks); }
  catch (error) { console.warn('[FRAME RECOMMENDATIONS]', error.message); }

  function genreWeight(candidate) {
    const map = candidate.type === 'series' ? tvGenreWeights : movieGenreWeights;
    return candidate.genreIds.reduce((sum,id) => sum + clamp(map.get(id) || 0, -10, 12), 0);
  }

  function moodWeight(candidate) {
    if (!moodConfig) return 0;
    const ids = candidate.type === 'series' ? moodConfig.series : moodConfig.movie;
    return candidate.genreIds.some(id => ids.includes(id)) ? 10 : -7;
  }

  function candidateTraitKeys(candidate) {
    const ids = new Set(candidate.genreIds || []);
    const traits = [];
    const add = key => { if (!traits.includes(key)) traits.push(key); };
    if ([27,53,80,9648].some(id => ids.has(id))) add('trait:dark');
    if ([35,10751,10749].some(id => ids.has(id))) add('trait:light');
    if ([28,12,10759].some(id => ids.has(id))) add('trait:fast');
    if ([18,10749,35].some(id => ids.has(id))) add('trait:character');
    if ([53,9648,28,80,10759].some(id => ids.has(id))) add('trait:plot');
    if ([14,878,16,10765].some(id => ids.has(id))) add('trait:fantastical');
    if ([18,36,99,80].some(id => ids.has(id))) add('trait:realistic');
    if ([9648,878,10765].some(id => ids.has(id))) add('trait:mindfuck');
    if ([18,36,9648].some(id => ids.has(id)) && ![28,10759].some(id => ids.has(id))) add('trait:slow');
    if ([28,35,10751].some(id => ids.has(id))) add('trait:clear');
    return traits;
  }

  function candidateFeatureSet(candidate) {
    const set = new Set((candidate.genreIds || []).map(id => `genre:${id}`));
    (candidate.featureHints || []).forEach(key => set.add(key));
    candidateTraitKeys(candidate).forEach(key => set.add(key));
    if (candidate.originalLanguage) set.add(`language:${candidate.originalLanguage}`);
    const year = Number(candidate.year);
    if (Number.isFinite(year) && year > 1900) set.add(`decade:${Math.floor(year/10)*10}s`);
    return set;
  }

  function dnaScores(candidate) {
    const keys = candidateFeatureSet(candidate);
    const matched = [];
    let featureScore = 0;
    for (const key of keys) {
      const feature = dnaFeatureMap.get(key);
      if (!feature) continue;
      const contribution = feature.weight * feature.confidence;
      featureScore += contribution;
      if (contribution > .6) matched.push({label:feature.label || key, contribution});
    }

    let pairScore = 0;
    const matchedPairs = [];
    for (const pair of dnaPairs) {
      if (!keys.has(pair.a) || !keys.has(pair.b)) continue;
      const contribution = pair.weight * pair.confidence;
      pairScore += contribution;
      if (contribution > .5) matchedPairs.push({
        label:`${pair.labelA || pair.a} + ${pair.labelB || pair.b}`,
        contribution
      });
    }

    return {
      featureScore:clamp(featureScore,-12,18),
      pairScore:clamp(pairScore,-10,16),
      matched:matched.sort((a,b)=>b.contribution-a.contribution),
      matchedPairs:matchedPairs.sort((a,b)=>b.contribution-a.contribution)
    };
  }

  function onlineScores(candidate) {
    const keys = candidateFeatureSet(candidate);
    let logit = onlineBias;
    let known = 0;
    let confidenceSum = 0;
    let strongest = null;

    for (const key of keys) {
      const learned = onlineFeatureMap.get(key);
      if (!learned) continue;
      const contribution = learned.weight * learned.confidence;
      logit += contribution;
      known += 1;
      confidenceSum += learned.confidence;
      if (!strongest || Math.abs(contribution) > Math.abs(strongest.contribution)) {
        strongest = {label:learned.label || key, contribution};
      }
    }

    const probability = 1 / (1 + Math.exp(-clamp(logit,-12,12)));
    const total = Math.max(1,keys.size);
    const unknownShare = clamp((total-known)/total,0,1);
    const averageConfidence = known ? confidenceSum/known : 0;
    const uncertainty = clamp(unknownShare*.65 + (1-averageConfidence)*.35,0,1);

    return {
      probability,
      score:clamp((probability-.5)*28,-14,14),
      uncertainty,
      strongest
    };
  }

  const ranked = [...candidates.values()].map(candidate => {
    const personal = genreWeight(candidate);
    const quality = clamp((candidate.voteAverage - 6) * 2.2, -5, 7);
    const popularity = clamp(Math.log10(candidate.popularity + 1) * 1.7, 0, 6);
    const tonight = moodWeight(candidate);
    const dna = dnaScores(candidate);
    const learned = onlineScores(candidate);
    const learnedWeight = onlineExamples >= 6 ? 1 : onlineExamples / 6;
    const score = clamp(Math.round(
      59 + candidate.affinity + personal * 1.05 + quality + popularity + tonight
      + dna.featureScore * .70 + dna.pairScore * .88
      + learned.score * learnedWeight
    ), 45, 98);

    const map = candidate.type === 'series' ? tvGenreWeights : movieGenreWeights;
    const matchedGenres = candidate.genreIds
      .map(id => ({id, name:GENRE_NAMES.get(id), weight:map.get(id) || 0}))
      .filter(x => x.name && x.weight > 0)
      .sort((a,b)=>b.weight-a.weight)
      .slice(0,2)
      .map(x => `♥ ${x.name}`);
    const moodReason = moodConfig && tonight > 0 ? [`Heute: ${moodConfig.label}`] : [];
    const relationReason = dna.matchedPairs[0]?.label ? [`DNA: ${dna.matchedPairs[0].label}`] : [];
    const featureReason = dna.matched[0]?.label ? [`DNA: ${dna.matched[0].label}`] : [];
    const learnedReason = learned.strongest?.contribution > .18 ? [`Gelernt: ${learned.strongest.label}`] : [];
    const reasons = [...moodReason, ...learnedReason, ...relationReason, ...featureReason, ...matchedGenres, ...candidate.reasons]
      .filter((value,index,array) => array.indexOf(value) === index)
      .slice(0,3);

    return {
      tmdbId:candidate.tmdbId,
      type:candidate.type,
      title:candidate.title,
      year:candidate.year,
      description:candidate.description || 'Noch keine deutsche Kurzbeschreibung verfügbar.',
      poster:candidate.poster,
      backdrop:candidate.backdrop,
      tags:candidate.genreIds.map(id => GENRE_NAMES.get(id)).filter(Boolean).slice(0,4),
      match:score,
      learningProbability:Number(learned.probability.toFixed(3)),
      uncertainty:Number(learned.uncertainty.toFixed(3)),
      exploration:false,
      reasons
    };
  }).sort((a,b)=>b.match-a.match || a.title.localeCompare(b.title,'de'));

  const result = [];
  let movies = 0, series = 0;
  const exploitTarget = onlineExamples >= 4 ? Math.max(9,Math.round(12*(1-explorationRate))) : 11;

  function canAdd(item) {
    if (result.some(entry => entry.type === item.type && entry.tmdbId === item.tmdbId)) return false;
    if (item.type === 'movie' && movies >= 8) return false;
    if (item.type === 'series' && series >= 6) return false;
    return true;
  }

  function addResult(item) {
    if (!canAdd(item) || result.length >= 12) return false;
    result.push(item);
    if (item.type === 'movie') movies += 1; else series += 1;
    return true;
  }

  for (const item of ranked) {
    if (result.length >= exploitTarget) break;
    addResult(item);
  }

  const explorationPool = ranked
    .filter(item => !result.some(entry => entry.type === item.type && entry.tmdbId === item.tmdbId))
    .map(item => ({
      item,
      exploreScore:item.match + item.uncertainty*9 + Math.random()*1.5
    }))
    .sort((a,b)=>b.exploreScore-a.exploreScore);

  for (const entry of explorationPool) {
    if (result.length >= 12) break;
    const candidate = {...entry.item, exploration:true};
    if (!candidate.reasons.some(reason => reason === 'FRAME lernt hier bewusst dazu')) {
      candidate.reasons = ['FRAME lernt hier bewusst dazu',...candidate.reasons].slice(0,3);
    }
    addResult(candidate);
  }

  for (const item of ranked) {
    if (result.length >= 12) break;
    addResult(item);
  }

  return json({
    ok:true,
    source:'tmdb',
    profileSignals:signals.length,
    tasteDnaFeatures:dnaFeatures.length,
    tasteDnaPairs:dnaPairs.length,
    onlineLearning:{
      algorithm:'online-logistic-pairwise-v1',
      examples:onlineExamples,
      features:onlineFeatureWeights.length,
      explorationRate
    },
    mood,
    items:result
  });
}
