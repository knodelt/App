// FRAME accounts: email one-time code, Google OAuth, Apple OAuth, private
// Durable Object storage. Credentials stay in Cloudflare Worker secrets.
// Do not expose AUTH_SECRET, RESEND_API_KEY, OAuth private keys, or session IDs.
const DAY=86400000, SESSION_DAYS=30, CODE_EXP_MS=10*60000;
const ALLOWED_KEYS=new Set([
  'frame-state','frame-taste-dna-v2','frame-online-learning-v1',
  'frame-recommendation-history-v1','frame-loop-v1','frame-loop-mode-v1',
  'frame-mood-v1','frame-recommendation-exclusions-v1'
]);
const json=(value,status=200,extra={})=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff',...extra}
});
const b64url=bytes=>{
  let s='';for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
const decodeB64=s=>{
  const x=s.replace(/-/g,'+').replace(/_/g,'/');const raw=atob(x+'='.repeat((4-x.length%4)%4));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
const rnd=(length=32)=>b64url(crypto.getRandomValues(new Uint8Array(length)));
const textBytes=s=>new TextEncoder().encode(s);
const hex=a=>[...a].map(b=>b.toString(16).padStart(2,'0')).join('');
async function hmac(value,secret) {
  const key=await crypto.subtle.importKey('raw',textBytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,textBytes(value)));
}
const equal=(a,b)=>{
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
  let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0;
};
const getCookie=(req,key)=>{
  const line=req.headers.get('cookie')||'';
  return line.split(';').map(x=>x.trim()).find(x=>x.startsWith(key+'='))?.slice(key.length+1)||'';
};
const sessionCookie=value=>'__Host-frame_session='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+30*86400;
const clearSession='__Host-frame_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
const oauthCookie=(value,age)=>'__Host-frame_oauth='+value+'; Path=/; HttpOnly; Secure; SameSite=None; Max-Age='+age;
const emailOK=v=>/^[^\s@]{1,100}@[^\s@]{1,190}\.[^\s@]{2,40}$/.test(v)&&v.length<=254;
const emailNormalize=v=>String(v||'').trim().toLowerCase();
const originOK=req=>{try{return new URL(req.headers.get('origin')).origin===new URL(req.url).origin;}catch{return false;}};
const accountID=async(email,env)=>hex(await hmac('account:'+email,env.AUTH_SECRET));
const object=(env,id)=>env.FRAME_ACCOUNTS.get(env.FRAME_ACCOUNTS.idFromName(id));
const restrictedBody=async(req,max=128*1024)=>{
  if(Number(req.headers.get('content-length')||0)>max)throw Error('TOO_LARGE');
  const raw=await req.text();if(raw.length>max)throw Error('TOO_LARGE');
  return JSON.parse(raw);
};
async function cmd(env,id,action,payload={}){
  const req=new Request('https://frame-account.internal/'+action,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(payload)
  });
  const res=await object(env,id).fetch(req);
  return {status:res.status,data:await res.json()};
}
async function session(req,env){
  const raw=getCookie(req,'__Host-frame_session').split('.');
  if(raw.length!==2||!/^[0-9a-f]{64}$/.test(raw[0])||!/^[A-Za-z0-9_-]{43}$/.test(raw[1]))return null;
  const result=await cmd(env,raw[0],'validate',{id:raw[1]});
  if(!result.data.ok)return null;
  return {accountId:raw[0],sid:raw[1],email:result.data.email};
}
async function issueSession(env,email,provider){
  const id=await accountID(email,env),sid=rnd();
  await cmd(env,id,'issue',{id:sid,email,provider,expiresAt:Date.now()+SESSION_DAYS*DAY});
  return sessionCookie(id+'.'+sid);
}
async function hashCode(env,accountId,code){
  return hex(await hmac('email-code:'+accountId+':'+code,env.AUTH_SECRET));
}
async function startEmail(req,env){
  if(!env.RESEND_API_KEY||!env.FRAME_EMAIL_FROM)return json({ok:false,error:'E-Mail-Versand ist noch nicht eingerichtet.'},503);
  const {email:input}=await restrictedBody(req,4096);
  const email=emailNormalize(input);
  if(!emailOK(email))return json({ok:false,error:'Bitte eine gültige E-Mail-Adresse eingeben.'},400);
  const id=await accountID(email,env);
  // Check rate limits before sending. Uniform generic response avoids account enumeration.
  const check=await cmd(env,id,'canCode');
  if(!check.data.ok)return json({ok:false,error:'Bitte später erneut versuchen.'},429);
  const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{'authorization':'Bearer '+env.RESEND_API_KEY,'content-type':'application/json'},
    body:JSON.stringify({from:env.FRAME_EMAIL_FROM,to:[email],subject:'Dein FRAME Anmeldecode',
      text:'Dein FRAME-Code lautet: '+code+'. Er gilt 10 Minuten. Falls du ihn nicht angefordert hast, kannst du diese Nachricht ignorieren.'})
  });
  if(!response.ok)return json({ok:false,error:'Der Code konnte nicht versendet werden.'},502);
  return json((await cmd(env,id,'startCode',{hash:await hashCode(env,id,code),
    expiresAt:Date.now()+CODE_EXP_MS})).data);
}
async function verifyEmail(req,env) {
  const data=await restrictedBody(req,4096);
  const email=emailNormalize(data.email),code=String(data.code||'').trim();
  if(!emailOK(email)||!/^\d{6}$/.test(code))return json({ok:false,error:'Ungültige Eingabe.'},400);
  const id=await accountID(email,env);
  const result=await cmd(env,id,'verifyCode',{hash:await hashCode(env,id,code)});
  if(!result.data.ok)return json({ok:false,error:'Code falsch oder abgelaufen.'},401);
  const cookie=await issueSession(env,email,'email');
  return json({ok:true,email},200,{'set-cookie':cookie});
}
async function exchangeOAuth(provider,code,redirectUri,verifier,env) {
  const google=provider==='google';
  const clientId=google?env.GOOGLE_CLIENT_ID:env.APPLE_CLIENT_ID;
  let secret=google?env.GOOGLE_CLIENT_SECRET:await appleClientSecret(env);
  const body=new URLSearchParams({client_id:clientId,client_secret:secret,code,
    grant_type:'authorization_code',redirect_uri:redirectUri});
  if(google)body.set('code_verifier',verifier);
  const result=await fetch(google?'https://oauth2.googleapis.com/token':'https://appleid.apple.com/auth/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  if(!result.ok)throw Error('OAUTH_TOKEN_EXCHANGE');
  const data=await result.json();
  if(!data.id_token)throw Error('MISSING_ID_TOKEN');
  return data.id_token;
}
async function appleClientSecret(env){
  if(!env.APPLE_PRIVATE_KEY||!env.APPLE_TEAM_ID||!env.APPLE_KEY_ID||!env.APPLE_CLIENT_ID)throw Error('APPLE_UNCONFIGURED');
  const pem=env.APPLE_PRIVATE_KEY.replace(/\\n/g,'\n')
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const pk=await crypto.subtle.importKey('pkcs8',decodeB64(pem),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const now=Math.floor(Date.now()/1000);
  const h=b64url(textBytes(JSON.stringify({alg:'ES256',kid:env.APPLE_KEY_ID,typ:'JWT'})));
  const p=b64url(textBytes(JSON.stringify({iss:env.APPLE_TEAM_ID,iat:now,exp:now+3600,
    aud:'https://appleid.apple.com',sub:env.APPLE_CLIENT_ID})));
  const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pk,textBytes(h+'.'+p));
  return h+'.'+p+'.'+b64url(new Uint8Array(sig));
}
async function verifyJWT(idToken,provider,clientId,nonce){
  const parts=String(idToken).split('.');
  if(parts.length!==3)throw Error('TOKEN_FORMAT');
  const header=JSON.parse(new TextDecoder().decode(decodeB64(parts[0])));
  const payload=JSON.parse(new TextDecoder().decode(decodeB64(parts[1])));
  const google=provider==='google',issuer=google?'https://accounts.google.com':'https://appleid.apple.com';
  if(header.alg!=='RS256'||typeof header.kid!=='string'||
    !(google?['accounts.google.com','https://accounts.google.com'].includes(payload.iss):payload.iss===issuer)||
    !(typeof payload.aud==='string'?payload.aud===clientId:Array.isArray(payload.aud)&&payload.aud.includes(clientId))||
    !Number.isFinite(payload.exp)||payload.exp*1000<Date.now()||
    !Number.isFinite(payload.iat)||payload.iat*1000>Date.now()+60000||
    !equal(String(payload.nonce||''),nonce)||
    !emailOK(emailNormalize(payload.email))||
    ![true,'true'].includes(payload.email_verified))throw Error('TOKEN_CLAIMS');
  const keysResponse=await fetch(google?'https://www.googleapis.com/oauth2/v3/certs':'https://appleid.apple.com/auth/keys');
  if(!keysResponse.ok)throw Error('JWKS_UNAVAILABLE');
  const jwks=await keysResponse.json();
  const jwk=(jwks.keys||[]).find(k=>k.kid===header.kid && k.kty==='RSA' && (!k.alg||k.alg==='RS256'));
  if(!jwk)throw Error('KEY_NOT_FOUND');
  const pub=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pub,decodeB64(parts[2]),textBytes(parts[0]+'.'+parts[1]));
  if(!valid)throw Error('INVALID_SIGNATURE');
  return emailNormalize(payload.email);
}
const sha256=async text=>new Uint8Array(await crypto.subtle.digest('SHA-256',textBytes(text)));
async function oauthStart(req,env,provider){
  const google=provider==='google';
  const clientId=google?env.GOOGLE_CLIENT_ID:env.APPLE_CLIENT_ID;
  if(!clientId||(google&&!env.GOOGLE_CLIENT_SECRET)||
      (!google&&(!env.APPLE_TEAM_ID||!env.APPLE_KEY_ID||!env.APPLE_PRIVATE_KEY)))
    return json({ok:false,error:'Dieser Login-Anbieter ist noch nicht eingerichtet.'},503);
  const state=rnd(),nonce=rnd(),verifier=rnd(48),exp=Date.now()+10*60000;
  const payload=b64url(textBytes(JSON.stringify({provider,state,nonce,verifier,exp})));
  const sig=b64url(await hmac(payload,env.AUTH_SECRET));
  const redirect=new URL('/api/account/oauth/'+provider+'/callback',req.url).toString();
  const url=new URL(google?'https://accounts.google.com/o/oauth2/v2/auth':'https://appleid.apple.com/auth/authorize');
  const params={client_id:clientId,redirect_uri:redirect,response_type:'code',scope:google?'openid email':'name email',
    state,nonce};
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  if(google){
    url.searchParams.set('code_challenge_method','S256');
    url.searchParams.set('code_challenge',b64url(await sha256(verifier)));
    url.searchParams.set('prompt','select_account');
  }else url.searchParams.set('response_mode','form_post');
  return new Response(null,{status:302,headers:{
    'location':url.toString(),'cache-control':'no-store','set-cookie':oauthCookie(payload+'.'+sig,600)
  }});
}
async function oauthCallback(req,env,provider){
  const cookie=getCookie(req,'__Host-frame_oauth');
  const parts=cookie.split('.');
  const clear=oauthCookie('',0);
  const fail=()=>new Response(null,{status:303,headers:{location:'/?frame_auth=failed','cache-control':'no-store','set-cookie':clear}});
  if(parts.length!==2||!equal(parts[1],b64url(await hmac(parts[0],env.AUTH_SECRET))))return fail();
  let config;
  try{config=JSON.parse(new TextDecoder().decode(decodeB64(parts[0])));}catch{return fail();}
  if(config.provider!==provider||config.exp<Date.now())return fail();
  let fields;
  try{
    fields=req.method==='POST'?Object.fromEntries(await req.formData()):Object.fromEntries(new URL(req.url).searchParams);
    if(!equal(String(fields.state||''),config.state)||!fields.code)return fail();
    const clientId=provider==='google'?env.GOOGLE_CLIENT_ID:env.APPLE_CLIENT_ID;
    const idToken=await exchangeOAuth(provider,String(fields.code),new URL('/api/account/oauth/'+provider+'/callback',req.url).toString(),config.verifier,env);
    const email=await verifyJWT(idToken,provider,clientId,config.nonce);
    const session=await issueSession(env,email,provider);
    // Response may carry two Set-Cookie headers; do not combine comma-separated values.
    const headers=new Headers({'location':'/?frame_auth=connected','cache-control':'no-store'});
    headers.append('set-cookie',clear);headers.append('set-cookie',session);
    return new Response(null,{status:303,headers});
  }catch(error){
    console.error('[FRAME AUTH] OAuth login failed:',String(error?.message||'unknown'));
    return fail();
  }
}
function validSyncData(data){
  if(!data||typeof data!=='object'||Array.isArray(data))return false;
  const keys=Object.keys(data);
  if(keys.length>ALLOWED_KEYS.size||keys.some(key=>!ALLOWED_KEYS.has(key)))return false;
  return keys.every(key=>typeof data[key]==='string'&&data[key].length<=650000);
}
export async function handleFrameAccount(request,env){
  const url=new URL(request.url),path=url.pathname.slice('/api/account/'.length);
  if(!env.FRAME_ACCOUNTS||!env.AUTH_SECRET||env.AUTH_SECRET.length<32)
    return json({ok:false,error:'Konten werden noch eingerichtet.'},503);
  try{
    if(path==='config'&&request.method==='GET')return json({ok:true,email:!!(env.RESEND_API_KEY&&env.FRAME_EMAIL_FROM),
      google:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),
      apple:!!(env.APPLE_CLIENT_ID&&env.APPLE_TEAM_ID&&env.APPLE_KEY_ID&&env.APPLE_PRIVATE_KEY)});
    if(path==='oauth/google/start'&&request.method==='GET')return oauthStart(request,env,'google');
    if(path==='oauth/apple/start'&&request.method==='GET')return oauthStart(request,env,'apple');
    if(path==='oauth/google/callback'&&['GET','POST'].includes(request.method))return oauthCallback(request,env,'google');
    if(path==='oauth/apple/callback'&&['GET','POST'].includes(request.method))return oauthCallback(request,env,'apple');
    if(request.method==='POST'&&!originOK(request))return json({ok:false,error:'Ungültige Anfrage.'},403);
    if(path==='email/start'&&request.method==='POST')return startEmail(request,env);
    if(path==='email/verify'&&request.method==='POST')return verifyEmail(request,env);
    const me=await session(request,env);
    if(path==='me'&&request.method==='GET'){
      if(!me)return json({ok:true,authenticated:false});
      const profile=await cmd(env,me.accountId,'info');
      return json({ok:true,authenticated:true,email:me.email,revision:profile.data.rev||0,
        hasCloudData:!!profile.data.hasCloudData});
    }
    if(!me)return json({ok:false,error:'Bitte anmelden.'},401);
    if(path==='sync'&&request.method==='GET'){
      const result=await cmd(env,me.accountId,'read');
      return json(result.data,result.status);
    }
    if(path==='sync'&&request.method==='PUT'){
      if(!originOK(request))return json({ok:false,error:'Ungültige Anfrage.'},403);
      const body=await restrictedBody(request,3*1024*1024);
      if(!validSyncData(body.data)||!Number.isSafeInteger(body.revision)||body.revision<0)
        return json({ok:false,error:'Ungültige Cloud-Daten.'},400);
      const result=await cmd(env,me.accountId,'write',{data:body.data,revision:body.revision});
      return json(result.data,result.status);
    }
    if(path==='logout'&&request.method==='POST'){
      await cmd(env,me.accountId,'revoke',{id:me.sid});
      return json({ok:true},200,{'set-cookie':clearSession});
    }
    if(path==='delete'&&request.method==='POST'){
      await cmd(env,me.accountId,'deleteAccount');
      return json({ok:true},200,{'set-cookie':clearSession});
    }
    return json({ok:false,error:'Nicht gefunden.'},404);
  }catch(e){
    if(e?.message==='TOO_LARGE')return json({ok:false,error:'Daten zu groß.'},413);
    console.error('[FRAME ACCOUNT]',String(e?.message||e));
    return json({ok:false,error:'Anfrage konnte nicht verarbeitet werden.'},500);
  }
}

export class FrameAccount {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async fetch(request){
    const action=new URL(request.url).pathname.slice(1);
    let p={};
    try{p=await request.json()}catch{return json({ok:false},400);}
    return this.ctx.storage.transaction(async txn=>{
      const now=Date.now();
      const data=await txn.get('account')||{email:null,rev:0,cloud:null,sessions:{},challenge:null,attempts:[],lastCodeAt:0};
      const out=(v,status=200)=>json(v,status);
      if(action==='canCode'){
        return out({ok: now-data.lastCodeAt>=60000 && data.attempts.filter(t=>now-t<3600000).length<5});
      }
      if(action==='startCode'){
        if(now-data.lastCodeAt<60000||data.attempts.filter(t=>now-t<3600000).length>=5)
          return out({ok:false,error:'Bitte später versuchen.'},429);
        data.challenge={hash:p.hash,expiresAt:p.expiresAt,tries:0};
        data.lastCodeAt=now;data.attempts=[...data.attempts.filter(t=>now-t<3600000),now];
        await txn.put('account',data);return out({ok:true});
      }
      if(action==='verifyCode'){
        const c=data.challenge;
        if(!c||c.expiresAt<now||c.tries>=5)return out({ok:false},401);
        c.tries++;
        const valid=equal(c.hash,p.hash);
        if(valid)data.challenge=null;
        await txn.put('account',data);
        return out({ok:valid},valid?200:401);
      }
      if(action==='issue'){
        data.email=p.email;
        data.sessions[p.id]={expiresAt:p.expiresAt,provider:p.provider};
        for(const [key,value] of Object.entries(data.sessions))if(value.expiresAt<now)delete data.sessions[key];
        await txn.put('account',data);
        return out({ok:true});
      }
      if(action==='validate'){
        const s=data.sessions[p.id];
        return out(s?.expiresAt>now && data.email?{ok:true,email:data.email}:{ok:false},s?.expiresAt>now?200:401);
      }
      if(action==='revoke'){
        delete data.sessions[p.id];await txn.put('account',data);return out({ok:true});
      }
      if(action==='info')return out({ok:true,rev:data.rev,hasCloudData:data.cloud!==null});
      if(action==='read')return out({ok:true,revision:data.rev,data:data.cloud});
      if(action==='write'){
        if(data.rev!==p.revision)return out({ok:false,conflict:true,revision:data.rev},409);
        data.rev++;
        data.cloud=p.data;
        await txn.put('account',data);
        return out({ok:true,revision:data.rev});
      }
      if(action==='deleteAccount'){
        await txn.delete('account');return out({ok:true});
      }
      return out({ok:false},404);
    });
  }
}
