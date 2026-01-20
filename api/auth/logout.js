
const { json } = require('../_lib/http');
const { clearSession } = require('../_lib/cookie');

module.exports = (req, res) => {
  clearSession(res);
  return json(res, 200, { ok:true });
};
