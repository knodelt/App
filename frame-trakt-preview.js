// Private Trakt discovery preview. Development credentials never reach the browser.
// Existing TMDB feed, accounts, user film state and swipes remain unchanged.
const PREVIEW_OWNER = 'knodelthomas@googlemail.com';
const PREVIEW_LIMIT = 6;
const MEDIA_TYPES = {movies:'movie',shows:'show'};
const JSON_HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'};
const respond = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});
const short = (v,max=3000)=>typeof v==='string'?v.slice(0,max):'';
const posterPath = input=>{
  if(typeof input!=='string'||input.length>400)return null;
  let url;
  try { url=new URL(input.startsWith('http')?input:'https://'+input.replace(/^\/\//,'')); }
  catch { return null; }
  if(url.protocol!=='https:'||url.hostname!=='walter-r2.trakt.tv'||url.port||url.search||url.hash)return null;
  if(!/^\/images\/(movies|shows)\/[a-zA-Z0-9_.\/-]+\.webp$/.test(url.pathname))return null;
  if(!/\/posters\//.test(url.pathname))return null;
  return url.pathname;
};
function imageFrom(media){
  const images=media?.images;
  if(!images)return null;
  const v=Array.isArray(images.poster)?images.poster[0]:images.poster;
  const path=posterPath(v);
  return path?'/api/trakt/poster?asset='+encodeURIComponent(path):null;
}
async function traktGET(path,key){
  const abort=new AbortController();
  const timer=setTimeout(()=>abort.abort(),9000);
  try {
    const res=await fetch('https://api.trakt.tv/'+path,{
      method:'GET',redirect:'manual',signal:abort.signal,
      headers:{
        'accept':'application/json',
        'trakt-api-version':'2',
        'trakt-api-key':key
      }
    });
    if(!res.ok){
      const error=Error('Trakt antwortet mit HTTP '+res.status);
      error.status=res.status;
      throw error;
    }
    const data=await res.json();
    return data;
  } finally {clearTimeout(timer);}
}
function normalize(media,type,translation){
  const useGerman=!!(translation?.overview&&typeof translation.overview==='string');
  const overview=useGerman?translation.overview:short(media?.overview||'',1500);
  return {
    title:short(translation?.title||media?.title||'Unbekannt',160),
    originalTitle:short(media?.title||'',160),
    year:Number.isInteger(media?.year)?media.year:null,
    type,
    ids:{
      trakt:Number.isInteger(media?.ids?.trakt)?media.ids.trakt:null,
      imdb:short(media?.ids?.imdb||'',40),
      tmdb:Number.isInteger(media?.ids?.tmdb)?media.ids.tmdb:null
    },
    overview:short(overview,1500),
    language:useGerman?'de':short(media?.language||'original',15),
    translated:useGerman,
    genres:Array.isArray(media?.genres)?media.genres.filter(x=>typeof x==='string').slice(0,4):[],
    rating:Number.isFinite(media?.rating)?Math.round(media.rating*10)/10:null,
    votes:Number.isInteger(media?.votes)?media.votes:null,
    runtime:Number.isInteger(media?.runtime)?media.runtime:null,
    poster:imageFrom(media),
    hasPoster:!!imageFrom(media)
  };
}
async function previewOne(item,type,key){
  const partial=item?.[type]||{};
  const traktId=partial?.ids?.trakt;
  if(!Number.isInteger(traktId)||traktId<=0)return normalize(partial,type,null);
  let media=partial,translation=null;
  // List results sometimes have stale, minimal embedded metadata.
  const result=await Promise.allSettled([
    traktGET((type==='movie'?'movies/':'shows/')+traktId+'?extended=full',key),
    traktGET((type==='movie'?'movies/':'shows/')+traktId+'/translations/de',key)
  ]);
  if(result[0].status==='fulfilled' && result[0].value && typeof result[0].value==='object')
    media={...partial,...result[0].value};
  if(result[1].status==='fulfilled'&&Array.isArray(result[1].value)){
    translation=result[1].value.find(x=>x?.language==='de'&&x?.country==='de'&&x?.overview)||
      result[1].value.find(x=>x?.language==='de'&&x?.overview)||null;
  }
  return normalize(media,type,translation);
}
async function previewList(section,key){
  const type=MEDIA_TYPES[section];
  const items=await traktGET(section+'/trending?limit='+PREVIEW_LIMIT+'&page=1&extended=full',key);
  if(!Array.isArray(items))throw Error('Trakt lieferte kein erwartetes Listenformat.');
  const cards=await Promise.all(items.slice(0,PREVIEW_LIMIT).map(item=>previewOne(item,type,key)));
  return {
    type,items:cards,
    count:cards.length,
    coverage:{
      posters:cards.filter(x=>x.hasPoster).length,
      german:cards.filter(x=>x.translated).length,
      descriptions:cards.filter(x=>x.overview).length,
      genres:cards.filter(x=>x.genres.length>0).length
    }
  };
}
async function cachedPoster(request){
  const asset=new URL(request.url).searchParams.get('asset')||'';
  if(!posterPath('walter-r2.trakt.tv'+asset) || !asset.startsWith('/images/'))
    return respond({ok:false,error:'Ungültiges Bild.'},400);
  const cache=typeof caches!=='undefined'?caches.default:null;
  const cacheReq=new Request(new URL(request.url).toString(),{method:'GET'});
  if(cache){
    const saved=await cache.match(cacheReq).catch(()=>null);
    if(saved)return saved;
  }
  const abort=new AbortController();
  const timeout=setTimeout(()=>abort.abort(),8000);
  try{
    const res=await fetch('https://walter-r2.trakt.tv'+asset,{
      method:'GET',redirect:'manual',signal:abort.signal,
      headers:{'accept':'image/webp'}
    });
    if(!res.ok)return respond({ok:false,error:'Trakt-Poster nicht verfügbar.'},502);
    if(!String(res.headers.get('content-type')||'').toLowerCase().startsWith('image/webp'))
      return respond({ok:false,error:'Kein WebP-Bild.'},502);
    const indicated=Number(res.headers.get('content-length')||0);
    if(indicated>3*1024*1024)return respond({ok:false,error:'Bild zu groß.'},502);
    const data=await res.arrayBuffer();
    if(data.byteLength>3*1024*1024)return respond({ok:false,error:'Bild zu groß.'},502);
    const out=new Response(data,{
      status:200,
      headers:{
        'content-type':'image/webp',
        'cache-control':'public, max-age=604800',
        'x-content-type-options':'nosniff'
      }
    });
    if(cache)await cache.put(cacheReq,out.clone()).catch(()=>{});
    return out;
  } catch{
    return respond({ok:false,error:'Trakt-Poster konnte nicht geladen werden.'},502);
  } finally{clearTimeout(timeout);}
}
export async function handleTraktPreview(request,env,getVerifiedFrameSession){
  if(request.method!=='GET')return respond({ok:false,error:'Methode nicht erlaubt.'},405);
  if(!env.FRAME_ACCOUNTS||!env.AUTH_SECRET)return respond({ok:false,error:'FRAME-Login nicht eingerichtet.'},503);
  const me=await getVerifiedFrameSession(request,env).catch(()=>null);
  if(!me)return respond({ok:false,error:'Bitte mit FRAME anmelden.'},401);
  const owner=String(env.FRAME_ADMIN_EMAIL||PREVIEW_OWNER).trim().toLowerCase();
  if(me.email?.toLowerCase()!==owner)return respond({ok:false,error:'Nur für den FRAME-Administrator.'},403);
  const url=new URL(request.url);
  if(url.pathname==='/api/trakt/poster')return cachedPoster(request);
  if(url.pathname!=='/api/trakt/preview')return respond({ok:false},404);
  const section=url.searchParams.get('type')||'movies';
  if(!Object.prototype.hasOwnProperty.call(MEDIA_TYPES,section))
    return respond({ok:false,error:'Nur Filme oder Serien möglich.'},400);
  const key=String(env.TRAKT_CLIENT_ID||'').trim();
  if(!key)return respond({ok:false,error:'TRAKT_CLIENT_ID fehlt in Cloudflare.'},503);
  try{
    const data=await previewList(section,key);
    return respond({ok:true,source:'Trakt',testOnly:true,section,checkedAt:new Date().toISOString(),...data});
  }catch(err){
    const status=err?.status===429?429:502;
    return respond({ok:false,error:status===429?'Trakt-Limit erreicht. Bitte später testen.':'Trakt-Vorschau derzeit nicht abrufbar: '+short(err?.message||'Unbekannter Fehler',130)},status);
  }
}
