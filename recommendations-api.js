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

  const signals = (Array.isArray(body?.signals) ? body.signals : [])
    .slice(0,100)
    .map(normalizeSignal)
    .filter(Boolean);
  const tagWeights = (Array.isArray(body?.tagWeights) ? body.tagWeights : [])
    .slice(0,30)
    .map(entry => ({ tag:String(entry?.tag || '').slice(0,60), weight:clamp(Number(entry?.weight) || 0, -30, 30) }))
    .filter(entry => entry.tag && entry.weight !== 0);

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

  const candidates = new Map();
  function addCandidate(item, type, boost = 0, reason = '') {
    if (!item || !['movie','series'].includes(type)) return;
    const id = Number(item.id);
    if (!Number.isFinite(id) || id < 1 || excluded[type].has(id) || item.adult === true) return;
    if (!item.poster_path && !item.backdrop_path) return;
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
      voteAverage:Number(item.vote_average || 0),
      popularity:Number(item.popularity || 0),
      affinity:0,
      reasons:new Set()
    };
    current.affinity += boost;
    if (reason) current.reasons.add(reason);
    if (!current.description && item.overview) current.description = String(item.overview).trim();
    candidates.set(key, current);
  }

  const tasks = [];
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

  tasks.push(
    tmdb('/discover/movie', env, {
      language:'de-DE', region:'DE', include_adult:false, sort_by:'popularity.desc', page:1,
      'vote_count.gte':100,
      with_genres:topMovieGenres.join('|'),
      without_genres:badMovieGenres.join(',')
    }).then(data => (data.results || []).slice(0,20).forEach(item => addCandidate(item,'movie', topMovieGenres.length ? 3 : 1, 'Passt zu deinem Genreprofil')))
  );
  tasks.push(
    tmdb('/discover/tv', env, {
      language:'de-DE', sort_by:'popularity.desc', page:1,
      'vote_count.gte':60,
      with_genres:topTvGenres.join('|'),
      without_genres:badTvGenres.join(',')
    }).then(data => (data.results || []).slice(0,20).forEach(item => addCandidate(item,'series', topTvGenres.length ? 3 : 1, 'Passt zu deinem Genreprofil')))
  );

  try { await Promise.all(tasks); }
  catch (error) { console.warn('[FRAME RECOMMENDATIONS]', error.message); }

  function genreWeight(candidate) {
    const map = candidate.type === 'series' ? tvGenreWeights : movieGenreWeights;
    return candidate.genreIds.reduce((sum,id) => sum + clamp(map.get(id) || 0, -10, 12), 0);
  }

  const ranked = [...candidates.values()].map(candidate => {
    const personal = genreWeight(candidate);
    const quality = clamp((candidate.voteAverage - 6) * 2.2, -5, 7);
    const popularity = clamp(Math.log10(candidate.popularity + 1) * 1.7, 0, 6);
    const score = clamp(Math.round(61 + candidate.affinity + personal * 1.25 + quality + popularity), 48, 98);

    const map = candidate.type === 'series' ? tvGenreWeights : movieGenreWeights;
    const matchedGenres = candidate.genreIds
      .map(id => ({id, name:GENRE_NAMES.get(id), weight:map.get(id) || 0}))
      .filter(x => x.name && x.weight > 0)
      .sort((a,b)=>b.weight-a.weight)
      .slice(0,2)
      .map(x => `♥ ${x.name}`);
    const reasons = [...matchedGenres, ...candidate.reasons].slice(0,3);

    return {
      tmdbId:candidate.tmdbId,
      type:candidate.type,
      title:candidate.title,
      year:candidate.year,
      description:candidate.description || 'Noch keine deutsche Kurzbeschreibung verfügbar.',
      poster:candidate.poster,
      backdrop:candidate.backdrop,
      match:score,
      reasons
    };
  }).sort((a,b)=>b.match-a.match || a.title.localeCompare(b.title,'de'));

  const result = [];
  let movies = 0, series = 0;
  for (const item of ranked) {
    if (result.length >= 12) break;
    if (item.type === 'movie' && movies >= 8) continue;
    if (item.type === 'series' && series >= 6) continue;
    result.push(item);
    if (item.type === 'movie') movies += 1; else series += 1;
  }

  return json({
    ok:true,
    source:'tmdb',
    profileSignals:signals.length,
    items:result
  });
}
