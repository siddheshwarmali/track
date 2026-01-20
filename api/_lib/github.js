
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
  const c = cfg();
  const url = `${GH_API}/repos/${c.owner}/${c.repo}/contents/${encodePath(path)}`;
  const body = {
    message,
    content: Buffer.from(textContent, 'utf-8').toString('base64'),
    branch: c.branch
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, { method:'PUT', headers: { ...headers(c), 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || `GitHub PUT failed (${r.status})`);
  return j;
}

async function ghDeleteFile(path, message, sha){
  const c = cfg();
  const url = `${GH_API}/repos/${c.owner}/${c.repo}/contents/${encodePath(path)}`;
  const body = { message, sha, branch: c.branch };
  const r = await fetch(url, { method:'DELETE', headers: { ...headers(c), 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || `GitHub DELETE failed (${r.status})`);
  return j;
}

// Basic 409 retry once
async function ghPutFileRetry(path, textContent, message){
  const first = await ghGetFile(path);
  try {
    return await ghPutFile(path, textContent, message, first.exists?first.sha:null);
  } catch(e){
    if (String(e).includes('409')){
      const again = await ghGetFile(path);
      return await ghPutFile(path, textContent, message, again.exists?again.sha:null);
    }
    throw e;
  }
}

module.exports = { ghGetFile, ghPutFile, ghPutFileRetry, ghDeleteFile, decodeContent };
