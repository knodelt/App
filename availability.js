const REGION = 'DE';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=1800, s-maxage=21600' : 'no-store'
    }
  });
}

async function tmdb(path, env) {
  const response = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${env.TMDB_API_TOKEN}`
    },
    cf: { cacheEverything: true, cacheTtl: 21600 }
  });
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  return response.json();
}

function typeLabel(type) {
  if (type === 'sub') return 'Abo';
  if (type === 'rent') return 'Leihen';
  if (type === 'buy') return 'Kaufen';
  if (type === 'free') return 'Gratis';
  if (type === 'ads') return 'Mit Werbung';
  return 'Verfügbar';
}

function offerPriority(offer) {
  const order = { sub:0, free:1, ads:2, rent:3, buy:4 };
  return order[offer.type] ?? 9;
}

function dedupe(offers) {
  const seen = new Set();
  return offers
    .filter(offer => offer?.provider)
    .sort((a,b) => offerPriority(a) - offerPriority(b))
    .filter(offer => {
      const key = `${offer.provider}|${offer.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

async function fromTmdb(type, id, env) {
  const namespace = type === 'series' ? 'tv' : 'movie';
  const data = await tmdb(`/${namespace}/${id}/watch/providers`, env);
  const region = data?.results?.[REGION] || {};
  const offers = [];

  const add = (entries, typeName) => (entries || []).forEach(provider => offers.push({
    provider: provider.provider_name,
    providerId: provider.provider_id,
    logo: provider.logo_path || null,
    type: typeName,
    label: typeLabel(typeName),
    url: region.link || null
  }));

  add(region.flatrate, 'sub');
  add(region.free, 'free');
  add(region.ads, 'ads');
  add(region.rent, 'rent');
  add(region.buy, 'buy');

  return {
    source: 'tmdb-justwatch',
    attribution: 'JustWatch',
    link: region.link || null,
    offers: dedupe(offers)
  };
}

export async function handleAvailability(request, env) {
  if (!env.TMDB_API_TOKEN) {
    return json({ ok:false, code:'TMDB_NOT_CONFIGURED', message:'TMDB_API_TOKEN fehlt.' }, 503);
  }

  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const id = Number.parseInt(url.searchParams.get('id') || '', 10);

  if (!['movie','series'].includes(type) || !Number.isFinite(id) || id < 1) {
    return json({ ok:false, code:'BAD_AVAILABILITY_REQUEST', message:'Ungültige Verfügbarkeitsanfrage.' }, 400);
  }

  try {
    const availability = await fromTmdb(type, id, env);
    return json({ ok:true, region:REGION, ...availability });
  } catch (error) {
    console.error('[FRAME AVAILABILITY]', error);
    return json({ ok:false, code:'AVAILABILITY_ERROR', message:'Streaming-Verfügbarkeit konnte gerade nicht geladen werden.' }, 502);
  }
}
