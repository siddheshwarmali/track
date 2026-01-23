// api/state.js (updated)
// Fixes:
// 1) Admin checks were using s.role, but session usually contains only userId. Now we load users.json and compute role/permissions.
// 2) GET /api/state?dash=<id> now normalizes dashboard file shapes and returns state even for older storage formats.

const { json, readBody } = require('./_lib/http');
const { getSession } = require('./_lib/cookie');
const { ghGetFile, ghPutFileRetry, ghDeleteFile, decodeContent } = require('./_lib/github');

const USERS_PATH = 'db/users.json';
const INDEX_PATH = 'db/dashboards/index.json';
const DASH_DIR = 'db/dashboards';

function parseJsonSafe(t, fb) { try { return JSON.parse(t); } catch { return fb; } }

function isVisibleTo(d, userId) {
  if (!d) return false;
  if (d.ownerId === userId) return true;
  if (d.publishedToAll) return true;
  if (Array.isArray(d.allowedUsers) && d.allowedUsers.includes(userId)) return true;
  return false;
}

// Deep-merge helper for Run -> patch save without overwriting Build
function isPlainObject(x) { return x && typeof x === 'object' && !Array.isArray(x); }
function deepMerge(target, patch) {
  if (!isPlainObject(target) || !isPlainObject(patch)) return patch;
  const out = Object.assign({}, target);
  Object.keys(patch).forEach((k) => {
    const pv = patch[k];
    const tv = out[k];
    if (isPlainObject(tv) && isPlainObject(pv)) out[k] = deepMerge(tv, pv);
    else out[k] = pv; // arrays/primitives replace
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
  // Supports:
  //  A) { id, name, state: {...} }
  //  B) { data: { state: {...} } }
  //  C) direct state object {...}
  if (!data || typeof data !== 'object') return null;
  if (data.state && typeof data.state === 'object') return data.state;
  if (data.data && data.data.state && typeof data.data.state === 'object') return data.data.state;
  if (data.executive || data.headless || data.__meta) return data;
  return null;
}

module.exports = async (req, res) => {
  try {
    const s = getSession(req);
    if (!s) return json(res, 401, { error: 'Not authenticated' });

    // Load user role/permissions (session may not include role)
    const { users } = await loadUsers();
    const me = users[s.userId] || { role: 'viewer', permissions: {} };
    const isAdmin = me.role === 'admin';

    const dash = req.query.dash ? String(req.query.dash) : null;
    const list = req.query.list !== undefined;
    const publish = req.query.publish !== undefined;
    const unpublish = req.query.unpublish !== undefined;
    const merge = req.query.merge !== undefined;

    // List dashboards visible to this user
    if (req.method === 'GET' && list) {
      const idx = await loadIndex();
      const arr = Object.values(idx.dashboards)
        .filter((d) => isVisibleTo(d, s.userId))
        .map((d) => ({
          id: d.id,
          name: d.name,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          publishedAt: d.publishedAt || null,
          published: !!d.published,
        }));
      arr.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      return json(res, 200, { dashboards: arr });
    }

    // Get dashboard state (owner/allowed/published)
    if (req.method === 'GET' && dash) {
      const idx = await loadIndex();
      const rec = idx.dashboards[dash];
      if (!rec) return json(res, 404, { error: 'Not found' });
      if (!isVisibleTo(rec, s.userId) && !isAdmin) return json(res, 403, { error: 'Forbidden' });

      const d = await loadDash(dash);
      if (!d.exists) return json(res, 404, { error: 'Not found' });

      const meta = {
        ownerId: rec.ownerId,
        published: !!rec.published,
        publishedToAll: !!rec.publishedToAll,
        allowedUsers: rec.allowedUsers || [],
        publishedAt: rec.publishedAt || null,
      };

      const state = normalizeStateFromFile(d.data) || {};
      return json(res, 200, { id: rec.id, name: rec.name, meta, state });
    }

    // MERGE/PATCH save (Run uses this)
    if (req.method === 'POST' && dash && merge) {
      const body = await readBody(req);
      const patch = body.patch;
      if (!patch) return json(res, 400, { error: 'patch required' });

      const idx = await loadIndex();
      const dashboards = idx.dashboards;
      const existing = dashboards[dash];
      if (!existing) return json(res, 404, { error: 'Not found' });
      if (existing.ownerId !== s.userId && !isAdmin) return json(res, 403, { error: 'Forbidden' });

      const d = await loadDash(dash);
      if (!d.exists) return json(res, 404, { error: 'Not found' });

      const curState = normalizeStateFromFile(d.data) || {};
      const nextState = deepMerge(curState, patch);

      const now = new Date().toISOString();
      existing.updatedAt = now;
      dashboards[dash] = existing;

      const name = existing.name || dash;
      await ghPutFileRetry(
        d.path,
        JSON.stringify({ id: dash, name, state: nextState }, null, 2),
        `merge dashboard ${name}`,
        d.sha
      );
      await saveIndex(dashboards);
      return json(res, 200, { ok: true, mode: 'merge' });
    }

    // Full replace save (Build uses this)
    if (req.method === 'POST' && dash && !publish && !unpublish && !merge) {
      const body = await readBody(req);
      const state = body.state;
      const name = body.name || (state && state.__meta && state.__meta.name) || dash;
      if (!state) return json(res, 400, { error: 'state required' });

      const idx = await loadIndex();
      const dashboards = idx.dashboards;
      const existing = dashboards[dash];
      if (existing && existing.ownerId !== s.userId && !isAdmin) return json(res, 403, { error: 'Forbidden' });

      const now = new Date().toISOString();
      const rec = existing || { id: dash, ownerId: s.userId, createdAt: now, allowedUsers: [s.userId], published: false, publishedToAll: false };
      rec.id = dash;
      rec.name = name;
      rec.updatedAt = now;
      dashboards[dash] = rec;

      const path = `${DASH_DIR}/${dash}.json`;
      const f = await ghGetFile(path);
      const sha = f.exists ? f.sha : null;

      await ghPutFileRetry(path, JSON.stringify({ id: dash, name, state }, null, 2), `save dashboard ${name}`, sha);
      await saveIndex(dashboards);
      return json(res, 200, { ok: true, mode: 'replace' });
    }

    // Publish
    if (req.method === 'POST' && dash && publish) {
      const body = await readBody(req);
      const allFlag = !!body.all;
      const usersList = Array.isArray(body.users) ? body.users.map(String).filter(Boolean) : [];

      const idx = await loadIndex();
      const dashboards = idx.dashboards;
      const rec = dashboards[dash];
      if (!rec) return json(res, 404, { error: 'Not found' });
      if (rec.ownerId !== s.userId && !isAdmin) return json(res, 403, { error: 'Forbidden' });

      const now = new Date().toISOString();
      rec.published = true;
      rec.publishedToAll = allFlag;
      rec.allowedUsers = allFlag ? [rec.ownerId] : Array.from(new Set([rec.ownerId, ...usersList]));
      rec.publishedAt = now;
      rec.updatedAt = now;
      dashboards[dash] = rec;

      await saveIndex(dashboards);
      return json(res, 200, { ok: true });
    }

    // Unpublish
    if (req.method === 'POST' && dash && unpublish) {
      const idx = await loadIndex();
      const dashboards = idx.dashboards;
      const rec = dashboards[dash];
      if (!rec) return json(res, 404, { error: 'Not found' });
      if (rec.ownerId !== s.userId && !isAdmin) return json(res, 403, { error: 'Forbidden' });

      rec.published = false;
      rec.publishedToAll = false;
      rec.allowedUsers = [rec.ownerId];
      rec.updatedAt = new Date().toISOString();
      dashboards[dash] = rec;

      await saveIndex(dashboards);
      return json(res, 200, { ok: true });
    }

    // Delete
    if (req.method === 'DELETE' && dash) {
      const idx = await loadIndex();
      const dashboards = idx.dashboards;
      const rec = dashboards[dash];
      if (!rec) return json(res, 404, { error: 'Not found' });
      if (rec.ownerId !== s.userId && !isAdmin) return json(res, 403, { error: 'Forbidden' });

      const d = await loadDash(dash);
      if (d.exists) await ghDeleteFile(d.path, `delete dashboard ${dash}`, d.sha);
      delete dashboards[dash];
      await saveIndex(dashboards);
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { error: 'Bad request' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};
