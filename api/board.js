const { json } = require('./_lib/http');
const { getSession } = require('./_lib/cookie');
const { ghGetFile, decodeContent } = require('./_lib/github');
const USERS_PATH='db/users.json';
const INDEX_PATH='db/dashboards/index.json';
const DASH_DIR='db/dashboards';
function parseJsonSafe(txt,fb){ try{return JSON.parse(txt);}catch{return fb;} }
function safeText(s,fb=''){ return (typeof s==='string' && s.trim())?s.trim():fb; }
async function loadUsers(){
  const f=await ghGetFile(USERS_PATH);
  if(!f.exists) return {users:{}};
  const data=parseJsonSafe((decodeContent(f)||'').trim()||'{"users":{}}',{users:{}});
  return { users:data.users||{} };
}
async function loadIndex(){
  const f=await ghGetFile(INDEX_PATH);
  if(!f.exists) return {dashboards:{}};
  const data=parseJsonSafe((decodeContent(f)||'').trim()||'{"dashboards":{}}',{dashboards:{}});
  return { dashboards:data.dashboards||{} };
}
async function loadDashState(id){
  const f=await ghGetFile(`${DASH_DIR}/${id}.json`);
  if(!f.exists) return null;
  const data=parseJsonSafe((decodeContent(f)||'').trim()||'{}',{});
  return data.state||null;
}
function isVisibleTo(d,userId){
  if(d.ownerId===userId) return true;
  if(d.publishedToAll) return true;
  if(Array.isArray(d.allowedUsers) && d.allowedUsers.includes(userId)) return true;
  return false;
}
function pickMilestones(state){
  const arr=Array.isArray(state?.executive?.milestones)?state.executive.milestones:[];
  const items=arr.slice(0,3).map(x=>{ const t=safeText(x?.title||x?.name||'Milestone'); const dt=safeText(x?.date||x?.dueDate||''); return dt?`${t} — ${dt}`:t; });
  return { count: arr.length, items };
}
function pickApplication(state){
  const us=Array.isArray(state?.executive?.userStories)?state.executive.userStories:[];
  const bugs=Array.isArray(state?.executive?.bugs)?state.executive.bugs:[];
  const usOpen=us.filter(x=>String(x?.stage||x?.status||'').toLowerCase()!=='closed').length;
  const bugsOpen=bugs.filter(x=>String(x?.stage||x?.status||'').toLowerCase()!=='closed').length;
  return { userStories: us.length, bugs: bugs.length, usOpen, bugsOpen };
}
function pickDiscipline(state){
  const d=Array.isArray(state?.executive?.taskDisciplines)?state.executive.taskDisciplines:[];
  const pending=Array.isArray(state?.executive?.pendingDisciplineData)?state.executive.pendingDisciplineData.length:0;
  return { disciplines: d.length, pending };
}
function sortItems(items, mode){
  const m=(mode||'newest');
  if(m==='oldest') return items.sort((a,b)=>(a.publishedAt||a.updatedAt||'').localeCompare(b.publishedAt||b.updatedAt||''));
  if(m==='name_asc') return items.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  if(m==='name_desc') return items.sort((a,b)=>String(b.name||'').localeCompare(String(a.name||'')));
  return items.sort((a,b)=>(b.publishedAt||b.updatedAt||'').localeCompare(a.publishedAt||a.updatedAt||''));
}
module.exports=async(req,res)=>{
  try{
    const sess=getSession(req);
    if(!sess) return json(res,401,{error:'Not authenticated'});
    const { users } = await loadUsers();
    const me = users[sess.userId] || { role:'viewer', permissions:{} };
    if(!(me.role==='admin' || (me.permissions&&me.permissions.executiveBoard))) return json(res,403,{error:'Forbidden: Executive Board access required'});

    const sort = (req.query && req.query.sort) ? String(req.query.sort) : 'newest';
    const idx = await loadIndex();
    const vis = Object.values(idx.dashboards).filter(d=>d && d.published).filter(d=>isVisibleTo(d, sess.userId));

    const items=[];
    for(const d of vis){
      const state = await loadDashState(d.id);
      items.push({
        id:d.id, name:d.name, ownerId:d.ownerId, publishedAt:d.publishedAt||d.updatedAt, updatedAt:d.updatedAt,
        summary: safeText(state?.executive?.savedSummaryText||'') || 'No summary',
        milestones: pickMilestones(state),
        application: pickApplication(state),
        discipline: pickDiscipline(state)
      });
    }
    sortItems(items, sort);
    return json(res,200,{items});
  }catch(e){ return json(res,500,{error:e.message||String(e)}); }
};
