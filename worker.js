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

  try {
    const [movies, series, people] = await Promise.all([
      tmdb('/discover/movie', env, {
        include_adult: false,
        include_video: false,
        language,
        region: 'DE',
        page,
        sort_by: 'popularity.desc',
        'vote_count.gte': 80
      }),
      tmdb('/discover/tv', env, {
        include_adult: false,
        language,
        page,
        sort_by: 'popularity.desc',
        'vote_count.gte': 40
      }),
      tmdb('/person/popular', env, { language, page })
    ]);

    const movieCards = (movies.results || []).filter(x => x.poster_path).slice(0, 18).map(movieToCard);
    const seriesCards = (series.results || []).filter(x => x.poster_path).slice(0, 12).map(seriesToCard);
    const peopleCards = (people.results || []).filter(x => x.profile_path).slice(0, 8).map(personToCard);
    const items = weave([movieCards.slice(0, 9), seriesCards.slice(0, 6), peopleCards.slice(0, 4)])
      .concat(weave([movieCards.slice(9), seriesCards.slice(6), peopleCards.slice(4)]));

    return json({
      ok: true,
      source: 'tmdb',
      page,
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
    if (url.pathname === '/api/recommendation-art') return handleRecommendationArt(env);
    return env.ASSETS.fetch(request);
  }
};