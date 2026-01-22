/* assets/js/state-client.js
 * Frontend client for /api/state (matches backend api/state.js contract)
 * Compatible with older browsers.
 */

(function (global) {
  'use strict';

  function toQS(params) {
    var esc = encodeURIComponent;
    var parts = [];
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      if (params[k] === undefined || params[k] === null) continue;
      parts.push(esc(k) + '=' + esc(String(params[k])));
    }
    return parts.length ? ('?' + parts.join('&')) : '';
  }

  function safeJsonParse(text, fallback) {
    try { return JSON.parse(text || ''); } catch (e) { return fallback; }
  }

  function request(url, opt) {
    opt = opt || {};
    var headers = opt.headers || {};
    headers['Accept'] = headers['Accept'] || 'application/json';
    if (opt.body !== undefined && opt.body !== null) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    return fetch(url, {
      method: opt.method || 'GET',
      credentials: 'same-origin',
      headers: headers,
      body: (opt.body !== undefined && opt.body !== null)
        ? (typeof opt.body === 'string' ? opt.body : JSON.stringify(opt.body))
        : undefined
    }).then(function (res) {
      return res.text().then(function (t) {
        var j = safeJsonParse(t, { error: t });
        if (!res.ok) {
          var msg = (j && (j.error || j.message)) || t || ('HTTP ' + res.status);
          var err = new Error(msg);
          err.status = res.status;
          err.payload = j;
          throw err;
        }
        return j;
      });
    });
  }

  var StateApi = {
    list: function () {
      return request('/api/state' + toQS({ list: 1 }), { method: 'GET' })
        .then(function (data) { return (data && data.dashboards) ? data.dashboards : []; });
    },
    get: function (dashId) {
      if (!dashId) return Promise.reject(new Error('dashId required'));
      return request('/api/state' + toQS({ dash: dashId }), { method: 'GET' });
    },
    save: function (dashId, stateObj, name) {
      if (!dashId) return Promise.reject(new Error('dashId required'));
      if (!stateObj) return Promise.reject(new Error('state required'));
      var body = { state: stateObj };
      if (name) body.name = name;
      return request('/api/state' + toQS({ dash: dashId }), { method: 'POST', body: body });
    },
    publish: function (dashId, opt) {
      if (!dashId) return Promise.reject(new Error('dashId required'));
      opt = opt || {};
      var body = { all: !!opt.all, users: Array.isArray(opt.users) ? opt.users : [] };
      return request('/api/state' + toQS({ dash: dashId, publish: 1 }), { method: 'POST', body: body });
    },
    unpublish: function (dashId) {
      if (!dashId) return Promise.reject(new Error('dashId required'));
      return request('/api/state' + toQS({ dash: dashId, unpublish: 1 }), { method: 'POST', body: {} });
    },
    remove: function (dashId) {
      if (!dashId) return Promise.reject(new Error('dashId required'));
      return request('/api/state' + toQS({ dash: dashId }), { method: 'DELETE', body: {} });
    }
  };

  global.StateApi = StateApi;

})(window);
