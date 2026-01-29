// api/state.js
// FIXED VERSION
// --------------------------------------------------
// - Build saves ONLY build state
// - Run saves ONLY run state (merge)
// - Prevents blank overwrites
// - Publish / Unpublish handled safely
// --------------------------------------------------

const { json, readBody } = require('./_lib/http');
const { getSession } = require('./_lib/cookie');
const { ghGetFile, ghPutFileRetry, decodeContent } = require('./_lib/github');

const USERS_PATH = 'db/users.json';
const INDEX_PATH = 'db/dashboards/index.json';
const DASH_DIR = 'db/dashboards';

/* ---------------- Helpers ---------------- */

function safeParse(txt, fallback) {
  try { return JSON.parse(txt); } catch { return fallback; }
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Deep merge but NEVER overwrite with undefined / null
function deepMerge(target, patch) {
  if (!isObject(target) || !isObject(patch)) return patch;
  const out = { ...target };
  for (const k of Object.keys(patch)) {
    if (patch[k] === undefined || patch[k] === null) continue;
    out[k] = isObject(out[k]) && isObject(patch[k])
      ? deepMerge(out[k], patch[k])
      : patch[k];
  }
  return out;
}

/* ---------------- GitHub loaders ---------------- */

async function loadUsers() {
  const f = await ghGetFile(USERS_PATH);
  if (!f.exists) return {};
  return safeParse(decodeContent(f), {}).users || {};
}

async function loadIndex() {
  const f = await ghGetFile(INDEX_PATH);
  if (!f.exists) {
    await ghPutFileRetry(
      INDEX_PATH,
      JSON.stringify({ dashboards: {} }, null, 2),
      'init dashboards index'
    );
    return {};
  }
  return safeParse(decodeContent(f), {}).dashboards || {};
}

async function saveIndex(dashboards) {
  await ghPutFileRetry(
    INDEX_PATH,
    JSON.stringify({ dashboards }, null, 2),
    'update dashboards index'
  );
}

async function loadDashboardFile(id) {
  const f = await ghGetFile(`${DASH_DIR}/${id}.json`);
  if (!f.exists) return null;
  return {
    sha: f.sha,
    data: safeParse(decodeContent(f), {})
  };
}

/* ---------------- API Handler ---------------- */

module.exports = async (req, res) => {
  try {
    const session = getSession(req);
    if (!session) return json(res, 401, { error: 'Not authenticated' });

    const users = await loadUsers();
    const me = users[session.userId] || { role: 'viewer' };
    const isAdmin = me.role === 'admin';

    const dashId = req.query.dash;
    const isMerge = req.query.merge !== undefined;
    const isPublish = req.query.publish !== undefined;
    const isUnpublish = req.query.unpublish !== undefined;

    /* ---------- GET DASHBOARD ---------- */
    if (req.method === 'GET' && dashId) {
      const index = await loadIndex();
      const meta = index[dashId];
      if (!meta) return json(res, 404, { error: 'Dashboard not found' });

      const file = await loadDashboardFile(dashId);
      const state = file?.data?.state || {};

      return json(res, 200, {
        id: dashId,
        name: meta.name,
        meta,
        state
      });
    }

    /* ---------- RUN SAVE (MERGE ONLY) ---------- */
    if (req.method === 'POST' && dashId && isMerge) {
      const body = await readBody(req);
      if (!body.patch || !body.patch.run) {
        return json(res, 400, { error: 'run patch required' });
      }

      const index = await loadIndex();
      const meta = index[dashId];
      if (!meta) return json(res, 404, { error: 'Not found' });
      if (meta.ownerId !== session.userId && !isAdmin) {
        return json(res, 403, { error: 'Forbidden' });
      }

      const file = await loadDashboardFile(dashId);
      const currentState = file?.data?.state || {};

      const nextState = deepMerge(currentState, {
        run: body.patch.run   // 🔒 RUN ONLY
      });

      await ghPutFileRetry(
        `${DASH_DIR}/${dashId}.json`,
        JSON.stringify({ id: dashId, name: meta.name, state: nextState }, null, 2),
        'merge run data',
        file?.sha
      );

      return json(res, 200, { ok: true, mode: 'run-merge' });
    }

    /* ---------- BUILD SAVE (REPLACE BUILD ONLY) ---------- */
    if (req.method === 'POST' && dashId && !isMerge && !isPublish && !isUnpublish) {
      const body = await readBody(req);
      if (!body.state || !body.state.build) {
        return json(res, 400, { error: 'build state required' });
      }

      const index = await loadIndex();
      const meta = index[dashId];
      if (!meta) return json(res, 404, { error: 'Not found' });
      if (meta.ownerId !== session.userId && !isAdmin) {
        return json(res, 403, { error: 'Forbidden' });
      }

      const file = await loadDashboardFile(dashId);
      const currentState = file?.data?.state || {};

      const nextState = {
        ...currentState,
        build: body.state.build   // 🔒 BUILD ONLY
      };

      await ghPutFileRetry(
        `${DASH_DIR}/${dashId}.json`,
        JSON.stringify({ id: dashId, name: meta.name, state: nextState }, null, 2),
        'save build data',
        file?.sha
      );

      return json(res, 200, { ok: true, mode: 'build-save' });
    }

    /* ---------- PUBLISH ---------- */
    if (req.method === 'POST' && dashId && isPublish) {
      const index = await loadIndex();
      const meta = index[dashId];
      if (!meta) return json(res, 404, { error: 'Not found' });
      if (meta.ownerId !== session.userId && !isAdmin) {
        return json(res, 403, { error: 'Forbidden' });
      }

      meta.published = true;
      meta.publishedAt = new Date().toISOString();
      index[dashId] = meta;

      await saveIndex(index);
      return json(res, 200, { ok: true, published: true });
    }

    /* ---------- UNPUBLISH ---------- */
    if (req.method === 'POST' && dashId && isUnpublish) {
      const index = await loadIndex();
      const meta = index[dashId];
      if (!meta) return json(res, 404, { error: 'Not found' });
      if (meta.ownerId !== session.userId && !isAdmin) {
        return json(res, 403, { error: 'Forbidden' });
      }

      meta.published = false;
      delete meta.publishedAt;
      index[dashId] = meta;

      await saveIndex(index);
      return json(res, 200, { ok: true, published: false });
    }

    return json(res, 405, { error: 'Unsupported operation' });

  } catch (err) {
    return json(res, 500, { error: err.message || String(err) });
  }
};
