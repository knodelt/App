// Optional, explicit analytics for FRAME beta. No tracking before opt-in.
// No analytics cookies, fingerprinting, IP addresses, or film IDs.
(()=>{
  'use strict';
  const CONSENT='frame-analytics-consent-v1', VISITOR='frame-analytics-visitor-v1';
  const allowed=new Set(['open','swipe','save','personalized','framelog','match','tonight']);
  const read=k=>{try{return localStorage.getItem(k)}catch{return null;}};
  const put=(k,v)=>{try{localStorage.setItem(k,v);return true;}catch{return false;}};
  const valid=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||'');
  let id=null,active=false,pending={},timer=null,transmitting=false,lastInteraction=Date.now();
  let consentWaiting=false,bannerReturnFocus=null,bannerPositionCleanup=null;
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
    const prompt=document.getElementById('frameAnalyticsPrompt');
    const restore=Boolean(prompt?.contains(document.activeElement));
    bannerPositionCleanup?.();
    bannerPositionCleanup=null;
    prompt?.remove();
    if(restore){
      try{
        const target=bannerReturnFocus?.isConnected?bannerReturnFocus:document.getElementById('brandButton');
        target?.focus({preventScroll:true});
      }catch{}
    }
    bannerReturnFocus=null;
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
    // On a first visit, the welcome tutorial is a modal dialog; do not
    // put an analytics consent banner on top or behind an inaccessible modal.
    if(window.FrameOnboardingPending){
      if(!consentWaiting){
        consentWaiting=true;
        document.addEventListener('frame:onboarding-finished',()=>{
          consentWaiting=false;consentUI();
        },{once:true});
      }
      return;
    }
    if(document.getElementById('frameAnalyticsPrompt'))return;
    const style=document.createElement('style');
    style.textContent=`
      #frameAnalyticsPrompt{position:fixed;z-index:1400;bottom:calc(98px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);
        width:min(calc(100% - 22px),490px);max-height:calc(100dvh - 120px - env(safe-area-inset-bottom));overflow-y:auto;
        border:1px solid rgba(255,255,255,.16);border-radius:19px;
        box-shadow:0 18px 55px rgba(0,0,0,.64);background:linear-gradient(145deg,#29202a,#17161b);
        color:#f5eef2;padding:20px;font:13px/1.5 var(--font-ui,system-ui),sans-serif;}
      #frameAnalyticsPrompt h2{font-size:17px;display:block;margin:0 0 8px;font-weight:800;line-height:1.35}
      #frameAnalyticsPrompt p{margin:0 0 12px;color:#d2c5d0}
      #frameAnalyticsPrompt .frame-stat-context{color:#f3e8ed;font-size:13px;line-height:1.55;margin-bottom:8px}
      #frameAnalyticsPrompt .frame-stat-privacy{color:#b9aab8;font-size:11px;line-height:1.55;margin-bottom:15px}
      #frameAnalyticsPrompt[aria-hidden="true"]{display:none!important}
      #frameAnalyticsPrompt button:focus-visible,
      #frameAnalyticsPrompt a:focus-visible{outline:3px solid #fff;outline-offset:3px}
      #frameAnalyticsPrompt a{color:#ffd1df}
      #frameAnalyticsPrompt .frame-stat-buttons{display:flex;gap:8px;flex-wrap:wrap}
      #frameAnalyticsPrompt button{flex:1;border-radius:11px;padding:11px 12px;font:700 12px/1.2 system-ui;min-width:116px;cursor:pointer}
      #frameAnalyticsYes{background:#f4bed1;color:#231823;border:0}
      #frameAnalyticsNo{color:#fff;background:#38303e;border:1px solid rgba(255,255,255,.15)}
    `;document.head.appendChild(style);
    const aside=document.createElement('aside');aside.id='frameAnalyticsPrompt';
    aside.setAttribute('role','dialog');
    aside.setAttribute('aria-modal','false');
    aside.setAttribute('aria-labelledby','frameAnalyticsHeading');
    aside.setAttribute('aria-describedby','frameAnalyticsContext frameAnalyticsCopy');
    aside.innerHTML='<h2 id="frameAnalyticsHeading">Hilfst du uns, FRAME besser zu machen?</h2><p class="frame-stat-context" id="frameAnalyticsContext">FRAME ist noch in der Beta. Damit wir die App dort verbessern, wo es wirklich hakt, möchten wir verstehen, welche Bereiche ihr ausprobiert.</p><p class="frame-stat-privacy" id="frameAnalyticsCopy">Nur wenn du zustimmst, zählen wir Besuche, Aktionen wie Swipes und zuletzt aktive Geräte. Bei einem angemeldeten Konto ist für den Betreiber auch deine E-Mail sichtbar. Wir erfassen keine IP-Adresse und keine Filmhistorie. <a href="/datenschutz.html">Mehr zum Datenschutz</a>.</p><div class="frame-stat-buttons"><button type="button" id="frameAnalyticsNo">Nein, danke</button><button type="button" id="frameAnalyticsYes">Ja, erlauben</button></div>';
    bannerReturnFocus=document.activeElement;
    document.body.appendChild(aside);
    // The bottom navigation can grow when labels wrap, and iOS safe areas
    // change its actual height. Measure its top edge rather than guessing
    // from viewport width; reserve a clear gap at every screen size.
    const alignBanner=()=>{
      if(!aside.isConnected)return;
      const nav=document.querySelector('.app-shell > nav.bottom-nav');
      if(!nav)return;
      const navTop=nav.getBoundingClientRect().top;
      const viewportHeight=window.innerHeight;
      if(!Number.isFinite(navTop))return;
      const reserve=Math.max(70,Math.ceil(viewportHeight-navTop+12));
      aside.style.bottom=reserve+'px';
      aside.style.maxHeight=Math.max(120,Math.floor(navTop-24))+'px';
    };
    alignBanner();
    window.addEventListener('resize',alignBanner,{passive:true});
    window.visualViewport?.addEventListener('resize',alignBanner,{passive:true});
    let navObserver=null;
    if(typeof ResizeObserver!=='undefined'){
      const nav=document.querySelector('.app-shell > nav.bottom-nav');
      if(nav){
        navObserver=new ResizeObserver(alignBanner);
        navObserver.observe(nav);
      }
    }
    bannerPositionCleanup=()=>{
      window.removeEventListener('resize',alignBanner);
      window.visualViewport?.removeEventListener('resize',alignBanner);
      navObserver?.disconnect();
    };
    aside.querySelector('#frameAnalyticsYes')?.addEventListener('click',()=>decide(true));
    aside.querySelector('#frameAnalyticsNo')?.addEventListener('click',()=>decide(false));
    aside.addEventListener('keydown',event=>{
      if(event.key==='Escape'){
        event.preventDefault();
        decide(false);
      }
    });
    if(window.FrameOnboardingActive){
      aside.inert=true;aside.setAttribute('aria-hidden','true');
    }else{
      requestAnimationFrame(()=>aside.querySelector('#frameAnalyticsNo')?.focus({preventScroll:true}));
    }
  }
  // Replay of the tutorial temporarily hides/inerts the optional prompt.
  document.addEventListener('frame:onboarding-modal',event=>{
    const banner=document.getElementById('frameAnalyticsPrompt');
    if(!banner)return;
    const covered=event.detail?.open===true;
    banner.inert=covered;
    if(covered)banner.setAttribute('aria-hidden','true');
    else banner.removeAttribute('aria-hidden');
  });
  ['pointerdown','keydown'].forEach(name=>document.addEventListener(name,()=>{lastInteraction=Date.now();},{passive:true}));
  document.addEventListener('frame:swipe-recorded',ev=>{
    event('swipe');if(ev.detail?.action==='save')event('save');
  });
  document.addEventListener('frame:view-changed',ev=>{
    const target=ev.detail?.target;
    if(['personalized','framelog','recommend','tonight'].includes(target)){
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
