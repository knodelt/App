(() => {
  'use strict';
  const KEYS=[
    'frame-state','frame-taste-dna-v2','frame-online-learning-v1',
    'frame-recommendation-history-v1',
    'frame-mood-v1','frame-recommendation-exclusions-v1','frame-tonight-v1'
  ];
  // Old cloud revisions may include retired Daily Frame keys; allow reading
  // them for migration but never restore, upload, or track them again.
  const LEGACY_KEYS=new Set(['frame-loop-v1','frame-loop-mode-v1']);
  const activeSnapshot=data=>Object.fromEntries(
    Object.entries(data||{}).filter(([key])=>KEYS.includes(key))
  );
  const OWNER='frame-cloud-owner-v1',HASH='frame-cloud-hash-v1',REV='frame-cloud-revision-v1';
  // Survives location.reload() but not a fresh browser session. Prevents a
  // cloud restore from triggering unbounded reloads on mobile browsers.
  const RESTORE_GUARD='frame-cloud-restore-reload-v2';
  // An imported backup may differ from cloud; never silently overwrite it.
  const IMPORT_PENDING='frame-cloud-import-pending-v1';
  // Account marker intentionally survives logout while local film data stays.
  // Prevents uploads to a different email account without explicit permission.
  const LAST_LOCAL_OWNER='frame-cloud-last-local-owner-v135';
  const panel=document.querySelector('#frameAccountPanel'),modal=document.querySelector('#frameAccountModal');
  if(!panel||!modal)return;
  const pick=id=>document.getElementById(id);
  const show=(id,on)=>{const n=pick(id);if(n)n.hidden=!on;};
  const text=(id,val)=>{const n=pick(id);if(n)n.textContent=val;};
  let me=null,revision=0,ready=false,inflight=false,paused=false,timer=null,changedDuring=false;
  let lastHash='',config={email:false},initSerial=0;
  let authGeneration=0,verifying=false,signingOut=false,deleteArmed=false;
  let sendingCode=false,resendAllowedAt=0,resendTimer=null;
  let cloudDecisionPending=null,choiceReturnFocus=null;
  let providerCheck=null,providerCheckId=0;
  let retryTimer=null,retryDelay=3000;
  const safeGet=key=>{try{return localStorage.getItem(key)}catch{return null}};
  const safeSet=(key,val)=>{try{localStorage.setItem(key,val)}catch{}};
  const sessionGet=key=>{try{return sessionStorage.getItem(key)}catch{return null}};
  const sessionSet=(key,val)=>{try{sessionStorage.setItem(key,val)}catch{}};
  const sessionClear=key=>{try{sessionStorage.removeItem(key)}catch{}};
  const accountFetch=async(path,options={})=>{
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const result=await fetch('/api/account/'+path,{
        credentials:'same-origin',cache:'no-store',signal:controller.signal,
        headers:{accept:'application/json',...(options.body?{'content-type':'application/json'}:{}),...options.headers},
        ...options
      });
      let data={};try{data=await result.json()}catch{}
      if(!result.ok)throw Object.assign(new Error(data.error||'Server nicht erreichbar.'),{status:result.status,data});
      return data;
    }catch(error){
      if(error.name==='AbortError')throw Error('Zeitüberschreitung. Bitte Verbindung prüfen.');
      throw error;
    }finally{clearTimeout(timeout);}
  };
  const snapshot=()=>{
    const values={};
    for(const key of KEYS){
      const value=safeGet(key);
      if(value!==null)values[key]=value;
    }
    return values;
  };
  const validSnapshot=items=>{
    if(!items||typeof items!=='object'||Array.isArray(items))return false;
    const keys=Object.keys(items);
    if(keys.some(key=>!KEYS.includes(key)&&!LEGACY_KEYS.has(key)))return false;
    return keys.every(key=>{
      const value=items[key];
      if(typeof value!=='string'||value.length>650000)return false;
      if(key==='frame-loop-mode-v1')return value==='user'||value==='partner';
      if(key==='frame-recommendation-exclusions-v1')return true;
      try{
        const parsed=JSON.parse(value);
        return parsed!==null&&typeof parsed==='object'&&!Array.isArray(parsed);
      }catch{return false;}
    });
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
      online=parse('frame-online-learning-v1'),history=parse('frame-recommendation-history-v1');
    return Object.keys(local.swipes||{}).length>0 ||
      (local.saved||[]).length>0 ||
      Object.keys(local.watched||{}).length>0 ||
      Object.keys(local.frameLogItems||{}).length>0 ||
      Object.keys(local.frameLogMeta||{}).length>0 ||
      Object.keys(dna.items||{}).length>0 ||
      (online.examples||[]).length>0 ||
      Object.keys(history||{}).length>0;
  };
  const status=(value,bad=false)=>{
    text('frameAccountStatus',value);
    pick('frameAccountStatus')?.classList.toggle('is-error',bad);
  };
  const syncStatus=(value,bad=false)=>{
    text('frameAccountSyncStatus',value);
    pick('frameAccountSyncStatus')?.classList.toggle('is-error',bad);
  };
  // Keep cloud decisions in the page instead of opening synchronous native
  // confirm dialogs immediately after login. These can appear as a frozen PWA.
  const conflictActions=(firstUpload=false)=>{
    const block=pick('frameAccountConflict');
    if(block)block.dataset.mode=firstUpload?'initial-upload':'conflict';
    show('frameAccountUseCloud',!firstUpload);
    show('frameAccountReload',!firstUpload);
    text('frameAccountUseLocal',firstUpload?
      'Meine Gerätedaten in FRAME Cloud sichern':
      'Daten dieses Geräts in die Cloud laden');
  };
  const defaultConflictMessage='Deine lokalen Daten und die Cloud unterscheiden sich. Sichere die Daten bei Bedarf und wähle dann bewusst, welche Version erhalten bleibt.';
  const choiceModal=pick('frameCloudChoiceModal');
  const closeCloudChoice=()=>{
    if(!choiceModal)return;
    choiceModal.hidden=true;
    cloudDecisionPending=null;
    if(choiceReturnFocus?.isConnected)try{choiceReturnFocus.focus({preventScroll:true});}catch{}
    choiceReturnFocus=null;
  };
  const openCloudChoice=(message,{emptyDevice=false,localOnly=false}={})=>{
    if(!choiceModal)return;
    if(choiceModal.hidden)choiceReturnFocus=document.activeElement;
    cloudDecisionPending=emptyDevice?'cloud-only':'conflict';
    text('frameCloudChoiceTitle',emptyDevice?'Deine gespeicherten Filme sind bereit.':'Zwei Filmstände. Bitte wählen.');
    text('frameCloudChoiceDescription',message);
    text('frameCloudChoiceStatus','');
    show('frameCloudChoiceLocal',!emptyDevice);
    show('frameCloudChoiceRemote',!localOnly);
    text('frameCloudChoiceLocal',localOnly?'Gerätedaten in dieses Konto übernehmen':'Gerätedaten statt Cloud verwenden');
    text('frameCloudChoiceRemote','Cloud-Daten auf dieses Gerät laden');
    choiceModal.hidden=false;
    requestAnimationFrame(()=>pick(emptyDevice?'frameCloudChoiceRemote':'frameCloudChoiceBackup')?.focus({preventScroll:true}));
  };
  const surfaceCloudConflict=(message,{emptyDevice=false,localOnly=false}={})=>{
    text('frameAccountConflictMessage',message);
    show('frameAccountConflict',true);
    openCloudChoice(message,{emptyDevice,localOnly});
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
    // FRAME supports email-code login only. A temporary configuration error
    // must never conceal its one working authentication option.
    show('frameAccountEmailLogin',true);
    const none=!config.email;
    const explain=state==='error'||(state==='ready'&&none);
    show('frameAccountProvidersDisabled',explain);
    show('frameAccountRetryProviders',explain&&state!=='loading');
    if(explain){
      text('frameAccountProvidersDisabled',
        message || 'E-Mail-Anmeldung gerade nicht erreichbar. Versuche es erneut.');
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
      window.FrameMoodSheet?.close?.();
      // A toast from the last swipe must not remain visible behind login.
      document.getElementById('toast')?.classList.remove('show');
      void refreshProviders();
    }
  };
  const clearCloudMarks=()=>{
    for(const key of [OWNER,HASH,REV,IMPORT_PENDING]){
      try{localStorage.removeItem(key)}catch{}
    }
    sessionClear(RESTORE_GUARD);
  };
  const retainMarks=(hash,rev)=>{
    safeSet(OWNER,me.email);safeSet(HASH,hash);safeSet(REV,String(rev));
    lastHash=hash;revision=rev;
  };
  const restoreLocal=(items)=>{
    if(!validSnapshot(items))throw Error('Die Cloud enthält beschädigte oder inkompatible Daten. Deine Gerätedaten wurden nicht verändert.');
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
    if(!validSnapshot(values))throw Object.assign(
      Error('Lokale Daten sind beschädigt. Bitte vor weiteren Schritten ein Geräte-Backup herunterladen.'),
      {status:400});
    const generation=authGeneration;
    const before=await fingerprint(values);
    const result=await accountFetch('sync',{method:'PUT',body:JSON.stringify({revision:rev,data:values})});
    if(generation!==authGeneration||!me?.authenticated)return null;
    retainMarks(before,result.revision);
    try{localStorage.removeItem(IMPORT_PENDING)}catch{}
    syncStatus('Synchronisiert · '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}));
    return before;
  }
  function scheduleRetry(){
    if(retryTimer||!ready||paused)return;
    retryTimer=setTimeout(()=>{
      retryTimer=null;
      if(ready&&!paused)void push();
    },retryDelay);
    retryDelay=Math.min(retryDelay*2,60000);
  }
  function clearRetry(){
    clearTimeout(retryTimer);
    retryTimer=null;retryDelay=3000;
  }
  function queue(){
    if(!ready||paused||!me?.authenticated)return;
    if(inflight){changedDuring=true;return;}
    clearTimeout(timer);
    clearTimeout(retryTimer);retryTimer=null;
    timer=setTimeout(()=>{void push();},1700);
    syncStatus('Änderungen werden gesichert …');
  }
  async function push(){
    if(!ready||paused||inflight||!me?.authenticated)return;
    inflight=true;
    try {
      const local=snapshot(),hash=await fingerprint(local);
      if(hash===lastHash){clearRetry();syncStatus('Alle Änderungen synchronisiert');return;}
      await upload(local,revision);
      clearRetry();
      if((await fingerprint(snapshot()))!==hash)changedDuring=true;
    }catch(e){
      if(e.status===409){
        clearRetry();
        paused=true;ready=false;
        syncStatus('Änderungen auf zwei Geräten erkannt. Bitte abgleichen.',true);
        show('frameAccountConflict',true);
      }else if(e.status===401){
        clearRetry();
        paused=true;ready=false;
        me={authenticated:false};
        showPanel();
        status('Deine Sitzung ist abgelaufen. Melde dich erneut an. Deine Gerätedaten bleiben erhalten.',true);
      }else if(e.status===400||e.status===413){
        clearRetry();
        paused=true;ready=false;
        syncStatus(e.message+' Lokale Daten bleiben erhalten.',true);
      }else{
        syncStatus('Offline oder Cloud nicht erreichbar. Lokale Änderungen bleiben erhalten; neuer Versuch folgt.',true);
        scheduleRetry();
      }
    }finally{
      inflight=false;
      if(changedDuring){
        changedDuring=false;
        if(ready&&!paused)queue();
      }
    }
  }
  async function reconcile({allowAutomaticRestore=true}={}){
    if(!me?.authenticated||inflight)return;
    clearTimeout(timer);
    clearRetry();
    const serial=++initSerial;
    ready=false;paused=true;
    conflictActions(false);
    text('frameAccountConflictMessage',defaultConflictMessage);
    syncStatus('Cloud-Daten werden geprüft …');
    try{
      const cloud=await accountFetch('sync');
      if(serial!==initSerial)return;
      const remote=activeSnapshot(cloud.data||{}),local=snapshot();
      const obsoleteCloudFields=Object.keys(cloud.data||{}).some(key=>LEGACY_KEYS.has(key));
      revision=cloud.revision;
      const [remoteHash,localHash]=await Promise.all([fingerprint(remote),fingerprint(local)]);
      const sameOwner=safeGet(OWNER)===me.email;
      const baseline=sameOwner?safeGet(HASH):null;
      if(serial!==initSerial)return;
      if(remoteHash===localHash){
        // Drop unused Daily Frame cloud fields once the remaining FRAME data
        // are identical. This is a metadata-only migration, not a film-history reset.
        if(obsoleteCloudFields){
          await upload(local,revision);
          if(serial!==initSerial||!me?.authenticated)return;
        }else retainMarks(remoteHash,revision);
        try{localStorage.removeItem(IMPORT_PENDING)}catch{}
        sessionClear(RESTORE_GUARD);
        paused=false;ready=true;
        syncStatus('Deine Daten sind synchronisiert.');
        show('frameAccountConflict',false);
        return;
      }
      if(safeGet(IMPORT_PENDING)==='1'){
        // Never overwrite a freshly imported backup without an explicit choice.
        const message='Dein importiertes Backup und die Cloud unterscheiden sich. Beide Stände bleiben erhalten, bis du ausdrücklich entscheidest.';
        syncStatus('Backup und Cloud müssen abgeglichen werden.',true);
        surfaceCloudConflict(message);
        return;
      }
      // A previous logout may have intentionally retained unsynced local
      // films from a DIFFERENT account. Never upload these to the new email
      // address without an explicit, visible decision.
      const lastOwner=safeGet(LAST_LOCAL_OWNER);
      const currentOwnerTag=lastOwner?await fingerprint({account:me.email}):null;
      if(serial!==initSerial)return;
      if(lastOwner && lastOwner!==currentOwnerTag && hasData(local)){
        syncStatus('Gerätedaten gehören zu einem anderen FRAME-Konto.',true);
        surfaceCloudConflict('Auf diesem Gerät liegen Filme aus einer anderen Anmeldung. Sie werden nicht automatisch in dieses Konto hochgeladen. Sichere die Gerätedaten und entscheide bewusst, ob sie hier übernommen werden sollen.',{localOnly:!cloud.data||!hasData(remote)});
        return;
      }
      if(!cloud.data || !hasData(remote)) {
        // Empty account OR account with no actual film history:
        // an earlier empty login may already have written harmless preferences.
        // First login into a genuinely empty account: copy the current device
        // snapshot directly. There is no remote data to overwrite, and the
        // user has chosen to sign into FRAME Cloud.
        const swipeCount=Object.keys((()=>{try{return JSON.parse(local['frame-state']||'{}').swipes||{}}catch{return {}}})()).length;
        syncStatus(swipeCount?swipeCount+' lokale Swipes werden sicher ins Konto übernommen …':'Deine Gerätedaten werden in FRAME Cloud gesichert …');
        const saved=await upload(local,revision);
        if(serial!==initSerial||saved===null)return;
        // Do not mark the device clean if a swipe happened during upload.
        ready=true;paused=false;show('frameAccountConflict',false);
        closeCloudChoice();
        if((await fingerprint(snapshot()))!==saved)queue();
        return;
      }
      if(!hasData(local) || (baseline===localHash && sameOwner)) {
        // A cloud restore must never cause an unsolicited page refresh after
        // the login flow. Present the explicit restore option instead.
        // Do not reload the site again if it has already restored this exact
        // cloud revision during the current browser tab session.
        const stamp=me.email+':'+revision+':'+remoteHash;
        if(!allowAutomaticRestore || sessionGet(RESTORE_GUARD)===stamp){
          paused=true;ready=false;
          syncStatus('Cloud-Daten gefunden. Gerätedaten werden nicht überschrieben.');
          surfaceCloudConflict(
            'Dein Konto enthält bereits Film- und Geschmacksdaten. Du kannst sie bewusst auf dieses Gerät laden. Bis dahin bleibt dein aktueller Stand erhalten.',
            {emptyDevice:!hasData(local)});
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
        if(serial!==initSerial||!me?.authenticated)return;
        ready=true;paused=false;show('frameAccountConflict',false);
        return;
      }
      // Both copies contain changes; never silently discard one.
      syncStatus('Deine lokalen Swipes sind noch nicht mit der Cloud zusammengeführt.',true);
      surfaceCloudConflict('Auf diesem Gerät und in der Cloud gibt es unterschiedliche Filmstände. Lade zuerst ein Geräte-Backup herunter. Du kannst dann entscheiden, welcher Stand übernommen werden soll.');
    }catch(e){
      if(serial!==initSerial)return;
      if(e.status===401){
        me={authenticated:false};
        showPanel();
        status('Die Anmeldung konnte nicht bestätigt werden. Bitte erneut anmelden. Deine Gerätedaten bleiben erhalten.',true);
      }else{
        syncStatus((e.message||'Cloud nicht erreichbar.')+' Deine lokalen Swipes bleiben auf diesem Gerät.',true);
        if(choiceModal&&!choiceModal.hidden)text('frameCloudChoiceStatus',e.message||'Cloud nicht erreichbar.');
      }
    }
  }
  async function chooseRemote(){
    // A destructive replacement needs two deliberate taps, never a native
    // confirm dialog that can lock a PWA behind its own overlay.
    if(hasData(snapshot())&&pick('frameCloudChoiceRemote')?.dataset.armed!=='yes'){
      const button=pick('frameCloudChoiceRemote');
      if(button){button.dataset.armed='yes';button.textContent='Wirklich Gerätedaten ersetzen? Erneut tippen';}
      text('frameCloudChoiceStatus','Achtung: Diese Auswahl ersetzt lokale, noch nicht synchronisierte Swipes. Erstelle vorher ein Geräte-Backup.');
      return;
    }
    const button=pick('frameCloudChoiceRemote');
    if(button)button.disabled=true;
    try{
      const generation=authGeneration;
      const cloud=await accountFetch('sync');
      if(generation!==authGeneration||!me?.authenticated)return;
      if(!cloud.data)throw Error('Noch keine Cloud-Daten vorhanden.');
      const current=activeSnapshot(cloud.data);
      const hash=await fingerprint(current);
      if(generation!==authGeneration||!me?.authenticated)return;
      restoreLocal(current);
      if(await fingerprint(snapshot())!==hash)
        throw Error('Cloud-Daten konnten nicht vollständig übernommen werden.');
      retainMarks(hash,cloud.revision);
      try{localStorage.removeItem(IMPORT_PENDING)}catch{}
      // This reload follows an explicit user choice, never an automatic loop.
      sessionSet(RESTORE_GUARD,me.email+':'+cloud.revision+':'+hash);
      closeCloudChoice();
      location.reload();
    }catch(e){syncStatus(e.message,true);text('frameCloudChoiceStatus',e.message);}
    finally{if(button){button.disabled=false;button.dataset.armed='';button.textContent='Cloud-Daten auf dieses Gerät laden';}}
  }
  async function chooseLocal(){
    if(!me?.authenticated)return;
    const button=pick('frameCloudChoiceLocal');
    // Existing cloud data can contain different swipes. Require a second tap
    // before replacing it; the first tap is only an on-screen warning.
    const initial=pick('frameAccountConflict')?.dataset.mode==='initial-upload';
    if(!initial && button && button.dataset.armed!=='yes'){
      button.dataset.armed='yes';
      button.textContent='Cloud wirklich ersetzen? Erneut tippen';
      text('frameCloudChoiceStatus','Achtung: Dieser Schritt ersetzt vorhandene Cloud-Daten. Sichere beide Versionen zuerst.');
      return;
    }
    if(button)button.disabled=true;
    try{
      const cloud=await accountFetch('sync');
      if(initial&&cloud.data && hasData(activeSnapshot(cloud.data)))throw Error('Dein Konto enthält inzwischen Cloud-Daten. Bitte erst vergleichen.');
      const hash=await upload(snapshot(),cloud.revision);
      if(hash===null)return;
      paused=false;ready=true;
      conflictActions(false);
      show('frameAccountConflict',false);
      closeCloudChoice();
      if(await fingerprint(snapshot())!==hash)queue();
    }catch(e){syncStatus(e.message,true);text('frameCloudChoiceStatus',e.message);}
    finally{if(button){button.disabled=false;button.dataset.armed='';button.textContent='Gerätedaten statt Cloud verwenden';}}
  }
  async function logout(deleteAccount=false){
    if(signingOut)return;
    const button=pick(deleteAccount?'frameAccountDelete':'frameAccountLogout');
    if(deleteAccount&&!deleteArmed){
      deleteArmed=true;
      if(button)button.textContent='Konto endgültig löschen? Erneut tippen';
      syncStatus('Kontolöschung entfernt die Cloud-Daten endgültig. Sichere sie vorher.',true);
      return;
    }
    signingOut=true;
    const wasReady=ready,wasPaused=paused;
    if(button){button.disabled=true;button.textContent=deleteAccount?'Konto wird gelöscht …':'Wird abgemeldet …';}
    try{
      // A logout must never be blocked by an unfinished initial upload or a
      // conflict. Never delete unsynchronised local data on ordinary sign-out.
      clearTimeout(timer);clearRetry();
      ready=false;paused=true;
      // Hashing an owner tag is best effort; it must never make a successful
      // server-side logout look like a failed logout.
      let signedOutOwner=null;
      if(!deleteAccount&&me?.email){
        try{signedOutOwner=await fingerprint({account:me.email});}catch{}
      }
      await accountFetch(deleteAccount?'delete':'logout',{method:'POST',body:'{}'});
      authGeneration++;initSerial++;
      if(signedOutOwner)safeSet(LAST_LOCAL_OWNER,signedOutOwner);
      if(deleteAccount)try{localStorage.removeItem(LAST_LOCAL_OWNER)}catch{}
      me={authenticated:false};
      inflight=false;changedDuring=false;
      clearCloudMarks();
      closeCloudChoice();
      if(deleteAccount){
        // Deleting a cloud account is explicitly destructive and confirmed
        // by the second tap; normal sign-out always keeps local films.
        for(const key of KEYS){try{localStorage.removeItem(key)}catch{}}
        location.reload();
      }else{
        showPanel();
        status('Abgemeldet. Deine lokalen Filme und Swipes bleiben auf diesem Gerät gespeichert.');
        syncStatus('Abgemeldet. Keine Cloud-Synchronisierung aktiv.');
      }
    }catch(e){
      ready=wasReady;paused=wasPaused;
      syncStatus('Abmelden fehlgeschlagen: '+(e.message||'Keine Verbindung')+'. Deine Gerätedaten bleiben erhalten.',true);
    }finally{
      signingOut=false;deleteArmed=false;
      if(button){button.disabled=false;button.textContent=deleteAccount?'Konto und Cloud-Daten löschen':'Abmelden';}
    }
  }
  async function init(){
    const generation=authGeneration;
    showPanel();
    // A slow initial /me request must not overwrite a newly completed login.
    void refreshProviders();
    let current;
    try{current=await accountFetch('me');}
    catch(e){
      if(generation===authGeneration)status(e.message||'Anmeldung momentan nicht verfügbar.',true);
      return;
    }
    if(generation!==authGeneration)return;
    me=current;
    showPanel();
    // Avoid an automatic restore/reload cycle on startup as well.
    if(me.authenticated)await reconcile({allowAutomaticRestore:false});
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
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape')return;
    if(choiceModal&&!choiceModal.hidden)closeCloudChoice();
    else if(!modal.hidden)toggleModal(false);
  });
  pick('frameAccountEmailLogin')?.addEventListener('click',()=>{
    show('frameAccountEmailStep',true);show('frameAccountCodeStep',false);
  });
  // The server allows one new code every 60 seconds (maximum five per hour).
  // Never resend automatically: it invalidates the previous code immediately.
  const updateResendButton=()=>{
    const button=pick('frameAccountResendCode');
    if(!button)return;
    if(resendTimer){clearTimeout(resendTimer);resendTimer=null;}
    const seconds=Math.max(0,Math.ceil((resendAllowedAt-Date.now())/1000));
    button.disabled=sendingCode||verifying||seconds>0;
    button.textContent=sendingCode?'Neuer Code wird gesendet …':
      seconds>0?'Code erneut senden · '+seconds+' s':'Code erneut senden';
    if(seconds>0)resendTimer=setTimeout(updateResendButton,Math.min(1000,seconds*1000));
  };
  const startCode=async(resend=false)=>{
    if(sendingCode||verifying||(resend&&Date.now()<resendAllowedAt))return;
    const email=pick('frameAccountEmailInput')?.value.trim()||'';
    const firstButton=pick('frameAccountSendCode');
    if(!email){text('frameAccountDialogMessage','Bitte zuerst deine E-Mail-Adresse eingeben.');return;}
    sendingCode=true;
    if(firstButton)firstButton.disabled=true;
    if(resend)updateResendButton();
    text('frameAccountDialogMessage',resend?'Neuer Code wird angefordert …':'Anmeldecode wird gesendet …');
    try{
      await accountFetch('email/start',{method:'POST',body:JSON.stringify({email})});
      resendAllowedAt=Date.now()+60000;
      const input=pick('frameAccountCodeInput');
      // A new code supersedes the old one. Clear only after the server confirms.
      if(input)input.value='';
      show('frameAccountEmailStep',false);
      show('frameAccountCodeStep',true);
      text('frameAccountDialogMessage',resend
        ? 'Neuer Code versendet. Der alte Code ist jetzt ungültig. Verwende bitte die neueste E-Mail.'
        : 'Code versendet. Gib den sechsstelligen Code ein. Nur der zuletzt angeforderte Code ist gültig.');
      updateResendButton();
    }catch(e){
      text('frameAccountDialogMessage',(e.message||'Code konnte nicht gesendet werden.')+
        (resend?' Prüfe die neueste E-Mail: Falls der Server bereits einen neuen Code erzeugt hat, kann der bisherige ungültig sein.':''));
    }finally{
      sendingCode=false;
      if(firstButton)firstButton.disabled=false;
      updateResendButton();
    }
  };
  pick('frameAccountSendCode')?.addEventListener('click',()=>void startCode(false));
  pick('frameAccountResendCode')?.addEventListener('click',()=>void startCode(true));
  pick('frameAccountVerifyCode')?.addEventListener('click',async()=>{
    if(verifying)return;
    const email=pick('frameAccountEmailInput')?.value.trim()||'';
    const code=pick('frameAccountCodeInput')?.value.trim()||'';
    const button=pick('frameAccountVerifyCode');
    verifying=true;
    if(button){button.disabled=true;button.textContent='Anmeldung läuft …';}
    updateResendButton();
    text('frameAccountDialogMessage','Code wird geprüft …');
    try{
      const verified=await accountFetch('email/verify',{method:'POST',body:JSON.stringify({email,code})});
      if(verified.ok!==true||!verified.email)throw Error('Der Login konnte nicht bestätigt werden.');
      // The server has issued the session cookie. Show the signed-in state
      // immediately rather than reloading the entire PWA.
      authGeneration++;
      initSerial++;
      clearTimeout(timer);clearRetry();
      me={authenticated:true,email:verified.email};
      ready=false;paused=true;
      toggleModal(false);
      showPanel();
      syncStatus('Anmeldung erfolgreich. Cloud-Daten werden geprüft …');
      try{
        switchView('taste');
        requestAnimationFrame(()=>panel.scrollIntoView({behavior:'auto',block:'nearest'}));
      }catch{}
      // No automatic restore or refresh: explicit cloud choices protect data.
      void reconcile({allowAutomaticRestore:false});
    }catch(e){
      text('frameAccountDialogMessage',e.message||'Anmeldung derzeit nicht möglich.');
    }finally{
      verifying=false;
      if(button){button.disabled=false;button.textContent='Anmelden';}
      updateResendButton();
    }
  });
  const downloadLocalBackup=()=>{
    try{
      // Include unsynced local edits; never replace these with a remote copy.
      const data=snapshot();
      const blob=new Blob([JSON.stringify({
        type:'frame-local-backup',version:1,
        savedAt:new Date().toISOString(),data
      },null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='FRAME-Geraete-Backup-'+new Date().toISOString().slice(0,10)+'.json';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      if(me?.authenticated)syncStatus('Geräte-Backup erstellt. Bewahre die Datei sicher auf.');
      else status('Geräte-Backup erstellt. Bewahre die Datei sicher auf.');
    }catch(e){syncStatus(e.message,true);}
  };
  pick('frameAccountDownload')?.addEventListener('click',downloadLocalBackup);
  pick('frameAccountDownloadGuest')?.addEventListener('click',downloadLocalBackup);
  const importFileInput=pick('frameAccountImportFile');
  const openImport=()=>{if(importFileInput){importFileInput.value='';importFileInput.click();}};
  pick('frameAccountImport')?.addEventListener('click',openImport);
  pick('frameAccountImportGuest')?.addEventListener('click',openImport);
  importFileInput?.addEventListener('change',async()=>{
    const file=importFileInput.files?.[0];
    if(!file)return;
    try{
      if(file.size>3*1024*1024)throw Error('Backup zu groß. Maximal 3 MB erlaubt.');
      const backup=JSON.parse(await file.text());
      if(!['frame-local-backup','frame-cloud-backup'].includes(backup?.type)||
         !validSnapshot(backup.data))throw Error('Keine gültige FRAME-Backup-Datei.');
      if(!confirm('Das Backup ersetzt die aktuellen Gerätedaten. Sichere vorher bei Bedarf deinen bisherigen Stand. Fortfahren?'))return;
      restoreLocal(backup.data);
      if(me?.authenticated)safeSet(IMPORT_PENDING,'1');
      clearRetry();
      location.reload();
    }catch(error){
      const message='Wiederherstellen fehlgeschlagen: '+(error?.message||'Ungültige Datei.');
      if(me?.authenticated)syncStatus(message,true);
      else status(message,true);
    }
  });
  pick('frameAccountReload')?.addEventListener('click',()=>location.reload());
  pick('frameAccountUseCloud')?.addEventListener('click',()=>{
    openCloudChoice('In der Cloud gibt es einen anderen Datenstand. Entscheide, ob du ihn auf dieses Gerät laden möchtest.',{emptyDevice:!hasData(snapshot())});
  });
  pick('frameAccountUseLocal')?.addEventListener('click',()=>{
    openCloudChoice('Deine lokalen Filme können einen älteren Cloud-Stand ersetzen. Bitte sichere sie vorher.');
  });
  pick('frameCloudChoiceLocal')?.addEventListener('click',()=>void chooseLocal());
  pick('frameCloudChoiceRemote')?.addEventListener('click',()=>void chooseRemote());
  pick('frameCloudChoiceBackup')?.addEventListener('click',()=>{
    downloadLocalBackup();
    text('frameCloudChoiceStatus','Das Geräte-Backup wurde angefordert. Bewahre die Datei sicher auf, bevor du Daten ersetzt.');
  });
  pick('frameCloudChoiceLater')?.addEventListener('click',()=>{
    closeCloudChoice();
    syncStatus('Deine Gerätedaten bleiben lokal erhalten. Über „Jetzt synchronisieren“ kannst du später entscheiden.');
  });
    pick('frameAccountSyncNow')?.addEventListener('click',()=>{
    // Never bypass a conflict and overwrite another device's data without consent.
    if(paused||!ready){void reconcile({allowAutomaticRestore:false});return;}
    void push();
  });
  pick('frameAccountLogout')?.addEventListener('click',()=>void logout(false));
  pick('frameAccountDelete')?.addEventListener('click',()=>void logout(true));
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState!=='visible'||!me?.authenticated||inflight)return;
    void (async()=>{
      // Pending local edits must be uploaded (with revision check) before
      // attempting a fresh cloud pull when returning to the app.
      if(ready&&!paused&&(await fingerprint(snapshot()))!==lastHash){
        await push();
        // If still dirty, the upload failed. Leave the offline retry running;
        // a cloud read must not interrupt it or mark local data as a conflict.
        if((await fingerprint(snapshot()))!==lastHash)return;
      }
      if(ready&&!paused&&!inflight)await reconcile({allowAutomaticRestore:false});
    })();
  });
  window.addEventListener('online',()=>{
    if(ready&&!paused){clearRetry();queue();}
    else if(me?.authenticated)void reconcile({allowAutomaticRestore:false});
  });
  // A second tab has its own in-memory state. Never let the older tab
  // overwrite newer data persisted by the other tab.
  window.addEventListener('storage',event=>{
    if(!me?.authenticated||event.storageArea!==localStorage||!KEYS.includes(event.key))return;
    clearTimeout(timer);clearRetry();
    paused=true;ready=false;
    syncStatus('FRAME wurde in einem anderen Tab geändert. Bitte die Seite neu laden.',true);
    text('frameAccountConflictMessage',
      'Ein anderer FRAME-Tab hat die Gerätedaten geändert. Lade diese Seite neu, bevor du weitere Änderungen speicherst.');
    show('frameAccountConflict',true);
  });
  window.FrameCloud={
    changed:queue,
    refresh:()=>reconcile({allowAutomaticRestore:false})
  };
  void init();
})();