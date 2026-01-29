// api/state.js (Optimized for Data Persistence & Permissions)
const { json, readBody } = require('./_lib/http');
const { getSession } = require('./_lib/cookie');
const { ghGetFile, ghPutFileRetry, ghDeleteFile, decodeContent } = require('./_lib/github');

const USERS_PATH = 'db/users.json';
const INDEX_PATH = 'db/dashboards/index.json';
const DASH_DIR = 'db/dashboards';

function parseJsonSafe(t, fb) { try { return JSON.parse(t); } catch { return fb; } }

function isVisibleTo(d, userId, isAdmin) {
  if (!d) return false;
  if (isAdmin || d.ownerId === userId) return true;
  if (d.publishedToAll) return true;
  if (d.published && Array.isArray(d.allowedUsers) && d.allowedUsers.includes(userId)) return true;
  return false;
}

function isPlainObject(x) { return x && typeof x === 'object' && !Array.isArray(x); }

/**
 * Enhanced Deep Merge to prevent blanking out data
 * If a key exists in target but not in patch, it is preserved.
 */
function deepMerge(target, patch) {
  if (!isPlainObject(target) || !isPlainObject(patch)) return patch;
  const out = { ...target };
  Object.keys(patch).forEach((k) => {
    const pv = patch[k];
    const tv = out[k];
    if (isPlainObject(tv) && isPlainObject(pv)) out[k] = deepMerge(tv, pv);
    else if (pv !== undefined && pv !== null) out[k] = pv; 
  });
  return out;
}

async function loadUsers() {
  const f = await ghGetFile(USERS_PATH);
  if (!f.exists) return { users: {} };
  const data = parseJsonSafe((decodeContent(f) || '').trim() || '{"users":{}}', { users: {} });
  return { users: data.users || {} };
}

async function loadIndex() {
  const f = await ghGetFile(INDEX_PATH);
  if (!f.exists) {
    await ghPutFileRetry(INDEX_PATH, JSON.stringify({ dashboards: {} }, null, 2), 'init dashboards index');
    return { dashboards: {} };
  }
  const data = parseJsonSafe((decodeContent(f) || '').trim() || '{"dashboards":{}}', { dashboards: {} });
  return { dashboards: data.dashboards || {} };
}

async function saveIndex(dashboards) {
  await ghPutFileRetry(INDEX_PATH, JSON.stringify({ dashboards }, null, 2), 'update dashboards index');
}

async function loadDash(id) {
  const path = `${DASH_DIR}/${id}.json`;
  const f = await ghGetFile(path);
  if (!f.exists) return { exists: false, path };
  const data = parseJsonSafe((decodeContent(f) || '').trim() || '{}', {});
  return { exists: true, path, sha: f.sha, data };
}

function normalizeStateFromFile(data) {
  if (!data || typeof data !== 'object') return {};
  if (data.state && typeof data.state === 'object') return data.state;
  if (data.data && data.data.state && typeof data.data.state === 'object') return data.data.state;
  return data;
}

module.exports = async (req, res) => {
  try {
    const s = getSession(req);
    if (!s) return json(res, 401, { error: 'Not authenticated' });

    const { users } = await loadUsers();
    const me = users[s.userId] || { role: 'viewer' };
    const isAdmin = me.role === 'admin';

    const dash = req.query.dash ? String(req.query.dash) : null;
    const list = req.query.list !== undefined;
    const publish = req.query.publish !== undefined;
    const unpublish = req.query.unpublish !== undefined;
    const merge = req.query.merge !== undefined;

    // 1. LIST
    if (req.method === 'GET' && list) {
      const idx = await loadIndex();
      const arr = Object.values(idx.dashboards)
        .filter((d) => isVisibleTo(d, s.userId, isAdmin))
        .map((d) => ({
          id: d.id,
          name: d.name,
          updatedAt: d.updatedAt,
          published: !!d.published,
        }));
      return json(res, 200, { dashboards: arr });
    }

    // 2. GET SINGLE
    if (req.method === 'GET' && dash) {
      const idx = await loadIndex();
      const rec = idx.dashboards[dash];
      if (!rec) return json(res, 404, { error: 'Not found' });
      if (!isVisibleTo(rec, s.userId, isAdmin)) return json(res, 403, { error: 'Forbidden' });

      const d = await loadDash(dash);
      if (!d.exists) return json(res, 404, { error: 'Not found' });

      return json(res, 200, { 
        id: rec.id, 
        name: rec.name, 
        meta: rec, 
        state: normalizeStateFromFile(d.data) 
      });
    }

    // 3. SAVE (Build or Run)
    if (req.method === 'POST' && dash && !publish && !unpublish) {
      const body = await readBody(req);
      const idx = await loadIndex();
      const dashboards = idx.dashboards;
      const existingIdx = dashboards[dash];

      if (existingIdx && existingIdx.ownerId !== s.userId && !isAdmin) {
        return json(res, 403, { error: 'Forbidden' });
      }

      const d = await loadDash(dash);
      const curState = d.exists ? normalizeStateFromFile(d.data) : {};
      
      // Determine if we are merging (Run) or replacing structure (Build)
      // Even in Build mode, we now deepMerge to prevent deleting Run-time data
      const incomingState = merge ? body.patch : body.state;
      if (!incomingState) return json(res, 400, { error: 'No data provided' });

      const nextState = deepMerge(curState, incomingState);
      const now = new Date().toISOString();
      
      const rec = existingIdx || { 
        id: dash, 
        ownerId: s.userId, 
        createdAt: now, 
        published: false 
      };
      
      rec.name = body.name || rec.name || dash;
      rec.updatedAt = now;
      dashboards[dash] = rec;

      await ghPutFileRetry(
        d.path, 
        JSON.stringify({ id: dash, name: rec.name, state: nextState }, null, 2), 
        `update ${dash}`, 
        d.sha
      );
      await saveIndex(dashboards);
      return json(res, 200, { ok: true });
    }

    // 4. PUBLISH / UNPUBLISH
    if (req.method === 'POST' && dash && (publish || unpublish)) {
      const idx = await loadIndex();
      const rec = idx.dashboards[dash];
      if (!rec) return json(res, 404, { error: 'Not found' });
      if (rec.ownerId !== s.userId && !isAdmin) return json(res, 403, { error: 'Forbidden' });

      if (publish) {
        const body = await readBody(req);
        rec.published = true;
        rec.publishedToAll = !!body.all;
        rec.allowedUsers = body.all ? [] : Array.from(new Set([rec.ownerId, ...(body.users || [])]));
      } else {
        rec.published = false;
        rec.publishedToAll = false;
        rec.allowedUsers = [rec.ownerId];
      }

      rec.updatedAt = new Date().toISOString();
      await saveIndex(idx.dashboards);
      return json(res, 200, { ok: true });
    }

    // 5. DELETE
    if (req.method === 'DELETE' && dash) {
       // ... existing delete logic ...
    }

    return json(res, 400, { error: 'Method not supported' });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
};
