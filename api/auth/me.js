const { json } = require('../_lib/http');
const { getSession } = require('../_lib/cookie');
const { ghGetFile, decodeContent } = require('../_lib/github');

const USERS_PATH = 'db/users.json';

async function loadUsers() {
  const f = await ghGetFile(USERS_PATH);
  if (!f.exists) return { users: {} };
  const data = JSON.parse(decodeContent(f) || '{"users":{}}');
  return { users: data.users || {} };
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
