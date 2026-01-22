module.exports = async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`(function(global){'use strict';function toQS(p){var e=encodeURIComponent,a=[];for(var k in p){if(!Object.prototype.hasOwnProperty.call(p,k))continue;if(p[k]===undefined||p[k]===null)continue;a.push(e(k)+'='+e(String(p[k])));}return a.length?'?'+a.join('&'):'';}function safeParse(t,fb){try{return JSON.parse(t||'');}catch(e){return fb;}}function req(url,opt){opt=opt||{};var h=opt.headers||{};h['Accept']=h['Accept']||'application/json';if(opt.body!==undefined&&opt.body!==null)h['Content-Type']=h['Content-Type']||'application/json';return fetch(url,{method:opt.method||'GET',credentials:'same-origin',headers:h,body:(opt.body!==undefined&&opt.body!==null)?(typeof opt.body==='string'?opt.body:JSON.stringify(opt.body)):undefined}).then(function(r){return r.text().then(function(t){var j=safeParse(t,{error:t});if(!r.ok){throw new Error((j&&(j.error||j.message))||t||('HTTP '+r.status));}return j;});});}
  global.StateApi={
    list:function(){return req('/api/state'+toQS({list:1}),{method:'GET'}).then(function(d){return (d&&d.dashboards)||[];});},
    get:function(id){return req('/api/state'+toQS({dash:id}),{method:'GET'});},
    save:function(id,state,name){return req('/api/state'+toQS({dash:id}),{method:'POST',body:{state:state,name:name}});},
    merge:function(id,patch){return req('/api/state'+toQS({dash:id,merge:1}),{method:'POST',body:{patch:patch}});},
    publish:function(id,body){return req('/api/state'+toQS({dash:id,publish:1}),{method:'POST',body:body||{}});},
    unpublish:function(id){return req('/api/state'+toQS({dash:id,unpublish:1}),{method:'POST',body:{}});},
    remove:function(id){return req('/api/state'+toQS({dash:id}),{method:'DELETE',body:{}});}
  };
})(window);`);
};
