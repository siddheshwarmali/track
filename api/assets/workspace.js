module.exports = async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`(function(){'use strict';
  function qs(id){return document.getElementById(id);} 
  function dashId(){ try{ return new URL(location.href).searchParams.get('dash')||''; }catch(e){ return ''; } }
  function setDashInUrl(id){
    try{ var u=new URL(location.href); if(id) u.searchParams.set('dash',id); else u.searchParams.delete('dash'); location.href=u.pathname+u.search; }
    catch(e){ location.href='/run.html?dash='+encodeURIComponent(id||''); }
  }
  function toast(msg, kind){
    var t=qs('toast'); if(!t) return;
    t.textContent=msg; t.classList.remove('hidden');
    t.classList.remove('bg-emerald-600','bg-red-600','bg-slate-900');
    t.classList.add(kind==='error'?'bg-red-600':(kind==='ok'?'bg-emerald-600':'bg-slate-900'));
    clearTimeout(toast._timer);
    toast._timer=setTimeout(function(){t.classList.add('hidden');}, 2600);
  }
  function fillSelect(sel, dashboards, current){
    if(!sel) return;
    sel.innerHTML = dashboards.map(function(d){
      var id=String(d.id); var name=(d.name||d.id);
      return '<option value="'+id.replace(/"/g,'&quot;')+'">'+String(name).replace(/</g,'&lt;')+'</option>';
    }).join('') || '<option value="">No workspaces</option>';
    sel.value = current || (dashboards[0] && dashboards[0].id) || '';
  }
  async function updateIndicator(id){
    var ind=qs('ws-indicator');
    if(!ind) return;
    if(!id){ ind.textContent=''; return; }
    try{ var resp=await window.StateApi.get(id); var meta=resp&&resp.meta?resp.meta:{};
      if(meta.published){ ind.textContent = meta.publishedToAll ? 'Published (All)' : 'Published'; ind.className='text-xs text-emerald-700 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200'; }
      else { ind.textContent='Private'; ind.className='text-xs text-slate-600 px-2 py-1 rounded-full bg-slate-50 border border-slate-200'; }
    }catch(e){ ind.textContent=''; }
  }
  async function beforeSwitchSave(){
    try{ if(window.RunApp && typeof window.RunApp.saveNow==='function') await window.RunApp.saveNow(); }catch(e){}
  }
  async function switchWorkspace(id){
    if(!id) return;
    await beforeSwitchSave();
    setDashInUrl(id);
  }
  async function createWorkspace(){
    var name=prompt('New workspace name:');
    if(!name) return;
    var id='dash-'+Math.random().toString(36).slice(2,8)+'-'+Date.now().toString(36);
    var state={ __meta:{name:name}, executive:{ bauData:{} }, run:{ tickets:[] } };
    try{ await window.StateApi.save(id, state, name); toast('Workspace created','ok'); setDashInUrl(id); }
    catch(e){ toast('Create failed: '+(e.message||String(e)),'error'); }
  }
  async function renameWorkspace(){
    var id=dashId(); if(!id){ toast('Select workspace first','error'); return; }
    try{ var resp=await window.StateApi.get(id); var current=resp&&resp.name?resp.name:id; var name=prompt('Rename workspace:', current); if(!name||name===current) return;
      var st=resp&&resp.state?resp.state:{}; if(st && st.__meta) st.__meta.name=name; await window.StateApi.save(id, st, name); toast('Renamed','ok'); location.reload();
    }catch(e){ toast('Rename failed: '+(e.message||String(e)),'error'); }
  }
  async function deleteWorkspace(){
    var id=dashId(); if(!id) return; if(!confirm('Delete workspace '+id+'?')) return;
    try{ await window.StateApi.remove(id); toast('Deleted','ok'); location.href='/run.html'; }
    catch(e){ toast('Delete failed: '+(e.message||String(e)),'error'); }
  }
  function downloadText(filename, text){
    var blob=new Blob([text],{type:'application/json'}); var url=URL.createObjectURL(blob);
    var a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
  }
  async function exportWorkspace(){
    var id=dashId(); if(!id){ toast('Select workspace first','error'); return; }
    try{ var resp=await window.StateApi.get(id); downloadText((resp.name||id)+'-workspace.json', JSON.stringify(resp,null,2)); toast('Exported','ok'); }
    catch(e){ toast('Export failed: '+(e.message||String(e)),'error'); }
  }
  async function importWorkspace(file){
    try{ var text=await file.text(); var data=JSON.parse(text); var id=data.id||('dash-'+Math.random().toString(36).slice(2,8)); var name=data.name||id; var st=data.state||{};
      await window.StateApi.save(id, st, name); toast('Imported','ok'); setDashInUrl(id);
    }catch(e){ toast('Import failed: '+(e.message||String(e)),'error'); }
  }
  async function openPublishModal(){
    var id=dashId(); if(!id){ toast('Select workspace first','error'); return; }
    var box=qs('publishUsers'); if(box) box.innerHTML='Loading…';
    qs('publishAll').checked=false;
    qs('publishModal').classList.remove('hidden'); qs('publishModal').classList.add('flex');
    try{
      var r=await fetch('/api/users/list',{credentials:'same-origin',headers:{'Accept':'application/json'}});
      var t=await r.text(); var j={}; try{j=JSON.parse(t||'{}');}catch(e){j={};}
      var users=(j.users||[]).map(function(u){return u.userId;}).filter(Boolean);
      if(box){ box.innerHTML = users.map(function(u){ return '<label class="flex items-center justify-between px-2 py-1 border-b last:border-b-0"><span class="font-mono text-xs">'+u+'</span><input type="checkbox" class="publishUser" value="'+u+'"></label>'; }).join('') || '<div class="text-xs text-slate-500">No users</div>'; }
    }catch(e){ if(box) box.innerHTML='<div class="text-xs text-red-600">Failed to load users</div>'; }
  }
  function closePublishModal(){ var m=qs('publishModal'); if(m){ m.classList.add('hidden'); m.classList.remove('flex'); } }
  async function doPublish(){
    var id=dashId(); var all=qs('publishAll').checked; var users=[];
    var checks=document.querySelectorAll('.publishUser'); for(var i=0;i<checks.length;i++){ if(checks[i].checked) users.push(checks[i].value); }
    try{ await window.StateApi.publish(id,{all:all,users:users}); toast('Published','ok'); closePublishModal(); updateIndicator(id); }
    catch(e){ toast('Publish failed: '+(e.message||String(e)),'error'); }
  }
  async function doUnpublish(){
    var id=dashId(); try{ await window.StateApi.unpublish(id); toast('Unpublished','ok'); updateIndicator(id); }
    catch(e){ toast('Unpublish failed: '+(e.message||String(e)),'error'); }
  }
  function wireWsMenu(){
    var btn=qs('ws-actions-btn');
    var menu=qs('ws-actions-menu');
    var back=qs('ws-actions-backdrop');
    function open(){ if(menu) menu.classList.remove('hidden'); if(back) back.classList.remove('hidden'); }
    function close(){ if(menu) menu.classList.add('hidden'); if(back) back.classList.add('hidden'); }
    if(btn) btn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); if(menu && menu.classList.contains('hidden')) open(); else close(); });
    if(back) back.addEventListener('click', close);
    document.addEventListener('click', function(e){ if(menu && !menu.classList.contains('hidden')){ var inside=menu.contains(e.target) || (btn && btn.contains(e.target)); if(!inside) close(); } });
    if(menu) menu.addEventListener('click', function(e){
      var it = e.target.closest ? e.target.closest('[data-ws-action]') : null;
      if(!it) return;
      e.preventDefault();
      close();
      var act = it.getAttribute('data-ws-action');
      if(act==='new') return createWorkspace();
      if(act==='rename') return renameWorkspace();
      if(act==='save') { if(window.RunApp && window.RunApp.saveNow) return window.RunApp.saveNow(true); }
      if(act==='export') return exportWorkspace();
      if(act==='import') { var f=qs('ws-import-file'); if(f) f.click(); return; }
      if(act==='publish') return openPublishModal();
      if(act==='unpublish') return doUnpublish();
      if(act==='delete') return deleteWorkspace();
    });
  }
  async function init(){
    if(!window.StateApi) return;
    var current = dashId();
    var sel=qs('ws-select');
    var twSel=qs('tw-ws-select');
    try{
      var list = await window.StateApi.list();
      fillSelect(sel, list, current);
      fillSelect(twSel, list, current);
      var chosen = (sel && sel.value) ? sel.value : current;
      if(!current && chosen){ setDashInUrl(chosen); return; }
      updateIndicator(chosen);
    }catch(e){ toast('Failed to load workspaces','error'); }
    if(sel) sel.addEventListener('change', function(e){ switchWorkspace(e.target.value); });
    if(twSel) twSel.addEventListener('change', function(e){ switchWorkspace(e.target.value); });
    var imp=qs('ws-import-file');
    if(imp) imp.addEventListener('change', function(e){ var f=e.target.files && e.target.files[0]; if(f) importWorkspace(f); e.target.value=''; });
    var pc=qs('publishClose'); if(pc) pc.addEventListener('click', closePublishModal);
    var pc2=qs('publishCancel'); if(pc2) pc2.addEventListener('click', closePublishModal);
    var pb=qs('publishDo'); if(pb) pb.addEventListener('click', doPublish);
    var qn=qs('ws-new-btn'); if(qn) qn.addEventListener('click', createWorkspace);
    wireWsMenu();
  }
  window.addEventListener('DOMContentLoaded', init);
})();`);
};
