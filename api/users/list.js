const { json } = require('../_lib/http');
const { getSession } = require('../_lib/cookie');
const { ghGetFile, decodeContent } = require('../_lib/github');
const USERS_PATH='db/users.json';
function parseJsonSafe(txt,fb){ try{return JSON.parse(txt);}catch{return fb;} }
module.exports=async(req,res)=>{
  const s=getSession(req);
  if(!s) return json(res,401,{error:'Not authenticated'});
  const f=await ghGetFile(USERS_PATH);
  if(!f.exists) return json(res,200,{users:[]});
  const data=parseJsonSafe((decodeContent(f)||'').trim()||'{"users":{}}',{users:{}});
  const users=Object.values(data.users||{}).map(u=>({userId:u.userId, role:u.role}));
  return json(res,200,{users});
};
