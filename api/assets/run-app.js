module.exports = async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`(function(){
  'use strict';
  var tickets=[];
  var pieChart=null, barChart=null;
  var editIndex=-1;
  var thresholds={Small:4, Medium:6, Large:8};

  function qs(id){ return document.getElementById(id); }
  function dashId(){ try{ return new URL(location.href).searchParams.get('dash')||''; }catch(e){ return ''; } }
  function esc(s){ return String(s||'').replace(/[&<>"']/g,function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

  function setText(id, t){ var el=qs(id); if(el) el.textContent=t; }
  function setStatus(t){ setText('statusText', t); }
  function showError(t){ var el=qs('errorBox'); if(!el) return; el.textContent=t; el.classList.remove('hidden'); }
  function clearError(){ var el=qs('errorBox'); if(!el) return; el.textContent=''; el.classList.add('hidden'); }

  function computeKpis(list){
    var total=list.length, onTime=0;
    for(var i=0;i<list.length;i++){ var t=list[i]||{}; if(Number(t.actualTime)<=Number(t.threshold)) onTime++; }
    var breached=total-onTime;
    var sla= total? ((onTime/total)*100).toFixed(1) : '0.0';
    return {total:total,onTime:onTime,breached:breached,sla:sla};
  }

  function groupByType(list){
    var map={};
    for(var i=0;i<list.length;i++){
      var t=list[i]||{};
      var tp=t.type||'Medium';
      if(!map[tp]) map[tp]={onTime:0,breached:0};
      if(Number(t.actualTime)<=Number(t.threshold)) map[tp].onTime++; else map[tp].breached++;
    }
    return map;
  }

  function renderKpis(k){
    setText('kpiTotal', String(k.total));
    setText('kpiOnTime', String(k.onTime));
    setText('kpiBreached', String(k.breached));
    setText('kpiSla', k.sla+'%');
    setText('dashPill', dashId()||'—');
    setText('filePill', tickets.length? ('Loaded: '+tickets.length+' tickets') : 'No data loaded');
    try{ var d=dashId(); var q=d?('?dash='+encodeURIComponent(d)):''; var b=qs('nav-build'); var r=qs('nav-run'); if(b) b.href='/build.html'+q; if(r) r.href='/run.html'+q; }catch(e){}
  }

  function renderCharts(k, byType){
    if(typeof ChartDataLabels!=='undefined') Chart.register(ChartDataLabels);
    if(pieChart) pieChart.destroy();
    pieChart = new Chart(qs('pieChart').getContext('2d'), {
      type:'doughnut',
      data:{ labels:['On Time','Breached'], datasets:[{ data:[k.onTime,k.breached], backgroundColor:['#10b981','#ef4444'], borderWidth:0 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' }, datalabels:{ color:'#111', font:{weight:'bold'}, formatter:function(v){return v;} } } }
    });

    if(barChart) barChart.destroy();
    var types=Object.keys(byType);
    var onArr=[], brArr=[];
    for(var i=0;i<types.length;i++){ onArr.push(byType[types[i]].onTime); brArr.push(byType[types[i]].breached); }
    barChart = new Chart(qs('barChart').getContext('2d'), {
      type:'bar',
      data:{ labels:types, datasets:[{ label:'On Time', data:onArr, backgroundColor:'#10b981' },{ label:'Breached', data:brArr, backgroundColor:'#ef4444' }] },
      options:{ responsive:true, maintainAspectRatio:false, scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true } } }
    });
  }

  function statusLabel(t){ return (Number(t.actualTime)<=Number(t.threshold))?'On Time':'Breached'; }
  function badge(txt){
    var ok=txt==='On Time';
    var cls= ok?'bg-emerald-50 border-emerald-200 text-emerald-700':'bg-red-50 border-red-200 text-red-700';
    return "<span class='px-2 py-1 rounded-full border text-xs "+cls+"'>"+esc(txt)+"</span>";
  }

  function renderTable(){
    var q=(qs('searchBox').value||'').toLowerCase().trim();
    var tb=qs('ticketTbody');
    tb.innerHTML='';
    for(var i=0;i<tickets.length;i++){
      var t=tickets[i];
      var hay=(String(t.id)+' '+String(t.title)+' '+String(t.type)).toLowerCase();
      if(q && hay.indexOf(q)===-1) continue;
      var tr=document.createElement('tr');
      tr.className='border-b hover:bg-slate-50';
      tr.innerHTML =
        "<td class='py-2 pr-3 font-mono text-slate-700'>"+esc(t.id)+"</td>"+
        "<td class='py-2 pr-3 text-slate-800'>"+esc(t.title)+"</td>"+
        "<td class='py-2 pr-3 text-slate-700'>"+esc(t.type)+"</td>"+
        "<td class='py-2 pr-3 text-right text-slate-700'>"+Number(t.actualTime||0).toFixed(2)+"</td>"+
        "<td class='py-2 pr-3 text-right text-slate-700'>"+Number(t.threshold||0).toFixed(2)+"</td>"+
        "<td class='py-2 pr-3'>"+badge(statusLabel(t))+"</td>"+
        "<td class='py-2 text-right'><button class='px-3 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs' data-edit='"+i+"'>Edit</button></td>";
      tb.appendChild(tr);
    }
    var btns=tb.querySelectorAll('[data-edit]');
    for(var j=0;j<btns.length;j++){
      btns[j].addEventListener('click', function(){ openEdit(parseInt(this.getAttribute('data-edit'),10)); });
    }
  }

  function openEdit(i){
    editIndex=i;
    var t=tickets[i]||{};
    qs('editId').value=t.id||'';
    qs('editTitle').value=t.title||'';
    qs('editType').value=t.type||'Medium';
    qs('editTime').value=(t.actualTime!=null)?t.actualTime:0;
    qs('editThreshold').value=(t.threshold!=null)?t.threshold:(thresholds[qs('editType').value]||6);
    qs('editModal').classList.remove('hidden');
    qs('editModal').classList.add('flex');
  }
  function closeEdit(){ qs('editModal').classList.add('hidden'); qs('editModal').classList.remove('flex'); }
  function saveEdit(){
    if(editIndex<0) return;
    var t=tickets[editIndex]||{};
    t.id=(qs('editId').value||'').trim();
    t.title=(qs('editTitle').value||'').trim();
    t.type=qs('editType').value;
    t.actualTime=Number(qs('editTime').value||0);
    t.threshold=Number(qs('editThreshold').value||thresholds[t.type]||6);
    tickets[editIndex]=t;
    closeEdit();
    generateAndSave();
  }

  function parseRows(rows){
    var out=[];
    for(var i=0;i<rows.length;i++){
      var r=rows[i]||{};
      var id=r.ID||r.Id||r.id||(''+Math.floor(Math.random()*1000000));
      var title=r.Title||r.title||'Untitled';
      var type=r['Ticket type']||r.Type||r.type||'Medium';
      var time=Number(r['Actual time']||r['Actual Time']||r.actualTime||0);
      var thr=Number(r.Threshold||r.threshold||thresholds[type]||6);
      out.push({id:String(id),title:String(title),type:String(type),actualTime:time,threshold:thr});
    }
    return out;
  }

  function uploadFile(file){
    clearError();
    if(!file) return;
    setStatus('Reading file…');
    var reader=new FileReader();
    reader.onload=function(e){
      try{
        var data=new Uint8Array(e.target.result);
        var wb=XLSX.read(data,{type:'array'});
        var sheet=wb.Sheets[wb.SheetNames[0]];
        var rows=XLSX.utils.sheet_to_json(sheet);
        tickets=parseRows(rows);
        closeRunModal();
        generateAndSave();
      }catch(err){ showError('Upload failed: '+(err.message||String(err))); }
    };
    reader.readAsArrayBuffer(file);
  }

  function syncAdo(){
    clearError();
    setStatus('Syncing from ADO…');
    var d=dashId();
    fetch('/api/ado/run-tickets?dash='+encodeURIComponent(d), {credentials:'same-origin', headers:{'Accept':'application/json'}})
      .then(function(r){ return r.text().then(function(t){ var j; try{j=JSON.parse(t||'{}');}catch(e){j={error:t};} if(!r.ok) throw new Error(j.error||j.message||t||('HTTP '+r.status)); return j; }); })
      .then(function(data){
        var list=(data && (data.tickets||data.items||data.payload||data)) || [];
        if(!Array.isArray(list) || !list.length) throw new Error('No tickets returned from ADO endpoint.');
        tickets=list;
        closeRunModal();
        generateAndSave();
      })
      .catch(function(e){ showError('ADO sync failed: '+(e.message||String(e))); setStatus('ADO sync failed.'); });
  }

  function saveToWorkspace(){
    var d=dashId();
    if(!d || !window.StateApi) return Promise.resolve();
    var k=computeKpis(tickets);
    var bauData={ totalTickets:k.total, withinSLA:k.onTime, breachedSLA:k.breached, slaPercentage:k.sla };
    return window.StateApi.merge(d, { run:{ tickets:tickets, updatedAt:new Date().toISOString() }, executive:{ bauData: bauData } });
  }

  function generateAndSave(){
    clearError();
    if(!tickets.length){ showError('No tickets loaded. Click Run to upload or sync.'); return; }
    var k=computeKpis(tickets);
    renderKpis(k);
    renderCharts(k, groupByType(tickets));
    renderTable();
    setStatus('Report generated. Saving…');
    saveToWorkspace().then(function(){ setStatus('Report generated and saved.'); }).catch(function(){ setStatus('Report generated (save failed).'); });
  }

  function downloadJpg(){
    clearError();
    setStatus('Generating image…');
    html2canvas(qs('captureRegion'), {backgroundColor:'#ffffff', scale:2})
      .then(function(canvas){
        var a=document.createElement('a');
        a.download='Run_Report_'+new Date().toISOString().slice(0,10)+'.jpg';
        a.href=canvas.toDataURL('image/jpeg',0.95);
        a.click();
        setStatus('Downloaded.');
      })
      .catch(function(e){ showError('Download failed: '+(e.message||String(e))); });
  }

  function loadFromWorkspace(){
    var d=dashId();
    renderKpis(computeKpis(tickets));
    if(!d || !window.StateApi) return;
    setStatus('Loading workspace state…');
    window.StateApi.get(d).then(function(resp){
      var st=(resp && resp.state) ? resp.state : {};
      var run=st.run || {};
      if(Array.isArray(run.tickets)) tickets = run.tickets;
      renderKpis(computeKpis(tickets));
      renderTable();
      setStatus(tickets.length ? 'Loaded from workspace.' : 'No run data yet. Click Run.');
    }).catch(function(){ setStatus('Could not load workspace state.'); });
  }

  function openRunModal(){ qs('runModal').classList.remove('hidden'); qs('runModal').classList.add('flex'); }
  function closeRunModal(){ qs('runModal').classList.add('hidden'); qs('runModal').classList.remove('flex'); }

  function wireHeader(){
    // hamburger and actions
    function toggle(el){ if(el) el.classList.toggle('hidden'); }
    var hambBtn=qs('tw-menu-btn'), hambMenu=qs('tw-menu');
    hambBtn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); toggle(hambMenu); });

    var actBtn=qs('actionsBtn'), actMenu=qs('actionsMenu');
    actBtn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); toggle(actMenu); });

    document.addEventListener('click', function(e){
      if(hambMenu && !hambMenu.classList.contains('hidden') && !(hambMenu.contains(e.target)||hambBtn.contains(e.target))) hambMenu.classList.add('hidden');
      if(actMenu && !actMenu.classList.contains('hidden') && !(actMenu.contains(e.target)||actBtn.contains(e.target))) actMenu.classList.add('hidden');
    });

    // Run button opens modal
    qs('runBtn').addEventListener('click', function(e){ e.preventDefault(); openRunModal(); });

    // Action: download
    actMenu.addEventListener('click', function(e){
      var el=e.target;
      while(el && el!==actMenu && !el.getAttribute('data-act')) el=el.parentNode;
      if(!el || !el.getAttribute) return;
      var act=el.getAttribute('data-act');
      actMenu.classList.add('hidden');
      if(act==='download') downloadJpg();
    });
  }

  function initModal(){
    qs('runModalClose').addEventListener('click', closeRunModal);
    qs('runModalCancel').addEventListener('click', closeRunModal);

    qs('uploadPick').addEventListener('click', function(){ qs('fileInput').click(); });
    qs('adoSyncBtn').addEventListener('click', function(){ syncAdo(); });

    qs('fileInput').addEventListener('change', function(e){
      if(e.target.files && e.target.files[0]) uploadFile(e.target.files[0]);
    });
  }

  function initEdit(){
    qs('editClose').addEventListener('click', closeEdit);
    qs('editCancel').addEventListener('click', closeEdit);
    qs('editSave').addEventListener('click', saveEdit);
    qs('editType').addEventListener('change', function(){
      var tp=qs('editType').value;
      qs('editThreshold').value = thresholds[tp] || 6;
    });
  }

  function init(){
    if(window.lucide && typeof window.lucide.createIcons==='function') window.lucide.createIcons();
    setText('dashPill', dashId()||'—');
    renderKpis(computeKpis(tickets));
    qs('searchBox').addEventListener('input', renderTable);

    wireHeader();
    initModal();
    initEdit();

    setStatus('Ready. Click Run to upload or sync.');
    loadFromWorkspace();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
`);
};
