(function(global){
  function toQS(p){
    const e=encodeURIComponent, a=[];
    for(const k in p){
      if(!Object.prototype.hasOwnProperty.call(p,k)) continue;
      if(p[k]===undefined || p[k]===null) continue;
      a.push(e(k)+'='+e(String(p[k])));
    }
    return a.length ? ('?'+a.join('&')) : '';
  }
  function safeParse(t, fb){ try{ return JSON.parse(t||''); } catch(e){ return fb; } }
  function req(url, opt){
    opt = opt || {};
    const h = opt.headers || {};
    h['Accept'] = h['Accept'] || 'application/json';
    if(opt.body!==undefined && opt.body!==null) h['Content-Type'] = h['Content-Type'] || 'application/json';

    return fetch(url, {
      method: opt.method || 'GET',
      credentials: 'same-origin',
      headers: h,
      body: (opt.body!==undefined && opt.body!==null)
        ? (typeof opt.body==='string' ? opt.body : JSON.stringify(opt.body))
        : undefined
    }).then(async r=>{
      const t = await r.text();
      const j = safeParse(t, {error:t});
      if(!r.ok) throw new Error((j && (j.error||j.message)) || t || ('HTTP '+r.status));
      return j;
    });
  }

  global.StateApi = {
    list: ()=> req('/api/state'+toQS({list:1}), {method:'GET'}).then(d => (d&&d.dashboards)||[]),
    get:  (id)=> req('/api/state'+toQS({dash:id}), {method:'GET'}),
    save: (id,state,name)=> req('/api/state'+toQS({dash:id}), {method:'POST', body:{state,name}}),
    merge:(id,patch)=> req('/api/state'+toQS({dash:id,merge:1}), {method:'POST', body:{patch}}),
    publish:(id,body)=> req('/api/state'+toQS({dash:id,publish:1}), {method:'POST', body:body||{}}),
    unpublish:(id)=> req('/api/state'+toQS({dash:id,unpublish:1}), {method:'POST', body:{}}),
    remove:(id)=> req('/api/state'+toQS({dash:id}), {method:'DELETE', body:{}})
  };
})(window);
