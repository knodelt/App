(() => {
  'use strict';
  // Hidden Match V1: a room lives on the server, never in another player's localStorage.
  const SESSION_KEY = 'frame-hidden-match-session-v1';
  const NAME_KEY = 'frame-hidden-match-name-v1';
  const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
  const API = '/api/hidden-match/';
  const node = id => document.getElementById(id);
  const show = (id,visible) => { const el=node(id); if(el) el.hidden=!visible; };
  const text = (id,value) => { const el=node(id); if(el) el.textContent=value == null ? '' : String(value); };
  const escapeHtml = value => String(value == null ? '' : value)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const inviteCode = (new URL(location.href).searchParams.get('hm') || '').trim().toUpperCase();
  let session = null;
  let room = null;
  let socket = null;
  let pollTimer = null;
  let reconnectTimer = null;
  let heartbeat = null;
  let reconnectAttempts = 0;
  let busy = false;
  let cardShown = '';
  let revealShown = '';
  let initialResume = false;
  let pointer = null;
  let qrLastLink = '';

  function getStoredSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return value && CODE_RE.test(value.code) && ['host','guest'].includes(value.role)
        && typeof value.token === 'string' && value.token.length >= 36 ? value : null;
    } catch { return null; }
  }
  function rememberSession(value) {
    session=value;
    try { localStorage.setItem(SESSION_KEY,JSON.stringify(value)); } catch {}
  }
  function rememberName(value) {
    try { localStorage.setItem(NAME_KEY,value); } catch {}
  }
  function getRememberedName() {
    try {return localStorage.getItem(NAME_KEY) || '';} catch {return '';}
  }
  function error(message) {
    const element=node('hmError');
    if (!element) return;
    element.textContent=message || 'Da ist etwas schiefgelaufen. Bitte versuche es erneut.';
    element.hidden=false;
  }
  function clearError() { show('hmError',false); }
  function setWorking(working) {
    busy=Boolean(working);
    for(const id of ['hmCreate','hmJoin','hmReadyButton','hmPick','hmNext','hmCloseRoom','hmExit']) {
      const button=node(id);
      if(button) button.disabled=busy;
    }
    for(const button of document.querySelectorAll('[data-hm-vote]')) button.disabled=busy;
  }
  async function post(endpoint,body,credentials=session) {
    const details=credentials ? {code:credentials.code,token:credentials.token} : {};
    let response;
    try {
      response=await fetch(API+endpoint,{
        method:'POST',
        headers:{'content-type':'application/json',accept:'application/json'},
        body:JSON.stringify({...details,...body}),
        cache:'no-store'
      });
    } catch { throw new Error('Keine Verbindung. Bitte Internetverbindung prüfen.'); }
    const data=await response.json().catch(()=>null);
    if (!response.ok || !data?.ok) {
      const err=new Error(data?.message || 'Room ist derzeit nicht erreichbar.');
      err.code=data?.code || String(response.status);
      throw err;
    }
    return data;
  }
  function nameFrom(id) {
    const value=(node(id)?.value || getRememberedName() || 'Filmfan').trim().slice(0,24);
    return value || 'Filmfan';
  }
  function inviteUrl(code) {
    const url=new URL('/',location.origin);
    url.searchParams.set('hm',code);
    return url.toString();
  }
  function clearInviteParameter() {
    const url=new URL(location.href);
    if (!url.searchParams.has('hm')) return;
    url.searchParams.delete('hm');
    history.replaceState(history.state,'',url.pathname+url.search+url.hash);
  }
  function showSetup(code=null) {
    show('hmSetup',true);
    show('hmLive',false);
    show('hmHostSetup',!code);
    show('hmGuestSetup',Boolean(code));
    if (code) {
      text('hmGuestHeading','Raum '+code+' wartet auf dich.');
    }
  }
  function clearConnection() {
    if (socket) {
      const old=socket;socket=null;
      old.onclose=null;old.onerror=null;old.onmessage=null;
      try {old.close(1000,'Left room');} catch {}
    }
    if (pollTimer) {clearInterval(pollTimer);pollTimer=null;}
    if (reconnectTimer) {clearTimeout(reconnectTimer);reconnectTimer=null;}
    if (heartbeat) {clearInterval(heartbeat);heartbeat=null;}
    reconnectAttempts=0;
  }
  function dropLocalSession() {
    clearConnection();
    try {localStorage.removeItem(SESSION_KEY);}catch{}
    session=null;room=null;cardShown='';revealShown='';qrLastLink='';
    clearInviteParameter();
    showSetup();
    clearError();
  }
  function connectionBadge(state) {
    const label=node('hmConnection');
    if (!label) return;
    const online=state==='online';
    label.classList.toggle('online',online);
    label.classList.toggle('offline',state==='offline');
    label.textContent=online?'LIVE':state==='offline'?'Getrennt':'Verbinde …';
  }
  function makeQR(url) {
    if (!url || qrLastLink===url) return;
    const host=node('hmQrCode');
    if (!host) return;
    qrLastLink=url;
    try {
      if(typeof window.qrcode !== 'function') {
        host.textContent='Einladungslink oben kopieren';
        return;
      }
      const qr=window.qrcode(0,'M');
      qr.addData(url);
      qr.make();
      host.innerHTML=qr.createImgTag(3,5,'Hidden-Match-Einladung als QR-Code');
    } catch {
      host.textContent='QR-Code nicht verfügbar – Link kopieren';
    }
  }
  function beginLive(result) {
    room=result.room;
    rememberSession({code:room.code,role:room.role,token:result.token});
    clearInviteParameter();
    setWorking(false);
    clearError();
    paint();
    startRealtime();
    try { switchView('recommend'); }catch{}
  }
  async function createRoom() {
    if (busy) return;
    const name=nameFrom('hmHostName');
    rememberName(name);
    setWorking(true);clearError();
    text('hmCreate','Room wird erstellt …');
    try {
      const data=await post('create',{name},null);
      beginLive(data);
    } catch(e) { error(e.message); }
    finally {
      setWorking(false);
      node('hmCreate').innerHTML='Hidden Match starten <span aria-hidden="true">→</span>';
    }
  }
  async function joinRoom() {
    if(busy || !CODE_RE.test(inviteCode)) return;
    const name=nameFrom('hmGuestName');
    rememberName(name);
    setWorking(true);clearError();
    text('hmJoin','Verbinde …');
    try {
      const data=await post('join',{code:inviteCode,name},null);
      beginLive(data);
    } catch(e) { error(e.message); }
    finally {
      setWorking(false);
      node('hmJoin').innerHTML='Room beitreten <span aria-hidden="true">→</span>';
    }
  }
  function setRoom(newRoom) {
    if (!session || newRoom?.code !== session.code) return;
    if (room && newRoom.round !== room.round) {
      cardShown='';revealShown='';
    }
    room=newRoom;
    paint();
  }
  function posterUrl(item) {
    return item?.poster && /^\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(item.poster)
      ? 'https://image.tmdb.org/t/p/w780'+item.poster : '';
  }
  function cardForVote() {
    if (!room || room.status!=='playing') return null;
    return room.items.find(item=>!room.ownVotes[item.id]) || null;
  }
  function paintCard(item) {
    if (!item || !room) return;
    const identity=room.code+':'+room.round+':'+item.id;
    if(identity===cardShown) return;
    cardShown=identity;
    const art=node('hmCardArt');
    if(art) {
      const poster=posterUrl(item);
      art.style.backgroundImage=poster?'url("'+poster+'")':'linear-gradient(145deg,#55404b,#141319)';
    }
    const voted=Object.keys(room.ownVotes).length;
    text('hmCardCount','KARTE '+String(voted+1).padStart(2,'0')+' / '+room.total);
    text('hmCardTitle',item.title);
    text('hmCardMeta',(item.type==='movie'?'FILM':'SERIE')+' · '+(item.year||'—'));
    text('hmCardBlurb',item.blurb || 'Wie passt dieser Titel zu deinem Filmeabend?');
    const card=node('hmCard');
    if(card)card.style.transform='';
  }
  function paintReveal() {
    if(!room) return;
    const matches=room.matches || [];
    const key=room.code+':'+room.round+':'+room.status+':'+matches.map(item=>item.id).join(',');
    if(key !== revealShown) {
      revealShown=key;
      text('hmRevealTitle',matches.length===1?'Ein gemeinsamer Treffer!':matches.length?matches.length+' gemeinsame Treffer':'Noch kein gemeinsamer Treffer.');
      text('hmRevealDescription',matches.length
        ? 'Ihr habt unabhängig voneinander diese Filme oder Serien ausgewählt.'
        : 'Kein Drama: Eine neue Runde bringt euch vielleicht auf einen gemeinsamen Nenner.');
      const list=node('hmMatchCards');
      if(list) list.innerHTML=matches.map((item,index)=>{
        const tier=item.tier===3?'PERFECT MATCH':item.tier===2?'GOOD MATCH':'MAYBE MATCH';
        const why=item.tier===3?'Beide: SUPER':item.tier===2?'SUPER + MERKEN':'Beide: MERKEN';
        const art=posterUrl(item);
        return '<div class="hm-match-card" style="animation-delay:'+Math.min(index*100,550)+'ms">'
          +'<div class="hm-match-poster"'+(art?' style="background-image:url(\''+art+'\')"':'')+'></div>'
          +'<div class="hm-match-copy"><span class="hm-match-tier">'+tier+'</span><h4>'+escapeHtml(item.title)+'</h4>'
          +'<p>'+escapeHtml(why)+' · '+escapeHtml(item.year||'')+'</p></div></div>';
      }).join('');
    }
    const picked=node('hmPicked');
    if(room.picked && picked) {
      picked.hidden=false;
      picked.innerHTML='<strong>FRAME HAT ENTSCHIEDEN</strong><h4>'+escapeHtml(room.picked.title)+'</h4>'
        +'<p>Das ist heute euer gemeinsamer Favorit. Viel Spaß beim Filmabend!</p>';
    } else if(picked) { picked.hidden=true;picked.textContent=''; }
    show('hmPick',Boolean(matches.length) && !room.picked);
    show('hmNext',room.role==='host');
    text('hmNext',matches.length?'Nochmal 10 neue Titel':'Neue Runde versuchen');
  }
  function paint() {
    if(!room || !session) { showSetup(); return; }
    show('hmSetup',false);
    show('hmLive',true);
    const host=room.role==='host';
    text('hmRoomCode',room.code);
    const total=room.total||10;
    text('hmHostNameLabel',room.hostName+(host?' (Du)':''));
    text('hmGuestNameLabel',room.guestName?room.guestName+(!host?' (Du)':''):'Wartet auf Gast');
    text('hmHostCount',room.hostProgress+'/'+total);
    text('hmGuestCount',room.guestProgress+'/'+total);
    if(node('hmHostMeter'))node('hmHostMeter').style.width=(100*room.hostProgress/total)+'%';
    if(node('hmGuestMeter'))node('hmGuestMeter').style.width=(100*room.guestProgress/total)+'%';
    show('hmInviteArea',host && room.status==='waiting');
    if(host && room.status==='waiting') {
      const link=inviteUrl(room.code);
      if(node('hmInviteLink'))node('hmInviteLink').value=link;
      makeQR(link);
    }
    show('hmWaiting',room.status==='waiting');
    const item=cardForVote();
    show('hmPlaying',Boolean(item));
    show('hmPartnerPending',room.status==='playing' && !item);
    if(item) paintCard(item);
    show('hmReady',room.status==='ready');
    if(room.status==='ready') {
      const button=node('hmReadyButton');
      if(button){button.disabled=busy || room.ownReady;button.innerHTML=room.ownReady?'Warte auf dein Gegenüber …':'Reveal starten <span aria-hidden="true">→</span>';}
      text('hmReadyCopy',room.ownReady?'Du bist bereit. Sobald die zweite Person bestätigt, geht es los.':'Ihr habt beide abgestimmt – seid ihr bereit für die Enthüllung?');
    }
    show('hmReveal',room.status==='reveal' || room.status==='finished');
    if(['reveal','finished'].includes(room.status)) paintReveal();
    show('hmClosed',room.status==='closed');
    show('hmExit',!host && room.status!=='closed');
    show('hmCloseRoom',host && room.status!=='closed');
    text('hmRoomFooter',room.status==='closed'?'Room beendet':room.status==='waiting'?'Einladung 24 Stunden gültig':room.status==='ready'?'Beide entscheiden, wann der Reveal startet.':'Eure Stimmen bleiben bis zum gemeinsamen Reveal geheim.');
  }
  async function perform(endpoint,payload={},options={}) {
    if (busy || !session) return;
    const before=session.code;
    setWorking(true);clearError();
    try {
      const result=await post(endpoint,payload);
      if(session?.code===before) setRoom(result.room);
      if(endpoint==='close') {clearConnection();}
      if(endpoint==='leave') {dropLocalSession();}
      if(options.announce && typeof showToast==='function') showToast(options.announce);
    } catch(e) {
      error(e.message);
      if(e.code==='ROOM_CLOSED' || e.code==='UNAUTHORIZED') dropLocalSession();
    } finally {
      setWorking(false);
      if(room)paint();
    }
  }
  async function vote(action) {
    if(busy || !room || room.status!=='playing') return;
    const item=cardForVote();
    if(!item)return;
    await perform('vote',{itemId:item.id,vote:action});
  }
  async function refreshState() {
    if(!session || busy) return;
    try {
      const result=await post('state',{});
      if(result.room.code===session?.code) {
        setRoom(result.room);
        if(!socket || socket.readyState!==WebSocket.OPEN) connectionBadge('offline');
      }
    }catch(e) {
      if(e.code==='ROOM_CLOSED'||e.code==='UNAUTHORIZED') {
        dropLocalSession();
        error('Dein Room ist beendet oder abgelaufen. Starte einen neuen.');
      }else connectionBadge('offline');
    }
  }
  function connectSocket() {
    if(!session || (socket && (socket.readyState===WebSocket.CONNECTING || socket.readyState===WebSocket.OPEN)))return;
    const owner=session.code;
    const endpoint=(location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+API+'ws?code='+encodeURIComponent(owner)+'&token='+encodeURIComponent(session.token);
    try {socket=new WebSocket(endpoint);}
    catch {connectionBadge('offline');scheduleReconnect();return;}
    connectionBadge('connecting');
    socket.onopen=()=>{
      reconnectAttempts=0;connectionBadge('online');
      if(heartbeat)clearInterval(heartbeat);
      heartbeat=setInterval(()=>{if(socket?.readyState===WebSocket.OPEN)socket.send('ping');},25000);
      refreshState();
    };
    socket.onmessage=event=>{
      if(event.data==='pong')return;
      try{
        const msg=JSON.parse(event.data);
        if(msg.type==='state' && session?.code===owner) setRoom(msg.room);
      }catch{}
    };
    socket.onerror=()=>connectionBadge('offline');
    socket.onclose=()=>{
      if(heartbeat)clearInterval(heartbeat);heartbeat=null;
      socket=null;connectionBadge('offline');
      if(session?.code===owner) scheduleReconnect();
    };
  }
  function scheduleReconnect() {
    if(reconnectTimer || !session)return;
    const delay=Math.min(16000,1000*Math.pow(1.7,reconnectAttempts++));
    reconnectTimer=setTimeout(()=>{
      reconnectTimer=null;
      if(session)connectSocket();
    },delay);
  }
  function startRealtime() {
    clearConnection();
    connectionBadge('connecting');
    connectSocket();
    pollTimer=setInterval(refreshState,8000);
  }
  function openExisting() {
    session=getStoredSession();
    if(!session)return false;
    room=null;
    show('hmSetup',false);show('hmLive',true);
    show('hmWaiting',true);text('hmRoomCode',session.code);
    connectionBadge('connecting');
    initialResume=true;
    refreshState().finally(()=>{
      if(session)startRealtime();
      initialResume=false;
    });
    return true;
  }
  async function copyInvitation() {
    const value=node('hmInviteLink')?.value;
    if(!value)return;
    try {
      if(!navigator.clipboard?.writeText)throw Error('no clipboard');
      await navigator.clipboard.writeText(value);
      if(typeof showToast==='function')showToast('Einladungslink kopiert.');
    } catch {
      const input=node('hmInviteLink');if(!input)return;
      input.focus();input.select();
      try {document.execCommand('copy');if(typeof showToast==='function')showToast('Link kopiert.');}catch {error('Bitte Link markieren und kopieren.');}
    }
  }
  async function shareInvitation() {
    const url=node('hmInviteLink')?.value;
    if(!url)return;
    if(navigator.share) {
      try { await navigator.share({title:'FRAME Hidden Match',text:'Lass uns zusammen einen Film finden!',url}); }
      catch(e) {if(e.name!=='AbortError')await copyInvitation();}
    } else await copyInvitation();
  }
  async function leaveRoom() {
    if(!session || busy)return;
    if(session.role==='host') {
      if(!confirm('Möchtest du den gemeinsamen Room wirklich beenden?'))return;
      await perform('close');
      dropLocalSession();
    }else {
      if(!confirm('Room verlassen? Deine Stimmen dieser Runde gehen verloren.'))return;
      await perform('leave');
    }
  }
  function onPointerDown(event) {
    if(event.button!==0 || event.target.closest('button') || busy || !cardForVote())return;
    pointer={x:event.clientX,y:event.clientY,id:event.pointerId};
  }
  function onPointerMove(event) {
    if(!pointer || pointer.id!==event.pointerId || busy)return;
    const dx=event.clientX-pointer.x;
    const dy=event.clientY-pointer.y;
    const element=node('hmCard');
    if(element)element.style.transform='translate('+Math.max(-72,Math.min(72,dx*.3))+'px,'+Math.max(-46,Math.min(20,dy*.18))+'px) rotate('+dx*.014+'deg)';
  }
  function onPointerEnd(event) {
    if(!pointer || pointer.id!==event.pointerId)return;
    const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;
    pointer=null;
    const element=node('hmCard');
    if(element)element.style.transform='';
    if(Math.abs(dx)>85 && Math.abs(dx)>Math.abs(dy)*.85)vote(dx<0?'like':'dislike');
    else if(dy<-90 && Math.abs(dy)>Math.abs(dx)*.85)vote('save');
  }
  function bind() {
    node('hmCreate')?.addEventListener('click',createRoom);
    node('hmJoin')?.addEventListener('click',joinRoom);
    node('hmCancelInvite')?.addEventListener('click',()=>{clearInviteParameter();showSetup();});
    node('hmStartOver')?.addEventListener('click',dropLocalSession);
    node('hmCopyLink')?.addEventListener('click',copyInvitation);
    node('hmShareLink')?.addEventListener('click',shareInvitation);
    node('hmReadyButton')?.addEventListener('click',()=>perform('ready'));
    node('hmPick')?.addEventListener('click',()=>perform('pick'));
    node('hmNext')?.addEventListener('click',()=>perform('next'));
    node('hmCloseRoom')?.addEventListener('click',leaveRoom);
    node('hmExit')?.addEventListener('click',leaveRoom);
    for(const button of document.querySelectorAll('[data-hm-vote]')) {
      button.addEventListener('click',()=>vote(button.dataset.hmVote));
    }
    const card=node('hmCard');
    card?.addEventListener('pointerdown',onPointerDown);
    card?.addEventListener('pointermove',onPointerMove);
    card?.addEventListener('pointerup',onPointerEnd);
    card?.addEventListener('pointercancel',()=>{pointer=null;card.style.transform='';});
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden && session){refreshState();connectSocket();}
    });
    window.addEventListener('online',()=>{if(session){refreshState();connectSocket();}});
  }
  if(!node('roomPanel'))return;
  node('hmHostName').value=getRememberedName();
  node('hmGuestName').value=getRememberedName();
  bind();
  if(inviteCode && !CODE_RE.test(inviteCode)) {
    showSetup();
    error('Der Einladungslink ist ungültig. Bitte lass dir einen neuen Link schicken.');
  } else if(inviteCode && getStoredSession()?.code!==inviteCode) {
    showSetup(inviteCode);
    try{switchView('recommend');}catch{}
    setTimeout(()=>node('roomPanel')?.scrollIntoView({block:'start',behavior:'smooth'}),150);
  } else if(openExisting()) {
    if(inviteCode) {
      try{switchView('recommend');}catch{}
      setTimeout(()=>node('roomPanel')?.scrollIntoView({block:'start',behavior:'smooth'}),150);
    }
  } else {
    showSetup();
  }
})();
