module.exports = async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`(function(){'use strict';
  var tickets=[]; var pieChart=null, barChart=null; var thresholds={Small:4,Medium:6,Large:8};
  function qs(id){return document.getElementById(id);} 
  function dashId(){try{return new URL(location.href).searchParams.get('dash')||'';}catch(e){return ''}}
  function esc(s){return String(s||'').replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
  function toast(msg,kind){var t=qs('toast');if(!t)return;t.textContent=msg;t.classList.remove('hidden');t.classList.remove('bg-emerald-600','bg-red-600','bg-slate-900');t.classList.add(kind==='error'?'bg-red-600':(kind==='ok'?'bg-emerald-600':'bg-slate-900'));clearTimeout(toast._timer);toast._timer=setTimeout(function(){t.classList.add('hidden');},2600);} 

  function computeTotals(){var total=tickets.length,onTime=0;for(var i=0;i<tickets.length;i++){var t=tickets[i]||{};if(Number(t.actualTime)<=Number(t.threshold))onTime++;}var breached=total-onTime;var sla=total?((onTime/total)*100).toFixed(1):'0.0';return{total:total,onTime:onTime,breached:breached,sla:sla};}
  function buildBarData(){var map={};for(var i=0;i<tickets.length;i++){var t=tickets[i]||{};var tp=t.type||'Medium';if(!map[tp])map[tp]={type:tp,total:0,onTime:0,breached:0,totalTime:0};map[tp].total++;map[tp].totalTime+=Number(t.actualTime||0);if(Number(t.actualTime)<=Number(t.threshold))map[tp].onTime++;else map[tp].breached++;}var arr=[];for(var k in map){if(Object.prototype.hasOwnProperty.call(map,k))arr.push(map[k]);}var order={'Small':1,'Medium':2,'Large':3};arr.sort(function(a,b){return(order[a.type]||99)-(order[b.type]||99)||a.type.localeCompare(b.type);});return arr;}

  function renderKPIs(t){qs('kpiTotal').textContent=String(t.total);qs('kpiOnTime').textContent=String(t.onTime);qs('kpiBreached').textContent=String(t.breached);qs('kpiSla').textContent=t.sla+'%';}
  function renderCharts(totals,barData){if(typeof ChartDataLabels!=='undefined')Chart.register(ChartDataLabels);if(pieChart)pieChart.destroy();pieChart=new Chart(qs('pieChart').getContext('2d'),{type:'doughnut',data:{labels:['On Time','Breached'],datasets:[{data:[totals.onTime,totals.breached],backgroundColor:['#10b981','#ef4444'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'},datalabels:{color:'#111',font:{weight:'bold'},formatter:function(v){return v;}}}});if(barChart)barChart.destroy();barChart=new Chart(qs('barChart').getContext('2d'),{type:'bar',data:{labels:barData.map(function(d){return d.type;}),datasets:[{label:'On Time',data:barData.map(function(d){return d.onTime;}),backgroundColor:'#10b981'},{label:'Breached',data:barData.map(function(d){return d.breached;}),backgroundColor:'#ef4444'}]},options:{responsive:true,maintainAspectRatio:false,scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}},plugins:{legend:{position:'bottom'}}}});} 

  function renderSummary(barData){var body=qs('tableBody');body.innerHTML='';for(var i=0;i<barData.length;i++){var d=barData[i];var avg=d.total?(d.totalTime/d.total).toFixed(2):'0.00';var sla=d.total?((d.onTime/d.total)*100).toFixed(1):'0.0';var badgeClass='badge-green';if(Number(sla)<70)badgeClass='badge-red';else if(Number(sla)<90)badgeClass='badge-yellow';var thr=(thresholds[d.type]!==undefined)?thresholds[d.type]:'-';var tr=document.createElement('tr');tr.innerHTML="<td><strong>"+esc(d.type)+"</strong></td><td style='text-align:center;'>"+thr+"</td><td style='text-align:center;'>"+d.total+"</td><td style='text-align:center;'><span class='badge badge-green'>"+d.onTime+"</span></td><td style='text-align:center;'><span class='badge badge-red'>"+d.breached+"</span></td><td style='text-align:center;'>"+avg+"</td><td style='text-align:center;'><span class='badge "+badgeClass+"'>"+sla+"%</span></td>";body.appendChild(tr);}}
  function renderTickets(){var tb=qs('ticketTbody');var q=(qs('searchBox').value||'').toLowerCase().trim();tb.innerHTML='';for(var i=0;i<tickets.length;i++){var t=tickets[i];var hay=(String(t.id)+' '+String(t.title)+' '+String(t.type)).toLowerCase();if(q&&hay.indexOf(q)===-1)continue;var tr=document.createElement('tr');tr.className='border-b hover:bg-slate-50';tr.innerHTML="<td class='py-2 pr-3 font-mono text-slate-700'>"+esc(t.id)+"</td><td class='py-2 pr-3 text-slate-800'>"+esc(t.title)+"</td><td class='py-2 pr-3 text-slate-700'>"+esc(t.type)+"</td><td class='py-2 pr-3 text-right text-slate-700'>"+Number(t.actualTime||0).toFixed(2)+"</td><td class='py-2 pr-3 text-right text-slate-700'>"+Number(t.threshold||0).toFixed(2)+"</td>";tb.appendChild(tr);}}

  function saveToWorkspace(){var d=dashId();if(!d||!window.StateApi)return Promise.resolve();var totals=computeTotals();var bau={totalTickets:totals.total,withinSLA:totals.onTime,breachedSLA:totals.breached,slaPercentage:totals.sla};return window.StateApi.merge(d,{run:{tickets:tickets,updatedAt:new Date().toISOString()},executive:{bauData:bau}});} 
  function generateAndSave(){if(!tickets.length){toast('No tickets loaded','error');return;}var totals=computeTotals();var bar=buildBarData();renderKPIs(totals);renderCharts(totals,bar);renderSummary(bar);renderTickets();toast('Saving…','info');saveToWorkspace().then(function(){toast('Saved','ok');}).catch(function(){toast('Save failed','error');});}

  function downloadJpg(){toast('Generating image…','info');html2canvas(qs('captureRegion'),{backgroundColor:'#ffffff',scale:2}).then(function(canvas){var a=document.createElement('a');a.download='Run_Report_'+new Date().toISOString().slice(0,10)+'.jpg';a.href=canvas.toDataURL('image/jpeg',0.95);a.click();toast('Downloaded','ok');}).catch(function(){toast('Download failed','error');});}

  function openModal(){var m=qs('runModal'); if(!m) return; m.classList.remove('hidden'); m.classList.add('flex');}
  function closeModal(){var m=qs('runModal'); if(!m) return; m.classList.add('hidden'); m.classList.remove('flex');}
  function openAdoForm(){var a=qs('adoFormWrap'); if(a) a.classList.remove('hidden');}
  function closeAdoForm(){var a=qs('adoFormWrap'); if(a) a.classList.add('hidden');}

  function parseRows(rows){var out=[];for(var i=0;i<rows.length;i++){var r=rows[i]||{};var id=r.ID||r.Id||r.id||(''+Math.floor(Math.random()*1000000));var title=r.Title||r.title||'Untitled';var type=r['Ticket type']||r.Type||r.type||'Medium';var time=Number(r['Actual time']||r['Actual Time']||r.actualTime||0);var thr=Number(r.Threshold||r.threshold||thresholds[type]||6);out.push({id:String(id),title:String(title),type:String(type),actualTime:time,threshold:thr});}return out;}
  function uploadFile(file){if(!file)return;toast('Reading file…','info');var reader=new FileReader();reader.onload=function(e){try{var data=new Uint8Array(e.target.result);var wb=XLSX.read(data,{type:'array'});var sheet=wb.Sheets[wb.SheetNames[0]];var rows=XLSX.utils.sheet_to_json(sheet);tickets=parseRows(rows);closeModal();generateAndSave();}catch(err){toast('Upload failed','error');}};reader.readAsArrayBuffer(file);} 

  async function adoSubmit(){toast('Querying ADO…','info');var org=(qs('adoOrg').value||'').trim();var project=(qs('adoProject').value||'').trim();var queryId=(qs('adoQueryId').value||'').trim();var pat=(qs('adoPat').value||'').trim();if(!org||!project||!queryId||!pat){toast('Fill all ADO fields','error');return;}try{var resp=await fetch('/api/ado/run-tickets',{method:'POST',credentials:'same-origin',headers:{'Accept':'application/json','Content-Type':'application/json'},body:JSON.stringify({org:org,project:project,queryId:queryId,pat:pat})});var t=await resp.text();var j={};try{j=JSON.parse(t||'{}');}catch(e){j={error:t};}if(!resp.ok)throw new Error(j.error||j.message||t||('HTTP '+resp.status));var list=j.tickets||[];if(!Array.isArray(list)||!list.length){toast('No tickets returned','error');return;}tickets=list;closeAdoForm();closeModal();generateAndSave();}catch(e){toast('ADO sync failed','error');}}

  function loadFromWorkspace(){var d=dashId();if(!d||!window.StateApi)return;window.StateApi.get(d).then(function(resp){var st=resp&&resp.state?resp.state:{};var run=st.run||{};if(Array.isArray(run.tickets))tickets=run.tickets;if(tickets.length)generateAndSave();}).catch(function(){});} 

  function init(){
    window.RunApp={ saveNow:function(){return saveToWorkspace();}, download:downloadJpg, openGenerate: openModal };
    // fallback open
    window.addEventListener('tw:openGenerate', openModal);

    if(window.lucide&&window.lucide.createIcons) window.lucide.createIcons();

    // modal wiring
    qs('runModalClose').addEventListener('click',closeModal);
    qs('runModalCancel').addEventListener('click',closeModal);
    qs('uploadPick').addEventListener('click',function(){qs('fileInput').click();});
    qs('adoOpenBtn').addEventListener('click',openAdoForm);
    qs('adoCancel').addEventListener('click',closeAdoForm);
    qs('adoSubmit').addEventListener('click',function(){adoSubmit();});
    qs('fileInput').addEventListener('change',function(e){var f=e.target.files&&e.target.files[0];if(f)uploadFile(f);e.target.value='';});

    // tickets
    qs('searchBox').addEventListener('input',renderTickets);
    var toggleBtn=qs('toggleTicketsBtn');
    toggleBtn.addEventListener('click',function(){var sec=qs('ticketsSection');sec.classList.toggle('hidden');toggleBtn.textContent=sec.classList.contains('hidden')?'Show Tickets':'Hide Tickets';});
    qs('ticketsSection').classList.add('hidden');

    loadFromWorkspace();
  }
  window.addEventListener('DOMContentLoaded',init);
})();`);
};
