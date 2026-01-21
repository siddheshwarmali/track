
const { json } = require('../_lib/http');
const { getSession } = require('../_lib/cookie');
const { ghGetFile, decodeContent } = require('../_lib/github');

const USERS_PATH = 'db/users.json';

function parseJsonSafe(txt, fallback){ try{return JSON.parse(txt)}catch{return fallback} }

module.exports = async (req, res) => {
  try{
    const s = getSession(req);
    if(!s) return json(res, 200, { authenticated:false });

    const f = await ghGetFile(USERS_PATH);
    let role = s.role || 'viewer';
    let permissions = {};

    if(f.exists){
      const data = parseJsonSafe((decodeContent(f)||'').trim() || '{"users":{}}', {users:{}});
      const u = (data.users || {})[s.userId];
      if(u){
        role = u.role || role;
        permissions = u.permissions || {};
      }
    }

    return json(res, 200, { authenticated:true, userId:s.userId, role, permissions });
  } catch(e){
    return json(res, 200, { authenticated:false });
  }
};
