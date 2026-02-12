// d:\My Project\CycleCipher-main\api\_lib\logger.js
const fs = require('fs');
const path = require('path');

function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d - yearStart) / 86400000) + 1)/7);
}

function getDiffs(oldData, newData, prefix = '') {
  // 1. Ignore noisy keys
  if (prefix.endsWith('.capturedAt') || prefix === 'capturedAt') return [];
  if (prefix.endsWith('.updatedAt') || prefix === 'updatedAt') return [];
  if (prefix.endsWith('.adoConfig') || prefix.includes('.adoConfig.')) return []; // Ignore ADO config noise

  if (oldData === newData) return [];
  
  // 2. Handle Addition (show value)
  if (oldData === undefined) {
      let val = '';
      try { val = JSON.stringify(newData); } catch(e) { val = String(newData); }
      if (val.length > 500) val = val.substring(0, 497) + '...';
      return [`${prefix} added: ${val}`];
  }
  if (newData === undefined) {
      let val = '';
      try { val = JSON.stringify(oldData); } catch(e) { val = String(oldData); }
      if (val.length > 500) val = val.substring(0, 497) + '...';
      return [`${prefix} deleted: ${val}`];
  }

  const isObj = (v) => typeof v === 'object' && v !== null;
  
  // If types differ
  if (typeof oldData !== typeof newData || Array.isArray(oldData) !== Array.isArray(newData)) {
    return [`${prefix} changed type`];
  }

  // Primitives
  if (!isObj(oldData)) {
    if (oldData !== newData) return [`${prefix}: '${oldData}' -> '${newData}'`];
    return [];
  }

  // Arrays
  if (Array.isArray(oldData)) {
    if (JSON.stringify(oldData) === JSON.stringify(newData)) return [];
    
    // 1. Try ID-based comparison (Robust for reorders, adds, removes)
    const oldArr = oldData;
    const newArr = newData;

    // Helper to find a unique ID property (supports id, key, or name)
    const getId = (item) => {
        if (!item || typeof item !== 'object') return null;
        return item.id || item.key || item.name;
    };

    // Check if items look like objects with IDs/Keys
    const looksLikeIdList = (oldArr.length > 0 || newArr.length > 0) && 
                            (oldArr.length === 0 || getId(oldArr[0])) &&
                            (newArr.length === 0 || getId(newArr[0]));

    if (looksLikeIdList) {
        const oldMap = new Map();
        oldArr.forEach(i => { const id = getId(i); if(id) oldMap.set(String(id), i); });
        const newMap = new Map();
        newArr.forEach(i => { const id = getId(i); if(id) newMap.set(String(id), i); });

        const changes = [];
        
        // Added
        newMap.forEach((item, id) => {
            if (!oldMap.has(id)) {
                let label = item.title || item.label || item.name || item.description || item.phase || id;
                if (typeof label === 'string' && label.length > 100) label = label.substring(0, 97) + '...';
                changes.push(`${prefix} added item "${label}"`);
            }
        });

        // Removed
        oldMap.forEach((item, id) => {
            if (!newMap.has(id)) {
                let label = item.title || item.label || item.name || item.description || item.phase || id;
                if (typeof label === 'string' && label.length > 100) label = label.substring(0, 97) + '...';
                changes.push(`${prefix} deleted item "${label}"`);
            }
        });

        // Modified
        newMap.forEach((newItem, id) => {
            if (oldMap.has(id)) {
                const oldItem = oldMap.get(id);
                if (JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
                    let label = newItem.title || newItem.label || newItem.name || newItem.description || newItem.phase || id;
                    if (typeof label === 'string' && label.length > 50) label = label.substring(0, 47) + '...';
                    changes.push(...getDiffs(oldItem, newItem, `${prefix}[${id} "${label}"]`));
                }
            }
        });

        if (changes.length > 0) return changes;
    }

    // If lengths differ
    if (oldData.length !== newData.length) {
        // If array was empty and now has items, show added items (up to a limit)
        if (oldData.length === 0 && newData.length > 0) {
             const added = [];
             for(let i=0; i<newData.length; i++) {
                 added.push(...getDiffs(undefined, newData[i], `${prefix}[${i}]`));
                 if (added.length > 3) break; // Limit noise for bulk adds
             }
             if (added.length > 3) return [`${prefix} initialized with ${newData.length} items`];
             return added;
        }
        
        // If items added (simple append detection)
        if (newData.length > oldData.length) {
             const commonLength = oldData.length;
             const prefixMatch = JSON.stringify(oldData) === JSON.stringify(newData.slice(0, commonLength));
             if (prefixMatch) {
                 const added = [];
                 for(let i=commonLength; i<newData.length; i++) {
                     let keyName = `[${i}]`;
                     const item = newData[i];
                     if (item && typeof item === 'object') {
                        // Try to find a readable name
                        let label = item.title || item.name || item.phase || item.discipline || item.category || item.description || item.id;
                        if (label && typeof label === 'string') {
                            if (label.length > 50) label = label.substring(0, 47) + '...';
                            keyName = `[${i} "${label}"]`;
                        }
                     }
                     added.push(...getDiffs(undefined, newData[i], `${prefix}${keyName}`));
                 }
                 if (added.length <= 3) return added;
             }
        }

        // If items removed (single deletion detection)
        if (oldData.length > newData.length && oldData.length - newData.length === 1) {
             let idx = 0;
             while(idx < newData.length && JSON.stringify(oldData[idx]) === JSON.stringify(newData[idx])) {
                 idx++;
             }
             // Check if rest matches (shifted)
             const restMatch = JSON.stringify(oldData.slice(idx + 1)) === JSON.stringify(newData.slice(idx));
             if (restMatch) {
                 let val = '';
                 try { val = JSON.stringify(oldData[idx]); } catch(e) { val = String(oldData[idx]); }
                 if (val.length > 100) val = val.substring(0, 97) + '...';
                 return [`${prefix} deleted item [${idx}]: ${val}`];
             }
        }

        return [`${prefix} (Array[${oldData.length}] -> Array[${newData.length}])`];
    }

    // If lengths are same, check items (limit depth)
    const depth = prefix ? prefix.split('.').length : 0;
    if (depth >= 6) return [`${prefix} modified`];

    let changes = [];
    for (let i = 0; i < oldData.length; i++) {
        let keyName = `[${i}]`;
        const item = oldData[i];
        if (item && typeof item === 'object') {
             let label = item.title || item.label || item.name || item.phase || item.discipline || item.category || item.description || item.id || item.key;
             if (label && typeof label === 'string') {
                 if (label.length > 50) label = label.substring(0, 47) + '...';
                 keyName = `[${i} "${label}"]`;
             }
        }
        const p = `${prefix}${keyName}`;
        changes = changes.concat(getDiffs(oldData[i], newData[i], p));
    }
    if (changes.length > 5) return [`${prefix} (multiple items modified)`];
    return changes;
  }

  // Objects - Limit recursion depth to avoid massive logs
  // Depth 0 (root) -> Depth 1 (executive/run) -> Depth 2 (milestones/tickets)
  const depth = prefix ? prefix.split('.').length : 0;
  
  if (depth >= 8) {
    if (JSON.stringify(oldData) !== JSON.stringify(newData)) return [`${prefix} modified`];
    return [];
  }

  const keys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  let changes = [];
  
  for (const key of keys) {
    // Skip noisy keys
    if (key === 'capturedAt' || key === 'sha' || key === 'updatedAt') continue;
    const p = prefix ? `${prefix}.${key}` : key;
    changes = changes.concat(getDiffs(oldData[key], newData[key], p));
  }
  
  return changes;
}

function describeChanges(oldData, newData) {
  try {
    const diffs = getDiffs(oldData, newData);
    if (diffs.length === 0) return 'No changes detected.';
    return `Changes: ${diffs.join(', ')}`;
  } catch (e) {
    return 'Error calculating changes';
  }
}



function log(userId, workspaceId, action, details) {
  try {
    // Use the global DB root if set, otherwise fallback
    // On Cloudflare, __dirname might not exist or behave differently
    const dbRoot = process.env.LOCAL_DB_ROOT || (typeof __dirname !== 'undefined' ? path.join(__dirname, '../../') : '/tmp');
    const logsDir = path.join(dbRoot, 'db', 'logs');

    if (!fs.existsSync(logsDir)) {
      // If fs is read-only (Cloudflare), this might throw or fail silently.
      // We catch the error below.
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const now = new Date();
    const year = now.getFullYear();
    const week = getWeekNumber(now);
    // File format: log_2024_week5.jsonl
    const filename = `log_${year}_week${week}.jsonl`;
    const filePath = path.join(logsDir, filename);

    const entry = {
      ts: now.toISOString(),
      user: userId || 'system',
      ws: workspaceId || '-',
      act: action,
      det: details || ''
    };    

    // Append as a single line JSON
    if (fs.appendFileSync) {
        fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
    } else {
        // Fallback for Cloudflare Logs
        console.log(JSON.stringify(entry));
    }
  } catch (e) {
    // Suppress FS errors on Cloudflare
    if (e.code !== 'EROFS' && e.code !== 'ENosys') {
        console.error('Logger Error:', e);
    }
  }
}

module.exports = { log, describeChanges };
