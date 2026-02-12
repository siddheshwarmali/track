// d:\My Project\CycleCipher-main\api\logs.js
const fs = require('fs');
const path = require('path');
const { json } = require('./_lib/http');
const { getSession } = require('./_lib/cookie');
const { log } = require('./_lib/logger');
const { ghGetFile, decodeContent } = require('./_lib/github');

const USERS_PATH = 'db/users.json';

function parseJsonSafe(txt, fb) {
  try { return JSON.parse(txt); } catch { return fb; }
}

async function loadUsers() {
  const f = await ghGetFile(USERS_PATH);
  if (!f.exists) return { users: {} };
  const data = parseJsonSafe((decodeContent(f) || '').trim() || '{"users":{}}', { users: {} });
  return { users: data.users || {} };
}

// Helper to get week number (duplicated to avoid complex dependency chains if _lib is moved)
function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d - yearStart) / 86400000) + 1)/7);
}

module.exports = async (req, res) => {
  try {
    const s = getSession(req);
    if (!s) return json(res, 401, { error: 'Not authenticated' });


    const { users } = await loadUsers();
    const me = users[s.userId];

    // Only admins can view logs
    if (!me || me.role !== 'admin') {
      return json(res, 403, { error: 'Forbidden: Admin access required' });
    }

    const dbRoot = process.env.LOCAL_DB_ROOT || path.join(__dirname, '../');
    const logsDir = path.join(dbRoot, 'db', 'logs');

    if (req.method === 'GET') {
      // Determine which file to read. Default to current week.
      let year = new Date().getFullYear();
      let week = getWeekNumber(new Date());

      if (req.query.week) {
        // Format YYYY-Www
        const parts = req.query.week.split('-W');
        if (parts.length === 2) {
          year = parseInt(parts[0]);
          week = parseInt(parts[1]);
        }
      }

      const filename = `log_${year}_week${week}.jsonl`;
      const filePath = path.join(logsDir, filename);

      if (!fs.existsSync(filePath)) {
        return json(res, 200, { logs: [], meta: { file: filename, found: false } });
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      const logs = lines.map(line => {
        try { return JSON.parse(line); } catch (e) { return null; }
      }).filter(x => x).reverse(); // Newest first

      return json(res, 200, { logs, meta: { file: filename, found: true } });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
};
