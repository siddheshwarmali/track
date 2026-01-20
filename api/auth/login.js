
const bcrypt = require('bcryptjs');
const { json, readBody } = require('../_lib/http');
const { setSession } = require('../_lib/cookie');
const { ghGetFile, ghPutFileRetry, decodeContent } = require('../_lib/github');

const USERS_PATH = 'db/users.json';

async function loadUsers(){
  const f = await ghGetFile(USERS_PATH);
  if(!f.exists) return { exists:false, sha:null, users:{} };
  const data = JSON.parse(decodeContent(f) || '{"users":{}}');
  return { exists:true, sha:f.sha, users: data.users || {} };
}

async function ensureSeedAdmin(){
  const { exists, users } = await loadUsers();
  if (exists && users && users.admin) return;
  const pw = process.env.ADMIN_PASSWORD || 'admin123';
  const nextUsers = users || {};
  nextUsers.admin = { userId:'admin', passwordHash: bcrypt.hashSync(pw, 10), role:'admin', updatedAt: new Date().toISOString() };
  await ghPutFileRetry(USERS_PATH, JSON.stringify({ users: nextUsers }, null, 2), 'seed admin user');
}

module.exports = async (req, res) => {
  if(req.method !== 'POST') return json(res, 405, { error:'Method not allowed' });
  await ensureSeedAdmin();
  const body = await readBody(req);
  const userId = String(body.userId || '').trim();
  const password = String(body.password || '');
  if(!userId || !password) return json(res, 400, { error:'userId and password required' });

  const { users } = await loadUsers();
  const u = users[userId];
  if(!u) return json(res, 401, { error:'Invalid credentials' });
  if(!bcrypt.compareSync(password, u.passwordHash)) return json(res, 401, { error:'Invalid credentials' });

  setSession(res, { userId: u.userId, role: u.role });
  return json(res, 200, { ok:true, userId: u.userId, role: u.role });
};
