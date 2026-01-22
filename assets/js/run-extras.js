/* assets/js/run-extras.js
 * Standalone Run page helpers:
 * - Hamburger open/close
 * - Actions dropdown triggers existing Run functions
 * - Store BAU stats into localStorage (tw_bau_<dash>) after dashboard generation
 * - Replace iframe-only ADO sync with backend call (/api/ado/run-tickets)
 */

(function () {
  'use strict';

  function getDash() {
    try { return new URL(location.href).searchParams.get('dash') || 'default'; } catch (e) { return 'default'; }
  }

  function toggleHidden(el, open) {
    if (!el) return;
    var next = (typeof open === 'boolean') ? open : el.classList.contains('hidden');
    el.classList.toggle('hidden', !next);
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

  function computeBau(tickets) {
    tickets = tickets || [];
    var total = tickets.length;
    if (!total) return { totalTickets: 0, withinSLA: 0, breachedSLA: 0, slaPercentage: '0.0' };
    var onTime = 0;
    for (var i = 0; i < tickets.length; i++) {
      var t = tickets[i] || {};
      if (Number(t.actualTime) <= Number(t.threshold)) onTime++;
    }
    var breached = total - onTime;
    var sla = ((onTime / total) * 100).toFixed(1);
    return { totalTickets: total, withinSLA: onTime, breachedSLA: breached, slaPercentage: sla };
  }

  function saveBauToLocal() {
    try {
      var tickets = window.loadedTicketData || [];
      var bau = computeBau(tickets);
      localStorage.setItem('tw_bau_' + getDash(), JSON.stringify(bau));
    } catch (e) {}
  }

  function patchGenerateDashboard() {
    var orig = window.generateDashboard;
    if (typeof orig !== 'function' || orig.__tw_patched) return;
    var wrapped = function () {
      var res = orig.apply(this, arguments);
      saveBauToLocal();
      return res;
    };
    wrapped.__tw_patched = true;
    window.generateDashboard = wrapped;
  }

  function overrideAdoSync() {
    // override requestAdoSync used by the Run template
    window.requestAdoSync = function () {
      var btn = document.getElementById('syncAdoBtn');
      if (btn) {
        btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Connecting...';
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
      }
      var dash = '';
      try { dash = new URL(location.href).searchParams.get('dash') || ''; } catch (e) {}

      fetch('/api/ado/run-tickets?dash=' + encodeURIComponent(dash), { headers: { 'Accept': 'application/json' }, credentials: 'same-origin' })
        .then(function (r) {
          return r.text().then(function (t) {
            var j; try { j = JSON.parse(t || '{}'); } catch (e) { j = { error: t }; }
            if (!r.ok) throw new Error(j.error || j.message || t || ('HTTP ' + r.status));
            return j;
          });
        })
        .then(function (data) {
          var tickets = (data && (data.tickets || data.items || data.payload || data)) || [];
          if (!tickets || !tickets.length) {
            if (typeof window.showAlert === 'function') window.showAlert('❌ No valid tickets found from ADO endpoint.');
            if (typeof window.resetSyncBtn === 'function') window.resetSyncBtn();
            return;
          }
          window.loadedTicketData = tickets;
          var fn = document.getElementById('fileName');
          if (fn) fn.textContent = 'Synced from Azure DevOps';
          var pb = document.getElementById('processBtn');
          if (pb) { pb.disabled = false; pb.style.opacity = 1; }
          if (typeof window.resetSyncBtn === 'function') window.resetSyncBtn();
          if (typeof window.processData === 'function') window.processData();
        })
        .catch(function (err) {
          if (typeof window.showAlert === 'function') window.showAlert('❌ ADO sync failed: ' + (err.message || String(err)));
          if (typeof window.resetSyncBtn === 'function') window.resetSyncBtn();
        });
    };
  }

  function wireMenus() {
    var hambBtn = document.getElementById('tw-menu-btn');
    var hambMenu = document.getElementById('tw-menu');
    if (hambBtn) {
      hambBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleHidden(hambMenu);
      });
    }

    var actBtn = document.getElementById('run-actions-btn');
    var actMenu = document.getElementById('run-actions-menu');
    if (actBtn) {
      actBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleHidden(actMenu);
      });
    }

    document.addEventListener('click', function (e) {
      var insideHamb = hambMenu && (hambMenu.contains(e.target) || (hambBtn && hambBtn.contains(e.target)));
      if (hambMenu && !insideHamb) toggleHidden(hambMenu, false);

      var insideAct = actMenu && (actMenu.contains(e.target) || (actBtn && actBtn.contains(e.target)));
      if (actMenu && !insideAct) toggleHidden(actMenu, false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        toggleHidden(hambMenu, false);
        toggleHidden(actMenu, false);
      }
    });

    if (actMenu) {
      actMenu.addEventListener('click', function (e) {
        var el = e.target;
        while (el && el !== actMenu && !el.getAttribute('data-run-action')) el = el.parentNode;
        if (!el || !el.getAttribute) return;
        var act = el.getAttribute('data-run-action');
        e.preventDefault();
        toggleHidden(actMenu, false);

        if (act === 'upload') {
          var fi = document.getElementById('fileInput');
          if (fi) fi.click();
        } else if (act === 'ado') {
          if (typeof window.requestAdoSync === 'function') window.requestAdoSync();
        } else if (act === 'generate') {
          if (typeof window.processData === 'function') window.processData();
          else {
            var pb = document.getElementById('processBtn');
            if (pb) pb.click();
          }
        } else if (act === 'download') {
          if (typeof window.downloadReportAsJPG === 'function') window.downloadReportAsJPG();
          else {
            var db = document.getElementById('downloadBtn');
            if (db) db.click();
          }
        }
      });
    }
  }

  window.addEventListener('DOMContentLoaded', function () {
    preserveDashLinks();
    overrideAdoSync();
    wireMenus();

    // Patch generateDashboard after Run template scripts are loaded
    var n = 0;
    var timer = setInterval(function () {
      patchGenerateDashboard();
      n++;
      if ((window.generateDashboard && window.generateDashboard.__tw_patched) || n > 40) clearInterval(timer);
    }, 100);
  });

})();
