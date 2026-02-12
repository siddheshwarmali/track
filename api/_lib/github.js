// api/_lib/github.js
// GitHub Contents API helper with safe SHA handling for updates.
// Fixes: "Invalid request. "sha" wasn't supplied." when updating existing files.

const fs = require('fs');
const pathPkg = require('path');
const GH_API = 'https://api.github.com';

function must(name){
  const v = process.env[name];
  if(!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function cfg(){
  return {
    owner: must('GITHUB_OWNER'),
    repo: must('GITHUB_REPO'),
    branch: process.env.GITHUB_BRANCH || 'main',
    token: must('GITHUB_TOKEN'),
    apiVersion: process.env.GITHUB_API_VERSION || '2022-11-28'
  };
}

function headers(c){
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${c.token}`,
    'X-GitHub-Api-Version': c.apiVersion
  };
}

function encodePath(path){
  return encodeURIComponent(path).replace(/%2F/g,'/');
}

async function ghGetFile(path){
  const localRoot = process.env.LOCAL_DB_ROOT || (!process.env.GITHUB_OWNER ? 'D:\\My Project\\Database-main' : null);
  if (localRoot) {
    const fullPath = pathPkg.join(localRoot, path);
    if (!fs.existsSync(fullPath)) return { exists: false };
    const content = fs.readFileSync(fullPath, 'utf-8');
    return { exists: true, sha: 'local', content, encoding: 'utf-8' };
  }

  const c = cfg();
  const url = `${GH_API}/repos/${c.owner}/${c.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(c.branch)}`;
  const r = await fetch(url, { headers: headers(c) });
  if (r.status === 404) return { exists:false };
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || `GitHub GET failed (${r.status})`);
  return { exists:true, sha:j.sha, content:j.content, encoding:j.encoding };
}

function decodeContent(file){
  if (!file || !file.content) return '';
  if (file.encoding === 'base64') return Buffer.from(file.content, 'base64').toString('utf-8');
  return file.content;
}

async function ghPutFile(path, textContent, message, sha){
  const localRoot = process.env.LOCAL_DB_ROOT || (!process.env.GITHUB_OWNER ? 'D:\\My Project\\Database-main' : null);
  if (localRoot) {
    const fullPath = pathPkg.join(localRoot, path);
    const dir = pathPkg.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, textContent, 'utf-8');
    return { content: { sha: 'local' } };
  }

  const c = cfg();
  const url = `${GH_API}/repos/${c.owner}/${c.repo}/contents/${encodePath(path)}`;
  const body = {
    message,
    content: Buffer.from(textContent, 'utf-8').toString('base64'),
    branch: c.branch
  };
  // IMPORTANT: GitHub requires sha when updating an existing file.
  if (sha) body.sha = sha;

  const r = await fetch(url, {
    method: 'PUT',
    headers: { ...headers(c), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || `GitHub PUT failed (${r.status})`);
  return j;
}

async function ghDeleteFile(path, message, sha){
  const localRoot = process.env.LOCAL_DB_ROOT || (!process.env.GITHUB_OWNER ? 'D:\\My Project\\Database-main' : null);
  if (localRoot) {
    const fullPath = pathPkg.join(localRoot, path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    return { content: { sha: 'local' } };
  }

  const c = cfg();
  const url = `${GH_API}/repos/${c.owner}/${c.repo}/contents/${encodePath(path)}`;
  const body = { message, sha, branch: c.branch };
  const r = await fetch(url, {
    method: 'DELETE',
    headers: { ...headers(c), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || `GitHub DELETE failed (${r.status})`);
  return j;
}

// Robust update helper:
// - If sha is not provided, it fetches current sha (when file exists) and includes it.
// - Retries once on conflict.
async function ghPutFileRetry(path, textContent, message, sha){
  // If sha not supplied, but file exists -> get sha first.
  let currentSha = sha;
  if (!currentSha){
    const f = await ghGetFile(path);
    currentSha = f.exists ? f.sha : null;
  }
  try {
    return await ghPutFile(path, textContent, message, currentSha);
  } catch (e) {
    // Retry once on conflict or sha mismatch
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('409') || msg.toLowerCase().includes('sha') || msg.toLowerCase().includes('conflict')){
      const f2 = await ghGetFile(path);
      const sha2 = f2.exists ? f2.sha : null;
      return await ghPutFile(path, textContent, message, sha2);
    }
    throw e;
  }
}

module.exports = { ghGetFile, decodeContent, ghPutFileRetry, ghDeleteFile };
