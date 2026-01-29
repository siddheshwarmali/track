// api/state.js — FINAL, FRONTEND-COMPATIBLE VERSION

const { json, readBody } = require('./_lib/http');
const { getSession } = require('./_lib/cookie');
const { ghGetFile, ghPutFileRetry, decodeContent } = require('./_lib/github');

const USERS_PATH = 'db/users.json';
const INDEX_PATH = 'db/dashboards/index.json';
const DASH_DIR = 'db/dashboards';

/* ---------------- Utils ---------------- */

function safeParse(t, fb) {
  try { return JSON.parse(t); } catch { return fb; }
}
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(a, b) {
  if (!isObj(a) || !isObj(b)) return b;
  const o = { ...a };
  for (const k in b) {
    if (b[k] === undefined || b[k] === null) continue;
    o[k] = isObj(o[k]) && isObj(b[k]) ? deepMerge(o[k], b[k]) : b[k];
  }
  return o;
}

/* ---------------- Loaders ---------------- */

async function loadIndex() {
  const f = await ghGetFile(INDEX_PATH);
  if (!f.exists) {
    await ghPutFileRetry(INDEX_PATH, JSON.stringify({ dashboards: {} }, null, 2), 'init index');
    return {};
  }
  return safeParse(decodeContent(f), {}).dashboards || {};
}

async function saveIndex(dashboards) {
  await ghPutFileRetry(INDEX_PATH, JSON.stringify({ dashboards }, null, 2), 'save index');
}

async function loadDash(id) {
  const f = await ghGetFile(`${DASH_DIR}/${id}.json`);
  if (!f.exists) return null;
  return { sha: f.sha, data: safeParse(decodeContent(f), {}) };
}

/* ---------------- API ---------------- */

module.exports = async (req, res) => {
  try {
    const session = getSession(req);
    if (!session) return json(res, 401, { error: 'Not authenticated' });

    const dashId = req.query.dash;
    const list = req.query.list !== undefined;
    const merge = req.query.merge !== undefined;
    const publish = req.query.publish !== undefined;
    const unpublish = req.query.unpublish !== undefined;

    /* ===== LIST DASHBOARDS ===== */
    if (req.method === 'GET' && list) {
      const index = await loadIndex();
      const arr = Object.values(index).map(d => ({
        id: d.id,
        name: d.name,
        published: !!d.published,
        updatedAt: d.updatedAt || d.createdAt
      }));
      return json(res, 200, { dashboards: arr });
    }

    /* ===== GET DASHBOARD ===== */
    if (req.method === 'GET' && dashId) {
      const index = await loadIndex();
      const meta = index[dashId];
      if (!meta) return json(res, 404, { error: 'Not found' });

      const file = await loadDash(dashId);
      return json(res, 200, {
        id: dashId,
        name: meta.name,
        meta,
        state: file?.data?.state || {}
      });
    }

    /* ===== RUN SAVE (MERGE ONLY) ===== */
    if (req.method === 'POST' && dashId && merge) {
      const body = await readBody(req);
      if (!body.patch?.run) return json(res, 400, { error: 'run patch required' });

      const file = await loadDash(dashId);
      const current = file?.data?.state || {};

      const next = deepMerge(current, { run: body.patch.run });

      await ghPutFileRetry(
        `${DASH_DIR}/${dashId}.json`,
        JSON.stringify({ id: dashId, name: dashId, state: next }, null, 2),
        'merge run',
        file?.sha
      );

      return json(res, 200, { ok: true });
    }

    /* ===== BUILD SAVE (ALLOW EMPTY) ===== */
    if (req.method === 'POST' && dashId && !merge && !publish && !unpublish) {
      const body = await readBody(req);

      const file = await loadDash(dashId);
      const current = file?.data?.state || {};

      const next = {
        build: body.state?.build || current.build || {},
        run: current.run || {}
      };

      await ghPutFileRetry(
        `${DASH_DIR}/${dashId}.json`,
        JSON.stringify({ id: dashId, name: dashId, state: next }, null, 2),
        'save build',
        file?.sha
      );

      return json(res, 200, { ok: true });
    }

    /* ===== PUBLISH ===== */
    if (req.method === 'POST' && dashId && publish) {
      const index = await loadIndex();
      index[dashId].published = true;
      index[dashId].publishedAt = new Date().toISOString();
      await saveIndex(index);
      return json(res, 200, { ok: true });
    }

    /* ===== UNPUBLISH ===== */
    if (req.method === 'POST' && dashId && unpublish) {
      const index = await loadIndex();
      index[dashId].published = false;
      delete index[dashId].publishedAt;
      await saveIndex(index);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Unsupported operation' });

  } catch (e) {
    return json(res, 500, { error: e.message });
  }
};
