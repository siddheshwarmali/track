// api/state.js — FINAL FIX (PUBLISH / VISIBILITY RESTORED)
// =============================================================
// Fixes specifically:
// ✔ Publish
// ✔ Unpublish
// ✔ Published dashboards visible in Run
// ✔ Private dashboards hidden
// =============================================================

const { json, readBody } = require('./_lib/http');
const { getSession } = require('./_lib/cookie');
const { ghGetFile, ghPutFileRetry, ghDeleteFile, decodeContent } = require('./_lib/github');

const INDEX_PATH = 'db/dashboards/index.json';
const DASH_DIR = 'db/dashboards';

/* ---------- utilities ---------- */
function safeParse(t, fb){ try{ return JSON.parse(t); }catch{ return fb; } }
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(a,b){ if(!isObj(a)||!isObj(b)) return b; const o={...a}; for(const k in b){ if(b[k]===undefined) continue; o[k]=isObj(o[k])&&isObj(b[k])?deepMerge(o[k],b[k]):b[k]; } return o; }

/* ---------- loaders ---------- */
async function loadIndex(){
  const f = await ghGetFile(INDEX_PATH);
  if(!f.exists){
    const init={ dashboards:{} };
    await ghPutFileRetry(INDEX_PATH, JSON.stringify(init,null,2),'init index');
    return {};
  }
  const raw = safeParse(decodeContent(f),{});
  return isObj(raw.dashboards) ? raw.dashboards : {};
}

async function saveIndex(d){
  await ghPutFileRetry(INDEX_PATH, JSON.stringify({dashboards:d},null,2),'save index');
}

async function loadDash(id){
  try{
    const f = await ghGetFile(`${DASH_DIR}/${id}.json`);
    if(!f.exists) return null;
    return { sha:f.sha, data:safeParse(decodeContent(f),{}) };
  }catch{ return null; }
}

/* ---------- visibility helper ---------- */
function isVisible(meta, userId){
  if(!meta) return false;
  if(meta.ownerId === userId) return true;
  if(meta.published === true) return true;
  return false;
}

/* ---------- API ---------- */
module.exports = async (req,res)=>{
  try{
    const sess = getSession(req);
    if(!sess) return json(res,401,{error:'Not authenticated'});

    const dash = req.query.dash;
    const list = req.query.list !== undefined;
    const merge = req.query.merge !== undefined;
    const publish = req.query.publish !== undefined;
    const unpublish = req.query.unpublish !== undefined;

    /* ===== LIST (VISIBILITY FIX) ===== */
    if(req.method==='GET' && list){
      const idx = await loadIndex();
      const out = [];
      for(const id in idx){
        const d = idx[id];
        if(!isVisible(d, sess.userId)) continue; // 🔒 hide private dashboards
        out.push({
          id: d.id || id,
          name: d.name || 'Untitled',
          createdAt: d.createdAt || null,
          updatedAt: d.updatedAt || null,
          published: !!d.published,
          publishedAt: d.publishedAt || null
        });
      }
      return json(res,200,{dashboards:out});
    }

    /* ===== GET (VISIBILITY FIX) ===== */
    if(req.method==='GET' && dash){
      const idx = await loadIndex();
      const meta = idx[dash];
      if(!meta) return json(res,404,{error:'Not found'});
      if(!isVisible(meta, sess.userId)) return json(res,403,{error:'Forbidden'});
      const f = await loadDash(dash);
      return json(res,200,{ id:dash, name:meta.name||'Untitled', meta, state:f?.data?.state||{} });
    }

    /* ===== RUN MERGE ===== */
    if(req.method==='POST' && dash && merge){
      const body = await readBody(req);
      if(!body.patch) return json(res,400,{error:'patch required'});
      const idx = await loadIndex();
      if(!idx[dash]) return json(res,404,{error:'Not found'});
      const f = await loadDash(dash);
      const cur = f?.data?.state || {};
      const next = deepMerge(cur, body.patch);
      idx[dash].updatedAt = new Date().toISOString();
      await saveIndex(idx);
      await ghPutFileRetry(`${DASH_DIR}/${dash}.json`, JSON.stringify({id:dash,name:idx[dash].name||'Untitled',state:next},null,2),'merge run',f?.sha);
      return json(res,200,{ok:true});
    }

    /* ===== BUILD SAVE + CREATE ===== */
    if(req.method==='POST' && dash && !merge && !publish && !unpublish){
      const body = await readBody(req);
      const idx = await loadIndex();
      const now = new Date().toISOString();

      if(!idx[dash]){
        idx[dash] = { id:dash, name:body.name||'New Dashboard', ownerId:sess.userId, createdAt:now, updatedAt:now, published:false };
      } else {
        if(body.name) idx[dash].name = body.name;
        idx[dash].updatedAt = now;
      }

      const f = await loadDash(dash);
      const cur = f?.data?.state || {};
      const next = { ...cur, build: body.state || body.state?.build || cur.build || {} };

      await saveIndex(idx);
      await ghPutFileRetry(`${DASH_DIR}/${dash}.json`, JSON.stringify({id:dash,name:idx[dash].name,state:next},null,2),'save build',f?.sha);
      return json(res,200,{ok:true});
    }

    /* ===== DELETE ===== */
    if((req.method==='DELETE' && dash) || (req.method==='POST' && dash && req.query.delete!==undefined)){
      const idx = await loadIndex();
      if(!idx[dash]) return json(res,404,{error:'Not found'});
      delete idx[dash];
      await saveIndex(idx);
      try{ await ghDeleteFile(`${DASH_DIR}/${dash}.json`,'delete dashboard'); }catch{}
      return json(res,200,{ok:true});
    }

    /* ===== PUBLISH ===== */
    if(req.method==='POST' && dash && publish){
      const idx = await loadIndex();
      if(!idx[dash]) return json(res,404,{error:'Not found'});
      idx[dash].published = true;
      idx[dash].publishedAt = new Date().toISOString();
      await saveIndex(idx);
      return json(res,200,{ok:true});
    }

    /* ===== UNPUBLISH ===== */
    if(req.method==='POST' && dash && unpublish){
      const idx = await loadIndex();
      if(!idx[dash]) return json(res,404,{error:'Not found'});
      idx[dash].published = false;
      delete idx[dash].publishedAt;
      await saveIndex(idx);
      return json(res,200,{ok:true});
    }

    return json(res,405,{error:'Unsupported operation'});

  }catch(e){
    return json(res,500,{error:e.message||'Server error'});
  }
};
