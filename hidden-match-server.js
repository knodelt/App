// Hidden Match V1 — persistent, isolated two-person rooms on Cloudflare Durable Objects.
// Access to a room is capability-based; never send another player's votes pre-reveal.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
const LIFETIME_MS = 24 * 60 * 60 * 1000;
const PARTNER_LIFETIME_MS = 90 * LIFETIME_MS;
const MAX_ARCHIVE = 100;
const MAX_SHARED = 60;
const VOTES = new Set(['like', 'save', 'dislike']);

const reply = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff'
  }
});
const fail = (message, status = 400, code = 'BAD_REQUEST') => reply({ok:false,code,message},status);
const safeName = name => String(name || '').trim().replace(/[<>\u0000-\u001f]/g,'').slice(0,24) || 'Filmfan';
const secret = () => crypto.randomUUID() + '-' + crypto.randomUUID();
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}
function shuffled(array) {
  const values = [...array];
  if (values.length < 2) return values;
  const bytes = crypto.getRandomValues(new Uint32Array(values.length));
  for (let i = values.length - 1; i > 0; i--) {
    const j = bytes[i] % (i+1);
    [values[i],values[j]] = [values[j],values[i]];
  }
  return values;
}
function normalizeMedia(record, type) {
  const name = type === 'movie' ? record.title : record.name;
  const date = type === 'movie' ? record.release_date : record.first_air_date;
  if (!record?.id || !name || !record.poster_path) return null;
  const votes = Number(record.vote_count || 0);
  const popularity = Number(record.popularity || 0);
  if (votes < (type === 'movie' ? 120 : 80) || record.adult) return null;
  if (['ja','zh','ko'].includes(record.original_language) && votes < 600 && popularity < 40) return null;
  return {
    id:type + '-' + record.id,
    tmdbId:Number(record.id),
    type, title:String(name).slice(0,130),
    year:String(date || '').slice(0,4),
    poster:record.poster_path,
    blurb:String(record.overview || '').slice(0,400),
    rating:Number(record.vote_average || 0),
    genres:Array.isArray(record.genre_ids) ? record.genre_ids.slice(0,5) : []
  };
}
async function getTitles(env, exclude = [], preferredGenres = []) {
  if (!env.TMDB_API_TOKEN) throw new Error('TMDB_API_TOKEN fehlt');
  const page = 1 + crypto.getRandomValues(new Uint8Array(1))[0] % 3;
  async function discover(type) {
    const url = new URL('https://api.themoviedb.org/3/discover/' + (type === 'movie' ? 'movie' : 'tv'));
    const params = {
      language:'de-DE', page:String(page),
      sort_by:'popularity.desc', watch_region:'DE',
      with_watch_monetization_types:'flatrate|free|ads|rent|buy',
      'vote_count.gte': type === 'movie' ? '120' : '80'
    };
    if (type === 'movie') params.include_adult = 'false';
    for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
    const response = await fetch(url.toString(),{
      headers:{authorization:'Bearer '+env.TMDB_API_TOKEN,accept:'application/json'}
    });
    if (!response.ok) throw new Error('TMDB '+response.status);
    const data = await response.json();
    return shuffled((data.results || []).map(item => normalizeMedia(item,type)).filter(Boolean));
  }
  const settled = await Promise.allSettled([discover('movie'),discover('series')]);
  const movies = settled[0].status === 'fulfilled' ? settled[0].value : [];
  const series = settled[1].status === 'fulfilled' ? settled[1].value : [];
  const excluded = new Set(exclude);
  const used = new Set();
  const result = [];
  const add = item => {
    if (item && !used.has(item.id) && !excluded.has(item.id)) {
      used.add(item.id);result.push(item);
    }
  };
  // When a pair has previous mutual likes, rank the fresh TMDB discovery
  // candidates by those common genres. No individual vote is exposed.
  const preference=new Set(preferredGenres.map(Number));
  const prioritize=pool=>shuffled(pool).sort((a,b)=>{
    const score=item=>(item.genres||[]).filter(g=>preference.has(g)).length;
    return score(b)-score(a);
  });
  prioritize(movies).slice(0,7).forEach(add);
  prioritize(series).slice(0,5).forEach(add);
  prioritize([...movies,...series]).forEach(item=>{if(result.length<10)add(item);});
  if (result.length < 10) throw new Error('Zu wenige verfügbare Filmtitel. Versuch es bitte erneut.');
  return shuffled(result.slice(0,10));
}
function matchResults(room) {
  if (!['reveal','finished'].includes(room.status)) return [];
  const positives = new Set(['like','save']);
  return room.items.flatMap(item => {
    const first = room.votes.host[item.id];
    const second = room.votes.guest[item.id];
    if (!positives.has(first) || !positives.has(second)) return [];
    const tier = first === 'like' && second === 'like' ? 3 : first === 'save' && second === 'save' ? 1 : 2;
    return [{...item,tier,hostVote:first,guestVote:second}];
  }).sort((a,b) => b.tier-a.tier || b.rating-a.rating || a.title.localeCompare(b.title,'de'));
}
// Shared matches are archived only AFTER both people agree to reveal.
function archiveRevealedMatches(room) {
  const existing=new Map((room.matchArchive||[]).map(item=>[item.id,item]));
  for(const item of matchResults(room)){
    if(!existing.has(item.id))existing.set(item.id,{
      id:item.id,tmdbId:item.tmdbId,type:item.type,title:item.title,
      poster:item.poster,year:item.year,rating:item.rating,
      genres:Array.isArray(item.genres)?item.genres.slice(0,5):[]
    });
  }
  room.matchArchive=[...existing.values()].slice(-MAX_ARCHIVE);
}
function extendPartnership(room) {
  if(room.partner?.active)room.expiresAt=Date.now()+PARTNER_LIFETIME_MS;
}
function progress(room,role) {
  return Object.keys(room.votes[role] || {}).length;
}
function publicRoom(room, role) {
  const completed = room.status === 'ready' || room.status === 'reveal' || room.status === 'finished';
  const revealed = room.status === 'reveal' || room.status === 'finished';
  return {
    code:room.code, role, status:room.status, round:room.round,
    expiresAt:room.expiresAt, participant:room[role]?.name,
    hostName:room.host.name,guestName:room.guest?.name || null,
    hostProgress:progress(room,'host'),guestProgress:progress(room,'guest'),
    total:room.items.length, items:room.items, ownVotes:room.votes[role],
    ownReady:Boolean(room.ready[role]), partnerReady:completed ? Boolean(room.ready[role === 'host' ? 'guest' : 'host']) : false,
    matches:revealed ? matchResults(room) : null,
    picked:revealed ? room.picked : null,
    partnership:{
      active:Boolean(room.partner?.active),
      ownConsent:Boolean(room.partner?.consent?.[role]),
      otherConsent:Boolean(room.partner?.consent?.[role==='host'?'guest':'host'])
    },
    sharedList:room.partner?.active ? (room.sharedList||[]) : [],
    tailored:Boolean(room.tailored && room.partner?.active),
    nextRequested:Boolean(room.nextRequested)
  };
}

export class HiddenMatchRoom {
  constructor(ctx,env) {
    this.ctx=ctx;
    this.env=env;
  }
  async load() {
    const room = await this.ctx.storage.get('room');
    if (!room) return null;
    if (Date.now() > room.expiresAt) {
      await this.ctx.storage.delete('room');
      return null;
    }
    return room;
  }
  async store(room) {
    await this.ctx.storage.put('room',room);
    await this.ctx.storage.setAlarm(room.expiresAt);
  }
  async alarm() {
    await this.ctx.storage.delete('room');
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000,'Room expired'); } catch {} }
  }
  role(room,token) {
    if (!token || typeof token !== 'string') return null;
    if (token === room.host.token) return 'host';
    if (room.guest && token === room.guest.token) return 'guest';
    return null;
  }
  async broadcast(room) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const role = ws.deserializeAttachment()?.role;
        if (role && room[role]) ws.send(JSON.stringify({type:'state',room:publicRoom(room,role)}));
      } catch { try {ws.close(1011,'Connection reset');}catch{} }
    }
  }
  async fetch(request) {
    const action = new URL(request.url).pathname.slice(1);
    if (action === 'ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return fail('WebSocket erforderlich.',426);
      const params = new URL(request.url).searchParams;
      const room = await this.load();
      if (!room || room.status === 'closed') return fail('Room abgelaufen oder beendet.',410,'ROOM_CLOSED');
      const role = this.role(room,params.get('token'));
      if (!role) return fail('Zugang ungültig.',401,'UNAUTHORIZED');
      const pair = new WebSocketPair();
      const [client,server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({role});
      server.send(JSON.stringify({type:'state',room:publicRoom(room,role)}));
      return new Response(null,{status:101,webSocket:client});
    }
    if (request.method !== 'POST') return fail('POST erforderlich.',405);
    const payload = await request.json().catch(()=>null);
    if (!payload || typeof payload !== 'object') return fail('Ungültige Anfrage.');
    if (action === 'create') {
      if (await this.load()) return fail('Room-Code bereits vergeben.',409,'ROOM_EXISTS');
      if (!Array.isArray(payload.items) || payload.items.length !== 10) return fail('Keine gültigen Karten.');
      const room = {
        code:payload.code, round:1, status:'waiting',createdAt:Date.now(),
        expiresAt:Date.now()+LIFETIME_MS, host:{name:safeName(payload.name),token:payload.token},
        guest:null,items:payload.items,votes:{host:{},guest:{}},
        ready:{host:false,guest:false},picked:null,seen:payload.items.map(item=>item.id),
        partner:{active:false,consent:{host:false,guest:false}},
        matchArchive:[],sharedList:[],nextRequested:false
      };
      await this.store(room);
      return reply({ok:true,room:publicRoom(room,'host'),token:room.host.token});
    }
    const room = await this.load();
    if (!room || room.status === 'closed') return fail('Room nicht gefunden oder abgelaufen.',410,'ROOM_CLOSED');
    if (action === 'join') {
      if (room.guest) return fail('Dieser Room ist bereits mit zwei Personen besetzt.',409,'ROOM_FULL');
      if (room.status !== 'waiting') return fail('Room ist nicht mehr offen.',409,'ROOM_NOT_OPEN');
      room.guest={name:safeName(payload.name),token:payload.token};
      room.status='playing';
      await this.store(room);
      await this.broadcast(room);
      return reply({ok:true,room:publicRoom(room,'guest'),token:room.guest.token});
    }
    const role = this.role(room,payload.token);
    if (!role) return fail('Deine Room-Sitzung ist ungültig.',401,'UNAUTHORIZED');
    if (action === 'state') return reply({ok:true,room:publicRoom(room,role)});
    if (action === 'vote') {
      // The host may rate titles while the invite is still pending.
      // A guest can vote only after joining. Neither side sees the other's votes.
      if (room.status !== 'playing' && !(room.status === 'waiting' && role === 'host')) {
        return fail('Abstimmung derzeit nicht möglich.',409,'WRONG_PHASE');
      }
      const itemId = String(payload.itemId || '');
      if (!room.items.some(item=>item.id === itemId) || !VOTES.has(payload.vote)) return fail('Ungültige Karte oder Stimme.');
      if (room.votes[role][itemId]) return fail('Diese Karte ist bereits bewertet.',409,'ALREADY_VOTED');
      room.votes[role][itemId]=payload.vote;
      if (room.guest && progress(room,'host')===room.items.length && progress(room,'guest')===room.items.length) {
        room.status='ready';
      }
    } else if (action === 'ready') {
      if (room.status !== 'ready') return fail('Warte, bis beide alle Karten bewertet haben.',409,'NOT_READY');
      if (progress(room,role)!==room.items.length) return fail('Bitte alle Karten bewerten.');
      room.ready[role]=true;
      if (room.ready.host && room.ready.guest) {
        room.status='reveal';
        archiveRevealedMatches(room);
      }
    } else if (action === 'pick') {
      if (!['reveal','finished'].includes(room.status)) return fail('Der Reveal ist noch nicht freigegeben.',409,'NOT_REVEALED');
      if (!room.picked) {
        const matches=matchResults(room);
        if (!matches.length) return fail('Noch keine gemeinsamen Favoriten.',409,'NO_MATCHES');
        room.picked=matches[0];
      }
      room.status='finished';
    } else if(action === 'savePartner') {
      if (!room.guest || ['closed'].includes(room.status)) return fail('Es müssen beide Personen verbunden sein.',409,'NO_PARTNER');
      if(!room.partner)room.partner={active:false,consent:{host:false,guest:false}};
      if(!room.partner.consent)room.partner.consent={host:false,guest:false};
      room.partner.consent[role]=true;
      if(room.partner.consent.host && room.partner.consent.guest)room.partner.active=true;
    } else if(action === 'toggleSave') {
      if(!room.partner?.active)return fail('Speichert zuerst eure Partnerschaft.',409,'PARTNER_REQUIRED');
      const itemId=String(payload.itemId||'');
      const match=(room.matchArchive||[]).find(item=>item.id===itemId);
      if(!match)return fail('Nur bereits enthüllte gemeinsame Treffer dürfen gespeichert werden.',409,'NOT_A_MATCH');
      const saved=room.sharedList||[];
      room.sharedList=saved.some(item=>item.id===itemId)
        ? saved.filter(item=>item.id!==itemId)
        : [...saved,match].slice(-MAX_SHARED);
    } else if (action === 'next') {
      if (role !== 'host' && !room.partner?.active) return fail('Nur der Host kann eine neue Runde starten.',403,'HOST_ONLY');
      if (!['reveal','finished'].includes(room.status)) return fail('Beendet zunächst die Runde.',409,'WRONG_PHASE');
      const genres=new Map();
      if(room.partner?.active){
        const savedIds=new Set((room.sharedList||[]).map(item=>item.id));
        for(const item of room.matchArchive||[]){
          for(const genre of item.genres||[]){
            if(!Number.isInteger(genre))continue;
            genres.set(genre,(genres.get(genre)||0)+(savedIds.has(item.id)?2:1));
          }
        }
      }
      const preferred=[...genres].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([genre])=>genre);
      let freshItems;
      try { freshItems=await getTitles(this.env,(room.seen||[]).slice(-300),preferred); }
      catch(error) { return fail(error.message||'Keine neuen Karten verfügbar.',503,'NO_TITLES'); }
      room.seen.push(...freshItems.map(item=>item.id));
      room.seen=room.seen.slice(-300);
      room.items=freshItems;
      room.tailored=preferred.length>0;
      room.round+=1;
      room.votes={host:{},guest:{}};
      room.ready={host:false,guest:false};
      room.picked=null;
      room.nextRequested=false;
      room.status='playing';
    } else if (action === 'leave') {
      if (role !== 'guest') return fail('Der Host muss den Room beenden.',403,'HOST_ONLY');
      if(room.partner?.active) {
        room.status='closed';
        room.expiresAt=Date.now()+5*60*1000;
      } else {
      room.guest=null;
      // Preserve already completed host swipes when a guest leaves.
      room.votes.guest={};
      room.ready={host:false,guest:false};
      room.picked=null;
      room.status='waiting';
      if(room.partner)room.partner.consent={host:false,guest:false};
      }
    } else if (action === 'close') {
      if (role !== 'host') return fail('Nur der Host kann den Room beenden.',403,'HOST_ONLY');
      room.status='closed';
      room.expiresAt=Date.now()+5*60*1000;
    } else {
      return fail('Aktion nicht gefunden.',404);
    }
    // Polling/state never renews a partnership, only an authenticated action.
    if(room.status!=='closed' && !['state'].includes(action))extendPartnership(room);
    await this.store(room);
    await this.broadcast(room);
    return reply({ok:true,room:publicRoom(room,role)});
  }
  webSocketMessage(ws,message) {
    if (message === 'ping') { try {ws.send('pong');}catch{} }
  }
  webSocketClose(ws,code,reason) { try {ws.close(code,reason);}catch{} }
  webSocketError(ws) { try {ws.close(1011,'Connection error');}catch{} }
}

export async function handleHiddenMatch(request,env) {
  const path = new URL(request.url).pathname;
  const action = path.split('/').pop();
  if (!env.HIDDEN_MATCH_ROOMS) return fail('Online-Rooms werden gerade eingerichtet.',503,'ROOM_SERVICE_UNAVAILABLE');
  const origin=request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return fail('Unzulässige Herkunft.',403,'INVALID_ORIGIN');
  if (action !== 'ws' && request.method !== 'POST') return fail('POST erforderlich.',405);
  if (Number(request.headers.get('content-length')||0)>12000) return fail('Anfrage zu groß.',413);
  if (action === 'ws') {
    const params=new URL(request.url).searchParams;
    const code=String(params.get('code')||'').trim().toUpperCase();
    if (!CODE_RE.test(code)) return fail('Ungültiger Room-Code.');
    return env.HIDDEN_MATCH_ROOMS.get(env.HIDDEN_MATCH_ROOMS.idFromName(code))
      .fetch(new Request('https://room.internal/ws?token='+encodeURIComponent(params.get('token')||''),request));
  }
  const body=await request.json().catch(()=>null);
  if (!body || typeof body !== 'object') return fail('Ungültige Anfrage.');
  if (action === 'create') {
    let items;
    try {items=await getTitles(env);} catch(error) {return fail(error.message||'Karten konnten nicht geladen werden.',503,'NO_TITLES');}
    for (let attempt=0;attempt<5;attempt++) {
      const code=newCode(),token=secret();
      const obj=env.HIDDEN_MATCH_ROOMS.get(env.HIDDEN_MATCH_ROOMS.idFromName(code));
      const response=await obj.fetch(new Request('https://room.internal/create',{
        method:'POST',body:JSON.stringify({code,name:body.name,token,items})
      }));
      if (response.status === 409) continue;
      return response;
    }
    return fail('Room-Erstellung fehlgeschlagen. Bitte erneut versuchen.',503);
  }
  const code=String(body.code||'').trim().toUpperCase();
  if (!CODE_RE.test(code)) return fail('Ungültiger Room-Code.');
  const payload={...body};
  if (action === 'join') payload.token=secret();
  if (!['join','state','vote','ready','pick','next','leave','close','savePartner','toggleSave'].includes(action)) return fail('Aktion nicht gefunden.',404);
  return env.HIDDEN_MATCH_ROOMS.get(env.HIDDEN_MATCH_ROOMS.idFromName(code))
    .fetch(new Request('https://room.internal/'+action,{method:'POST',body:JSON.stringify(payload)}));
}
