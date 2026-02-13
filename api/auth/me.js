const { json } = require('../_lib/http');
const { getSession } = require('../_lib/cookie');
const { ghGetFile, decodeContent } = require('../_lib/github');

const USERS_PATH = 'db/users.json';

function parseJsonSafe(txt, fb) {
  try { return JSON.parse(txt); } catch { return fb; }
}

async function loadUsers() {
  try {
    const f = await ghGetFile(USERS_PATH);
    if (!f.exists) return { users: {} };
    const data = parseJsonSafe(decodeContent(f) || '{"users":{}}', { users: {} });
    return { users: data.users || {} };
  } catch (e) {
    console.error('[Auth] Error loading users in /me:', e);
    // Fallback to in-memory default admin if DB is unreachable
    return { 
      users: { 
        admin: { userId: 'admin', role: 'admin', permissions: { userManager: true } } 
      } 
    };
  }
}

module.exports = async (req, res) => {
  try {
    const session = getSession(req);
    if (!session) {
      return json(res, 200, { authenticated: false });
    }

    const { users } = await loadUsers();
    const user = users[session.userId];

    if (!user) {
      return json(res, 200, { authenticated: false });
    }

    return json(res, 200, {
      authenticated: true,
      userId: user.userId,
      role: user.role || 'viewer',
      permissions: user.permissions || {}
    });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
};
