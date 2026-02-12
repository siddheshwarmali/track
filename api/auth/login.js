
const bcrypt = require('bcryptjs');
const { json, readBody } = require('../_lib/http');
const { setSession } = require('../_lib/cookie');
const { ghGetFile, ghPutFileRetry, decodeContent } = require('../_lib/github');
const { log } = require('../_lib/logger');

const USERS_PATH = 'db/users.json';

function parseJsonSafe(txt, fb) {
  try { return JSON.parse(txt); } catch { return fb; }
}

async function loadUsers(){
  const f = await ghGetFile(USERS_PATH);

  if (!f.exists) {
     // If file doesn't exist, create it with a default admin user
    const defaultUsers = { users: { admin: { userId: 'admin', role: 'admin', passwordHash: bcrypt.hashSync('admin', 10), permissions: { userManager: true } } } };
    await ghPutFileRetry(USERS_PATH, JSON.stringify(defaultUsers, null, 2), 'seed admin user');
    return { exists: true, sha: null, users: defaultUsers.users };
  }

  const data = parseJsonSafe((decodeContent(f) || '').trim() || '{"users":{}}', { users: {} });

  return { exists:true, sha:f.sha, users: data.users || {} };
}

async function ensureSeedAdmin(){
  const { exists, users } = await loadUsers();
  let valid = false;
  if (exists && users && users.admin && users.admin.passwordHash) {
    if (/^\$2[aby]\$/.test(users.admin.passwordHash)) valid = true;
  }
  if (valid) return;
  
  console.log('[Auth] Seeding admin user...');
  const pw = process.env.ADMIN_PASSWORD || 'admin';
  const nextUsers = users || {};
  const current = nextUsers.admin || {};
  nextUsers.admin = { 
    userId:'admin', role:'admin', permissions: { userManager: true }, ...current,
    passwordHash: bcrypt.hashSync(pw, 10), updatedAt: new Date().toISOString() 
  };
  await ghPutFileRetry(USERS_PATH, JSON.stringify({ users: nextUsers }, null, 2), 'seed admin user');
}

module.exports = async (req, res) => {
  if(req.method !== 'POST') {
    console.log(`[Auth] Invalid method ${req.method} for login`);
    return json(res, 405, { error:'Method not allowed' });
  }

  try {
    await ensureSeedAdmin();
    const body = await readBody(req);
    const userId = String(body.userId || '').trim();
    const password = String(body.password || '');
    if(!userId || !password) return json(res, 400, { error:'userId and password required' });

    const { users } = await loadUsers();
    const u = users[userId];
    if(!u) {
      console.log(`[Auth] Login failed: User ${userId} not found`);
      return json(res, 401, { error:'Invalid credentials' });
    }
    
    let isValid = false;
    try {
      if (u.passwordHash && bcrypt.compareSync(password, u.passwordHash)) isValid = true;
    } catch (err) {
      console.error(`[Auth] bcrypt error for user ${userId}:`, err.message);
    }
    if (!isValid) {
      console.log(`[Auth] Login failed: Password mismatch or missing hash for ${userId}`);
      return json(res, 401, { error: 'Invalid credentials' });
    }

    setSession(res, { userId: u.userId, role: u.role });
    log(u.userId, 'system', 'login', 'User logged in');
    return json(res, 200, { ok:true, userId: u.userId, role: u.role });
  } catch (e) {
    console.error('[Auth] Login error:', e);
    return json(res, 500, { error: e.message });
  }
};
