/* assets/js/build-extras.js
 * - Preserve ?dash= when navigating between build/run
 * - Read BAU stats from localStorage key tw_bau_<dash> and refresh BAU widgets
 */

(function () {
  'use strict';

  function getDash() {
    try { return new URL(location.href).searchParams.get('dash') || 'default'; } catch (e) { return 'default'; }
  }

  function preserveDashLinks() {
    try {
      var dash = new URL(location.href).searchParams.get('dash');
      var qs = dash ? ('?dash=' + encodeURIComponent(dash)) : '';
      var b = document.getElementById('nav-build');
      var r = document.getElementById('nav-run');
      if (b) b.href = '/build.html' + qs;
      if (r) r.href = '/run.html' + qs;
    } catch (e) {}
  }

  function loadBauFromLocal() {
    try {
      var key = 'tw_bau_' + getDash();
      var raw = localStorage.getItem(key);
      if (!raw) return;
      var val = JSON.parse(raw);
      if (!val) return;
      if (typeof window.bauData === 'object' && window.bauData) {
        window.bauData.totalTickets = (val.totalTickets != null) ? val.totalTickets : window.bauData.totalTickets;
        window.bauData.withinSLA = (val.withinSLA != null) ? val.withinSLA : window.bauData.withinSLA;
        window.bauData.breachedSLA = (val.breachedSLA != null) ? val.breachedSLA : window.bauData.breachedSLA;
        window.bauData.slaPercentage = (val.slaPercentage != null) ? val.slaPercentage : window.bauData.slaPercentage;
        if (typeof window.renderBauStats === 'function') window.renderBauStats();
      }
    } catch (e) {}
  }

  window.addEventListener('DOMContentLoaded', function () {
    preserveDashLinks();
    setTimeout(loadBauFromLocal, 400);
  });

  window.addEventListener('storage', function (e) {
    if (e && e.key && String(e.key).indexOf('tw_bau_') === 0) loadBauFromLocal();
  });

})();
