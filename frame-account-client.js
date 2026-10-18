(() => {
  'use strict';
  const KEYS=[
    'frame-state','frame-taste-dna-v2','frame-online-learning-v1',
    'frame-recommendation-history-v1','frame-loop-v1','frame-loop-mode-v1',
    'frame-mood-v1','frame-recommendation-exclusions-v1'
  ];
  const OWNER='frame-cloud-owner-v1',HASH='frame-cloud-hash-v1',REV='frame-cloud-revision-v1';
  const panel=document.querySelector('#frameAccountPanel'),modal=document.querySelector('#frameAccountModal');
  if(!panel||!modal)return;
  const pick=id=>document.getElementById(id);
  const show=(id,on)=>{const n=pick(id);if(n)n.hidden=!on;};
  const text=(id,val)=>{const n=pick(id);if(n)n.textContent=val;};
  let me=null,revision=0,ready=false,inflight=false,paused=false,timer=null,changedDuring=false;
  let lastHash='',lastSentHash='',config={email:false,google:false,apple:false},initSerial=0;
  const safeGet=key=>{try{return localStorage.getItem(key)}catch{return null}};
  const safeSet=(key,val)=>{try{localStorage.setItem(key,val)}catch{}};
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
    let local={};try{local=JSON.parse(s['frame-state']||'{}')}catch{}
    return Object.keys(local.swipes||{}).length>0 ||
      (local.saved||[]).length>0 ||
      Object.keys(local.watched||{}).length>0 ||
      Object.keys(s).some(k=>k!=='frame-state'&&k!=='frame-loop-mode-v1');
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
    if(!logged)status('Noch ohne Konto. Deine Daten bleiben auf diesem Gerät.');
    else status('Du bist angemeldet.');
  };
  const toggleModal=value=>{
    modal.hidden=!value;
    if(value)pick('frameAccountEmailInput')?.focus({preventScroll:true});
  };
  const clearCloudMarks=()=>{
    for(const key of [OWNER,HASH,REV]){
      try{localStorage.removeItem(key)}catch{}
    }
  };
  const retainMarks=(hash,rev)=>{
    safeSet(OWNER,me.email);safeSet(HASH,hash);safeSet(REV,String(rev));
    lastHash=hash;revision=rev;
  };
  const restoreLocal=(items)=>{
    if(!items||typeof items!=='object')throw Error('Ungültiger Cloud-Speicher');
    for(const key of KEYS){
      try{
        if(Object.prototype.hasOwnProperty.call(items,key))localStorage.setItem(key,items[key]);
        else localStorage.removeItem(key);
      }catch{throw Error('Nicht genug Browserspeicher. Cloud-Daten nicht vollständig übernommen.');}
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
      if((await fingerprint(snapshot()))!==hash || changedDuring){
        changedDuring=false;
        queue();
      }
    }catch(e){
      if(e.status===409){
        paused=true;ready=false;
        syncStatus('Änderungen auf zwei Geräten erkannt. Bitte abgleichen.',true);
        show('frameAccountConflict',true);
      }else syncStatus(e.message||'Cloud-Speicherung fehlgeschlagen. Erneut versuchen.',true);
    }finally{inflight=false;}
  }
  async function reconcile(){
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
      if(baseline===localHash && sameOwner) {
        // Local copy was unmodified since the previous save: cloud may safely win.
        restoreLocal(remote);
        retainMarks(remoteHash,revision);
        location.reload();return;
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
      restoreLocal(cloud.data);
      const hash=await fingerprint(cloud.data);
      retainMarks(hash,cloud.revision);
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
      ready=false;clearTimeout(timer);
      await accountFetch(deleteAccount?'delete':'logout',{method:'POST',body:'{}'});
      for(const key of KEYS){try{localStorage.removeItem(key)}catch{}}
      clearCloudMarks();
      location.reload();
    }catch(e){syncStatus(e.message,true);}
  }
  async function init(){
    showPanel();
    try{config=await accountFetch('config');}
    catch{config={email:false,google:false,apple:false};}
    show('frameAccountEmailLogin',Boolean(config.email));
    show('frameAccountGoogle',Boolean(config.google));
    show('frameAccountApple',Boolean(config.apple));
    show('frameAccountProvidersDisabled',!config.email&&!config.google&&!config.apple);
    try{me=await accountFetch('me');}
    catch(e){status(e.message||'Anmeldung momentan nicht verfügbar.',true);return;}
    showPanel();
    if(me.authenticated)await reconcile();
  }
  document.querySelector('#frameAccountOpen')?.addEventListener('click',()=>toggleModal(true));
  document.querySelector('#frameAccountModalClose')?.addEventListener('click',()=>toggleModal(false));
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
  for(const provider of ['Google','Apple']){
    pick('frameAccount'+provider)?.addEventListener('click',()=>{
      location.assign('/api/account/oauth/'+provider.toLowerCase()+'/start');
    });
  }
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
  pick('frameAccountSyncNow')?.addEventListener('click',()=>{paused=false;ready=true;void push();});
  pick('frameAccountLogout')?.addEventListener('click',()=>void logout(false));
  pick('frameAccountDelete')?.addEventListener('click',()=>void logout(true));
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&me?.authenticated&&!inflight)void reconcile();
  });
  window.addEventListener('online',()=>{if(ready)queue();});
  window.FrameCloud={changed:queue,refresh:reconcile};
  void init();
})();