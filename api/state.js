// api/state.js — FINAL, FEATURE-COMPLETE & FRONTEND-COMPATIBLE
// =============================================================
// Built on your provided working baseline, with ALL missing pieces added.
// Guarantees:
// ✔ Workspace list (GET ?list=1)
// ✔ Visibility (owner / publishedToAll / allowedUsers / admin)
// ✔ Create on first save
// ✔ Rename via build save
// ✔ Delete via DELETE or POST ?delete=1
// ✔ Build save (no Run wipe)
// ✔ Run merge save (no Build wipe)
// ✔ Publish / Unpublish (all/users)
// ✔ Backward compatibility with old dashboard file shapes
// ✔ No 500s on malformed data
// =============================================================

const { json, readBody } = require('./_lib/http');
const { getSession } = require('./_lib/cookie');
const { ghGetFile, ghPutFileRetry, ghDeleteFile, decodeContent } = require('./_lib/github');

const USERS_PATH = 'db/users.json';
const INDEX_PATH = 'db/dashboards/index.json';
const DASH_DIR = 'db/dashboards';

/* ---------------- helpers ---------------- */
function safeParse(t, fb){ try{ return JSON.parse(t); }catch{ return fb; } }
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(a,b){ if(!isObj(a)||!isObj(b)) return b; const o={...a}; for(const k in b){ if(b[k]===undefined) continue; o[k]=isObj(o[k])&&isObj(b[k])?deepMerge(o[k],b[k]):b[k]; } return o; }

function normalizeStateFromFile(data){
  if(!data || typeof data!=='object') return {};
  if(isObj(data.state)) return data.state;
  if(isObj(data.data) && isObj(data.data.state)) return data.data.state;
  return data; // legacy direct-state
}

/* ---------------- loaders ---------------- */
async function loadUsers(){
  const f = await ghGetFile(USERS_PATH);
  if(!f.exists) return {};
  const data = safeParse(decodeContent(f),{});
  return data.users || {};
}

async function loadIndex(){
  const f = await ghGetFile(INDEX_PATH);
  if(!f.exists){
    const init={dashboards:{}};
    await ghPutFileRetry(INDEX_PATH, JSON.stringify(init,null,2),'init dashboards index');
    return {};
  }
  const raw = safeParse(decodeContent(f),{});
  return isObj(raw.dashboards) ? raw.dashboards : {};
}

async function saveIndex(d){
  await ghPutFileRetry(INDEX_PATH, JSON.stringify({dashboards:d},null,2),'save dashboards index');
}

async function loadDash(id){
  const path = `${DASH_DIR}/${id}.json`;
  try{
    const f = await ghGetFile(path);
    if(!f.exists) return { exists:false, path };
    return { exists:true, path, sha:f.sha, data:safeParse(decodeContent(f),{}) };
  }catch{ return { exists:false, path }; }
}

/* ---------------- visibility ---------------- */
function isVisibleTo(rec, userId, isAdmin){
  if(!rec) return false;
  if(isAdmin) return true;
  if(rec.ownerId === userId) return true;
  if(rec.published && rec.publishedToAll) return true;
  if(Array.isArray(rec.allowedUsers) && rec.allowedUsers.includes(userId)) return true;
  return false;
}

/* ---------------- API ---------------- */
module.exports = async (req,res)=>{
  try{
    const s = getSession(req);
    if(!s) return json(res,401,{error:'Not authenticated'});

    const users = await loadUsers();
    const me = users[s.userId] || { role:'viewer', permissions:{} };
    const isAdmin = me.role === 'admin';

    const dash = req.query.dash ? String(req.query.dash) : null;
    const list = req.query.list !== undefined;
    const merge = req.query.merge !== undefined;
    const publish = req.query.publish !== undefined;
    const unpublish = req.query.unpublish !== undefined;
    const del = req.query.delete !== undefined;

    /* ===== LIST ===== */
    if(req.method==='GET' && list){
      const idx = await loadIndex();
      const arr = [];
      for(const id in idx){
        const d = idx[id];
        if(!isVisibleTo(d, s.userId, isAdmin)) continue;
        arr.push({
          id: d.id || id,
          name: d.name || 'Untitled',
          createdAt: d.createdAt || null,
          updatedAt: d.updatedAt || null,
          published: !!d.published,
          publishedAt: d.publishedAt || null
        });
      }
      arr.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
      return json(res,200,{dashboards:arr});
    }

    /* ===== GET ===== */
    if(req.method==='GET' && dash){
      const idx = await loadIndex();
      const rec = idx[dash];
      if(!rec) return json(res,404,{error:'Not found'});
      if(!isVisibleTo(rec, s.userId, isAdmin)) return json(res,403,{error:'Forbidden'});
      const d = await loadDash(dash);
      if(!d.exists) return json(res,404,{error:'Not found'});
      const state = normalizeStateFromFile(d.data);
      return json(res,200,{ id:rec.id||dash, name:rec.name||'Untitled', meta:{
        ownerId: rec.ownerId,
        published: !!rec.published,
        publishedToAll: !!rec.publishedToAll,
        allowedUsers: rec.allowedUsers || [],
        publishedAt: rec.publishedAt || null
      }, state });
    }

    /* ===== RUN MERGE (PATCH) ===== */
    if(req.method==='POST' && dash && merge){
      const body = await readBody(req);
      if(!body.patch) return json(res,400,{error:'patch required'});
      const idx = await loadIndex();
      const rec = idx[dash];
      if(!rec) return json(res,404,{error:'Not found'});
      if(rec.ownerId!==s.userId && !isAdmin) return json(res,403,{error:'Forbidden'});
      const d = await loadDash(dash);
      if(!d.exists) return json(res,404,{error:'Not found'});
      const cur = normalizeStateFromFile(d.data);
      const next = deepMerge(cur, body.patch);
      rec.updatedAt = new Date().toISOString();
      idx[dash] = rec;
      await ghPutFileRetry(d.path, JSON.stringify({id:dash,name:rec.name||dash,state:next},null,2),'merge dashboard', d.sha);
      await saveIndex(idx);
      return json(res,200,{ok:true,mode:'merge'});
    }

    /* ===== BUILD SAVE (CREATE/REPLACE) ===== */
    if(req.method==='POST' && dash && !merge && !publish && !unpublish && !del){
      const body = await readBody(req);
      const state = body.state || {};
      const name = body.name || (state.__meta && state.__meta.name) || dash;
      const idx = await loadIndex();
      const now = new Date().toISOString();
      const rec = idx[dash] || { id:dash, ownerId:s.userId, createdAt:now, allowedUsers:[s.userId], published:false, publishedToAll:false };
      if(rec.ownerId!==s.userId && !isAdmin) return json(res,403,{error:'Forbidden'});
      rec.id = dash; rec.name = name; rec.updatedAt = now;
      idx[dash] = rec;
      const d = await loadDash(dash);
      const sha = d.exists ? d.sha : null;
      await ghPutFileRetry(d.path || `${DASH_DIR}/${dash}.json`, JSON.stringify({id:dash,name,state},null,2),'save dashboard', sha);
      await saveIndex(idx);
      return json(res,200,{ok:true,mode:'replace'});
    }

    /* ===== PUBLISH ===== */
    if(req.method==='POST' && dash && publish){
      const body = await readBody(req);
      const allFlag = !!body.all;
      const usersList = Array.isArray(body.users) ? body.users.map(String).filter(Boolean) : [];
      const idx = await loadIndex();
      const rec = idx[dash];
      if(!rec) return json(res,404,{error:'Not found'});
      if(rec.ownerId!==s.userId && !isAdmin) return json(res,403,{error:'Forbidden'});
      const now = new Date().toISOString();
      rec.published = true;
      rec.publishedToAll = allFlag;
      rec.allowedUsers = allFlag ? [rec.ownerId] : Array.from(new Set([rec.ownerId, ...usersList]));
      rec.publishedAt = now;
      rec.updatedAt = now;
      idx[dash] = rec;
      await saveIndex(idx);
      return json(res,200,{ok:true});
    }

    /* ===== UNPUBLISH ===== */
    if(req.method==='POST' && dash && unpublish){
      const idx = await loadIndex();
      const rec = idx[dash];
      if(!rec) return json(res,404,{error:'Not found'});
      if(rec.ownerId!==s.userId && !isAdmin) return json(res,403,{error:'Forbidden'});
      rec.published = false;
      rec.publishedToAll = false;
      rec.allowedUsers = [rec.ownerId];
      rec.updatedAt = new Date().toISOString();
      idx[dash] = rec;
      await saveIndex(idx);
      return json(res,200,{ok:true});
    }

    /* ===== DELETE ===== */
    if((req.method==='DELETE' && dash) || (req.method==='POST' && dash && del)){
      const idx = await loadIndex();
      const rec = idx[dash];
      if(!rec) return json(res,404,{error:'Not found'});
      if(rec.ownerId!==s.userId && !isAdmin) return json(res,403,{error:'Forbidden'});
      const d = await loadDash(dash);
      if(d.exists) await ghDeleteFile(d.path, `delete dashboard ${dash}`, d.sha);
      delete idx[dash];
      await saveIndex(idx);
      return json(res,200,{ok:true});
    }

    return json(res,400,{error:'Bad request'});
  }catch(e){
    return json(res,500,{error:e.message||String(e)});
  }
};
