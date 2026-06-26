const { setCors, sendJson } = require('../lib/http');
const { runDueEmails } = require('../lib/service');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const secret = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.secret || '';
    if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
      throw new Error('Invalid cron secret.');
    }
    const result = await runDueEmails({ limit: Number(req.query.limit || 50) });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 200, {
      success: false,
      message: error.message || String(error)
    });
  }
};
