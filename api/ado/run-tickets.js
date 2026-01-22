const { json, readBody } = require('../_lib/http');
const { getSession } = require('../_lib/cookie');

function normalizeOrg(org){
  if(!org) return '';
  org = String(org).trim();
  org = org.replace(/^https?:\/\//i,'');
  org = org.replace(/^dev\.azure\.com\//i,'');
  org = org.replace(/\/$/,'');
  return org;
}
function authHeaderFromPat(pat){
  const token = Buffer.from(':'+String(pat||''),'utf8').toString('base64');
  return 'Basic '+token;
}
function num(v){
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
function mapTypeFromWorkItem(wi){
  const f = (wi && wi.fields) ? wi.fields : {};
  const wtype = f['System.WorkItemType'] || '';
  const tags = (f['System.Tags'] || '').toLowerCase();
  if(tags.includes('small')) return 'Small';
  if(tags.includes('medium')) return 'Medium';
  if(tags.includes('large')) return 'Large';
  if(String(wtype).toLowerCase().includes('bug')) return 'Medium';
  if(String(wtype).toLowerCase().includes('task')) return 'Small';
  return 'Medium';
}

// POST body:
// { org, project, pat, queryId } OR { org, project, pat, wiql }
module.exports = async (req, res) => {
  try {
    const s = getSession(req);
    if(!s) return json(res, 401, { error: 'Not authenticated' });
    if(req.method !== 'POST') return json(res, 405, { error: 'Method not allowed. Use POST.' });

    const body = await readBody(req);
    const org = normalizeOrg(body.org);
    const project = String(body.project || '').trim();
    const pat = String(body.pat || '').trim();
    const queryId = String(body.queryId || '').trim();
    let wiql = String(body.wiql || '').trim();

    if(!org) return json(res, 400, { error: 'org required' });
    if(!project) return json(res, 400, { error: 'project required' });
    if(!pat) return json(res, 400, { error: 'pat required' });
    if(!queryId && !wiql) return json(res, 400, { error: 'queryId or wiql required' });

    const baseUrl = `https://dev.azure.com/${org}/${encodeURIComponent(project)}`;
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': authHeaderFromPat(pat)
    };

    // If queryId provided, fetch query definition with wiql
    if(queryId && !wiql){
      const qUrl = `${baseUrl}/_apis/wit/queries/${encodeURIComponent(queryId)}?$expand=wiql&api-version=7.1`;
      const qResp = await fetch(qUrl, { method:'GET', headers });
      const qText = await qResp.text();
      let qJson = {}; try{ qJson = JSON.parse(qText||'{}'); }catch(e){ qJson = { error: qText }; }
      if(!qResp.ok) return json(res, qResp.status, { error: qJson.error || qJson.message || qText || 'Query fetch failed' });
      wiql = String(qJson.wiql || '').trim();
      if(!wiql) return json(res, 400, { error: 'No wiql found for queryId' });
    }

    // Execute WIQL
    const wiqlUrl = `${baseUrl}/_apis/wit/wiql?api-version=7.1`;
    const wiqlResp = await fetch(wiqlUrl, { method:'POST', headers, body: JSON.stringify({ query: wiql }) });
    const wiqlText = await wiqlResp.text();
    let wiqlJson = {}; try{ wiqlJson = JSON.parse(wiqlText||'{}'); }catch(e){ wiqlJson = { error: wiqlText }; }
    if(!wiqlResp.ok) return json(res, wiqlResp.status, { error: wiqlJson.error || wiqlJson.message || wiqlText || 'WIQL execution failed' });

    const workItems = Array.isArray(wiqlJson.workItems) ? wiqlJson.workItems : [];
    const ids = workItems.map(w=>w.id).filter(Boolean);
    if(ids.length===0) return json(res, 200, { tickets: [] });

    // Fetch details via batch
    const batchUrl = `${baseUrl}/_apis/wit/workitemsbatch?api-version=7.1`;
    const fields = [
      'System.Id',
      'System.Title',
      'System.WorkItemType',
      'System.Tags',
      'Microsoft.VSTS.Scheduling.CompletedWork',
      'Microsoft.VSTS.Scheduling.OriginalEstimate'
    ];

    const batchResp = await fetch(batchUrl, { method:'POST', headers, body: JSON.stringify({ ids: ids.slice(0, 200), fields }) });
    const batchText = await batchResp.text();
    let batchJson = {}; try{ batchJson = JSON.parse(batchText||'{}'); }catch(e){ batchJson = { error: batchText }; }
    if(!batchResp.ok) return json(res, batchResp.status, { error: batchJson.error || batchJson.message || batchText || 'WorkItems batch failed' });

    const items = Array.isArray(batchJson.value) ? batchJson.value : [];
    const thresholdMap = { Small: 4, Medium: 6, Large: 8 };

    const tickets = items.map(wi => {
      const f = wi.fields || {};
      const type = mapTypeFromWorkItem(wi);
      const actualTime = num(f['Microsoft.VSTS.Scheduling.CompletedWork'] || f['Microsoft.VSTS.Scheduling.OriginalEstimate']);
      const threshold = thresholdMap[type] || 6;
      return {
        id: String(f['System.Id'] || wi.id || ''),
        title: String(f['System.Title'] || ''),
        type,
        actualTime,
        threshold
      };
    });

    return json(res, 200, { tickets });

  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};
