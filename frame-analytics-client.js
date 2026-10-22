// Optional, explicit analytics for FRAME beta. No tracking before opt-in.
// No analytics cookies, fingerprinting, IP addresses, or film IDs.
(()=>{
  'use strict';
  const CONSENT='frame-analytics-consent-v1', VISITOR='frame-analytics-visitor-v1';
  const allowed=new Set(['open','swipe','save','daily','personalized','framelog','match']);
  const read=k=>{try{return localStorage.getItem(k)}catch{return null;}};
  const put=(k,v)=>{try{localStorage.setItem(k,v);return true;}catch{return false;}};
  const valid=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||'');
  let id=null,active=false,pending={},timer=null,transmitting=false,lastInteraction=Date.now();
  function visitor(){
    let v=read(VISITOR);
    if(!valid(v)){v=crypto.randomUUID();if(!put(VISITOR,v))return null;}
    return v;
  }
  function send(){
    clearTimeout(timer);timer=null;
    if(!active||transmitting||!id||document.visibilityState!=='visible')return;
    const events=pending;pending={};transmitting=true;
    fetch('/api/analytics/track',{
      method:'POST',credentials:'same-origin',cache:'no-store',keepalive:true,
      headers:{'content-type':'application/json'},
      body:JSON.stringify({id,events})
    }).catch(()=>{}).finally(()=>{transmitting=false;if(Object.keys(pending).length)schedule();});
  }
  function schedule(){if(!timer)timer=setTimeout(send,3200);}
  function event(type){
    if(!active||!allowed.has(type))return;
    pending[type]=Math.min(40,(pending[type]||0)+1);
    schedule();
  }
  function begin(){
    if(active||read(CONSENT)!=='yes')return;
    id=visitor();if(!id)return;
    active=true;pending={};event('open');
  }
  function decide(yes){
    if(!put(CONSENT,yes?'yes':'no'))return;
    document.getElementById('frameAnalyticsPrompt')?.remove();
    if(yes){begin();return;}
    // Revoking consent immediately stops this tab and removes its server record.
    active=false;pending={};clearTimeout(timer);timer=null;
    const old=id||read(VISITOR);id=null;
    if(old&&valid(old)){
      fetch('/api/analytics/forget',{method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'content-type':'application/json'},body:JSON.stringify({id:old})}).catch(()=>{});
    }
    try{localStorage.removeItem(VISITOR);}catch{}
  }
  function consentUI(){
    if(read(CONSENT)==='yes'){begin();return;}
    if(read(CONSENT)==='no')return;
    const style=document.createElement('style');
    style.textContent=`
      #frameAnalyticsPrompt{position:fixed;z-index:1400;bottom:calc(78px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);
        width:min(calc(100% - 22px),490px);border:1px solid rgba(255,255,255,.16);border-radius:19px;
        box-shadow:0 18px 55px rgba(0,0,0,.64);background:#211c27;color:#f5eef2;padding:17px;font:13px/1.5 system-ui,sans-serif;}
      #frameAnalyticsPrompt strong{font-size:15px;display:block;margin-bottom:5px}
      #frameAnalyticsPrompt p{margin:0 0 12px;color:#d2c5d0}
      #frameAnalyticsPrompt a{color:#ffd1df}
      #frameAnalyticsPrompt .frame-stat-buttons{display:flex;gap:8px;flex-wrap:wrap}
      #frameAnalyticsPrompt button{flex:1;border-radius:11px;padding:11px 12px;font:700 12px/1.2 system-ui;min-width:116px;cursor:pointer}
      #frameAnalyticsYes{background:#f4bed1;color:#231823;border:0}
      #frameAnalyticsNo{color:#fff;background:#38303e;border:1px solid rgba(255,255,255,.15)}
      @media(min-width:850px){#frameAnalyticsPrompt{bottom:18px}}
    `;document.head.appendChild(style);
    const aside=document.createElement('aside');aside.id='frameAnalyticsPrompt';
    aside.setAttribute('aria-label','Optionale FRAME-Nutzungsstatistik');
    aside.innerHTML='<strong>FRAME gemeinsam verbessern?</strong><p>Mit deiner Erlaubnis zählen wir Besuche, Aktivitäten und zuletzt aktive Geräte für die Beta-Auswertung. Bei angemeldetem Konto ist auch deine E-Mail für den Betreiber sichtbar. Keine IP-Adresse, keine Filmhistorie. <a href="/datenschutz.html">Datenschutz</a></p><div class="frame-stat-buttons"><button type="button" id="frameAnalyticsNo">Nein, danke</button><button type="button" id="frameAnalyticsYes">Ja, erlauben</button></div>';
    document.body.appendChild(aside);
    aside.querySelector('#frameAnalyticsYes')?.addEventListener('click',()=>decide(true));
    aside.querySelector('#frameAnalyticsNo')?.addEventListener('click',()=>decide(false));
  }
  ['pointerdown','keydown'].forEach(name=>document.addEventListener(name,()=>{lastInteraction=Date.now();},{passive:true}));
  document.addEventListener('frame:swipe-recorded',ev=>{
    event('swipe');if(ev.detail?.action==='save')event('save');
  });
  document.addEventListener('frame:view-changed',ev=>{
    const target=ev.detail?.target;
    if(['daily','personalized','framelog','recommend'].includes(target)){
      event(target==='recommend'?'match':target);
    }
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&active){lastInteraction=Date.now();event('open');}
    else if(timer){ // Preserve queued event counts until the next visible period.
      clearTimeout(timer);timer=null;
    }
  });
  setInterval(()=>{
    if(active&&document.visibilityState==='visible'&&Date.now()-lastInteraction<5*60*1000)send();
  },60000);
  // A link appears in "Mein Frame" only after the SERVER has verified the owner session.
  fetch('/api/analytics/role',{credentials:'same-origin',cache:'no-store'})
    .then(r=>r.ok?r.json():null).then(r=>{
      if(!r?.admin)return;
      const panel=document.getElementById('frameAccountPanel');
      if(!panel||document.getElementById('frameAdminLink'))return;
      const a=document.createElement('a');
      a.id='frameAdminLink';a.href='/frame-admin.html';
      a.textContent='↗ FRAME Statistik & Admin';
      a.style.cssText='display:block;max-width:360px;margin:16px auto 4px;padding:13px;border:1px solid rgba(245,175,206,.32);border-radius:12px;text-align:center;color:#f9c9df;font:700 13px system-ui;text-decoration:none';
      panel.appendChild(a);
    }).catch(()=>{});
  consentUI();
  window.addEventListener('storage',event=>{
    if(event.key===CONSENT&&event.newValue!=='yes'){
      active=false;pending={};clearTimeout(timer);timer=null;id=null;
    }else if(event.key===CONSENT&&event.newValue==='yes')begin();
  });
  window.FrameAnalytics={consent:()=>read(CONSENT),allow:()=>decide(true),deny:()=>decide(false)};
})();
