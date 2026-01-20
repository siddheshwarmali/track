
const bcrypt = require('bcryptjs');
const { json, readBody } = require('../_lib/http');
const { getSession } = require('../_lib/cookie');
const { ghGetFile, ghPutFileRetry, decodeContent } = require('../_lib/github');

const USERS_PATH = 'db/users.json';

async function load(){
  const f = await ghGetFile(USERS_PATH);
  if(!f.exists) return { users:{}, sha:null, exists:false };
  const data = JSON.parse(decodeContent(f) || '{"users":{}}');
  return { users: data.users || {}, sha:f.sha, exists:true };
}

module.exports = async (req, res) => {
  const s = getSession(req);
  if(!s) return json(res, 401, { error:'Not authenticated' });
  if(s.role !== 'admin') return json(res, 403, { error:'Forbidden: Admin only' });

  if(req.method === 'GET'){
    const { users } = await load();
    return json(res, 200, { users: Object.values(users).map(u=>({userId:u.userId, role:u.role, updatedAt:u.updatedAt})) });
  }

  const body = await readBody(req);
  const { users } = await load();

  if(req.method === 'POST'){
    const userId = String(body.userId||'').trim();
    const password = String(body.password||'');
    const role = String(body.role||'viewer');
    if(!userId || !password) return json(res, 400, { error:'userId and password required' });
    users[userId] = { userId, passwordHash: bcrypt.hashSync(password, 10), role, updatedAt: new Date().toISOString() };
    await ghPutFileRetry(USERS_PATH, JSON.stringify({ users }, null, 2), `upsert user ${userId}`);
    return json(res, 200, { ok:true });
  }

  if(req.method === 'PUT'){
    const userId = String(body.userId||'').trim();
    if(!userId || !users[userId]) return json(res, 404, { error:'Not found' });
    if(body.role) users[userId].role = String(body.role);
    if(body.password) users[userId].passwordHash = bcrypt.hashSync(String(body.password), 10);
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
};
