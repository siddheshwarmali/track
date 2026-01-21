
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Executive Board</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;background:#0b1220;color:#e2e8f0}
  .wrap{max-width:1200px;margin:0 auto;padding:14px}
  .top{position:sticky;top:0;background:rgba(11,18,32,.85);backdrop-filter:blur(10px);border-bottom:1px solid rgba(148,163,184,.15)}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
  .pill{display:flex;gap:8px;align-items:center;border:1px solid rgba(148,163,184,.18);border-radius:999px;padding:8px 10px;background:rgba(15,23,42,.55)}
  select,input{background:transparent;border:0;outline:none;color:#e2e8f0;font-size:13px}
  .btn{border:1px solid rgba(148,163,184,.18);background:rgba(15,23,42,.65);color:#e2e8f0;border-radius:12px;padding:10px 12px;font-size:13px;text-decoration:none}
  .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px;margin-top:12px}
  .card{grid-column:span 12;border:1px solid rgba(148,163,184,.16);border-radius:18px;background:rgba(15,23,42,.72);overflow:hidden}
  .ch{padding:14px;border-bottom:1px solid rgba(148,163,184,.12);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .ch h2{margin:0;font-size:16px}
  .tag{font-size:11px;color:#94a3b8;border:1px solid rgba(148,163,184,.16);border-radius:999px;padding:4px 8px;background:rgba(2,6,23,.3)}
  .content{padding:14px}
  .sections{display:grid;grid-template-columns:repeat(12,1fr);gap:12px}
  .sec{grid-column:span 12;border:1px solid rgba(148,163,184,.14);border-radius:16px;padding:12px;background:rgba(2,6,23,.25)}
  .sec h3{margin:0 0 6px 0;font-size:13px;color:#cbd5e1}
  .sec p{margin:0;color:#94a3b8;font-size:13px;line-height:1.4}
  @media(min-width:720px){.sec{grid-column:span 6}}
  @media(min-width:1024px){.sec{grid-column:span 3}}
</style>
</head>
<body>
<div class="top"><div class="wrap"><div class="row">
  <div>
    <div style="font-size:18px;font-weight:800">Executive Board</div>
    <div style="color:#94a3b8;font-size:12px">Published dashboards in card view (Summary • Milestones • Application • Discipline)</div>
  </div>
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <div class="pill"><span style="color:#94a3b8;font-size:12px">Sort</span>
      <select id="sort"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name_asc">Name A→Z</option><option value="name_desc">Name Z→A</option></select>
    </div>
    <div class="pill"><span style="color:#94a3b8;font-size:12px">Search</span><input id="q" placeholder="Project name"/></div>
    <a class="btn" href="/index.html">Back</a>
  </div>
</div>
<div id="msg" style="margin-top:10px;color:#94a3b8;font-size:13px">Loading…</div>
<div id="err" style="display:none;margin-top:10px;padding:12px;border-radius:14px;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.08);color:#fecaca;font-size:13px"></div>
</div></div>

<div class="wrap"><div id="grid" class="grid"></div></div>

<script>
async function jget(url){
  const r = await fetch(url, { headers:{'Accept':'application/json'} });
  const t = await r.text();
  let j={}; try{ j=JSON.parse(t||'{}'); }catch{ j={}; }
  if(!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
function fmt(iso){ try{return new Date(iso).toLocaleString()}catch{return iso||'—'} }
function esc(s){ return String(s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function card(d){
  const ms = (d.milestones?.items||[]).map(x=>`<li style="color:#94a3b8;font-size:13px">• ${esc(x)}</li>`).join('');
  return `
  <div class="card" data-name="${esc((d.name||'').toLowerCase())}">
    <div class="ch">
      <div><h2>${esc(d.name||d.id)}</h2><div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap"><span class="tag">Published: ${fmt(d.publishedAt||d.updatedAt)}</span><span class="tag">Owner: ${esc(d.ownerId||'')}</span></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="tag">Milestones: <b>${d.milestones?.count||0}</b></span><span class="tag">US: <b>${d.application?.userStories||0}</b></span><span class="tag">Bugs: <b>${d.application?.bugs||0}</b></span><span class="tag">Disc: <b>${d.discipline?.disciplines||0}</b></span></div>
    </div>
    <div class="content"><div class="sections">
      <div class="sec"><h3>Overall Summary</h3><p>${esc(d.summary||'No summary')}</p></div>
      <div class="sec"><h3>Project Milestones</h3><p style="margin-bottom:6px">Top milestones:</p><ul style="margin:0;padding:0;list-style:none">${ms||'<li style="color:#94a3b8;font-size:13px">No milestones</li>'}</ul></div>
      <div class="sec"><h3>Application Tracker</h3><p>US: <b>${d.application?.userStories||0}</b> (Open ${d.application?.usOpen||0})</p><p>Bugs: <b>${d.application?.bugs||0}</b> (Open ${d.application?.bugsOpen||0})</p></div>
      <div class="sec"><h3>Task Discipline Tracker</h3><p>Disciplines: <b>${d.discipline?.disciplines||0}</b></p><p>Pending: <b>${d.discipline?.pending||0}</b></p></div>
    </div>
    <div style="margin-top:12px"><a class="btn" style="display:inline-block" href="/index.html?dash=${encodeURIComponent(d.id)}">Open Dashboard</a></div>
    </div>
  </div>`;
}
function applySearch(){
  const q=(document.getElementById('q').value||'').trim().toLowerCase();
  document.querySelectorAll('#grid .card').forEach(c=>{
    const n=c.getAttribute('data-name')||'';
    c.style.display = (!q||n.includes(q))?'':'none';
  });
}
async function load(){
  const msg=document.getElementById('msg');
  const err=document.getElementById('err');
  err.style.display='none';
  msg.textContent='Checking access…';
  const me = await jget('/api/auth/me');
  if(!me.authenticated){ location.href='/login.html?next='+encodeURIComponent('/executive-board.html'); return; }
  const perms = me.permissions||{};
  if(!(me.role==='admin' || perms.executiveBoard)){
    err.textContent='Access denied: admin has not granted Executive Board access.'; err.style.display='block'; msg.textContent='—'; return;
  }
  msg.textContent='Loading…';
  const sort=document.getElementById('sort').value;
  const data = await jget('/api/board?sort='+encodeURIComponent(sort));
  const items = Array.isArray(data.items)?data.items:[];
  document.getElementById('grid').innerHTML = items.map(card).join('') || '<div style="color:#94a3b8">No published dashboards available.</div>';
  msg.textContent = `Showing ${items.length} dashboard(s).`;
  applySearch();
}

document.getElementById('sort').addEventListener('change', load);
document.getElementById('q').addEventListener('input', applySearch);
load().catch(e=>{ const err=document.getElementById('err'); err.textContent=e.message||String(e); err.style.display='block'; document.getElementById('msg').textContent='—'; });
</script>
</body>
</html>
