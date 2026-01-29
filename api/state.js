import { getUser } from './auth.js';
import {
  ghGetFile,
  ghPutFileRetry,
  ghDeleteFile
} from './github.js';

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function normalizeStateFromFile(file) {
  return file?.state || {};
}

async function loadDash(dash) {
  const path = `data/dashboards/${dash}.json`;
  try {
    const { content, sha } = await ghGetFile(path);
    const data = JSON.parse(Buffer.from(content, 'base64').toString());
    return { exists: true, path, sha, data };
  } catch {
    return { exists: false, path, sha: null, data: null };
  }
}

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) return json(res, 401, { error: 'unauthorized' });

  const dash = req.query.dash;
  if (!dash) return json(res, 400, { error: 'dash required' });

  const publish = req.query.publish !== undefined;
  const unpublish = req.query.unpublish !== undefined;
  const merge = req.query.merge !== undefined;

  // 🔒 HARD GUARD — prevent conflict
  if (publish && unpublish) {
    return json(res, 400, {
      error: 'Cannot publish and unpublish at the same time'
    });
  }

  const d = await loadDash(dash);

  // =========================
  // GET DASHBOARD
  // =========================
  if (req.method === 'GET') {
    if (!d.exists) return json(res, 404, { error: 'not found' });

    const rec = d.data;

    // 🔐 Visibility logic (fixed)
    if (
      !rec.allowedUsers?.includes('*') &&
      rec.ownerId !== user.id &&
      !rec.allowedUsers?.includes(user.id)
    ) {
      return json(res, 403, { error: 'forbidden' });
    }

    return json(res, 200, rec);
  }

  // =========================
  // DELETE DASHBOARD
  // =========================
  if (req.method === 'DELETE') {
    if (!d.exists) return json(res, 404, { error: 'not found' });
    if (d.data.ownerId !== user.id) {
      return json(res, 403, { error: 'forbidden' });
    }
    await ghDeleteFile(d.path, d.sha, 'delete dashboard');
    return json(res, 200, { ok: true });
  }

  // =========================
  // POST (SAVE / RUN / PUBLISH)
  // =========================
  if (req.method === 'POST') {
    const body = req.body || {};
    const name = body.name || d.data?.name || 'Untitled';

    // ---------- PUBLISH / UNPUBLISH ----------
    if (publish || unpublish) {
      if (!d.exists) return json(res, 404, { error: 'not found' });
      if (d.data.ownerId !== user.id) {
        return json(res, 403, { error: 'forbidden' });
      }

      const rec = d.data;

      if (unpublish) {
        rec.published = false;
        rec.allowedUsers = [rec.ownerId];
      }

      if (publish) {
        const users = Array.isArray(body.users) ? body.users : [];
        const publishAll = body.all === true;

        rec.published = true;
        rec.allowedUsers = publishAll
          ? ['*']
          : Array.from(new Set([rec.ownerId, ...users]));
      }

      await ghPutFileRetry(
        d.path,
        JSON.stringify(rec, null, 2),
        'update publish state',
        d.sha
      );

      return json(res, 200, { ok: true });
    }

    // ---------- SAVE STATE ----------
    const incomingState = body.state;
    if (!incomingState) {
      return json(res, 400, { error: 'state required' });
    }

    const existingState = d.exists
      ? normalizeStateFromFile(d.data)
      : {};

    let finalState;

    if (merge) {
      // ✅ RUN MODE — merge only
      finalState = {
        ...existingState,
        ...incomingState
      };
    } else {
      // ✅ BUILD MODE — preserve run data
      finalState = {
        ...existingState,
        ...incomingState,
        run: incomingState.run ?? existingState.run
      };
    }

    const record = {
      id: dash,
      name,
      ownerId: d.data?.ownerId || user.id,
      published: d.data?.published || false,
      allowedUsers: d.data?.allowedUsers || [user.id],
      state: finalState
    };

    await ghPutFileRetry(
      d.path,
      JSON.stringify(record, null, 2),
      'save dashboard',
      d.sha
    );

    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'method not allowed' });
}
