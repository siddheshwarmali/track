const bcrypt = require('bcryptjs');
const { json, readBody } = require('../_lib/http');
const { getSession } = require('../_lib/cookie');
const { ghGetFile, ghPutFileRetry, decodeContent } = require('../_lib/github');
const USERS_PATH='db/users.json';
function parseJsonSafe(txt,fb){ try{return JSON.parse(txt);}catch{return fb;} }
async function loadAll(){
  const f=await ghGetFile(USERS_PATH);
  if(!f.exists) return {users:{}};
  const data=parseJsonSafe((decodeContent(f)||'').trim()||'{"users":{}}',{users:{}});
  return { users:data.users||{} };
}
function canManage(me){ return me && (me.role==='admin' || (me.permissions&&me.permissions.userManager)); }
module.exports=async(req,res)=>{
  try{
    const sess=getSession(req);
    if(!sess) return json(res,401,{error:'Not authenticated'});
    const all=await loadAll();
    const me=all.users[sess.userId] || { role:'viewer', permissions:{} };
    if(!canManage(me)) return json(res,403,{error:'Forbidden: User Manager access required'});

    if(req.method==='GET'){
      return json(res,200,{ users: Object.values(all.users).map(u=>({ userId:u.userId, role:u.role, permissions:u.permissions||{}, updatedAt:u.updatedAt })) });
    }

    const body=await readBody(req);

    if(req.method==='POST'){
      const userId=String(body.userId||'').trim();
      const password=String(body.password||'');
      const role=String(body.role||'viewer');
      const permissions=(body.permissions&&typeof body.permissions==='object')?body.permissions:{};
      if(!userId||!password) return json(res,400,{error:'userId and password required'});
      all.users[userId] = { userId, passwordHash:bcrypt.hashSync(password,10), role, permissions, updatedAt:new Date().toISOString() };
      await ghPutFileRetry(USERS_PATH, JSON.stringify({users:all.users},null,2), `upsert user ${userId}`);
      return json(res,200,{ok:true});
    }

    if(req.method==='PUT'){
      const userId=String(body.userId||'').trim();
      if(!userId||!all.users[userId]) return json(res,404,{error:'Not found'});
      if(body.role) all.users[userId].role=String(body.role);
      if(body.password) all.users[userId].passwordHash=bcrypt.hashSync(String(body.password),10);
      if(body.permissions && typeof body.permissions==='object') all.users[userId].permissions=body.permissions;
      all.users[userId].updatedAt=new Date().toISOString();
      await ghPutFileRetry(USERS_PATH, JSON.stringify({users:all.users},null,2), `update user ${userId}`);
      return json(res,200,{ok:true});
    }

    if(req.method==='DELETE'){
      const userId=String(body.userId||'').trim();
      if(!userId||!all.users[userId]) return json(res,404,{error:'Not found'});
      delete all.users[userId];
      await ghPutFileRetry(USERS_PATH, JSON.stringify({users:all.users},null,2), `delete user ${userId}`);
      return json(res,200,{ok:true});
    }

    return json(res,405,{error:'Method not allowed'});
  }catch(e){ return json(res,500,{error:e.message||String(e)}); }
};
