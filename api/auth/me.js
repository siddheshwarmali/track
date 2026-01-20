
const { json } = require('../_lib/http');
const { getSession } = require('../_lib/cookie');

module.exports = (req, res) => {
  const s = getSession(req);
  if(!s) return json(res, 200, { authenticated:false });
  return json(res, 200, { authenticated:true, userId: s.userId, role: s.role });
};
