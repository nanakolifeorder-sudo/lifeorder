const { setCors, sendJson, readJson, tenantFrom } = require('../lib/http');
const { routeAction, normalizeTenant } = require('../lib/service');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const payload = req.method === 'GET' ? {} : await readJson(req);
    const action = req.query.action || payload.action;
    if (!action) throw new Error('缺少 action。');

    const tenant = normalizeTenant(tenantFrom(req, payload));
    const result = await routeAction(action, payload, req, tenant);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 200, {
      success: false,
      message: error.message || String(error)
    });
  }
};
