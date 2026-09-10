const { settlePayment } = require('../lib/lifeorder-payment');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }
  try {
    const order = await settlePayment(req.body || {});
    const target = `/payment-success?order=${encodeURIComponent(order.public_token)}`;
    res.writeHead(303, { Location: target, 'Cache-Control': 'no-store' });
    res.end();
  } catch (error) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>付款結果確認中</title><p>付款結果確認中，請稍後重新開啟付款完成頁面。</p></html>');
  }
};
