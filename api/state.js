import { getUser } from './auth.js';
import { ghGetFile, ghPutFileRetry, ghDeleteFile } from './github.js';

/* =========================
   Helpers
========================= */

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

async function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise(resolve => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

async function getIndex() {
  try {
    const f = await ghGetFile('data/dashboards/index.json');
    const data = JSON.parse(Buffer.from(f.content, 'base64').toString());
    return { list: data || [], sha: f.sha, exists: true };
  } catch {
    return { list: [], sha: null, exists: false };
  }
}

async function saveIndex(list, sha) {
  await ghPutFileRetry(
    'data/dashboards/index.json',
    JSON.stringify(list, null, 2),
    'update dashboard index',
    sha || undefined
  );
}

async function loadDash(id) {
  const path = `data/dashboards/${id}.json`;
  try {
    const f = await ghGetFile(path);
    const data = JSON.parse(Buffer.from(f.content, 'base64').toString());
    return { exists: true, path, sha: f.sha, data };
  } catch {
    return { exists: false, path, sha: null, data: null };
  }
}

/* =========================
   Handler
========================= */

export default async function handler(req, res) {
  try {
    const user = await getUser(req);
    if (!user) return json(res, 401, { error: 'unauthorized' });

    /* =========================
       LIST DASHBOARDS
    ========================= */
    if (req.method === 'GET' && req.query.list !== undefined) {
      const idx = await getIndex();
      const visible = idx.list.filter(
        d =>
          d.ownerId === user.id ||
          d.allowedUsers?.includes('*') ||
          d.allowedUsers?.includes(user.id)
      );
      return json(res, 200, visible);
    }

    const dash = req.query.dash;
    if (!dash) return json(res, 400, { error: 'dash required' });

    const publish = req.query.publish !== undefined;
    const unpublish = req.query.unpublish !== undefined;
    const merge = req.query.merge !== undefined;

    if (publish && unpublish) {
      return json(res, 400, { error: 'conflict' });
    }

    const d = await loadDash(dash);

    /* =========================
       GET DASHBOARD
    ========================= */
    if (req.method === 'GET') {
      if (!d.exists) return json(res, 404, { error: 'not found' });
      const a = d.data.allowedUsers || [];
      if (
        d.data.ownerId !== user.id &&
        !a.includes('*') &&
        !a.includes(user.id)
      ) {
        return json(res, 403, { error: 'forbidden' });
      }
      return json(res, 200, d.data);
    }

    /* =========================
       POST (CREATE / SAVE)
    ========================= */
    if (req.method === 'POST') {
      const body = await getBody(req);
      const idx = await getIndex();

      const state = body.state || {};
      const rec = d.exists
        ? { ...d.data }
        : {
            id: dash,
            name: body.name || 'Untitled',
            ownerId: user.id,
            published: false,
            allowedUsers: [user.id],
            state: {}
          };

      rec.state = merge
        ? { ...rec.state, ...state }
        : { ...rec.state, ...state, run: state.run ?? rec.state.run };

      await ghPutFileRetry(
        d.path,
        JSON.stringify(rec, null, 2),
        'save dashboard',
        d.exists ? d.sha : undefined
      );

      // 🔑 ensure index.json is updated
      if (!idx.list.find(x => x.id === dash)) {
        idx.list.push({
          id: dash,
          name: rec.name,
          ownerId: rec.ownerId,
          allowedUsers: rec.allowedUsers
        });
        await saveIndex(idx.list, idx.sha);
      }

      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'method not allowed' });
  } catch (e) {
    console.error('[state] FATAL:', e);
    return json(res, 500, { error: 'server error' });
  }
}
