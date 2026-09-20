const MOVIE_GENRES = {
  28:'Action', 12:'Abenteuer', 16:'Animation', 35:'Komödie', 80:'Crime', 99:'Doku',
  18:'Drama', 10751:'Familie', 14:'Fantasy', 36:'Historie', 27:'Horror', 10402:'Musik',
  9648:'Mystery', 10749:'Romance', 878:'Sci-Fi', 10770:'TV-Film', 53:'Thriller',
  10752:'Krieg', 37:'Western'
};

const TV_GENRES = {
  10759:'Action & Adventure', 16:'Animation', 35:'Komödie', 80:'Crime', 99:'Doku', 18:'Drama',
  10751:'Familie', 10762:'Kids', 9648:'Mystery', 10763:'News', 10764:'Reality', 10765:'Sci-Fi & Fantasy',
  10766:'Soap', 10767:'Talk', 10768:'War & Politics', 37:'Western'
};

const FALLBACK_ART = 'linear-gradient(145deg,#5d4b3d 0%,#262126 52%,#0b0b0e 100%)';

const LOCAL_MARKET_LANGUAGES = new Set(['ja', 'zh', 'ko']);

const MOOD_FILTERS = {
  drama:{ movie:'18', series:'18' },
  horror:{ movie:'27', series:'9648' },
  tension:{ movie:'53|9648|80', series:'9648|80' },
  action:{ movie:'28|12', series:'10759' },
  laugh:{ movie:'35', series:'35' },
  mindfuck:{ movie:'878|9648', series:'10765|9648' },
  feelgood:{ movie:'35|10751', series:'35|10751' },
  romance:{ movie:'10749', series:'18|35' }
};

function isGermanyRelevantMedia(item, type = 'movie') {
  const voteCount = Number(item?.vote_count || 0);
  const popularity = Number(item?.popularity || 0);
  const originalLanguage = String(item?.original_language || '').toLowerCase();
  const hasLocalizedOverview = Boolean(String(item?.overview || '').trim());

  const baseVoteFloor = type === 'series' ? 80 : 120;
  const basePopularityFloor = type === 'series' ? 15 : 18;

  // Avoid globally obscure entries that happen to spike in one local market.
  if (voteCount < baseVoteFloor && popularity < basePopularityFloor) return false;

  // If TMDB has no German-facing synopsis, require noticeably stronger global reach.
  if (!hasLocalizedOverview && voteCount < 350 && popularity < 30) return false;

  // Japanese / Chinese / Korean local-market hits need clear international reach.
  // This keeps globally known titles while removing local-only catalogue noise.
  if (LOCAL_MARKET_LANGUAGES.has(originalLanguage)) {
    const internationallyVisible = voteCount >= 600 || popularity >= 40;
    const stronglyLocalizedOrMajor = hasLocalizedOverview || voteCount >= 1400 || popularity >= 65;
    if (!internationallyVisible || !stronglyLocalizedOrMajor) return false;
  }

  return true;
}

function isGermanyRelevantPerson(item) {
  const knownFor = Array.isArray(item?.known_for) ? item.known_for : [];
  return knownFor.some(work => {
    const type = work?.media_type === 'tv' ? 'series' : work?.media_type === 'movie' ? 'movie' : null;
    return type && isGermanyRelevantMedia(work, type);
  });
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=300' : 'no-store',
      ...extraHeaders
    }
  });
}

function clampPage(value) {
  const page = Number.parseInt(value || '1', 10);
  return Number.isFinite(page) ? Math.min(500, Math.max(1, page)) : 1;
}

async function tmdb(path, env, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${env.TMDB_API_TOKEN}`
    },
    cf: { cacheEverything: true, cacheTtl: 900 }
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`TMDB ${response.status}: ${message.slice(0, 180)}`);
  }
  return response.json();
}

function genreNames(ids = [], map = MOVIE_GENRES) {
  return ids.map(id => map[id]).filter(Boolean).slice(0, 3);
}

function vote(value) {
  const n = Number(value || 0);
  return n > 0 ? `★ ${n.toFixed(1)}` : 'Neu';
}

function cleanOverview(text, fallback) {
  const value = String(text || '').trim();
  return value || fallback;
}

function formatDateDE(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const [year, month, day] = raw.split('-');
  return year && month && day ? `${day}.${month}.${year}` : raw;
}

function uniqueNames(list = [], limit = 3) {
  return [...new Set(list.filter(Boolean))].slice(0, limit);
}

function movieToCard(item) {
  const genres = genreNames(item.genre_ids, MOVIE_GENRES);
  return {
    id: `tmdb-movie-${item.id}`,
    tmdbId: item.id,
    source: 'tmdb',
    type: 'movie',
    title: item.title || item.original_title || 'Unbekannter Film',
    year: (item.release_date || '').slice(0, 4) || '—',
    meta: vote(item.vote_average),
    subtitle: genres.join(' · ') || 'Film',
    blurb: cleanOverview(item.overview, 'Noch keine Kurzbeschreibung verfügbar.'),
    tags: [...genres, String(item.original_language || '').toUpperCase()].filter(Boolean),
    symbol: '◐',
    poster: item.poster_path || null,
    art: FALLBACK_ART
  };
}

function seriesToCard(item) {
  const genres = genreNames(item.genre_ids, TV_GENRES);
  return {
    id: `tmdb-series-${item.id}`,
    tmdbId: item.id,
    source: 'tmdb',
    type: 'series',
    title: item.name || item.original_name || 'Unbekannte Serie',
    year: (item.first_air_date || '').slice(0, 4) || '—',
    meta: vote(item.vote_average),
    subtitle: genres.join(' · ') || 'Serie',
    blurb: cleanOverview(item.overview, 'Noch keine Kurzbeschreibung verfügbar.'),
    tags: [...genres, String(item.original_language || '').toUpperCase()].filter(Boolean),
    symbol: '▣',
    poster: item.poster_path || null,
    art: 'linear-gradient(145deg,#345064 0%,#202a34 52%,#0b0c0f 100%)'
  };
}

function personToCard(item) {
  const known = (item.known_for || [])
    .map(work => work.title || work.name)
    .filter(Boolean)
    .slice(0, 3);
  const knownGenreIds = [...new Set((item.known_for || []).flatMap(work => work.genre_ids || []))];
  const knownGenres = genreNames(knownGenreIds, { ...MOVIE_GENRES, ...TV_GENRES });
  const department = item.known_for_department === 'Directing' ? 'REGIE' : item.known_for_department === 'Acting' ? 'SCHAUSPIEL' : (item.known_for_department || 'PERSON').toUpperCase();
  return {
    id: `tmdb-person-${item.id}`,
    tmdbId: item.id,
    source: 'tmdb',
    type: 'person',
    title: item.name || 'Unbekannte Person',
    year: department,
    meta: known.length ? `${known.length} bekannte Titel` : 'Film & Serie',
    subtitle: known.join(' · ') || department,
    blurb: known.length ? `Bekannt aus ${known.join(', ')}.` : 'Person aus Film und Fernsehen.',
    tags: [item.name, department, ...knownGenres].filter(Boolean),
    symbol: (item.name || '?').split(/\s+/).slice(0,2).map(part => part[0]).join('').toUpperCase(),
    poster: item.profile_path || null,
    art: 'linear-gradient(150deg,#5c4d46 0%,#292526 48%,#111113 100%)'
  };
}

function weave(groups) {
  const result = [];
  let index = 0;
  while (groups.some(group => index < group.length)) {
    for (const group of groups) if (index < group.length) result.push(group[index]);
    index += 1;
  }
  return result;
}


function tasteFeature(key, label, group) {
  return { key, label, group };
}

function inferTasteTraits({ genreIds = [], overview = '', keywordNames = [] } = {}) {
  const ids = new Set((genreIds || []).map(Number));
  const text = `${overview} ${(keywordNames || []).join(' ')}`.toLowerCase();
  const traits = [];

  const add = (key,label) => {
    if (!traits.some(item => item.key === key)) traits.push(tasteFeature(key,label,'trait'));
  };

  if ([27,53,80,9648].some(id => ids.has(id))) add('trait:dark','Düster');
  if ([35,10751,10749].some(id => ids.has(id))) add('trait:light','Leicht');
  if ([28,12,10759].some(id => ids.has(id))) add('trait:fast','Schnelles Tempo');
  if ([18,10749,35].some(id => ids.has(id))) add('trait:character','Figurengetrieben');
  if ([53,9648,28,80,10759].some(id => ids.has(id))) add('trait:plot','Plot-getrieben');
  if ([14,878,16,10765].some(id => ids.has(id))) add('trait:fantastical','Fantastische Welten');
  if ([18,36,99,80].some(id => ids.has(id))) add('trait:realistic','Realistisch');
  if ([9648,878,10765].some(id => ids.has(id))) add('trait:mindfuck','Mindfuck');
  if ([18,36,9648].some(id => ids.has(id)) && ![28,10759].some(id => ids.has(id))) add('trait:slow','Slow Burn');
  if (/psycholog|mind|trauma|obsess|paranoi|identity|memory/.test(text)) add('trait:psychological','Psychologisch');
  if (/twist|nonlinear|time travel|alternate reality|dream/.test(text)) add('trait:mindfuck','Mindfuck');

  return traits;
}

function runtimeBucket(runtime) {
  const minutes = Number(runtime || 0);
  if (!minutes) return null;
  if (minutes < 95) return tasteFeature('runtime:short','Kurz & kompakt','runtime');
  if (minutes >= 140) return tasteFeature('runtime:long','Lang & episch','runtime');
  return tasteFeature('runtime:medium','Mittlere Laufzeit','runtime');
}

function decadeFeature(dateValue) {
  const year = Number(String(dateValue || '').slice(0,4));
  if (!Number.isFinite(year) || year < 1900) return null;
  const decade = Math.floor(year / 10) * 10;
  return tasteFeature(`decade:${decade}s`, `${decade}er`, 'decade');
}

async function handleTasteFeatures(request, env) {
  if (!env.TMDB_API_TOKEN) {
    return json({ok:false, code:'TMDB_NOT_CONFIGURED', message:'TMDB_API_TOKEN fehlt.'},503);
  }

  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const id = Number.parseInt(url.searchParams.get('id') || '',10);
  if (!['movie','series','person'].includes(type) || !Number.isFinite(id) || id < 1) {
    return json({ok:false, code:'BAD_TASTE_FEATURE_REQUEST', message:'Ungültige Taste-DNA-Anfrage.'},400);
  }

  try {
    if (type === 'person') {
      const data = await tmdb(`/person/${id}`, env, {language:'de-DE', append_to_response:'combined_credits'});
      const department = data.known_for_department === 'Directing' ? 'director' : 'actor';
      const labelPrefix = department === 'director' ? 'Regie' : 'Schauspiel';
      const feature = tasteFeature(`person:${department}:${id}`, `${labelPrefix}: ${data.name || 'Person'}`, department);

      const genreCounts = new Map();
      [...(data.combined_credits?.cast || []), ...(data.combined_credits?.crew || [])]
        .slice(0,30)
        .forEach(work => (work.genre_ids || []).forEach(genreId => genreCounts.set(genreId,(genreCounts.get(genreId)||0)+1)));
      const genreFeatures = [...genreCounts.entries()]
        .sort((a,b)=>b[1]-a[1])
        .slice(0,3)
        .map(([genreId]) => {
          const name = MOVIE_GENRES[genreId] || TV_GENRES[genreId];
          return name ? tasteFeature(`genre:${genreId}`,name,'genre') : null;
        })
        .filter(Boolean);

      return json({ok:true, type, tmdbId:id, features:[feature,...genreFeatures]},200,{'cache-control':'public, max-age=86400'});
    }

    const path = type === 'series' ? `/tv/${id}` : `/movie/${id}`;
    const data = await tmdb(path, env, {language:'de-DE', append_to_response:'credits,keywords'});

    const features = [];
    (data.genres || []).slice(0,5).forEach(genre => {
      features.push(tasteFeature(`genre:${genre.id}`,genre.name,'genre'));
    });

    if (type === 'movie') {
      (data.credits?.crew || [])
        .filter(person => person.job === 'Director')
        .slice(0,2)
        .forEach(person => features.push(tasteFeature(`person:director:${person.id}`,`Regie: ${person.name}`,'director')));
    } else {
      (data.created_by || []).slice(0,2)
        .forEach(person => features.push(tasteFeature(`person:creator:${person.id}`,`Creator: ${person.name}`,'creator')));
    }

    (data.credits?.cast || []).slice(0,3)
      .forEach(person => features.push(tasteFeature(`person:actor:${person.id}`,`Cast: ${person.name}`,'actor')));

    const keywordList = type === 'series'
      ? (data.keywords?.results || [])
      : (data.keywords?.keywords || []);
    keywordList.slice(0,7).forEach(keyword => {
      features.push(tasteFeature(`keyword:${keyword.id}`,keyword.name,'keyword'));
    });

    if (data.original_language) {
      features.push(tasteFeature(`language:${data.original_language}`,String(data.original_language).toUpperCase(),'language'));
    }

    const runtime = type === 'movie'
      ? data.runtime
      : (Array.isArray(data.episode_run_time) ? data.episode_run_time[0] : null);
    const runtimeFeature = runtimeBucket(runtime);
    if (runtimeFeature) features.push(runtimeFeature);

    const dateValue = type === 'series' ? data.first_air_date : data.release_date;
    const decade = decadeFeature(dateValue);
    if (decade) features.push(decade);

    features.push(...inferTasteTraits({
      genreIds:(data.genres || []).map(genre => genre.id),
      overview:data.overview || '',
      keywordNames:keywordList.map(keyword => keyword.name)
    }));

    const unique = features.filter((feature,index,array) =>
      feature?.key && array.findIndex(other => other?.key === feature.key) === index
    );

    return json({ok:true, type, tmdbId:id, features:unique.slice(0,24)},200,{'cache-control':'public, max-age=86400'});
  } catch (error) {
    console.error(error);
    return json({ok:false, code:'TMDB_TASTE_FEATURES_ERROR', message:'Taste-DNA-Merkmale konnten nicht geladen werden.'},502);
  }
}

async function handleFeed(request, env) {
  if (!env.TMDB_API_TOKEN) {
    return json({
      ok: false,
      code: 'TMDB_NOT_CONFIGURED',
      message: 'TMDB_API_TOKEN fehlt als Cloudflare Worker Secret.'
    }, 503);
  }

  const url = new URL(request.url);
  const page = clampPage(url.searchParams.get('page'));
  const language = 'de-DE';
  const mood = String(url.searchParams.get('mood') || 'any').toLowerCase();
  const moodFilter = MOOD_FILTERS[mood] || null;

  try {
    const [movies, series, people] = await Promise.all([
      tmdb('/discover/movie', env, {
        include_adult: false,
        include_video: false,
        language,
        region: 'DE',
        page,
        sort_by: 'popularity.desc',
        watch_region: 'DE',
        with_watch_monetization_types: 'flatrate|free|ads|rent|buy',
        'vote_count.gte': 80,
        ...(moodFilter?.movie ? { with_genres:moodFilter.movie } : {})
      }),
      tmdb('/discover/tv', env, {
        include_adult: false,
        language,
        page,
        sort_by: 'popularity.desc',
        watch_region: 'DE',
        with_watch_monetization_types: 'flatrate|free|ads|rent|buy',
        'vote_count.gte': 40,
        ...(moodFilter?.series ? { with_genres:moodFilter.series } : {})
      }),
      moodFilter ? Promise.resolve({ results:[] }) : tmdb('/person/popular', env, { language, page })
    ]);

    const movieCards = (movies.results || [])
      .filter(x => x.poster_path && isGermanyRelevantMedia(x, 'movie'))
      .slice(0, 18)
      .map(movieToCard);
    const seriesCards = (series.results || [])
      .filter(x => x.poster_path && isGermanyRelevantMedia(x, 'series'))
      .slice(0, 12)
      .map(seriesToCard);
    const peopleCards = (people.results || [])
      .filter(x => x.profile_path && isGermanyRelevantPerson(x))
      .slice(0, 8)
      .map(personToCard);
    const items = weave([movieCards.slice(0, 9), seriesCards.slice(0, 6), peopleCards.slice(0, 4)])
      .concat(weave([movieCards.slice(9), seriesCards.slice(6), peopleCards.slice(4)]));

    return json({
      ok: true,
      source: 'tmdb',
      page,
      mood,
      hasMore: page < Math.min(movies.total_pages || 500, 500),
      items
    });
  } catch (error) {
    console.error(error);
    return json({ ok: false, code: 'TMDB_ERROR', message: 'TMDB konnte gerade nicht geladen werden.' }, 502);
  }
}

async function handleDetails(request, env) {
  if (!env.TMDB_API_TOKEN) {
    return json({ ok:false, code:'TMDB_NOT_CONFIGURED', message:'TMDB_API_TOKEN fehlt.' }, 503);
  }

  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const id = Number.parseInt(url.searchParams.get('id') || '', 10);
  if (!['movie','series','person'].includes(type) || !Number.isFinite(id) || id < 1) {
    return json({ ok:false, code:'BAD_DETAILS_REQUEST', message:'Ungültige Detailanfrage.' }, 400);
  }

  try {
    if (type === 'movie') {
      const data = await tmdb(`/movie/${id}`, env, { language:'de-DE', append_to_response:'credits' });
      const directors = uniqueNames((data.credits?.crew || []).filter(x => x.job === 'Director').map(x => x.name), 2);
      const cast = uniqueNames((data.credits?.cast || []).slice(0, 5).map(x => x.name), 4);
      const genres = uniqueNames((data.genres || []).map(x => x.name), 3);
      return json({
        ok:true,
        details:{
          description: cleanOverview(data.overview, 'Noch keine ausführliche Beschreibung verfügbar.'),
          primaryMeta: data.runtime ? `${data.runtime} min` : vote(data.vote_average),
          facts:[
            directors.length ? { label:'Regie', value:directors.join(', ') } : null,
            cast.length ? { label:'Cast', value:cast.join(', ') } : null,
            genres.length ? { label:'Genres', value:genres.join(' · ') } : null
          ].filter(Boolean)
        }
      }, 200, { 'cache-control':'public, max-age=3600' });
    }

    if (type === 'series') {
      const data = await tmdb(`/tv/${id}`, env, { language:'de-DE', append_to_response:'credits' });
      const creators = uniqueNames((data.created_by || []).map(x => x.name), 2);
      const cast = uniqueNames((data.credits?.cast || []).slice(0, 5).map(x => x.name), 4);
      const genres = uniqueNames((data.genres || []).map(x => x.name), 3);
      const seasonText = data.number_of_seasons ? `${data.number_of_seasons} Staffel${data.number_of_seasons === 1 ? '' : 'n'}` : vote(data.vote_average);
      return json({
        ok:true,
        details:{
          description: cleanOverview(data.overview, 'Noch keine ausführliche Beschreibung verfügbar.'),
          primaryMeta: seasonText,
          facts:[
            creators.length ? { label:'Creator', value:creators.join(', ') } : null,
            cast.length ? { label:'Cast', value:cast.join(', ') } : null,
            genres.length ? { label:'Genres', value:genres.join(' · ') } : null
          ].filter(Boolean)
        }
      }, 200, { 'cache-control':'public, max-age=3600' });
    }

    const data = await tmdb(`/person/${id}`, env, { language:'de-DE', append_to_response:'combined_credits' });
    const allCredits = [
      ...(data.combined_credits?.cast || []),
      ...(data.combined_credits?.crew || [])
    ]
      .filter(item => item.title || item.name)
      .sort((a,b) => Number(b.popularity || 0) - Number(a.popularity || 0));

    const knownFor = uniqueNames(allCredits.map(x => x.title || x.name), 4);
    const department = data.known_for_department === 'Directing'
      ? 'Regie'
      : data.known_for_department === 'Acting'
        ? 'Schauspiel'
        : (data.known_for_department || 'Film & Serie');

    const germanFallback = knownFor.length
      ? `${data.name || 'Diese Person'} ist im Bereich ${department.toLowerCase()} tätig und unter anderem aus ${knownFor.join(', ')} bekannt.`
      : `${data.name || 'Diese Person'} ist aus Film und Fernsehen bekannt.`;

    const facts = [
      knownFor.length ? { label:'Bekannt aus', value:knownFor.join(', ') } : null,
      data.birthday ? { label:'Geboren', value:formatDateDE(data.birthday) } : null,
      data.place_of_birth ? { label:'Geburtsort', value:data.place_of_birth } : null
    ].filter(Boolean);

    return json({
      ok:true,
      details:{
        description: cleanOverview(data.biography, germanFallback),
        primaryMeta: department,
        facts
      }
    }, 200, { 'cache-control':'public, max-age=3600' });
  } catch (error) {
    console.error(error);
    return json({ ok:false, code:'TMDB_DETAILS_ERROR', message:'Details konnten gerade nicht geladen werden.' }, 502);
  }
}

const RECOMMENDATION_LOOKUPS = [
  { key:'Prisoners', query:'Prisoners', year:'2013', mediaType:'movie' },
  { key:'Enemy', query:'Enemy', year:'2013', mediaType:'movie' },
  { key:'Blade Runner 2049', query:'Blade Runner 2049', year:'2017', mediaType:'movie' },
  { key:'The Prestige', query:'The Prestige', year:'2006', mediaType:'movie' },
  { key:'Sharp Objects', query:'Sharp Objects', year:'2018', mediaType:'tv' }
];

function releaseYear(item, mediaType) {
  const date = mediaType === 'tv' ? item.first_air_date : item.release_date;
  return String(date || '').slice(0, 4);
}

async function lookupArtwork(entry, env) {
  const path = entry.mediaType === 'tv' ? '/search/tv' : '/search/movie';
  const data = await tmdb(path, env, {
    query: entry.query,
    language: 'de-DE',
    include_adult: false,
    page: 1
  });
  const results = data.results || [];
  const exactYear = results.find(item => releaseYear(item, entry.mediaType) === entry.year);
  const withImage = results.find(item => item.poster_path || item.backdrop_path);
  const match = exactYear || withImage || results[0];
  return {
    title: entry.key,
    mediaType: entry.mediaType,
    tmdbId: match?.id || null,
    poster: match?.poster_path || null,
    backdrop: match?.backdrop_path || null
  };
}

async function handleRecommendationArt(env) {
  if (!env.TMDB_API_TOKEN) {
    return json({ ok:false, code:'TMDB_NOT_CONFIGURED', message:'TMDB_API_TOKEN fehlt.' }, 503);
  }

  try {
    const items = await Promise.all(RECOMMENDATION_LOOKUPS.map(entry => lookupArtwork(entry, env)));
    return json({ ok:true, source:'tmdb', items }, 200, { 'cache-control':'public, max-age=21600' });
  } catch (error) {
    console.error(error);
    return json({ ok:false, code:'TMDB_RECOMMENDATION_ART_ERROR', message:'Empfehlungsbilder konnten gerade nicht geladen werden.' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/feed') return handleFeed(request, env);
    if (url.pathname === '/api/details') return handleDetails(request, env);
    if (url.pathname === '/api/taste-features') return handleTasteFeatures(request, env);
    if (url.pathname === '/api/recommendation-art') return handleRecommendationArt(env);
    return env.ASSETS.fetch(request);
  }
};