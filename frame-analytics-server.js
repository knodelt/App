// FRAME opt-in analytics. Uses the existing account Durable Object class in a separate,
// dedicated singleton instance. No IP addresses, cookies or movie IDs are recorded here.
const RETAIN_MS = 90*86400000;
const TYPES = ['open','swipe','save','daily','personalized','framelog','match'];
const VALID_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dayOf = ms => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
const response=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const sameOrigin=req=>{try{return new URL(req.headers.get('origin')).origin===new URL(req.url).origin;}catch{return false;}};
const analyticsID=env=>env.FRAME_ACCOUNTS.idFromName('frame-private-analytics-v1');
const internal=(env,action,payload={})=>env.FRAME_ACCOUNTS.get(analyticsID(env)).fetch(
  new Request('https://frame-analytics.internal/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
);
async function call(env,action,payload={}){
  const r=await internal(env,action,payload);
  return response(await r.json(),r.status);
}
export async function forgetFrameAccountAnalytics(env,email){
  if(!env.FRAME_ACCOUNTS || !email)return;
  try{await internal(env,'analytics-forget-account',{email:String(email).toLowerCase()});}
  catch(err){console.warn('[FRAME ANALYTICS] Account erasure retry needed:',String(err));}
}
export async function handleFrameAnalytics(req,env,getVerifiedSession){
  if(!env.FRAME_ACCOUNTS || !env.AUTH_SECRET || env.AUTH_SECRET.length<32)
    return response({ok:false,error:'Statistik ist nicht eingerichtet.'},503);
  const action=new URL(req.url).pathname.slice('/api/analytics/'.length);
  if(req.method==='POST' && !sameOrigin(req))return response({ok:false,error:'Ungültige Herkunft.'},403);
  if(action==='role' && req.method==='GET'){
    const me=await getVerifiedSession(req,env);
    const owner=String(env.FRAME_ADMIN_EMAIL||'').trim().toLowerCase();
    return response({ok:true,admin:!!(owner&&me?.email?.toLowerCase()===owner)});
  }
  if(action==='admin' && req.method==='GET'){
    const owner=String(env.FRAME_ADMIN_EMAIL||'').trim().toLowerCase();
    if(!owner)return response({ok:false,error:'Administrator nicht konfiguriert.'},503);
    const me=await getVerifiedSession(req,env);
    if(!me || me.email.toLowerCase()!==owner)return response({ok:false,error:'Zugriff nur für FRAME-Administrator.'},403);
    return call(env,'analytics-report');
  }
  if(action==='track' && req.method==='POST'){
    if(Number(req.headers.get('content-length')||0)>1800)return response({ok:false},413);
    let raw;try{raw=await req.text();if(raw.length>1800)throw Error();raw=JSON.parse(raw);}catch{return response({ok:false},400);}
    if(!VALID_ID.test(raw?.id||''))return response({ok:false},400);
    const events={};let total=0;
    for(const type of TYPES){
      const count=raw.events?.[type];
      if(count!==undefined){
        if(!Number.isSafeInteger(count)||count<0||count>40)return response({ok:false},400);
        total+=count;if(count)events[type]=count;
      }
    }
    if(total>70)return response({ok:false},400);
    const me=await getVerifiedSession(req,env).catch(()=>null);
    return call(env,'analytics-track',{id:raw.id,events,email:me?.email||null});
  }
  if(action==='forget' && req.method==='POST'){
    let raw;try{raw=await req.json()}catch{return response({ok:false},400);}
    if(!VALID_ID.test(raw?.id||''))return response({ok:false},400);
    return call(env,'analytics-forget',{id:raw.id});
  }
  return response({ok:false,error:'Nicht gefunden.'},404);
}
function cleanStats(row,now){
  const cutoff=dayOf(now-RETAIN_MS);
  row.days=Object.fromEntries(Object.entries(row.days||{}).filter(([date])=>date>=cutoff));
  return row;
}
export async function handleAnalyticsObject(storage,action,p){
  const now=Date.now();
  if(action==='analytics-track'){
    if(!VALID_ID.test(p.id||''))return response({ok:false},400);
    return storage.transaction(async tx=>{
      const key='stats:'+p.id;
      const row=cleanStats(await tx.get(key)||{id:p.id,firstSeen:now,lastSeen:0,email:null,days:{}},now);
      // A very short duplicate/abuse guard, without limiting normal swiping.
      if(now-row.lastWrite<1000)return response({ok:true,throttled:true});
      row.lastWrite=now;
      row.lastSeen=now;
      if(p.email && typeof p.email==='string' && p.email.length<=254)row.email=p.email.toLowerCase();
      const day=dayOf(now);
      const counts=row.days[day]||{open:0,swipe:0,save:0,daily:0,personalized:0,framelog:0,match:0};
      for(const t of TYPES)counts[t]=(counts[t]||0)+(p.events?.[t]||0);
      row.days[day]=counts;
      await tx.put(key,row);
      return response({ok:true});
    });
  }
  if(action==='analytics-forget'){
    if(!VALID_ID.test(p.id||''))return response({ok:false},400);
    await storage.delete('stats:'+p.id);
    return response({ok:true});
  }
  if(action==='analytics-forget-account'){
    const target=String(p.email||'').trim().toLowerCase();
    if(!target)return response({ok:false},400);
    const all=await storage.list({prefix:'stats:'});
    let deleted=0;
    for(const [key,row] of all){
      if(row?.email===target){await storage.delete(key);deleted++;}
    }
    return response({ok:true,deleted});
  }
  if(action==='analytics-report'){
    const all=await storage.list({prefix:'stats:'});
    const cutoff=now-RETAIN_MS;
    const rows=[];
    for(const [key,value] of all){
      if(!value || value.lastSeen<cutoff){await storage.delete(key);continue;}
      rows.push(cleanStats(value,now));
    }
    const today=dayOf(now), d7=dayOf(now-6*86400000),d30=dayOf(now-29*86400000);
    const totals=Object.fromEntries(TYPES.map(x=>[x,0]));
    const countSince=(day)=>rows.filter(r=>Object.keys(r.days||{}).some(d=>d>=day)).length;
    const online=rows.filter(r=>r.lastSeen>=now-5*60000).length;
    const todayCount=countSince(today), seven=countSince(d7),thirty=countSince(d30);
    const registered=new Set(rows.filter(r=>r.email).map(r=>r.email)).size;
    const dateKeys=Array.from({length:14},(_,i)=>dayOf(now-(13-i)*86400000));
    const series=dateKeys.map(date=>({date,users:0,opens:0,swipes:0}));
    const lookup=new Map(series.map(x=>[x.date,x]));
    for(const row of rows)for(const [date,events] of Object.entries(row.days||{})){
      if(date>=d30)for(const type of TYPES)totals[type]+=events[type]||0;
      const slot=lookup.get(date);
      if(slot){slot.users++;slot.opens+=events.open||0;slot.swipes+=events.swipe||0;}
    }
    const people=rows.slice().sort((a,b)=>b.lastSeen-a.lastSeen).slice(0,60).map(row=>({
      label:row.email||'Gast (anonym)',kind:row.email?'account':'guest',
      firstSeen:row.firstSeen,lastSeen:row.lastSeen,
      opens:Object.values(row.days||{}).reduce((n,d)=>n+(d.open||0),0),
      swipes:Object.values(row.days||{}).reduce((n,d)=>n+(d.swipe||0),0)
    }));
    return response({ok:true,online,today:todayCount,seven,thirty,
      total:rows.length,registered,events:totals,series,people,
      generatedAt:now,retentionDays:90,consentOnly:true});
  }
  return response({ok:false},404);
}
