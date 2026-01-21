
const bcrypt = require('bcryptjs');
const { json, readBody } = require('../_lib/http');
const { getSession } = require('../_lib/cookie');
const { ghGetFile, ghPutFileRetry, decodeContent } = require('../_lib/github');

const USERS_PATH = 'db/users.json';

async function load(){
  const f = await ghGetFile(USERS_PATH);
  if(!f.exists) return { users:{} };
  const data = JSON.parse((decodeContent(f) || '{"users":{}}') || '{"users":{}}');
  return { users: data.users || {} };
}

module.exports = async (req, res) => {
  try{
    const s = getSession(req);
    if(!s) return json(res, 401, { error:'Not authenticated' });

    const meFile = await ghGetFile(USERS_PATH);
    let meRole = s.role || 'viewer';
    let mePerms = {};
    if(meFile.exists){
      const all = JSON.parse((decodeContent(meFile) || '{"users":{}}') || '{"users":{}}');
      const u = (all.users||{})[s.userId];
      if(u){ meRole = u.role || meRole; mePerms = u.permissions || {}; }
    }
    const canManage = (meRole === 'admin') || !!mePerms.userManager;
    if(!canManage) return json(res, 403, { error:'Forbidden: User Manager access required' });

    if(req.method === 'GET'){
      const { users } = await load();
      return json(res, 200, { users: Object.values(users).map(u=>({ userId:u.userId, role:u.role, permissions:u.permissions||{}, updatedAt:u.updatedAt })) });
    }

    const body = await readBody(req);
    const { users } = await load();

    if(req.method === 'POST'){
      const userId = String(body.userId||'').trim();
      const password = String(body.password||'');
      const role = String(body.role||'viewer');
      const permissions = body.permissions && typeof body.permissions === 'object' ? body.permissions : {};
      if(!userId || !password) return json(res, 400, { error:'userId and password required' });
      users[userId] = { userId, passwordHash: bcrypt.hashSync(password, 10), role, permissions, updatedAt: new Date().toISOString() };
      await ghPutFileRetry(USERS_PATH, JSON.stringify({ users }, null, 2), `upsert user ${userId}`);
      return json(res, 200, { ok:true });
    }

    if(req.method === 'PUT'){
      const userId = String(body.userId||'').trim();
      if(!userId || !users[userId]) return json(res, 404, { error:'Not found' });
      if(body.role) users[userId].role = String(body.role);
      if(body.password) users[userId].passwordHash = bcrypt.hashSync(String(body.password), 10);
      if(body.permissions && typeof body.permissions === 'object') users[userId].permissions = body.permissions;
      users[userId].updatedAt = new Date().toISOString();
      await ghPutFileRetry(USERS_PATH, JSON.stringify({ users }, null, 2), `update user ${userId}`);
      return json(res, 200, { ok:true });
    }

    if(req.method === 'DELETE'){
      const userId = String(body.userId||'').trim();
      if(!userId || !users[userId]) return json(res, 404, { error:'Not found' });
      delete users[userId];
      await ghPutFileRetry(USERS_PATH, JSON.stringify({ users }, null, 2), `delete user ${userId}`);
      return json(res, 200, { ok:true });
    }

    return json(res, 405, { error:'Method not allowed' });
  } catch(e){
    return json(res, 500, { error: e.message || String(e) });
  }
};
