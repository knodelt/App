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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/feed') return handleFeed(request, env);
    return env.ASSETS.fetch(request);
  }
};
