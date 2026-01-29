import { getUser } from './auth.js';
import {
  ghGetFile,
  ghPutFileRetry,
  ghDeleteFile
} from './github.js';

/* =========================
   Helpers
========================= */

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

// Safe body parsing (Netlify / Cloudflare / Vercel)
async function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (e) {
        console.warn('[state] body parse failed');
        resolve({});
      }
    });
  });
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

/* =========================
   Handler
========================= */

export default async function handler(req, res) {
  console.log(`[state] ${req.method} ${req.url}`);

  const user = await getUser(req);
  if (!user) return json(res, 401, { error: 'unauthorized' });

  const dash = req.query.dash;
  if (!dash) return json(res, 400, { error: 'dash required' });

  const publish = req.query.publish !== undefined;
  const unpublish = req.query.unpublish !== undefined;
  const merge = req.query.merge !== undefined;

  // Prevent publish/unpublish conflict
  if (publish && unpublish) {
    return json(res, 400, {
      error: 'Cannot publish and unpublish at the same time'
    });
  }

  const d = await loadDash(dash);

  /* =========================
     GET DASHBOARD
  ========================= */

  if (req.method === 'GET') {
    if (!d.exists) return json(res, 404, { error: 'not found' });

    const rec = d.data;
    const allowed = rec.allowedUsers || [];

    if (
      !allowed.includes('*') &&
      rec.ownerId !== user.id &&
      !allowed.includes(user.id)
    ) {
      return json(res, 403, { error: 'forbidden' });
    }

    console.log('[state] loaded dashboard:', dash);
    return json(res, 200, rec);
  }

  /* =========================
     DELETE DASHBOARD
  ========================= */

  if (req.method === 'DELETE') {
    if (!d.exists) return json(res, 404, { error: 'not found' });
    if (d.data.ownerId !== user.id) {
      return json(res, 403, { error: 'forbidden' });
    }

    await ghDeleteFile(d.path, d.sha, 'delete dashboard');
    console.log('[state] deleted dashboard:', dash);
    return json(res, 200, { ok: true });
  }

  /* =========================
     POST (SAVE / RUN / PUBLISH)
  ========================= */

  if (req.method === 'POST') {
    const body = await getBody(req);
    const name = body.name || d.data?.name || 'Untitled';

    /* ---------- PUBLISH / UNPUBLISH ---------- */

    if (publish || unpublish) {
      if (!d.exists) return json(res, 404, { error: 'not found' });
      if (d.data.ownerId !== user.id) {
        return json(res, 403, { error: 'forbidden' });
      }

      const rec = d.data;

      if (unpublish) {
        rec.published = false;
        rec.allowedUsers = [rec.ownerId];
        console.log('[state] unpublished dashboard:', dash);
      }

      if (publish) {
        const users = Array.isArray(body.users) ? body.users : [];
        const publishAll = body.all === true;

        rec.published = true;
        rec.allowedUsers = publishAll
          ? ['*']
          : Array.from(new Set([rec.ownerId, ...users]));

        console.log(
          '[state] published dashboard:',
          dash,
          publishAll ? '(public)' : '(restricted)'
        );
      }

      await ghPutFileRetry(
        d.path,
        JSON.stringify(rec, null, 2),
        'update publish state',
        d.sha
      );

      return json(res, 200, { ok: true });
    }

    /* ---------- SAVE STATE ---------- */

    const incomingState = body.state;
    if (!incomingState || typeof incomingState !== 'object') {
      console.warn('[state] invalid state payload');
      return json(res, 400, { error: 'state required' });
    }

    const existingState = d.exists
      ? normalizeStateFromFile(d.data)
      : {};

    let finalState;

    if (merge) {
      // RUN MODE — merge only
      finalState = {
        ...existingState,
        ...incomingState
      };
      console.log('[state] run state merged:', dash);
    } else {
      // BUILD MODE — preserve run data
      finalState = {
        ...existingState,
        ...incomingState,
        run: incomingState.run ?? existingState.run
      };
      console.log('[state] build state saved:', dash);
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
