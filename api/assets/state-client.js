module.exports = async (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`(function (global) {
  'use strict';
  function toQS(params){ var esc=encodeURIComponent, parts=[]; for(var k in params){ if(!Object.prototype.hasOwnProperty.call(params,k)) continue; if(params[k]===undefined||params[k]===null) continue; parts.push(esc(k)+'='+esc(String(params[k])));} return parts.length?'?'+parts.join('&'):''; }
  function safeJsonParse(text, fb){ try{return JSON.parse(text||'');}catch(e){return fb;} }
  function request(url,opt){ opt=opt||{}; var headers=opt.headers||{}; headers['Accept']=headers['Accept']||'application/json'; if(opt.body!==undefined&&opt.body!==null) headers['Content-Type']=headers['Content-Type']||'application/json'; return fetch(url,{method:opt.method||'GET',credentials:'same-origin',headers:headers,body:(opt.body!==undefined&&opt.body!==null)?(typeof opt.body==='string'?opt.body:JSON.stringify(opt.body)):undefined}).then(function(res){ return res.text().then(function(t){ var j=safeJsonParse(t,{error:t}); if(!res.ok){ throw new Error((j&&(j.error||j.message))||t||('HTTP '+res.status)); } return j; }); }); }
  global.StateApi = {
    get: function(dashId){ return request('/api/state'+toQS({dash:dashId}), {method:'GET'}); },
    merge: function(dashId, patch){ return request('/api/state'+toQS({dash:dashId, merge:1}), {method:'POST', body:{patch:patch}}); }
  };
})(window);
`);
};
