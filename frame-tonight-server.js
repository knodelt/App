// FRAME TONIGHT data source: verified movie runtimes, requested only when a user
// presses "Meine drei Filme finden". Uses the existing TMDB Worker secret.
// No personal taste, account data or film history is sent to TMDB.
const TONIGHT_LIMITS = new Set([0,90,120,150,180]);
const TONIGHT_GENRES = {
  any: '', relax:'35|10751|10749|16', tension:'53|9648|80|28',
  laugh:'35', think:'878|9648|18', surprise:''
};
const MOVIE_TAGS = {
  28:'Action',12:'Abenteuer',16:'Animation',35:'Komödie',
  80:'Crime',99:'Doku',18:'Drama',10751:'Familie',
  14:'Fantasy',36:'Historie',27:'Horror',10402:'Musik',
  9648:'Mystery',10749:'Romance',878:'Sci-Fi',53:'Thriller',
  10752:'Krieg',37:'Western'
};
const reply=(value,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json; charset=utf-8',
    'cache-control':status===200?'public, max-age=300':'no-store',
    'x-content-type-options':'nosniff'}
});
async function getTmdb(path,secret,query={}){
  const url=new URL('https://api.themoviedb.org/3'+path);
  for(const [key,value] of Object.entries(query)){
    if(value!==undefined&&value!==null&&value!=='')url.searchParams.set(key,String(value));
  }
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),9500);
  try{
    const res=await fetch(url.toString(),{
      signal:ctrl.signal,redirect:'manual',
      headers:{accept:'application/json',authorization:'Bearer '+secret},
      cf:{cacheEverything:true,cacheTtl:3600}
    });
    if(!res.ok)throw Error('TMDB '+res.status);
    return await res.json();
  }finally{clearTimeout(timer);}
}
const validTime=n=>TONIGHT_LIMITS.has(n);
function normalizedMovie(detail,original,maxMinutes){
  const minutes=Number(detail?.runtime);
  const id=Number(detail?.id);
  if(!Number.isSafeInteger(id)||id<1||!Number.isInteger(minutes)||minutes<45||minutes>400)return null;
  if(maxMinutes && minutes>maxMinutes)return null;
  const genreIds=Array.isArray(detail.genres)?detail.genres.map(x=>x.id):
    (Array.isArray(original.genre_ids)?original.genre_ids:[]);
  const tags=[...new Set(genreIds.map(id=>MOVIE_TAGS[id]).filter(Boolean))].slice(0,12);
  const poster=/^\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(detail.poster_path||'')
    ?detail.poster_path:null;
  const overview=String(detail.overview||original.overview||'').trim();
  return {
    id:'tmdb-movie-'+id,tmdbId:id,type:'movie',source:'tmdb',
    title:String(detail.title||original.title||'').slice(0,160),
    year:String(detail.release_date||original.release_date||'').slice(0,4),
    runtime:minutes,meta:minutes+' min',
    subtitle:tags.slice(0,3).join(' · '),
    tags,blurb:overview.slice(0,420),poster
  };
}
export async function handleFrameTonight(request,env){
  if(request.method!=='GET')return reply({ok:false,error:'Nicht erlaubt.'},405);
  if(!env.TMDB_API_TOKEN)return reply({ok:false,error:'Filmquelle derzeit nicht eingerichtet.'},503);
  const url=new URL(request.url);
  const mood=url.searchParams.get('mood')||'any';
  const limit=Number(url.searchParams.get('minutes')||0);
  const page=Number(url.searchParams.get('page')||1);
  if(!Object.prototype.hasOwnProperty.call(TONIGHT_GENRES,mood)
      ||!validTime(limit)||!Number.isInteger(page)||page<1||page>4)
    return reply({ok:false,error:'Ungültige Auswahl.'},400);
  // All input combinations are strictly allowlisted. The shared response is
  // publicly cacheable; no user preferences or history enter the backend.
  const cache=typeof caches!=='undefined'?caches.default:null;
  const key=new Request('https://framingapp.de/api/tonight?v=1&mood='+mood+'&minutes='+limit+'&page='+page);
  if(cache){
    const found=await cache.match(key).catch(()=>null);
    if(found){try{return reply({...await found.json(),cached:true});}catch{}}
  }
  try{
    const query={
      language:'de-DE',region:'DE',page,include_adult:false,
      include_video:false,sort_by:'popularity.desc',
      'vote_count.gte':35,
      'with_runtime.gte':60,
      ...(limit?{'with_runtime.lte':limit}:{}),
      ...(TONIGHT_GENRES[mood]?{with_genres:TONIGHT_GENRES[mood]}:{})
    };
    const discover=await getTmdb('/discover/movie',env.TMDB_API_TOKEN,query);
    const items=(Array.isArray(discover.results)?discover.results:[])
      .filter(x=>Number.isSafeInteger(x?.id)&&x.id>0&&x.poster_path)
      .slice(0,14);
    // /discover/movie does not return runtime, and sometimes has incomplete
    // metadata. Verify each suggested duration using /movie/{id}.
    const detailed=await Promise.allSettled(items.map(x=>getTmdb('/movie/'+x.id,env.TMDB_API_TOKEN,{language:'de-DE'})));
    const cards=[];
    for(let i=0;i<detailed.length;i++){
      if(detailed[i].status!=='fulfilled')continue;
      const card=normalizedMovie(detailed[i].value,items[i],limit);
      if(card&&card.title&&card.tags.length)cards.push(card);
    }
    const payload={ok:true,source:'tmdb',mood,minutes:limit,page,
      hasMore:page<Math.min(4,Number(discover.total_pages)||1),items:cards.slice(0,12),
      verifiedRuntimes:true};
    if(cache){
      const stored=new Response(JSON.stringify(payload),{
        headers:{'content-type':'application/json','cache-control':'public, max-age=1800'}
      });
      await cache.put(key,stored).catch(()=>{});
    }
    return reply(payload);
  }catch(err){
    console.warn('[FRAME TONIGHT DATA]',String(err?.message||err).slice(0,120));
    return reply({ok:false,error:'Filme mit geprüfter Laufzeit sind momentan nicht abrufbar.'},502);
  }
}
