module.exports.json = function json(res, status, obj){
  res.statusCode = status;
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify(obj));
};
module.exports.readBody = async function readBody(req){
  const chunks=[];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if(!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
};
