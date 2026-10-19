(() => {
  'use strict';
  const KEYS=[
    'frame-state','frame-taste-dna-v2','frame-online-learning-v1',
    'frame-recommendation-history-v1','frame-loop-v1','frame-loop-mode-v1',
    'frame-mood-v1','frame-recommendation-exclusions-v1'
  ];
  const OWNER='frame-cloud-owner-v1',HASH='frame-cloud-hash-v1',REV='frame-cloud-revision-v1';
  // Survives location.reload() but not a fresh browser session. Prevents a
  // cloud restore from triggering unbounded reloads on mobile browsers.
  const RESTORE_GUARD='frame-cloud-restore-reload-v2';
  const panel=document.querySelector('#frameAccountPanel'),modal=document.querySelector('#frameAccountModal');
  if(!panel||!modal)return;
  const pick=id=>document.getElementById(id);
  const show=(id,on)=>{const n=pick(id);if(n)n.hidden=!on;};
  const text=(id,val)=>{const n=pick(id);if(n)n.textContent=val;};
  let me=null,revision=0,ready=false,inflight=false,paused=false,timer=null,changedDuring=false;
  let lastHash='',lastSentHash='',config={email:false},initSerial=0;
  let providerCheck=null,providerCheckId=0;
  const safeGet=key=>{try{return localStorage.getItem(key)}catch{return null}};
  const safeSet=(key,val)=>{try{localStorage.setItem(key,val)}catch{}};
  const sessionGet=key=>{try{return sessionStorage.getItem(key)}catch{return null}};
  const sessionSet=(key,val)=>{try{sessionStorage.setItem(key,val)}catch{}};
  const sessionClear=key=>{try{sessionStorage.removeItem(key)}catch{}};
  const accountFetch=async(path,options={})=>{
    const result=await fetch('/api/account/'+path,{
      credentials:'same-origin',cache:'no-store',
      headers:{accept:'application/json',...(options.body?{'content-type':'application/json'}:{}),...options.headers},
      ...options
    });
    let data={};try{data=await result.json()}catch{}
    if(!result.ok)throw Object.assign(new Error(data.error||'Server nicht erreichbar.'),{status:result.status,data});
    return data;
  };
  const snapshot=()=>{
    const values={};
    for(const key of KEYS){
      const value=safeGet(key);
      if(value!==null)values[key]=value;
    }
    return values;
  };
  const serialized=s=>JSON.stringify(Object.fromEntries(Object.entries(s).sort(([a],[b])=>a.localeCompare(b))));
  const fingerprint=async values=>{
    const bytes=new TextEncoder().encode(serialized(values));
    const raw=await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(raw)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  };
  const hasData=s=>{
    if(!s||!Object.keys(s).length)return false;
    const parse=key=>{try{return JSON.parse(s[key]||'{}')}catch{return {}}};
    const local=parse('frame-state'),dna=parse('frame-taste-dna-v2'),
      online=parse('frame-online-learning-v1'),history=parse('frame-recommendation-history-v1'),
      loop=parse('frame-loop-v1');
    return Object.keys(local.swipes||{}).length>0 ||
      (local.saved||[]).length>0 ||
      Object.keys(local.watched||{}).length>0 ||
      Object.keys(local.frameLogItems||{}).length>0 ||
      Object.keys(local.frameLogMeta||{}).length>0 ||
      Object.keys(dna.items||{}).length>0 ||
      (online.examples||[]).length>0 ||
      Object.keys(history||{}).length>0 ||
      (loop.pickHistory||[]).length>0;
  };
  const status=(value,bad=false)=>{
    text('frameAccountStatus',value);
    pick('frameAccountStatus')?.classList.toggle('is-error',bad);
  };
  const syncStatus=(value,bad=false)=>{
    text('frameAccountSyncStatus',value);
    pick('frameAccountSyncStatus')?.classList.toggle('is-error',bad);
  };
  const showPanel=()=>{
    const logged=Boolean(me?.authenticated);
    show('frameAccountGuest',!logged);
    show('frameAccountSigned',logged);
    text('frameAccountEmail',logged?me.email:'');
    const headerLogin=pick('frameHeaderLogin');
    if(headerLogin){
      text('frameHeaderLoginText',logged?'Konto':'Login');
      headerLogin.classList.toggle('is-logged-in',logged);
      headerLogin.setAttribute('aria-label',logged?'FRAME-Konto verwalten':'Bei FRAME anmelden');
      headerLogin.setAttribute('title',logged?'Dein FRAME-Konto':'Anmelden oder Konto erstellen');
    }
    if(!logged)status('Noch ohne Konto. Deine Daten bleiben auf diesem Gerät.');
    else status('Du bist angemeldet.');
  };
  const renderProviders=(state='ready',message='')=>{
    const usable=state==='ready';
    show('frameAccountEmailLogin',usable&&Boolean(config.email));
    const none=!config.email;
    const explain=state!=='ready'||none;
    show('frameAccountProvidersDisabled',explain);
    show('frameAccountRetryProviders',explain&&state!=='loading');
    if(explain){
      text('frameAccountProvidersDisabled',
        message || (state==='loading'?'Anmeldemethoden werden geprüft …':
          'Momentan ist keine Anmeldemethode verfügbar. Bitte erneut prüfen.'));
    }
  };
  async function refreshProviders(){
    if(providerCheck)return providerCheck;
    const requestId=++providerCheckId;
    renderProviders('loading');
    providerCheck=(async()=>{
      try{
        const response=await accountFetch('config');
        if(requestId!==providerCheckId)return;
        if(response.ok!==true)throw Error('Ungültige Antwort des Kontodienstes');
        config={email:response.email===true};
        renderProviders('ready');
      }catch(error){
        if(requestId!==providerCheckId)return;
        config={email:false};
        renderProviders('error','FRAME kann die Anmeldemethoden gerade nicht abrufen. Prüfe die Verbindung und versuche es erneut.');
        console.warn('[FRAME ACCOUNT] Login-Konfiguration nicht erreichbar:',error?.message||error);
      }
    })();
    try{await providerCheck;}finally{providerCheck=null;}
  }
  const toggleModal=value=>{
    modal.hidden=!value;
    if(value){
      void refreshProviders();
      if(config.email)pick('frameAccountEmailInput')?.focus({preventScroll:true});
    }
  };
  const clearCloudMarks=()=>{
    for(const key of [OWNER,HASH,REV]){
      try{localStorage.removeItem(key)}catch{}
    }
    sessionClear(RESTORE_GUARD);
  };
  const retainMarks=(hash,rev)=>{
    safeSet(OWNER,me.email);safeSet(HASH,hash);safeSet(REV,String(rev));
    lastHash=hash;revision=rev;
  };
  const restoreLocal=(items)=>{
    if(!items||typeof items!=='object')throw Error('Ungültiger Cloud-Speicher');
    // Check total storage before modifying the real keys. Roll back on quota errors.
    const previous=snapshot(),written=[];
    try{
      for(const key of KEYS){
        if(Object.prototype.hasOwnProperty.call(items,key))localStorage.setItem(key,items[key]);
        else localStorage.removeItem(key);
        written.push(key);
      }
    }catch{
      for(const key of written.reverse()){
        try{
          if(Object.prototype.hasOwnProperty.call(previous,key))localStorage.setItem(key,previous[key]);
          else localStorage.removeItem(key);
        }catch{}
      }
      throw Error('Nicht genug Browserspeicher für die Cloud-Daten. Vorhandene Daten wurden möglichst wiederhergestellt.');
    }
  };
  async function upload(values,rev) {
    const before=await fingerprint(values);
    const result=await accountFetch('sync',{method:'PUT',body:JSON.stringify({revision:rev,data:values})});
    retainMarks(before,result.revision);
    syncStatus('Synchronisiert · '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}));
    return before;
  }
  function queue(){
    if(!ready||paused||!me?.authenticated)return;
    if(inflight){changedDuring=true;return;}
    clearTimeout(timer);
    timer=setTimeout(()=>{void push();},1700);
    syncStatus('Änderungen werden gesichert …');
  }
  async function push(){
    if(!ready||paused||inflight||!me?.authenticated)return;
    inflight=true;
    try {
      const local=snapshot(),hash=await fingerprint(local);
      if(hash===lastHash){syncStatus('Alle Änderungen synchronisiert');return;}
      await upload(local,revision);
      if((await fingerprint(snapshot()))!==hash)changedDuring=true;
    }catch(e){
      if(e.status===409){
        paused=true;ready=false;
        syncStatus('Änderungen auf zwei Geräten erkannt. Bitte abgleichen.',true);
        show('frameAccountConflict',true);
      }else syncStatus(e.message||'Cloud-Speicherung fehlgeschlagen. Erneut versuchen.',true);
    }finally{
      inflight=false;
      if(changedDuring){
        changedDuring=false;
        if(ready&&!paused)queue();
      }
    }
  }
  async function reconcile({allowAutomaticRestore=true}={}){
    if(!me?.authenticated)return;
    const serial=++initSerial;
    ready=false;paused=true;
    syncStatus('Cloud-Daten werden geprüft …');
    try{
      const cloud=await accountFetch('sync');
      if(serial!==initSerial)return;
      const remote=cloud.data||{},local=snapshot();
      revision=cloud.revision;
      const [remoteHash,localHash]=await Promise.all([fingerprint(remote),fingerprint(local)]);
      const sameOwner=safeGet(OWNER)===me.email;
      const baseline=sameOwner?safeGet(HASH):null;
      if(serial!==initSerial)return;
      if(remoteHash===localHash){
        retainMarks(remoteHash,revision);
        sessionClear(RESTORE_GUARD);
        paused=false;ready=true;
        syncStatus('Deine Daten sind synchronisiert.');
        show('frameAccountConflict',false);
        return;
      }
      if(!cloud.data) {
        // No preexisting cloud copy; user authorizes the initial upload.
        if(!hasData(local) || confirm('Deine bisherigen FRAME-Daten jetzt in deinem neuen Cloud-Konto sichern?')){
          await upload(local,revision);
          paused=false;ready=true;show('frameAccountConflict',false);
        }else{
          syncStatus('Lokale Daten noch nicht hochgeladen.',true);
          show('frameAccountConflict',true);
        }
        return;
      }
      if(!hasData(local) || (baseline===localHash && sameOwner)) {
        // Do not reload the site again if it has already restored this exact
        // cloud revision during the current browser tab session.
        const stamp=me.email+':'+revision+':'+remoteHash;
        if(!allowAutomaticRestore || sessionGet(RESTORE_GUARD)===stamp){
          paused=true;ready=false;
          syncStatus('Cloud-Daten und Gerät unterscheiden sich. Bitte den Stand prüfen.',true);
          show('frameAccountConflict',true);
          return;
        }
        restoreLocal(remote);
        const importedHash=await fingerprint(snapshot());
        if(importedHash!==remoteHash){
          syncStatus('Cloud-Wiederherstellung konnte nicht geprüft werden.',true);
          show('frameAccountConflict',true);
          return;
        }
        retainMarks(remoteHash,revision);
        sessionSet(RESTORE_GUARD,stamp);
        location.reload();
        return;
      }
      if(baseline===remoteHash && sameOwner) {
        await upload(local,revision);
        ready=true;paused=false;show('frameAccountConflict',false);
        return;
      }
      // Both copies contain changes; never silently discard one.
      syncStatus('Auf diesem Gerät und in der Cloud liegen unterschiedliche Daten vor.',true);
      show('frameAccountConflict',true);
    }catch(e){syncStatus(e.message||'Cloud nicht erreichbar.',true);}
  }
  async function chooseRemote(){
    if(!confirm('Die Daten dieses Geräts durch deine Cloud-Daten ersetzen? Nicht synchronisierte lokale Änderungen gehen dabei verloren.'))return;
    try{
      const cloud=await accountFetch('sync');
      if(!cloud.data)throw Error('Noch keine Cloud-Daten vorhanden.');
      const hash=await fingerprint(cloud.data);
      restoreLocal(cloud.data);
      if(await fingerprint(snapshot())!==hash)
        throw Error('Cloud-Daten konnten nicht vollständig übernommen werden.');
      retainMarks(hash,cloud.revision);
      // This reload follows an explicit user choice, never an automatic loop.
      sessionSet(RESTORE_GUARD,me.email+':'+cloud.revision+':'+hash);
      location.reload();
    }catch(e){syncStatus(e.message,true);}
  }
  async function chooseLocal(){
    if(!confirm('Die Cloud-Daten mit den Daten dieses Geräts überschreiben? Änderungen von anderen Geräten gehen dabei verloren.'))return;
    try{
      const cloud=await accountFetch('sync'); // fetch latest version after conflict
      await upload(snapshot(),cloud.revision);
      paused=false;ready=true;
      show('frameAccountConflict',false);
    }catch(e){syncStatus(e.message,true);}
  }
  async function logout(deleteAccount=false){
    const warn=deleteAccount?
      'Dein FRAME-Konto und seine Cloud-Daten unwiderruflich löschen?':
      'Von FRAME abmelden? Die Cloud-Daten bleiben gespeichert. Die lokale Kopie auf diesem Gerät wird aus Datenschutzgründen entfernt.';
    if(!confirm(warn))return;
    try{
      clearTimeout(timer);
      if(!deleteAccount && ready && !paused){
        await push();
        const current=await fingerprint(snapshot());
        if(current!==lastHash){
          syncStatus('Noch nicht alle Änderungen gespeichert. Bitte später erneut abmelden.',true);
          return;
        }
      }
      if(!deleteAccount && (paused || !ready) &&
         !confirm('Die Cloud ist nicht synchronisiert. Trotzdem abmelden und lokale Änderungen verwerfen?'))return;
      ready=false;
      await accountFetch(deleteAccount?'delete':'logout',{method:'POST',body:'{}'});
      for(const key of KEYS){try{localStorage.removeItem(key)}catch{}}
      clearCloudMarks();
      location.reload();
    }catch(e){syncStatus(e.message,true);}
  }
  async function init(){
    showPanel();
    await refreshProviders();
    try{me=await accountFetch('me');}
    catch(e){status(e.message||'Anmeldung momentan nicht verfügbar.',true);return;}
    showPanel();
    if(me.authenticated)await reconcile();
  }
  pick('frameHeaderLogin')?.addEventListener('click',()=>{
    if(me?.authenticated){
      // The signed-in account controls already exist in "Mein Frame".
      switchView('taste');
      panel.scrollIntoView({behavior:'smooth',block:'start'});
    }else{
      toggleModal(true);
    }
  });
  document.querySelector('#frameAccountOpen')?.addEventListener('click',()=>toggleModal(true));
  document.querySelector('#frameAccountModalClose')?.addEventListener('click',()=>toggleModal(false));
  pick('frameAccountRetryProviders')?.addEventListener('click',()=>{void refreshProviders();});
  modal.addEventListener('click',e=>{if(e.target===modal)toggleModal(false);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden)toggleModal(false);});
  pick('frameAccountEmailLogin')?.addEventListener('click',()=>{
    show('frameAccountEmailStep',true);show('frameAccountCodeStep',false);
  });
  pick('frameAccountSendCode')?.addEventListener('click',async()=>{
    const email=pick('frameAccountEmailInput')?.value.trim()||'';
    text('frameAccountDialogMessage','Anmeldecode wird gesendet …');
    try{
      await accountFetch('email/start',{method:'POST',body:JSON.stringify({email})});
      show('frameAccountEmailStep',false);show('frameAccountCodeStep',true);
      text('frameAccountDialogMessage','Gib den sechsstelligen Code aus deiner E-Mail ein.');
    }catch(e){text('frameAccountDialogMessage',e.message);}
  });
  pick('frameAccountVerifyCode')?.addEventListener('click',async()=>{
    const email=pick('frameAccountEmailInput')?.value.trim()||'';
    const code=pick('frameAccountCodeInput')?.value.trim()||'';
    text('frameAccountDialogMessage','Code wird geprüft …');
    try{
      await accountFetch('email/verify',{method:'POST',body:JSON.stringify({email,code})});
      toggleModal(false);location.reload();
    }catch(e){text('frameAccountDialogMessage',e.message);}
  });
  pick('frameAccountDownload')?.addEventListener('click',async()=>{
    try{
      const data=me?.authenticated?(await accountFetch('sync')).data:snapshot();
      if(!data)throw Error('Noch keine Daten gesichert.');
      const blob=new Blob([JSON.stringify({type:'frame-cloud-backup',savedAt:new Date().toISOString(),data},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='FRAME-Backup-'+new Date().toISOString().slice(0,10)+'.json';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(e){syncStatus(e.message,true);}
  });
  pick('frameAccountUseCloud')?.addEventListener('click',()=>void chooseRemote());
  pick('frameAccountUseLocal')?.addEventListener('click',()=>void chooseLocal());
  pick('frameAccountSyncNow')?.addEventListener('click',()=>{
    // Never bypass a conflict and overwrite another device's data without consent.
    if(paused||!ready){void reconcile({allowAutomaticRestore:false});return;}
    void push();
  });
  pick('frameAccountLogout')?.addEventListener('click',()=>void logout(false));
  pick('frameAccountDelete')?.addEventListener('click',()=>void logout(true));
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&me?.authenticated&&!inflight)
      void reconcile({allowAutomaticRestore:false});
  });
  window.addEventListener('online',()=>{if(ready)queue();});
  window.FrameCloud={
    changed:queue,
    refresh:()=>reconcile({allowAutomaticRestore:false})
  };
  void init();
})();