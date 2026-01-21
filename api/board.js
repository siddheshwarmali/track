const { json } = require('./_lib/http');
const { getSession } = require('./_lib/cookie');
const { ghGetFile, decodeContent } = require('./_lib/github');

const INDEX_PATH = 'db/dashboards/index.json';
const DASH_DIR = 'db/dashboards';

function parseJsonSafe(txt, fallback){
  try { return JSON.parse(txt); } catch { return fallback; }
}

function isVisibleTo(rec, userId){
  if(!rec) return false;
  if(rec.ownerId === userId) return true;
  if(rec.publishedToAll) return true;
  if(Array.isArray(rec.allowedUsers) && rec.allowedUsers.includes(userId)) return true;
  return false;
}

function safeText(s, fallback=''){
  if(typeof s !== 'string') return fallback;
  const t=s.trim();
  return t ? t : fallback;
}

function pickMilestones(state){
  const m = state?.executive?.milestones;
  const arr = Array.isArray(m) ? m : [];
  const items = arr.slice(0,3).map(x => {
    const title = safeText(x?.title || x?.name || x?.milestone || 'Milestone');
    const date = safeText(x?.date || x?.dueDate || '');
    return date ? `${title} — ${date}` : title;
  });
  return { count: arr.length, items };
}

function pickApplication(state){
  const us = Array.isArray(state?.executive?.userStories) ? state.executive.userStories : [];
  const bugs = Array.isArray(state?.executive?.bugs) ? state.executive.bugs : [];
  const usOpen = us.filter(x => String(x?.stage || x?.status || '').toLowerCase() !== 'closed').length;
  const bugsOpen = bugs.filter(x => String(x?.stage || x?.status || '').toLowerCase() !== 'closed').length;
  return { userStories: us.length, bugs: bugs.length, usOpen, bugsOpen };
}

function pickDiscipline(state){
  const d = Array.isArray(state?.executive?.taskDisciplines) ? state.executive.taskDisciplines : [];
  const pending = Array.isArray(state?.executive?.pendingDisciplineData) ? state.executive.pendingDisciplineData.length : 0;
  const top = d.slice(0,3).map(x => {
    const n = safeText(x?.name || x?.discipline || x?.title || 'Discipline');
    const c = (x?.count ?? x?.total ?? x?.items ?? null);
    return (typeof c === 'number') ? `${n} — ${c}` : n;
  });
  return { disciplines: d.length, pending, top };
}

async function loadIndex(){
  const f = await ghGetFile(INDEX_PATH);
  if(!f.exists) return { dashboards:{} };
  const raw = (decodeContent(f) || '').trim();
  const data = parseJsonSafe(raw || '{"dashboards":{}}', { dashboards:{} });
  return { dashboards: data.dashboards || {} };
}

async function loadDashState(id){
  const path = `${DASH_DIR}/${id}.json`;
  const f = await ghGetFile(path);
  if(!f.exists) return null;
  const raw = (decodeContent(f) || '').trim();
  const data = parseJsonSafe(raw || '{}', {});
  return data.state || null;
}

function sortItems(items, mode){
  const m = (mode||'newest');
  if(m === 'oldest') return items.sort((a,b)=>(a.publishedAt||a.updatedAt||'').localeCompare(b.publishedAt||b.updatedAt||''));
  if(m === 'name_asc') return items.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  if(m === 'name_desc') return items.sort((a,b)=>String(b.name||'').localeCompare(String(a.name||'')));
  return items.sort((a,b)=>(b.publishedAt||b.updatedAt||'').localeCompare(a.publishedAt||a.updatedAt||''));
}

module.exports = async (req, res) => {
  try{
    const s = getSession(req);
    if(!s) return json(res, 401, { error:'Not authenticated' });
    if(!(s.role === 'admin' || s.role === 'executive')) return json(res, 403, { error:'Forbidden: Executive Board access required' });

    const sort = (req.query && req.query.sort) ? String(req.query.sort) : 'newest';

    const idx = await loadIndex();
    const dashboards = idx.dashboards;
    const visible = Object.values(dashboards)
      .filter(d => d && d.published)
      .filter(d => isVisibleTo(d, s.userId));

    const items=[];
    for(const d of visible){
      const state = await loadDashState(d.id);
      const summary = safeText(state?.executive?.savedSummaryText || state?.executive?.summaryText || '');
      items.push({
        id: d.id,
        name: d.name,
        ownerId: d.ownerId,
        publishedAt: d.publishedAt || d.updatedAt,
        updatedAt: d.updatedAt,
        summary: summary || 'No summary',
        milestones: pickMilestones(state),
        application: pickApplication(state),
        discipline: pickDiscipline(state)
      });
    }

    sortItems(items, sort);

    return json(res, 200, { items });
  } catch(e){
    return json(res, 500, { error: e.message || String(e) });
  }
};
