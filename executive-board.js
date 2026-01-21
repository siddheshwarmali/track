<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Executive Board</title>
  <style>
    :root{--bg:#0b1220;--card:#0f172a;--muted:#94a3b8;--text:#e2e8f0;--line:#1f2a44;--accent:#6366f1;--good:#10b981;--warn:#f59e0b;}
    *{box-sizing:border-box}
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:linear-gradient(180deg,#070b15,#0b1220 40%,#0b1220);color:var(--text)}
    a{color:inherit}
    .topbar{position:sticky;top:0;z-index:50;background:rgba(11,18,32,.72);backdrop-filter:blur(10px);border-bottom:1px solid rgba(148,163,184,.15)}
    .wrap{max-width:1200px;margin:0 auto;padding:16px}
    .row{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
    .title{display:flex;flex-direction:column;gap:2px}
    .title h1{margin:0;font-size:18px;letter-spacing:.2px}
    .title p{margin:0;color:var(--muted);font-size:12px}
    .controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
    .pill{display:inline-flex;gap:8px;align-items:center;padding:8px 10px;border:1px solid rgba(148,163,184,.18);border-radius:999px;background:rgba(15,23,42,.6)}
    select,input{background:transparent;color:var(--text);border:0;outline:none;font-size:13px}
    .btn{cursor:pointer;user-select:none;border:1px solid rgba(148,163,184,.18);background:rgba(15,23,42,.65);color:var(--text);border-radius:12px;padding:10px 12px;font-size:13px}
    .btn:hover{border-color:rgba(99,102,241,.6)}
    .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px;margin-top:14px}
    .card{grid-column:span 12;background:linear-gradient(180deg,rgba(15,23,42,.82),rgba(15,23,42,.65));border:1px solid rgba(148,163,184,.16);border-radius:18px;overflow:hidden}
    .card-h{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;padding:14px 14px 10px 14px;border-bottom:1px solid rgba(148,163,184,.12)}
    .card-h h2{margin:0;font-size:16px}
    .meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
    .tag{font-size:11px;color:var(--muted);border:1px solid rgba(148,163,184,.16);border-radius:999px;padding:4px 8px;background:rgba(2,6,23,.4)}
    .tag.accent{border-color:rgba(99,102,241,.35);color:#c7d2fe}
    .content{padding:12px 14px 14px 14px}
    .sections{display:grid;grid-template-columns:repeat(12,1fr);gap:12px}
    .sec{grid-column:span 12;border:1px solid rgba(148,163,184,.14);border-radius:16px;padding:12px;background:rgba(2,6,23,.25)}
    .sec h3{margin:0 0 6px 0;font-size:13px;color:#cbd5e1;letter-spacing:.2px}
    .sec p{margin:0;color:var(--muted);font-size:13px;line-height:1.4}
    .kpis{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
    .kpi{flex:1;min-width:140px;border:1px solid rgba(148,163,184,.12);border-radius:14px;padding:10px;background:rgba(15,23,42,.35)}
    .kpi .lbl{color:var(--muted);font-size:11px}
    .kpi .val{font-size:16px;font-weight:700;margin-top:2px}
    .list{margin:6px 0 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
    .li{display:flex;gap:8px;align-items:flex-start}
    .dot{width:8px;height:8px;border-radius:999px;background:var(--accent);margin-top:6px;flex:0 0 auto}
    .li span{color:var(--muted);font-size:13px;line-height:1.35}
    .actions{display:flex;gap:8px;align-items:center;margin-top:12px}
    .link{color:#c7d2fe;text-decoration:none;border:1px solid rgba(99,102,241,.35);background:rgba(99,102,241,.12);padding:8px 10px;border-radius:12px;font-size:12px}
    .link:hover{background:rgba(99,102,241,.18)}
    .status{margin-top:14px;color:var(--muted);font-size:13px}
    .error{margin-top:12px;padding:12px;border-radius:14px;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.08);color:#fecaca;font-size:13px;display:none}

    @media (min-width: 720px){
      .sec{grid-column:span 6}
    }
    @media (min-width: 1024px){
      .sec{grid-column:span 3}
      .card{grid-column:span 12}
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="wrap">
      <div class="row">
        <div class="title">
          <h1>Executive Board</h1>
          <p>Single view of all published dashboards (Summary • Milestones • Application Tracker • Task Discipline)</p>
        </div>
        <div class="controls">
          <div class="pill">
            <span style="color:var(--muted);font-size:12px">Sort</span>
            <select id="sort">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name_asc">Name A → Z</option>
              <option value="name_desc">Name Z → A</option>
            </select>
          </div>
          <div class="pill">
            <span style="color:var(--muted);font-size:12px">Search</span>
            <input id="q" placeholder="Project name..." />
          </div>
          <a class="btn" href="/index.html">Back to Dashboard</a>
        </div>
      </div>
      <div id="err" class="error"></div>
      <div id="status" class="status">Loading…</div>
    </div>
  </div>

  <div class="wrap">
    <div id="grid" class="grid"></div>
  </div>

<script>
  async function jget(url){
    const r = await fetch(url, { headers: { 'Accept':'application/json' } });
    const t = await r.text();
    let j={};
    try{ j = JSON.parse(t||'{}'); }catch{ j={}; }
    if(!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }

  function fmtDate(iso){
    if(!iso) return '—';
    try{ return new Date(iso).toLocaleString(); }catch{ return iso; }
  }

  function safeText(s, fallback='—'){
    if(typeof s !== 'string') return fallback;
    const x=s.trim();
    return x ? x : fallback;
  }

  function topItems(arr, mapFn, n=3){
    if(!Array.isArray(arr) || arr.length===0) return [];
    return arr.slice(0,n).map(mapFn);
  }

  function cardTemplate(d){
    const name = safeText(d.name, d.id);
    const publishedAt = fmtDate(d.publishedAt || d.updatedAt);
    const owner = safeText(d.ownerId,'');

    const summary = safeText(d.summary, 'No summary');

    const mCount = d.milestones?.count ?? 0;
    const mItems = d.milestones?.items || [];

    const app = d.application || { userStories:0, bugs:0, usOpen:0, bugsOpen:0 };

    const disc = d.discipline || { disciplines:0, pending:0, top:[] };

    return `
      <div class="card" data-name="${name.toLowerCase()}">
        <div class="card-h">
          <div>
            <h2>${name}</h2>
            <div class="meta" style="margin-top:6px; justify-content:flex-start">
              <span class="tag accent">Published: ${publishedAt}</span>
              ${owner ? `<span class="tag">Owner: ${owner}</span>` : ''}
            </div>
          </div>
          <div class="meta">
            <span class="tag">Milestones: <b>${mCount}</b></span>
            <span class="tag">US: <b>${app.userStories}</b></span>
            <span class="tag">Bugs: <b>${app.bugs}</b></span>
            <span class="tag">Disciplines: <b>${disc.disciplines}</b></span>
          </div>
        </div>

        <div class="content">
          <div class="sections">
            <div class="sec">
              <h3>Overall Summary</h3>
              <p>${summary}</p>
            </div>
            <div class="sec">
              <h3>Project Milestones</h3>
              <p>${mCount ? `Top milestones:` : 'No milestones found.'}</p>
              <ul class="list">
                ${mItems.map(x=>`<li class="li"><span class="dot"></span><span>${x}</span></li>`).join('')}
              </ul>
            </div>
            <div class="sec">
              <h3>Application Tracker</h3>
              <div class="kpis">
                <div class="kpi"><div class="lbl">User Stories</div><div class="val">${app.userStories}</div></div>
                <div class="kpi"><div class="lbl">Bugs</div><div class="val">${app.bugs}</div></div>
              </div>
              <p style="margin-top:8px">Open: US <b>${app.usOpen}</b> • Bugs <b>${app.bugsOpen}</b></p>
            </div>
            <div class="sec">
              <h3>Task Discipline Tracker</h3>
              <div class="kpis">
                <div class="kpi"><div class="lbl">Disciplines</div><div class="val">${disc.disciplines}</div></div>
                <div class="kpi"><div class="lbl">Pending</div><div class="val">${disc.pending}</div></div>
              </div>
              <ul class="list">
                ${(disc.top||[]).map(x=>`<li class="li"><span class="dot" style="background:#10b981"></span><span>${x}</span></li>`).join('')}
              </ul>
            </div>
          </div>

          <div class="actions">
            <a class="link" href="/index.html?dash=${encodeURIComponent(d.id)}">Open Dashboard</a>
          </div>
        </div>
      </div>
    `;
  }

  function applySearch(){
    const q = (document.getElementById('q').value || '').trim().toLowerCase();
    document.querySelectorAll('#grid .card').forEach(c=>{
      const n = c.getAttribute('data-name') || '';
      c.style.display = (!q || n.includes(q)) ? '' : 'none';
    });
  }

  async function load(){
    const err = document.getElementById('err');
    const status = document.getElementById('status');
    err.style.display='none';
    status.textContent='Checking access…';

    // Auth gate
    const me = await jget('/api/auth/me');
    if(!me || !me.authenticated){
      location.href = '/login.html?next=' + encodeURIComponent('/executive-board.html');
      return;
    }
    if(!(me.role === 'admin' || me.role === 'executive')){
      err.textContent = 'Access denied: admin has not granted you Executive Board access.';
      err.style.display = 'block';
      status.textContent = '—';
      return;
    }

    status.textContent='Loading published dashboards…';

    try{
      const sort = document.getElementById('sort').value;
      const data = await jget('/api/board?sort=' + encodeURIComponent(sort));
      const items = Array.isArray(data.items) ? data.items : [];

      const grid = document.getElementById('grid');
      if(items.length === 0){
        grid.innerHTML = '<div class="status">No published dashboards available for you.</div>';
        status.textContent='—';
        return;
      }

      grid.innerHTML = items.map(cardTemplate).join('');
      status.textContent = `Showing ${items.length} dashboard(s).`;
      applySearch();

    } catch(e){
      err.textContent = e.message || String(e);
      err.style.display='block';
      status.textContent='—';
    }
  }

  document.getElementById('sort').addEventListener('change', load);
  document.getElementById('q').addEventListener('input', applySearch);

  load();
</script>
</body>
</html>
