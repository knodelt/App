// Private Trakt discovery preview. Development credentials never reach the browser.
// Existing TMDB feed, accounts, user film state and swipes remain unchanged.
const PREVIEW_OWNER = 'knodelthomas@googlemail.com';
const PREVIEW_LIMIT = 5;
const MEDIA_TYPES = {movies:'movie',shows:'show'};
const JSON_HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'};
const respond = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});
const short = (v,max=3000)=>typeof v==='string'?v.slice(0,max):'';
// Trakt moved its image CDN from walter-r2.trakt.tv to media.trakt.tv in 2026.
// Do NOT hotlink the CDN: only return URLs for our authenticated caching proxy.
// Hosts and paths are checked against allowlists; user input never picks an
// arbitrary origin, avoiding an SSRF/open-proxy endpoint.
const POSTER_HOSTS=new Set(['media.trakt.tv','walter-r2.trakt.tv']);
function posterSource(input){
  if(typeof input!=='string'||input.length>500)return null;
  let url;
  try{url=new URL(/^https?:\/\//i.test(input)?input:'https://'+input.replace(/^\/\//,''));}
  catch{return null;}
  if(url.protocol!=='https:'||!POSTER_HOSTS.has(url.hostname)||url.port||url.username||url.password||url.search||url.hash)return null;
  if(!/^\/images\/(movies|shows)\/[a-zA-Z0-9_.\/-]+\.webp$/.test(url.pathname))return null;
  if(!/\/posters\//.test(url.pathname))return null;
  return {host:url.hostname,path:url.pathname};
}
function imageFrom(media){
  const images=media?.images;
  if(!images)return null;
  const urls=Array.isArray(images.poster)?images.poster:[images.poster];
  for(const entry of urls){
    const poster=posterSource(entry);
    if(poster){
      const params=new URLSearchParams({host:poster.host,asset:poster.path});
      return '/api/trakt/poster?'+params.toString()+'&v=3';
    }
  }
  return null;
}
async function traktGET(path,key){
  const abort=new AbortController();
  const timer=setTimeout(()=>abort.abort(),9000);
  try {
    const res=await fetch('https://api.trakt.tv/'+path,{
      method:'GET',redirect:'manual',signal:abort.signal,
      headers:{
        'accept':'application/json',
        'content-type':'application/json',
        'user-agent':'FRAME/1.0 (Trakt developer connectivity test)',
        'trakt-api-version':'2',
        'trakt-api-key':key
      }
    });
    if(!res.ok){
      const error=Error('Trakt antwortet mit HTTP '+res.status);
      error.status=res.status;
      error.endpoint=path.split('?')[0];
      error.retryAfter=Number(res.headers.get('retry-after')||0)||null;
      throw error;
    }
    const data=await res.json();
    return data;
  } finally {clearTimeout(timer);}
}
function normalize(media,type,translation){
  const poster=imageFrom(media);
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
    poster,
    hasPoster:!!poster
  };
}
// Start with the exact public request already proven to work in the connection
// test. Then attempt documented extra detail endpoints individually. A 403
// disables further requests to the affected endpoint family for this preview.
async function previewList(section,key){
  const type=MEDIA_TYPES[section];
  // Matches the working developer diagnostics: no extended parameter,
  // no extra page selector, and no burst of requests on initial load.
  const items=await traktGET(section+'/trending?limit='+PREVIEW_LIMIT,key);
  if(!Array.isArray(items))throw Error('Trakt lieferte kein erwartetes Listenformat.');
  const cards=[],warnings=[];
  const access={trending:'ok',details:'not-tested',translations:'not-tested'};
  let detailsRestricted=false, translationsRestricted=false;
  const prefix=type==='movie'?'movies/':'shows/';
  const statusMessage=(part,e)=>part+' nicht verfügbar ('+(e?.status?'HTTP '+e.status:'Verbindungsfehler')+').';

  for(const item of items.slice(0,PREVIEW_LIMIT)){
    const partial=item?.[type]||{};
    const id=partial?.ids?.trakt;
    let media=partial,translation=null;
    if(Number.isInteger(id)&&id>0&&!detailsRestricted){
      try{
        const full=await traktGET(prefix+id+'?extended=full',key);
        if(full && typeof full==='object'&&!Array.isArray(full)){
          media={...partial,...full};
          access.details='available';
        }
      }catch(error){
        access.details=error?.status===403?'restricted':error?.status===429?'rate-limited':'unavailable';
        if(warnings.length<3)warnings.push(statusMessage('Erweiterte Filmdaten',error));
        // Do not repeatedly retry endpoints which are explicitly denied.
        detailsRestricted=true;
      }
    }
    if(Number.isInteger(id)&&id>0&&!translationsRestricted&&!detailsRestricted){
      try{
        const values=await traktGET(prefix+id+'/translations/de',key);
        if(Array.isArray(values)){
          translation=values.find(v=>v?.language==='de'&&v?.country==='de'&&v?.overview)||
            values.find(v=>v?.language==='de'&&v?.overview)||null;
          access.translations='available';
        }
      }catch(error){
        if(error?.status===403||error?.status===401||error?.status===429){
          translationsRestricted=true;
          access.translations=error.status===429?'rate-limited':'restricted';
          if(warnings.length<3)warnings.push(statusMessage('Deutsche Übersetzungen',error));
        }else if(error?.status!==404 && warnings.length<3){
          warnings.push(statusMessage('Einzelne deutsche Übersetzung',error));
        }
      }
    }
    cards.push(normalize(media,type,translation));
  }
  if(access.details==='not-tested'){
    warnings.push('Trakt hat nur die öffentliche Titelliste geliefert. Zusätzliche Details wurden nicht angefragt.');
  }
  return {
    type,items:cards,count:cards.length,access,warnings,
    coverage:{
      posters:cards.filter(x=>x.hasPoster).length,
      german:cards.filter(x=>x.translated).length,
      descriptions:cards.filter(x=>x.overview).length,
      genres:cards.filter(x=>x.genres.length>0).length
    }
  };
}
function imageMime(bytes){
  if(bytes.length>=12&&bytes[0]===82&&bytes[1]===73&&bytes[2]===70&&bytes[3]===70&&
      bytes[8]===87&&bytes[9]===69&&bytes[10]===66&&bytes[11]===80)return 'image/webp';
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=8&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&
     bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10)return 'image/png';
  if(bytes.length>=12&&bytes[4]===102&&bytes[5]===116&&bytes[6]===121&&bytes[7]===112&&
     ((bytes[8]===97&&bytes[9]===118&&bytes[10]===105&&bytes[11]===102)||
      (bytes[8]===109&&bytes[9]===105&&bytes[10]===102&&bytes[11]===49)))return 'image/avif';
  return null;
}
async function cachedPoster(request){
  const requestUrl=new URL(request.url);
  const host=requestUrl.searchParams.get('host')||'walter-r2.trakt.tv';
  const asset=requestUrl.searchParams.get('asset')||'';
  const diagnose=requestUrl.searchParams.get('diagnose')==='1';
  const poster=posterSource('https://'+host+asset);
  if(!poster || poster.host!==host || poster.path!==asset)
    return respond({ok:false,error:'Ungültiges Bild.'},400);
  const cache=typeof caches!=='undefined'?caches.default:null;
  // The diagnostic request is never cached, so it can report the live upstream result.
  const cacheUrl=new URL(request.url);
  cacheUrl.searchParams.delete('diagnose');
  const cacheReq=new Request(cacheUrl.toString(),{method:'GET'});
  if(cache && !diagnose){
    const saved=await cache.match(cacheReq).catch(()=>null);
    if(saved)return saved;
  }
  const abort=new AbortController();
  const timeout=setTimeout(()=>abort.abort(),8500);
  const details={cdnHost:poster.host,upstreamStatus:null,contentType:null,redirected:false};
  const reply=(code,message,extra={})=>respond({
    ok:false,code,error:message,...details,...extra
  },502);
  try{
    // Permit one legitimate CDN-to-CDN image redirect. Unlisted hosts or
    // paths are never followed (no arbitrary redirect or external proxy).
    let source=poster,res;
    for(let hop=0;hop<2;hop++){
      res=await fetch('https://'+source.host+source.path,{
        method:'GET',redirect:'manual',signal:abort.signal,
        headers:{'accept':'image/webp,image/avif,image/jpeg,image/png;q=0.8'}
      });
      details.upstreamStatus=res.status;
      details.contentType=String(res.headers.get('content-type')||'').split(';')[0].slice(0,70);
      if([301,302,303,307,308].includes(res.status)){
        const location=res.headers.get('location')||'';
        const target=posterSource(location);
        details.redirected=true;
        if(hop===1||!target)return reply('CDN_REDIRECT','Trakt leitet auf einen nicht freigegebenen Bildpfad um.');
        source=target;
        continue;
      }
      break;
    }
    if(!res.ok){
      return reply('CDN_HTTP_'+res.status,
        res.status===403?'Trakt blockiert den Poster-Abruf (HTTP 403).'
        :res.status===404?'Trakt meldet, dass diese Posterdatei fehlt (HTTP 404).'
        :'Trakt-Bildserver antwortet mit HTTP '+res.status+'.');
    }
    const indicated=Number(res.headers.get('content-length')||0);
    if(indicated>3*1024*1024)return reply('POSTER_TOO_LARGE','Trakt-Poster ist größer als 3 MB.');
    const data=await res.arrayBuffer();
    if(data.byteLength>3*1024*1024)return reply('POSTER_TOO_LARGE','Trakt-Poster ist größer als 3 MB.');
    const format=imageMime(new Uint8Array(data,0,Math.min(data.byteLength,24)));
    if(!format)return reply('POSTER_NOT_IMAGE','Der Trakt-Bildserver liefert keine erkennbare Bilddatei.');
    if(diagnose)return respond({ok:true,format,bytes:data.byteLength,...details});
    const out=new Response(data,{
      status:200,
      headers:{
        'content-type':format,
        'cache-control':'private, max-age=604800',
        'x-content-type-options':'nosniff'
      }
    });
    if(cache)await cache.put(cacheReq,out.clone()).catch(()=>{});
    return out;
  }catch(error){
    const aborted=abort.signal.aborted;
    console.warn('[FRAME TRAKT POSTER]',aborted?'timeout':String(error?.name||'FetchError'));
    return reply(aborted?'CDN_TIMEOUT':'CDN_FETCH_FAILED',aborted
      ?'Der Trakt-Bildserver reagiert nicht rechtzeitig.'
      :'Der Cloudflare Worker konnte den Trakt-Bildserver nicht erreichen.');
  }finally{clearTimeout(timeout);}
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
  // Only public Trakt metadata is cached, and only after admin verification.
  // This prevents repeated detail/translation requests while testing tabs.
  const cache=typeof caches!=='undefined'?caches.default:null;
  // Increment the cache version after changing image normalization to avoid
  // re-serving older '0 poster' payloads for up to 10 minutes.
  const cacheKey=new Request('https://framingapp.de/api/trakt/preview?v=2&type='+section);
  if(cache){
    const cached=await cache.match(cacheKey).catch(()=>null);
    if(cached){
      try{return respond({...await cached.json(),cached:true});}catch{}
    }
  }
  try{
    const data=await previewList(section,key);
    const payload={ok:true,source:'Trakt',testOnly:true,section,checkedAt:new Date().toISOString(),...data};
    if(cache){
      const toCache=new Response(JSON.stringify(payload),{
        headers:{'content-type':'application/json','cache-control':'public, max-age=600'}
      });
      await cache.put(cacheKey,toCache).catch(()=>{});
    }
    return respond(payload);
  }catch(err){
    const status=err?.status===429?429:err?.status===403?403:502;
    const explanation=status===429?'Trakt-Limit erreicht. Bitte später testen.'
      :status===403?'Trakt verweigert bereits den öffentlichen Listenabruf (HTTP 403). Bitte in Trakt die Berechtigung deiner Development-App prüfen.'
      :'Trakt-Vorschau derzeit nicht abrufbar: '+short(err?.message||'Unbekannter Fehler',130);
    return respond({ok:false,source:'trakt',upstreamStatus:err?.status||null,error:explanation},status);
  }
}
