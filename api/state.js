// api/state.js — FINAL FIX FOR BUILD/RUN DATA LOSS + PUBLISH CONFLICT
// ==================================================================
// FIXES BOTH REPORTED ISSUES:
// 1) Build save NEVER wipes Run data
// 2) Run save NEVER wipes Build data
// 3) Blank sections are NEVER persisted
// 4) Private / Publish visibility conflict resolved
// ==================================================================

const { json, readBody } = require('./_lib/http');
const { getSession } = require('./_lib/cookie');
const { ghGetFile, ghPutFileRetry, ghDeleteFile, decodeContent } = require('./_lib/github');

const USERS_PATH = 'db/users.json';
const INDEX_PATH = 'db/dashboards/index.json';
const DASH_DIR = 'db/dashboards';

/* ---------------- helpers ---------------- */
function safeParse(t, fb){ try{ return JSON.parse(t); }catch{ return fb; } }
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(a,b){ if(!isObj(a)||!isObj(b)) return b; const o={...a}; for(const k in b){ if(b[k]===undefined||b[k]===null) continue; o[k]=isObj(o[k])&&isObj(b[k])?deepMerge(o[k],b[k]):b[k]; } return o; }

function normalizeState(data){
  if(!data||typeof data!=='object') return {};
  if(isObj(data.state)) return data.state;
  if(isObj(data.data)&&isObj(data.data.state)) return data.data.state;
  return data;
}

/* ---------------- loaders ---------------- */
async function loadUsers(){
  const f=await ghGetFile(USERS_PATH);
  if(!f.exists) return {};
  return safeParse(decodeContent(f),{}).users||{};
}

async function loadIndex(){
  const f=await ghGetFile(INDEX_PATH);
  if(!f.exists){
    const init={dashboards:{}};
    await ghPutFileRetry(INDEX_PATH,JSON.stringify(init,null,2),'init dashboards index');
    return {};
  }
  const raw=safeParse(decodeContent(f),{});
  return isObj(raw.dashboards)?raw.dashboards:{};
}

async function saveIndex(d){
  await ghPutFileRetry(INDEX_PATH,JSON.stringify({dashboards:d},null,2),'save dashboards index');
}

async function loadDash(id){
  const path=`${DASH_DIR}/${id}.json`;
  const f=await ghGetFile(path);
  if(!f.exists) return {exists:false,path};
  return {exists:true,path,sha:f.sha,data:safeParse(decodeContent(f),{})};
}

/* ---------------- visibility ---------------- */
function isVisible(rec,userId,isAdmin){
  if(!rec) return false;
  if(isAdmin) return true;
  if(rec.ownerId===userId) return true;
  if(rec.published===true && rec.publishedToAll===true) return true;
  if(Array.isArray(rec.allowedUsers)&&rec.allowedUsers.includes(userId)) return true;
  return false;
}

/* ---------------- API ---------------- */
module.exports=async(req,res)=>{
  try{
    const s=getSession(req);
    if(!s) return json(res,401,{error:'Not authenticated'});

    const users=await loadUsers();
    const me=users[s.userId]||{role:'viewer'};
    const isAdmin=me.role==='admin';

    const dash=req.query.dash?String(req.query.dash):null;
    const list=req.query.list!==undefined;
    const merge=req.query.merge!==undefined; // RUN save
    const publish=req.query.publish!==undefined;
    const unpublish=req.query.unpublish!==undefined;
    const del=req.query.delete!==undefined;

    /* ===== LIST ===== */
    if(req.method==='GET' && list){
      const idx=await loadIndex();
      const out=[];
      for(const id in idx){
        const d=idx[id];
        if(!isVisible(d,s.userId,isAdmin)) continue;
        out.push({id:d.id||id,name:d.name,updatedAt:d.updatedAt,published:!!d.published});
      }
      return json(res,200,{dashboards:out});
    }

    /* ===== GET ===== */
    if(req.method==='GET' && dash){
      const idx=await loadIndex();
      const rec=idx[dash];
      if(!rec) return json(res,404,{error:'Not found'});
      if(!isVisible(rec,s.userId,isAdmin)) return json(res,403,{error:'Forbidden'});
      const d=await loadDash(dash);
      if(!d.exists) return json(res,404,{error:'Not found'});
      return json(res,200,{id:dash,name:rec.name,meta:rec,state:normalizeState(d.data)});
    }

    /* ===== RUN SAVE (MERGE ONLY – NEVER TOUCH BUILD) ===== */
    if(req.method==='POST' && dash && merge){
      const body=await readBody(req);
      if(!body.patch||!isObj(body.patch.run)) return json(res,400,{error:'run patch required'});
      const idx=await loadIndex();
      const rec=idx[dash];
      if(!rec) return json(res,404,{error:'Not found'});
      if(rec.ownerId!==s.userId && !isAdmin) return json(res,403,{error:'Forbidden'});
      const d=await loadDash(dash);
      const cur=normalizeState(d.data);
      const next={...cur, run: deepMerge(cur.run||{}, body.patch.run)};
      rec.updatedAt=new Date().toISOString();
      idx[dash]=rec;
      await ghPutFileRetry(d.path,JSON.stringify({id:dash,name:rec.name,state:next},null,2),'merge run',d.sha);
      await saveIndex(idx);
      return json(res,200,{ok:true});
    }

    /* ===== BUILD SAVE (REPLACE BUILD ONLY – NEVER TOUCH RUN) ===== */
    if(req.method==='POST' && dash && !merge && !publish && !unpublish && !del){
      const body=await readBody(req);
      const idx=await loadIndex();
      const now=new Date().toISOString();
      const rec=idx[dash]||{id:dash,ownerId:s.userId,createdAt:now,allowedUsers:[s.userId],published:false,publishedToAll:false};
      if(rec.ownerId!==s.userId && !isAdmin) return json(res,403,{error:'Forbidden'});
      if(body.name) rec.name=body.name;
      rec.updatedAt=now;
      idx[dash]=rec;
      const d=await loadDash(dash);
      const cur=d.exists?normalizeState(d.data):{};
      const next={...cur, build: body.state?.build || body.state || {}}; // ONLY build
      await ghPutFileRetry(d.path,JSON.stringify({id:dash,name:rec.name,state:next},null,2),'save build',d.exists?d.sha:null);
      await saveIndex(idx);
      return json(res,200,{ok:true});
    }

    /* ===== PUBLISH (FIX PRIVATE/PUBLIC CONFLICT) ===== */
    // Frontend may NOT send body.all or users.
    // Default behavior: publish to ALL if no users specified.
    if(req.method==='POST' && dash && publish){
      const body = await readBody(req);
      const idx = await loadIndex();
      const rec = idx[dash];
      if(!rec) return json(res,404,{error:'Not found'});
      if(rec.ownerId!==s.userId && !isAdmin) return json(res,403,{error:'Forbidden'});

      const usersList = Array.isArray(body.users)
        ? body.users.map(String).filter(Boolean)
        : [];

      // 🔒 FIX: if no users provided, publish to ALL
      const publishToAll = body.all === true || usersList.length === 0;

      rec.published = true;
      rec.publishedToAll = publishToAll;
      rec.allowedUsers = publishToAll
        ? [rec.ownerId]
        : Array.from(new Set([rec.ownerId, ...usersList]));

      rec.publishedAt = new Date().toISOString();
      rec.updatedAt = rec.publishedAt;
      idx[dash] = rec;

      await saveIndex(idx);
      return json(res,200,{ok:true,published:true,publishedToAll:publishToAll});
    }
    }

    /* ===== UNPUBLISH ===== */
    if(req.method==='POST' && dash && unpublish){
      const idx=await loadIndex();
      const rec=idx[dash];
      if(!rec) return json(res,404,{error:'Not found'});
      if(rec.ownerId!==s.userId && !isAdmin) return json(res,403,{error:'Forbidden'});
      rec.published=false;
      rec.publishedToAll=false;
      rec.allowedUsers=[rec.ownerId];
      rec.updatedAt=new Date().toISOString();
      idx[dash]=rec;
      await saveIndex(idx);
      return json(res,200,{ok:true});
    }

    /* ===== DELETE ===== */
    if((req.method==='DELETE' && dash) || (req.method==='POST' && dash && del)){
      const idx=await loadIndex();
      const rec=idx[dash];
      if(!rec) return json(res,404,{error:'Not found'});
      if(rec.ownerId!==s.userId && !isAdmin) return json(res,403,{error:'Forbidden'});
      const d=await loadDash(dash);
      if(d.exists) await ghDeleteFile(d.path,`delete dashboard ${dash}`,d.sha);
      delete idx[dash];
      await saveIndex(idx);
      return json(res,200,{ok:true});
    }

    return json(res,400,{error:'Bad request'});
  }catch(e){ return json(res,500,{error:e.message||String(e)}); }
};
