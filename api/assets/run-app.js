module.exports = async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`(function(){'use strict';
  var tickets=[]; var pieChart=null; var barChart=null; var editIndex=-1;
  var thresholds={Small:4,Medium:6,Large:8};

  function qs(id){return document.getElementById(id);} 
  function dashId(){try{return new URL(location.href).searchParams.get('dash')||'';}catch(e){return ''}}
  function esc(s){return String(s||'').replace(/[&<>\"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'})[c];});}

  function toast(msg, kind){
    var t = qs('toast');
    if(!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    t.classList.remove('bg-emerald-600','bg-red-600','bg-slate-900');
    t.classList.add(kind==='error'?'bg-red-600':(kind==='ok'?'bg-emerald-600':'bg-slate-900'));
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function(){ t.classList.add('hidden'); }, 3200);
  }

  function computeTotals(){
    var total=tickets.length, onTime=0;
    for(var i=0;i<tickets.length;i++){var t=tickets[i]||{}; if(Number(t.actualTime)<=Number(t.threshold)) onTime++;}
    var breached=total-onTime;
    var sla= total? ((onTime/total)*100).toFixed(1) : '0.0';
    return {total:total,onTime:onTime,breached:breached,sla:sla};
  }

  function buildBarData(){
    var map={};
    for(var i=0;i<tickets.length;i++){
      var t=tickets[i]||{}; var tp=t.type||'Medium';
      if(!map[tp]) map[tp]={type:tp,total:0,onTime:0,breached:0,totalTime:0};
      map[tp].total++; map[tp].totalTime += Number(t.actualTime||0);
      if(Number(t.actualTime)<=Number(t.threshold)) map[tp].onTime++; else map[tp].breached++;
    }
    var arr=[]; for(var k in map){ if(Object.prototype.hasOwnProperty.call(map,k)) arr.push(map[k]); }
    var order={'Small':1,'Medium':2,'Large':3};
    arr.sort(function(a,b){ return (order[a.type]||99)-(order[b.type]||99) || a.type.localeCompare(b.type); });
    return arr;
  }

  function renderHeaderPills(){
    var d = dashId();
    var dashPill = qs('dashPill');
    if(dashPill) dashPill.textContent = d || '—';
    var filePill = qs('filePill');
    if(filePill) filePill.textContent = tickets.length?('Loaded: '+tickets.length+' tickets'):'No data loaded';
    try{ var q=d?('?dash='+encodeURIComponent(d)):''; var b=qs('nav-build'); var r=qs('nav-run'); if(b) b.href='/build.html'+q; if(r) r.href='/run.html'+q; }catch(e){}
  }

  function renderKPIs(t){
    if(qs('kpiTotal')) qs('kpiTotal').textContent = String(t.total);
    if(qs('kpiOnTime')) qs('kpiOnTime').textContent = String(t.onTime);
    if(qs('kpiBreached')) qs('kpiBreached').textContent = String(t.breached);
    if(qs('kpiSla')) qs('kpiSla').textContent = t.sla+'%';
  }

  function renderCharts(totals, barData){
    if(typeof ChartDataLabels!=='undefined') Chart.register(ChartDataLabels);
    if(pieChart) pieChart.destroy();
    pieChart = new Chart(qs('pieChart').getContext('2d'), {
      type:'doughnut',
      data:{labels:['On Time','Breached'],datasets:[{data:[totals.onTime,totals.breached],backgroundColor:['#10b981','#ef4444'],borderWidth:0}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'},datalabels:{color:'#111',font:{weight:'bold'},formatter:function(v){return v;}}}}
    });

    if(barChart) barChart.destroy();
    barChart = new Chart(qs('barChart').getContext('2d'), {
      type:'bar',
      data:{labels:barData.map(function(d){return d.type;}),datasets:[{label:'On Time',data:barData.map(function(d){return d.onTime;}),backgroundColor:'#10b981'},{label:'Breached',data:barData.map(function(d){return d.breached;}),backgroundColor:'#ef4444'}]},
      options:{responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}},plugins:{legend:{position:'bottom'}}}
    });
  }

  function renderTicketTypeSummary(barData){
    var tableBody = qs('tableBody');
    if(!tableBody) return;
    tableBody.innerHTML='';
    for(var i=0;i<barData.length;i++){
      var d=barData[i];
      var avgTime = d.total? (d.totalTime/d.total).toFixed(2) : '0.00';
      var slaPercent = d.total? ((d.onTime/d.total)*100).toFixed(1) : '0.0';
      var badgeClass='badge-green';
      if(Number(slaPercent) < 70) badgeClass='badge-red';
      else if(Number(slaPercent) < 90) badgeClass='badge-yellow';
      var thr = (thresholds[d.type]!==undefined)? thresholds[d.type] : '-';
      var row = document.createElement('tr');
      row.innerHTML = "<td><strong>"+esc(d.type)+"</strong></td>"+
        "<td style='text-align:center;'>"+thr+"</td>"+
        "<td style='text-align:center;'>"+d.total+"</td>"+
        "<td style='text-align:center;'><span class='badge badge-green'>"+d.onTime+"</span></td>"+
        "<td style='text-align:center;'><span class='badge badge-red'>"+d.breached+"</span></td>"+
        "<td style='text-align:center;'>"+avgTime+"</td>"+
        "<td style='text-align:center;'><span class='badge "+badgeClass+"'>"+slaPercent+"%</span></td>";
      row.ondblclick = (function(tp){ return function(){ openTicketList(tp); }; })(d.type);
      tableBody.appendChild(row);
    }
  }

  function setTicketsVisible(show){
    var sec = qs('ticketsSection');
    var btn = qs('toggleTicketsBtn');
    if(sec) sec.classList.toggle('hidden', !show);
    if(btn) btn.textContent = show ? 'Hide Tickets' : 'Show Tickets';
  }

  function openTicketList(type){
    setTicketsVisible(true);
    var input = qs('searchBox');
    if(input){ input.value = type; }
    renderTickets();
    toast('Showing tickets filtered by type: '+type, 'ok');
  }

  function statusLabel(t){return (Number(t.actualTime)<=Number(t.threshold))?'On Time':'Breached';}
  function badge(txt){var ok=txt==='On Time'; var cls= ok?'bg-emerald-50 border-emerald-200 text-emerald-700':'bg-red-50 border-red-200 text-red-700'; return "<span class='px-2 py-1 rounded-full border text-xs "+cls+"'>"+esc(txt)+"</span>";}

  function renderTickets(){
    var tb = qs('ticketTbody'); if(!tb) return;
    var q = (qs('searchBox').value||'').toLowerCase().trim();
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

  function openRunModal(){ qs('runModal').classList.remove('hidden'); qs('runModal').classList.add('flex'); }
  function closeRunModal(){ qs('runModal').classList.add('hidden'); qs('runModal').classList.remove('flex'); }

  function openAdoForm(){ qs('adoFormWrap').classList.remove('hidden'); }
  function closeAdoForm(){ qs('adoFormWrap').classList.add('hidden'); }

  function uploadFile(file){
    clearError();
    if(!file) return;
    toast('Reading file…','info');
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
      }catch(err){ showError('Upload failed: '+(err.message||String(err))); toast('Upload failed','error'); }
    };
    reader.readAsArrayBuffer(file);
  }

  async function adoSubmit(){
    clearError();
    toast('Querying ADO…','info');
    var org = (qs('adoOrg').value||'').trim();
    var project = (qs('adoProject').value||'').trim();
    var pat = (qs('adoPat').value||'').trim();
    var wiql = (qs('adoWiql').value||'').trim();
    if(!org||!project||!pat||!wiql){ showError('Please fill all ADO fields.'); toast('Missing ADO fields','error'); return; }

    try{
      var resp = await fetch('/api/ado/run-tickets', {
        method:'POST',
        credentials:'same-origin',
        headers:{'Accept':'application/json','Content-Type':'application/json'},
        body: JSON.stringify({ org: org, project: project, pat: pat, wiql: wiql })
      });
      var t = await resp.text();
      var j={}; try{ j=JSON.parse(t||'{}'); }catch(e){ j={error:t}; }
      if(!resp.ok) throw new Error(j.error||j.message||t||('HTTP '+resp.status));
      var list = (j && j.tickets) ? j.tickets : [];
      if(!Array.isArray(list) || !list.length){ toast('No tickets returned from ADO','info'); showError('No tickets returned from ADO.'); return; }
      tickets=list;
      closeAdoForm();
      closeRunModal();
      generateAndSave();
    }catch(e){
      showError('ADO sync failed: '+(e.message||String(e)));
      toast('ADO sync failed','error');
    }
  }

  function saveToWorkspace(){
    var d=dashId();
    if(!d || !window.StateApi) return Promise.resolve();
    var totals=computeTotals();
    var bauData={ totalTickets: totals.total, withinSLA: totals.onTime, breachedSLA: totals.breached, slaPercentage: totals.sla };
    return window.StateApi.merge(d, { run:{ tickets:tickets, updatedAt:new Date().toISOString() }, executive:{ bauData: bauData } });
  }

  function generateAndSave(){
    if(!tickets.length){ toast('No tickets loaded. Click Run.','info'); return; }
    var totals=computeTotals();
    var barData=buildBarData();
    renderHeaderPills();
    renderKPIs(totals);
    renderCharts(totals, barData);
    renderTicketTypeSummary(barData);
    renderTickets();
    toast('Report generated. Saving…','info');
    saveToWorkspace().then(function(){ toast('Saved to workspace','ok'); }).catch(function(){ toast('Save failed','error'); });
  }

  function downloadJpg(){
    toast('Generating image…','info');
    html2canvas(qs('captureRegion'), {backgroundColor:'#ffffff', scale:2})
      .then(function(canvas){
        var a=document.createElement('a');
        a.download='Run_Report_'+new Date().toISOString().slice(0,10)+'.jpg';
        a.href=canvas.toDataURL('image/jpeg',0.95);
        a.click();
        toast('Downloaded','ok');
      })
      .catch(function(e){ showError('Download failed: '+(e.message||String(e))); toast('Download failed','error'); });
  }

  function loadFromWorkspace(){
    var d=dashId();
    renderHeaderPills();
    if(!d || !window.StateApi){ toast('Missing ?dash=','error'); return; }
    toast('Loading workspace…','info');
    window.StateApi.get(d)
      .then(function(resp){
        var st=(resp && resp.state) ? resp.state : {};
        var run=st.run || {};
        if(Array.isArray(run.tickets)) tickets = run.tickets;
        if(tickets.length){ generateAndSave(); toast('Loaded from workspace','ok'); }
        else { toast('No run data yet. Click Run.','info'); }
      })
      .catch(function(){ toast('Load failed','error'); });
  }

  function wireHeader(){
    function toggle(el){ if(el) el.classList.toggle('hidden'); }
    var hambBtn=qs('tw-menu-btn'), hambMenu=qs('tw-menu');
    var actBtn=qs('actionsBtn'), actMenu=qs('actionsMenu');
    hambBtn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); toggle(hambMenu); });
    actBtn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); toggle(actMenu); });
    document.addEventListener('click', function(e){
      if(hambMenu && !hambMenu.classList.contains('hidden') && !(hambMenu.contains(e.target)||hambBtn.contains(e.target))) hambMenu.classList.add('hidden');
      if(actMenu && !actMenu.classList.contains('hidden') && !(actMenu.contains(e.target)||actBtn.contains(e.target))) actMenu.classList.add('hidden');
    });
    qs('runBtn').addEventListener('click', function(e){ e.preventDefault(); openRunModal(); });
    actMenu.addEventListener('click', function(e){
      var el=e.target; while(el && el!==actMenu && !el.getAttribute('data-act')) el=el.parentNode;
      if(!el || !el.getAttribute) return;
      var act=el.getAttribute('data-act'); actMenu.classList.add('hidden');
      if(act==='download') downloadJpg();
    });

    // tickets toggle
    qs('toggleTicketsBtn').addEventListener('click', function(){
      var sec=qs('ticketsSection');
      var hidden=sec && sec.classList.contains('hidden');
      setTicketsVisible(hidden);
    });
  }

  function initModal(){
    qs('runModalClose').addEventListener('click', closeRunModal);
    qs('runModalCancel').addEventListener('click', closeRunModal);

    qs('uploadPick').addEventListener('click', function(){ qs('fileInput').click(); });
    qs('adoOpenBtn').addEventListener('click', function(){ openAdoForm(); });

    qs('adoCancel').addEventListener('click', function(){ closeAdoForm(); });
    qs('adoSubmit').addEventListener('click', function(){ adoSubmit(); });

    qs('fileInput').addEventListener('change', function(e){ if(e.target.files && e.target.files[0]) uploadFile(e.target.files[0]); });
  }

  function initEdit(){
    qs('editClose').addEventListener('click', closeEdit);
    qs('editCancel').addEventListener('click', closeEdit);
    qs('editSave').addEventListener('click', saveEdit);
    qs('editType').addEventListener('change', function(){ var tp=qs('editType').value; qs('editThreshold').value = thresholds[tp] || 6; });
  }

  function init(){
    if(window.lucide && typeof window.lucide.createIcons==='function') window.lucide.createIcons();
    renderHeaderPills();
    // default hide tickets
    setTicketsVisible(false);
    // search works even when hidden
    qs('searchBox').addEventListener('input', renderTickets);
    wireHeader(); initModal(); initEdit();
    toast('Ready. Click Run.','info');
    loadFromWorkspace();
  }

  window.addEventListener('DOMContentLoaded', init);
})();`);
};
