
const { json, readBody } = require('./_lib/http');
const { getSession } = require('./_lib/cookie');
const { ghGetFile, ghPutFileRetry, ghDeleteFile, decodeContent } = require('./_lib/github');

const INDEX_PATH = 'db/dashboards/index.json';
const DASH_DIR = 'db/dashboards';

const ALLOWED_SECTIONS = new Set([
  'summary-section','section-milestones','section-discipline','section-user-stories',
  'section-bugs','section-blockers','section-kpi','section-bau','run-dashboard'
]);

function sanitizeSections(sections){
  const arr = Array.isArray(sections) ? sections : [];
  return [...new Set(arr.map(String))].filter(s => ALLOWED_SECTIONS.has(s));
}

function isVisibleTo(d, userId){
  if(!d) return false;
  if(d.ownerId === userId) return true;
  if(d.publishedToAll) return true;
  if(Array.isArray(d.allowedUsers) && d.allowedUsers.includes(userId)) return true;
  return false;
}

function deepClone(obj){
  try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
}

function filterStateForViewer(state, publishedSections){
  const allowed = new Set(publishedSections || []);
  const s = deepClone(state || {});
  s.executive = s.executive || {};

  if (!allowed.has('summary-section')) s.executive.savedSummaryText = null;
  if (!allowed.has('section-milestones')) { s.executive.milestones = []; s.executive.showTrackerDetails = false; }
  if (!allowed.has('section-discipline')) {
    s.executive.taskDisciplines = []; s.executive.l2Columns=[]; s.executive.l2Data={}; s.executive.l3Data=[];
    s.executive.pendingDisciplineData=[]; s.executive.profileToDisciplineMap={}; s.executive.tempAdoTasks=[];
    s.executive.showL2Details=false; s.executive.expandedDiscipline='ALL';
  }
  if (!allowed.has('section-user-stories')) { s.executive.userStories=[]; s.executive.activeUsStage='New'; }
  if (!allowed.has('section-bugs')) { s.executive.bugs=[]; s.executive.activeBugStage='New'; }
  if (!allowed.has('section-blockers')) s.executive.blockers=[];
  if (!allowed.has('section-kpi')) s.executive.kpiData=[];
  if (!allowed.has('section-bau')) s.executive.bauData={ totalTickets:0, withinSLA:0, breachedSLA:0, slaPercentage:0 };
  if (!allowed.has('run-dashboard')) { s.headless = s.headless || {}; s.headless.loadedTicketData = null; }
  return s;
}


async function loadIndex(){
  const f = await ghGetFile(INDEX_PATH);

  // If file doesn't exist, return empty dashboards (and optionally auto-create)
  if(!f.exists) {
    // Optional auto-create (requires GitHub write permissions)
    await ghPutFileRetry(INDEX_PATH, JSON.stringify({ dashboards: {} }, null, 2), 'init dashboards index');
    return { dashboards: {} };
  }

  // Decode + sanitize
  const raw = (decodeContent(f) || '').trim();

  // If file exists but is blank/whitespace -> fix it
  if(!raw) {
    await ghPutFileRetry(INDEX_PATH, JSON.stringify({ dashboards: {} }, null, 2), 'repair blank dashboards index');
    return { dashboards: {} };
  }

  // Parse with safety
  try {
    const data = JSON.parse(raw);
    return { dashboards: data.dashboards || {} };
  } catch (e) {
    // If JSON is corrupted -> overwrite with valid structure
    await ghPutFileRetry(INDEX_PATH, JSON.stringify({ dashboards: {} }, null, 2), 'repair corrupted dashboards index');
    return { dashboards: {} };
  }
}

async function saveIndex(dashboards){
  await ghPutFileRetry(INDEX_PATH, JSON.stringify({ dashboards }, null, 2), 'update dashboards index');
}

async function loadDash(id){
  const path = `${DASH_DIR}/${id}.json`;
  const f = await ghGetFile(path);
  if(!f.exists) return { exists:false, path };
  const data = JSON.parse(decodeContent(f) || '{}');
  return { exists:true, data, path, sha:f.sha };
}

module.exports = async (req, res) => {
  const s = getSession(req);
  if(!s) return json(res, 401, { error:'Not authenticated' });

  const dash = req.query.dash ? String(req.query.dash) : null;
  const list = req.query.list !== undefined;
  const publish = req.query.publish !== undefined;
  const unpublish = req.query.unpublish !== undefined;

  // LIST
  if(req.method==='GET' && list){
    const idx = await loadIndex();
    const arr = Object.values(idx.dashboards).filter(d => isVisibleTo(d, s.userId))
      .map(d => ({ id:d.id, name:d.name, createdAt:d.createdAt, updatedAt:d.updatedAt }));
    arr.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
    return json(res, 200, { dashboards: arr });
  }

  // GET
  if(req.method==='GET' && dash){
    const idx = await loadIndex();
    const metaRec = idx.dashboards[dash];
    if(!metaRec) return json(res, 404, { error:'Not found' });
    if(!isVisibleTo(metaRec, s.userId)) return json(res, 403, { error:'Forbidden' });

    const d = await loadDash(dash);
    if(!d.exists) return json(res, 404, { error:'Not found' });

    const isOwnerOrAdmin = (metaRec.ownerId === s.userId) || (s.role==='admin');
    const meta = {
      ownerId: metaRec.ownerId,
      published: !!metaRec.published,
      publishedToAll: !!metaRec.publishedToAll,
      allowedUsers: metaRec.allowedUsers || [],
      publishedSections: metaRec.publishedSections || []
    };
    const state = isOwnerOrAdmin ? d.data.state : filterStateForViewer(d.data.state, metaRec.publishedSections||[]);
    return json(res, 200, { id: metaRec.id, name: metaRec.name, meta, state });
  }

  // SAVE
  if(req.method==='POST' && dash && !publish && !unpublish){
    const body = await readBody(req);
    const state = body.state;
    const name = body.name || (state && state.__meta && state.__meta.name) || dash;
    if(!state) return json(res, 400, { error:'state required' });

    const idx = await loadIndex();
    const dashboards = idx.dashboards;
    const existing = dashboards[dash];
    if(existing && existing.ownerId !== s.userId && s.role!=='admin') return json(res, 403, { error:'Forbidden' });

    const now = new Date().toISOString();
    const rec = existing || { id:dash, ownerId:s.userId, createdAt: now, allowedUsers:[s.userId], published:false, publishedToAll:false, publishedSections:[] };
    rec.id = dash; rec.name = name; rec.updatedAt = now;
    dashboards[dash] = rec;

    // save dashboard state file
    const dashFile = { id: dash, name, state };
    const d = await loadDash(dash);
    await ghPutFileRetry(d.path, JSON.stringify(dashFile, null, 2), `save dashboard ${name}`);
    await saveIndex(dashboards);
    return json(res, 200, { ok:true });
  }

  // PUBLISH
  if(req.method==='POST' && dash && publish){
    const body = await readBody(req);
    const idx = await loadIndex();
    const dashboards = idx.dashboards;
    const rec = dashboards[dash];
    if(!rec) return json(res, 404, { error:'Not found' });
    if(rec.ownerId !== s.userId && s.role!=='admin') return json(res, 403, { error:'Forbidden' });

    const all = !!body.all;
    const users = Array.isArray(body.users) ? body.users.map(String).filter(Boolean) : [];
    const sections = sanitizeSections(body.sections);
    if(sections.length===0) return json(res, 400, { error:'Select at least one section' });

    rec.published = true;
    rec.publishedToAll = all;
    rec.allowedUsers = all ? [rec.ownerId] : Array.from(new Set([rec.ownerId, ...users]));
    rec.publishedSections = sections;
    rec.updatedAt = new Date().toISOString();

    dashboards[dash] = rec;
    await saveIndex(dashboards);
    return json(res, 200, { ok:true });
  }

  // UNPUBLISH
  if(req.method==='POST' && dash && unpublish){
    const idx = await loadIndex();
    const dashboards = idx.dashboards;
    const rec = dashboards[dash];
    if(!rec) return json(res, 404, { error:'Not found' });
    if(rec.ownerId !== s.userId && s.role!=='admin') return json(res, 403, { error:'Forbidden' });

    rec.published = false;
    rec.publishedToAll = false;
    rec.allowedUsers = [rec.ownerId];
    rec.publishedSections = [];
    rec.updatedAt = new Date().toISOString();

    dashboards[dash] = rec;
    await saveIndex(dashboards);
    return json(res, 200, { ok:true });
  }

  // DELETE
  if(req.method==='DELETE' && dash){
    const idx = await loadIndex();
    const dashboards = idx.dashboards;
    const rec = dashboards[dash];
    if(!rec) return json(res, 404, { error:'Not found' });
    if(rec.ownerId !== s.userId && s.role!=='admin') return json(res, 403, { error:'Forbidden' });

    const d = await loadDash(dash);
    if(d.exists) await ghDeleteFile(d.path, `delete dashboard ${dash}`, d.sha);
    delete dashboards[dash];
    await saveIndex(dashboards);
    return json(res, 200, { ok:true });
  }

  return json(res, 400, { error:'Bad request' });
};
