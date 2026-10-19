// FRAME accounts: email one-time codes via Brevo and private Durable Object storage.
// AUTH_SECRET, BREVO_API_KEY and session identifiers stay server-side.
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
const emailOK=v=>/^[^\s@]{1,100}@[^\s@]{1,190}\.[^\s@]{2,40}$/.test(v)&&v.length<=254;
const emailNormalize=v=>String(v||'').trim().toLowerCase();
// Public, verified sender. Keep the dashboard variable in sync with wrangler.jsonc.
const frameSenderEmail=env=>String(env.FRAME_EMAIL_FROM||'login@framingapp.de').trim();
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
// HTML + plain-text email: compatible with Outlook, Gmail and iOS Mail.
// The code is copyable text; external image requests and webfonts are avoided.
function buildFrameLoginEmail(code){
  if(!/^\d{6}$/.test(code))throw Error('INVALID_EMAIL_CODE');
  const subject='Dein Anmeldecode für FRAME';
  const textContent=[
    'FRAME',
    '',
    'Dein Anmeldecode',
    '',
    code,
    '',
    'Gültig für 10 Minuten. Der Code kann nur einmal verwendet werden.',
    '',
    'Falls du diese Anmeldung nicht angefordert hast, kannst du die E-Mail ignorieren.',
    'Gib deinen Anmeldecode niemals an andere Personen weiter.',
    '',
    'FRAME · Filme. Serien. People.',
    'https://framingapp.de'
  ].join('\n');
  const htmlContent=String.raw`<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Dein Anmeldecode für FRAME</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f1f3;color:#251f27;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;font-size:1px;color:#f4f1f3;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Dein FRAME-Anmeldecode ist zehn Minuten gültig.</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#f4f1f3;">
    <tr><td align="center" style="padding:36px 16px 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;max-width:520px;background-color:#ffffff;border:1px solid #eae3e8;border-radius:20px;overflow:hidden;">
        <tr><td style="padding:28px 32px;background-color:#161319;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="center" valign="middle" style="width:44px;height:44px;border-radius:12px;background-color:#fa5275;color:#ffffff;font:bold 30px Georgia,'Times New Roman',serif;">F</td>
              <td valign="middle" style="padding-left:13px;">
                <div style="color:#ffffff;font:bold 19px Arial,Helvetica,sans-serif;letter-spacing:3px;line-height:25px;">FRAME</div>
                <div style="color:#c5b7c1;font:12px Arial,Helvetica,sans-serif;line-height:19px;">Filme · Serien · People</div>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:36px 32px 12px;">
          <p style="margin:0 0 12px;color:#cc476b;font:bold 11px Arial,Helvetica,sans-serif;letter-spacing:2px;">DEIN FRAME-KONTO</p>
          <h1 style="margin:0 0 14px;color:#241d26;font:bold 30px/1.15 Georgia,'Times New Roman',serif;">Dein Anmeldecode.</h1>
          <p style="margin:0;color:#635965;font:15px/1.65 Arial,Helvetica,sans-serif;">Schön, dass du da bist. Gib diesen Code in FRAME ein, um dich sicher anzumelden.</p>
        </td></tr>
        <tr><td style="padding:20px 32px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;background-color:#fcf3f6;border:1px solid #f3d9e2;border-radius:14px;">
            <tr><td align="center" style="padding:24px 12px 21px;">
              <div style="color:#8f5269;font:bold 11px Arial,Helvetica,sans-serif;letter-spacing:1.5px;">DEIN EINMAL-CODE</div>
              <div style="padding:10px 0 8px;color:#1c1820;font:bold 39px/1.2 'Courier New',Courier,monospace;letter-spacing:6px;white-space:nowrap;">${code}</div>
              <div style="color:#94687c;font:13px Arial,Helvetica,sans-serif;line-height:18px;">10 Minuten gültig · einmal verwendbar</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 32px 34px;">
          <p style="margin:0;color:#6f6570;font:13px/1.65 Arial,Helvetica,sans-serif;">Du hast keinen Code angefordert? Dann kannst du diese Nachricht einfach ignorieren.</p>
          <p style="margin:12px 0 0;color:#9c536a;font:12px/1.6 Arial,Helvetica,sans-serif;">Sicherheitshinweis: Gib deinen Anmeldecode niemals an andere Personen weiter.</p>
        </td></tr>
        <tr><td style="padding:19px 32px 22px;background-color:#fbf9fa;border-top:1px solid #f0e9ed;">
          <p style="margin:0;color:#8c818c;font:12px/1.6 Arial,Helvetica,sans-serif;">Automatisch gesendet von <strong>FRAME</strong><br><a href="https://framingapp.de" style="color:#a24e6b;text-decoration:none;">framingapp.de</a></p>
        </td></tr>
      </table>
      <p style="margin:17px 0 0;color:#9c919b;font:11px/1.5 Arial,Helvetica,sans-serif;">Diese Nachricht enthält einen vertraulichen Anmeldecode.</p>
    </td></tr>
  </table>
</body>
</html>`;
  return {subject,textContent,htmlContent};
}

async function startEmail(req,env){
  const senderEmail=frameSenderEmail(env);
  if(!env.BREVO_API_KEY||!emailOK(senderEmail))return json({ok:false,error:'E-Mail-Versand ist noch nicht eingerichtet.'},503);
  const {email:input}=await restrictedBody(req,4096);
  const email=emailNormalize(input);
  if(!emailOK(email))return json({ok:false,error:'Bitte eine gültige E-Mail-Adresse eingeben.'},400);
  const id=await accountID(email,env);
  // Check rate limits before sending. Uniform generic response avoids account enumeration.
  const check=await cmd(env,id,'canCode');
  if(!check.data.ok)return json({ok:false,error:'Bitte später erneut versuchen.'},429);
  const ip=String(req.headers.get('cf-connecting-ip')||'unknown');
  const ipKey=hex(await hmac('email-rate:'+ip,env.AUTH_SECRET));
  const quota=await cmd(env,ipKey,'ipQuota');
  if(!quota.data.ok)return json({ok:false,error:'Zu viele Anfragen. Bitte später versuchen.'},429);
  const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');
  const hash=await hashCode(env,id,code);
  const prepared=await cmd(env,id,'startCode',{hash,expiresAt:Date.now()+CODE_EXP_MS});
  if(!prepared.data.ok)return json({ok:false,error:'Bitte später erneut versuchen.'},429);
  // Brevo Transactional API works with Workers Free via ordinary HTTPS fetch.
  // No email credential is ever sent to the browser or committed to GitHub.
  let response;
  try{
    response=await fetch('https://api.brevo.com/v3/smtp/email',{
      method:'POST',
      headers:{'api-key':env.BREVO_API_KEY,'accept':'application/json',
        'content-type':'application/json'},
      body:JSON.stringify({
        sender:{name:'FRAME',email:senderEmail},
        to:[{email}],
        ...buildFrameLoginEmail(code)
      })
    });
  }catch(error){
    console.error('[FRAME AUTH] Brevo nicht erreichbar');
    await cmd(env,id,'cancelCode',{hash});
    return json({ok:false,error:'Der E-Mail-Versand ist momentan nicht erreichbar.'},502);
  }
  if(!response.ok){
    console.error('[FRAME AUTH] Brevo HTTP status',response.status);
    await cmd(env,id,'cancelCode',{hash});
    return json({ok:false,error:'Der Code konnte nicht versendet werden. Prüfe die Absenderfreigabe bei Brevo.'},502);
  }
  return json({ok:true});
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
    if(path==='config'&&request.method==='GET')
      return json({ok:true,email:!!(env.BREVO_API_KEY&&emailOK(frameSenderEmail(env)))});
    // Social sign-in has been removed by choice. Do not route old OAuth URLs.
    if(path.startsWith('oauth/'))return json({ok:false,error:'Nicht gefunden.'},404);
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
      if(action==='ipQuota'){
        data.ipAttempts=(data.ipAttempts||[]).filter(t=>now-t<3600000);
        if(data.ipAttempts.length>=12)return out({ok:false},429);
        data.ipAttempts.push(now);
        await txn.put('account',data);
        return out({ok:true});
      }
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
      if(action==='cancelCode'){
        if(data.challenge?.hash===p.hash){
          data.challenge=null;
          await txn.put('account',data);
        }
        return out({ok:true});
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
