const crypto = require('crypto');
const COOKIE_NAME = 'execdash_session';
function must(name){ const v=process.env[name]; if(!v) throw new Error(`Missing env var: ${name}`); return v; }
function b64url(buf){ return Buffer.from(buf).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }
function sign(payload){ const secret=must('SESSION_SECRET'); const body=b64url(JSON.stringify(payload)); const sig=b64url(crypto.createHmac('sha256', secret).update(body).digest()); return `${body}.${sig}`; }
function verify(token){
  if(!token) return null;
  const secret=must('SESSION_SECRET');
  const [body,sig]=token.split('.');
  if(!body||!sig) return null;
  const expected=b64url(crypto.createHmac('sha256', secret).update(body).digest());
  if(expected!==sig) return null;
  try{
    const jsonStr = Buffer.from(body.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf-8');
    const payload = JSON.parse(jsonStr);
    if(payload && payload.exp && Date.now()>payload.exp) return null;
    return payload;
  }catch{ return null; }
}
function getCookie(req,name){
  const h=req.headers.cookie||'';
  for(const p of h.split(';').map(s=>s.trim())){
    const i=p.indexOf('=');
    if(i>0){ const k=p.slice(0,i); const v=p.slice(i+1); if(k===name) return decodeURIComponent(v); }
  }
  return null;
}
module.exports.getSession = (req)=> verify(getCookie(req, COOKIE_NAME));
module.exports.setSession = (res, {userId}, maxDays=7)=>{
  const exp = Date.now()+maxDays*86400*1000;
  const token = sign({ userId, exp });
  const secure = process.env.NODE_ENV === 'production';
  const cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxDays*86400}${secure?'; Secure':''}`;
  res.setHeader('Set-Cookie', cookie);
};
module.exports.clearSession = (res)=>{
  const secure = process.env.NODE_ENV === 'production';
  const cookie = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?'; Secure':''}`;
  res.setHeader('Set-Cookie', cookie);
};
