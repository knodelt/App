// FRAME · private Trakt API connectivity test.
// Development client ID is used ONLY by the verified FRAME administrator.
// This route does not replace TMDB, proxy arbitrary requests, or expose secrets.
const json=(v,status=200)=>new Response(JSON.stringify(v),{
  status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store, private',
    'x-content-type-options':'nosniff'
  }
});
const OWNER_EMAIL='knodelthomas@googlemail.com';
const ownerFrom=env=>String(env.FRAME_ADMIN_EMAIL||OWNER_EMAIL).trim().toLowerCase();
const mapItem=(entry,type)=>{
  const info=(type==='movie'?entry?.movie:entry?.show)||entry;
  return {
    title:String(info?.title||'Unbekannter Titel').slice(0,140),
    year:Number.isInteger(info?.year)?info.year:null,
    traktId:info?.ids?.trakt||null,
    imdbId:info?.ids?.imdb||null,
    tmdbId:info?.ids?.tmdb||null,
    originalLanguage:info?.language||null
  };
};
async function probe(resource,clientID){
  const timer=new AbortController();
  const timeout=setTimeout(()=>timer.abort('timeout'),8500);
  try{
    // Host and paths are constant: this endpoint is not an open proxy.
    const upstream=await fetch('https://api.trakt.tv/'+resource+'?limit=5',{
      method:'GET',signal:timer.signal,redirect:'error',
      headers:{
        'accept':'application/json',
        'trakt-api-version':'2',
        'trakt-api-key':clientID
      }
    });
    const result={status:upstream.status,ok:upstream.ok,titles:[]};
    if(!upstream.ok){
      result.message=upstream.status===401?'Client-ID ungültig oder nicht aktiviert.'
        :upstream.status===403?'Trakt hat diesen Aufruf nicht freigegeben (Development-Zugang prüfen).'
        :upstream.status===429?'Trakt-Limit erreicht; später erneut testen.'
        :'Trakt hat den Abruf abgelehnt.';
      const retry=Number(upstream.headers.get('retry-after'));
      if(upstream.status===429 && Number.isFinite(retry)&&retry>0)
        result.retryAfterSeconds=Math.min(retry,3600);
      return result;
    }
    const data=await upstream.json();
    if(!Array.isArray(data))return {...result,ok:false,message:'Unerwartetes API-Datenformat.'};
    result.titles=data.slice(0,5).map(x=>mapItem(x,resource.startsWith('movies')?'movie':'show'));
    return result;
  }catch(error){
    return {ok:false,status:null,message:error?.name==='AbortError'?'Trakt antwortet zu langsam.':'Netzwerkverbindung zu Trakt fehlgeschlagen.'};
  }finally{clearTimeout(timeout);}
}
export async function handleTraktDiagnostics(request,env,getVerifiedFrameSession){
  if(request.method!=='GET')return json({ok:false,error:'Methode nicht erlaubt.'},405);
  if(!env.FRAME_ACCOUNTS||!env.AUTH_SECRET)return json({ok:false,error:'FRAME-Login nicht eingerichtet.'},503);
  let me;
  try{me=await getVerifiedFrameSession(request,env);}
  catch{return json({ok:false,error:'Anmeldung momentan nicht überprüfbar.'},503);}
  if(!me)return json({ok:false,error:'Bitte zuerst in FRAME anmelden.'},401);
  if(me.email?.toLowerCase()!==ownerFrom(env))return json({ok:false,error:'Nur für den FRAME-Administrator.'},403);
  const clientID=String(env.TRAKT_CLIENT_ID||'').trim();
  if(!clientID)return json({ok:false,configured:false,error:'TRAKT_CLIENT_ID fehlt in Cloudflare bei diesem Worker bzw. dieser Umgebung.'},503);
  if(clientID.length>250)return json({ok:false,configured:false,error:'TRAKT_CLIENT_ID hat ein unerwartetes Format.'},503);
  const [movies,shows]=await Promise.all([
    probe('movies/trending',clientID),
    probe('shows/trending',clientID)
  ]);
  const success=movies.ok&&shows.ok;
  return json({
    ok:success,
    configured:true,
    appMode:'development-test',
    checkedAt:new Date().toISOString(),
    movies,shows,
    explanation:success
      ?'Trakt antwortet auf beide öffentlichen Test-Endpunkte. Der bisherige FRAME-Feed bleibt unverändert.'
      :'Mindestens ein Trakt-Test-Endpunkt konnte nicht erfolgreich abgerufen werden. Der TMDB-Feed bleibt unverändert.'
  },200);
}
