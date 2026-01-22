
// api/state.js
const { json, readBody } = require('./_lib/http');
const { getSession } = require('./_lib/cookie');
const { ghGetFile, ghPutFileRetry, ghDeleteFile, decodeContent } = require('./_lib/github');

const INDEX_PATH = 'db/dashboards/index.json';
const DASH_DIR = 'db/dashboards';

function parseJsonSafe(t, fb) { try { return JSON.parse(t); } catch (e) { return fb; } }

function isVisibleTo(d, userId) {
  if (!d) return false;
  if (d.ownerId === userId) return true;
  if (d.publishedToAll) return true;
  if (Array.isArray(d.allowedUsers) && d.allowedUsers.includes(userId)) return true;
  return false;
}

// ✅ Deep merge helper so Run can patch part of state without destroying Build
function isPlainObject(x) {
  return x && typeof x === 'object' && !Array.isArray(x);
}
function deepMerge(target, patch) {
  if (!isPlainObject(target) || !isPlainObject(patch)) return patch;
  const out = Object.assign({}, target);
  Object.keys(patch).forEach((k) => {
    const pv = patch[k];
    const tv = out[k];
    if (isPlainObject(tv) && isPlainObject(pv)) out[k] = deepMerge(tv, pv);
    else out[k] = pv; // arrays and primitives replace
  });
  return out;
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

module.exports = async (req, res) => {
  try {
    const s = getSession(req);
    if (!s) return json(res, 401, { error: 'Not authenticated' });

    const dash = req.query.dash ? String(req.query.dash) : null;
    const list = req.query.list !== undefined;
    const publish = req.query.publish !== undefined;
    const unpublish = req.query.unpublish !== undefined;

    // ✅ NEW: merge mode flag
    const merge = req.query.merge !== undefined;

    // LIST
    if (req.method === 'GET' && list) {
      const idx = await loadIndex();
      const arr = Object.values(idx.dashboards)
        .filter((d) => isVisibleTo(d, s.userId))
        .map((d) => ({
          id: d.id,
          name: d.name,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          publishedAt: d.publishedAt || null
        }));
      arr.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      return json(res, 200, { dashboards: arr });
    }

    // GET DASH
    if (req.method === 'GET' && dash) {
      const idx = await loadIndex();
      const rec = idx.dashboards[dash];
      if (!rec) return json(res, 404, { error: 'Not found' });
      if (!isVisibleTo(rec, s.userId)) return json(res, 403, { error: 'Forbidden' });

      const d = await loadDash(dash);
      if (!d.exists) return json(res, 404, { error: 'Not found' });

      const meta = {
        ownerId: rec.ownerId,
        published: !!rec.published,
        publishedToAll: !!rec.publishedToAll,
        allowedUsers: rec.allowedUsers || [],
        publishedAt: rec.publishedAt || null
      };
      return json(res, 200, { id: rec.id, name: rec.name, meta, state: d.data.state });
    }

    // SAVE FULL STATE (existing behavior)
    if (req.method === 'POST' && dash && !publish && !unpublish && !merge) {
      const body = await readBody(req);
      const state = body.state;
      const name = body.name || (state && state.__meta && state.__meta.name) || dash;
      if (!state) return json(res, 400, { error: 'state required' });

      const idx = await loadIndex();
      const dashboards = idx.dashboards;
      const existing = dashboards[dash];

      if (existing && existing.ownerId !== s.userId && s.role !== 'admin')
        return json(res, 403, { error: 'Forbidden' });

      const now = new Date().toISOString();
      const rec = existing || {
        id: dash,
        ownerId: s.userId,
        createdAt: now,
        allowedUsers: [s.userId],
        published: false,
        publishedToAll: false
      };

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

    // ✅ NEW: MERGE/PATCH SAVE (for Run page partial updates)
    if (req.method === 'POST' && dash && merge) {
      const body = await readBody(req);
      const patch = body.patch;
      if (!patch) return json(res, 400, { error: 'patch required' });

      const idx = await loadIndex();
      const dashboards = idx.dashboards;
      const existing = dashboards[dash];
      if (!existing) return json(res, 404, { error: 'Not found' });

      // Only owner or admin can patch
      if (existing.ownerId !== s.userId && s.role !== 'admin')
        return json(res, 403, { error: 'Forbidden' });

      // Load current state file
      const d = await loadDash(dash);
      if (!d.exists) return json(res, 404, { error: 'Not found' });

      const curState = d.data.state || {};
      const nextState = deepMerge(curState, patch);

      const name = existing.name || dash;
      const now = new Date().toISOString();
      existing.updatedAt = now;
      dashboards[dash] = existing;

      await ghPutFileRetry(d.path, JSON.stringify({ id: dash, name, state: nextState }, null, 2), `merge dashboard ${name}`, d.sha);
      await saveIndex(dashboards);
      return json(res, 200, { ok: true, mode: 'merge' });
    }

    // PUBLISH
    if (req.method === 'POST' && dash && publish) {
      const body = await readBody(req);
      const allFlag = !!body.all;
      const users = Array.isArray(body.users) ? body.users.map(String).filter(Boolean) : [];

      const idx = await loadIndex();
      const dashboards = idx.dashboards;
      const rec = dashboards[dash];

      if (!rec) return json(res, 404, { error: 'Not found' });
      if (rec.ownerId !== s.userId && s.role !== 'admin') return json(res, 403, { error: 'Forbidden' });

      const now = new Date().toISOString();
      rec.published = true;
      rec.publishedToAll = allFlag;
      rec.allowedUsers = allFlag ? [rec.ownerId] : Array.from(new Set([rec.ownerId].concat(users)));
      rec.publishedAt = now;
      rec.updatedAt = now;
      dashboards[dash] = rec;

      await saveIndex(dashboards);
      return json(res, 200, { ok: true });
    }

    // UNPUBLISH
    if (req.method === 'POST' && dash && unpublish) {
      const idx = await loadIndex();
      const dashboards = idx.dashboards;
      const rec = dashboards[dash];

      if (!rec) return json(res, 404, { error: 'Not found' });
      if (rec.ownerId !== s.userId && s.role !== 'admin') return json(res, 403, { error: 'Forbidden' });

      rec.published = false;
      rec.publishedToAll = false;
      rec.allowedUsers = [rec.ownerId];
      rec.updatedAt = new Date().toISOString();
      dashboards[dash] = rec;

      await saveIndex(dashboards);
      return json(res, 200, { ok: true });
    }

    // DELETE
    if (req.method === 'DELETE' && dash) {
      const idx = await loadIndex();
      const dashboards = idx.dashboards;
      const rec = dashboards[dash];

      if (!rec) return json(res, 404, { error: 'Not found' });
      if (rec.ownerId !== s.userId && s.role !== 'admin') return json(res, 403, { error: 'Forbidden' });

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
