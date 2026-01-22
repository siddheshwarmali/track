const { json } = require('../_lib/http');
const { getSession } = require('../_lib/cookie');
module.exports = async (req, res) => {
  try {
    const s = getSession(req);
    if (!s) return json(res, 401, { error: 'Not authenticated' });
    return json(res, 501, { error: 'Implement /api/ado/run-tickets to return {tickets:[...]}' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};
