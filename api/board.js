// api/board.js (updated)
// - Fixes summary hydration by reading dashboard files stored as either {state:{...}} OR direct {...}
// - Provides milestone 'journey' data (full milestones array + progressPct) instead of only count/top-3
// - Provides robust summary fallback (auto summary) when savedSummaryText is empty

const { json } = require('./_lib/http');
const { getSession } = require('./_lib/cookie');
const { ghGetFile, decodeContent } = require('./_lib/github');

const USERS_PATH = 'db/users.json';
const INDEX_PATH = 'db/dashboards/index.json';
const DASH_DIR  = 'db/dashboards';

function parseJsonSafe(txt, fb) {
  try { return JSON.parse(txt); } catch { return fb; }
}

function safeText(s, fb = '') {
  return (typeof s === 'string' && s.trim()) ? s.trim() : fb;
}

async function loadUsers() {
  const f = await ghGetFile(USERS_PATH);
  if (!f.exists) return { users: {} };
  const data = parseJsonSafe((decodeContent(f) || '').trim() || '{"users":{}}', { users: {} });
  return { users: data.users || {} };
}

async function loadIndex() {
  const f = await ghGetFile(INDEX_PATH);
  if (!f.exists) return { dashboards: {} };
  const data = parseJsonSafe((decodeContent(f) || '').trim() || '{"dashboards":{}}', { dashboards: {} });
  return { dashboards: data.dashboards || {} };
}

/**
 * Dashboard files can be stored in multiple shapes:
 *  A) { state: { executive: {...}, headless: {...}, __meta: {...} } }
 *  B) { data: { state: {...} } }
 *  C) { executive: {...}, headless: {...} }  (direct)
 * This normalizes and returns the state object consistently.
 */
async function loadDashState(id) {
  const f = await ghGetFile(`${DASH_DIR}/${id}.json`);
  if (!f.exists) return null;

  const raw = (decodeContent(f) || '').trim() || '{}';
  const data = parseJsonSafe(raw, {});

  // Prefer explicit wrappers
  if (data && typeof data === 'object') {
    if (data.state && typeof data.state === 'object') return data.state;
    if (data.data && data.data.state && typeof data.data.state === 'object') return data.data.state;

    // If looks like a state already, return it
    if (data.executive || data.headless || data.__meta) return data;
  }

  return null;
}

function isVisibleTo(d, userId) {
  if (d.ownerId === userId) return true;
  if (d.publishedToAll) return true;
  if (Array.isArray(d.allowedUsers) && d.allowedUsers.includes(userId)) return true;
  return false;
}

function normalizeStage(val) {
  return String(val || '').toLowerCase().trim();
}

function countOpen(items) {
  return (items || []).filter(x => normalizeStage(x?.stage || x?.status) !== 'closed').length;
}

function pickApplication(state) {
  const us   = Array.isArray(state?.executive?.userStories) ? state.executive.userStories : [];
  const bugs = Array.isArray(state?.executive?.bugs)       ? state.executive.bugs       : [];
  const usOpen   = countOpen(us);
  const bugsOpen = countOpen(bugs);

  // Optional: stage-specific counts (useful for summaries)
  const bugsNew    = bugs.filter(b => normalizeStage(b?.stage || b?.status) === 'new').length;
  const bugsActive = bugs.filter(b => normalizeStage(b?.stage || b?.status) === 'active').length;

  return { userStories: us.length, bugs: bugs.length, usOpen, bugsOpen, bugsNew, bugsActive };
}

function pickDiscipline(state) {
  const d = Array.isArray(state?.executive?.taskDisciplines) ? state.executive.taskDisciplines : [];
  const pending = Array.isArray(state?.executive?.pendingDisciplineData) ? state.executive.pendingDisciplineData.length : 0;
  return { disciplines: d.length, pending };
}

/**
 * Milestones in Build typically look like:
 * { phase, startDate, endDate, actualStartDate, actualEndDate, owner, remark }
 * This returns both:
 *  - milestones: journey-ready array
 *  - progressPct: completion percentage (based on actualEndDate/actualEnd)
 */
function pickMilestones(state) {
  const src = Array.isArray(state?.executive?.milestones) ? state.executive.milestones : [];

  const milestones = src.map(m => {
    const phase = safeText(m?.phase || m?.Activity || m?.title || m?.name || 'Milestone');
    const startDate = safeText(m?.startDate || m?.plannedStart || m?.start || m?.['Start Date'] || '');
    const endDate = safeText(m?.endDate || m?.plannedEnd || m?.end || m?.['End Date'] || '');
    const actualStartDate = safeText(m?.actualStartDate || m?.actualStart || m?.['Actual Start Date'] || '');
    const actualEndDate = safeText(m?.actualEndDate || m?.actualEnd || m?.['Actual End Date'] || '');
    const owner = safeText(m?.owner || m?.Owner || '');
    const remark = safeText(m?.remark || m?.Remark || '');

    return { phase, startDate, endDate, actualStartDate, actualEndDate, owner, remark };
  });

  const completed = milestones.filter(x => !!safeText(x.actualEndDate)).length;
  const progressPct = milestones.length ? Math.round((completed / milestones.length) * 100) : 0;

  // Keep previous compact preview for backwards compatibility
  const items = milestones.slice(0, 3).map(x => {
    const t = safeText(x.phase, 'Milestone');
    const dt = safeText(x.endDate || x.actualEndDate || '');
    return dt ? `${t} — ${dt}` : t;
  });

  return { count: milestones.length, progressPct, items, milestones };
}

function computeAutoSummary(state) {
  const ms = Array.isArray(state?.executive?.milestones) ? state.executive.milestones : [];
  const msPicked = pickMilestones(state);
  const app = pickApplication(state);

  const parts = [];
  if (ms.length) parts.push(`Project execution is at ${msPicked.progressPct}% completion (${msPicked.count} milestones).`);
  if (app.bugs) parts.push(`Bugs: ${app.bugs} total (${app.bugsNew} new, ${app.bugsActive} active).`);
  if (app.userStories) parts.push(`User Stories: ${app.userStories} total (Open ${app.usOpen}).`);

  return parts.join(' ').trim();
}

function sortItems(items, mode) {
  const m = (mode || 'newest');
  if (m === 'oldest') return items.sort((a, b) => (a.publishedAt || a.updatedAt || '').localeCompare(b.publishedAt || b.updatedAt || ''));
  if (m === 'name_asc') return items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  if (m === 'name_desc') return items.sort((a, b) => String(b.name || '').localeCompare(String(a.name || '')));
  return items.sort((a, b) => (b.publishedAt || b.updatedAt || '').localeCompare(a.publishedAt || a.updatedAt || ''));
}

module.exports = async (req, res) => {
  try {
    const sess = getSession(req);
    if (!sess) return json(res, 401, { error: 'Not authenticated' });

    const { users } = await loadUsers();
    const me = users[sess.userId] || { role: 'viewer', permissions: {} };

    if (!(me.role === 'admin' || (me.permissions && me.permissions.executiveBoard))) {
      return json(res, 403, { error: 'Forbidden: Executive Board access required' });
    }

    const sort = (req.query && req.query.sort) ? String(req.query.sort) : 'newest';
    const idx = await loadIndex();

    const vis = Object.values(idx.dashboards || {})
      .filter(d => d && d.published)
      .filter(d => isVisibleTo(d, sess.userId));

    const items = [];
    for (const d of vis) {
      const state = await loadDashState(d.id);

      const saved = safeText(state?.executive?.savedSummaryText || '');
      const summary = saved || safeText(computeAutoSummary(state), '') || 'No summary';

      items.push({
        id: d.id,
        name: d.name,
        ownerId: d.ownerId,
        publishedAt: d.publishedAt || d.updatedAt,
        updatedAt: d.updatedAt,

        // Card payload
        summary,
        milestones: pickMilestones(state),
        application: pickApplication(state),
        discipline: pickDiscipline(state)
      });
    }

    sortItems(items, sort);
    return json(res, 200, { items });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};
