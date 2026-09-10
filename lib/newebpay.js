const crypto = require('crypto');

const MPG_GATEWAY = 'https://core.newebpay.com/MPG/mpg_gateway';

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`付款服務尚未設定：${name}`);
  return value;
}

function paymentConfig() {
  const merchantId = requiredEnv('NEWEBPAY_MERCHANT_ID');
  const hashKey = requiredEnv('NEWEBPAY_HASH_KEY');
  const hashIv = requiredEnv('NEWEBPAY_HASH_IV');
  if (Buffer.byteLength(hashKey, 'utf8') !== 32 || Buffer.byteLength(hashIv, 'utf8') !== 16) {
    throw new Error('藍新金流 HashKey 或 HashIV 長度不正確。');
  }
  return { merchantId, hashKey, hashIv };
}

function encryptTradeInfo(parameters, config = paymentConfig()) {
  const source = new URLSearchParams(parameters).toString();
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(config.hashKey, 'utf8'), Buffer.from(config.hashIv, 'utf8'));
  return cipher.update(source, 'utf8', 'hex') + cipher.final('hex');
}

function decryptTradeInfo(value, config = paymentConfig()) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(config.hashKey, 'utf8'), Buffer.from(config.hashIv, 'utf8'));
  return decipher.update(String(value || ''), 'hex', 'utf8') + decipher.final('utf8');
}

function tradeSha(tradeInfo, config = paymentConfig()) {
  return crypto.createHash('sha256').update(`HashKey=${config.hashKey}&${tradeInfo}&HashIV=${config.hashIv}`, 'utf8').digest('hex').toUpperCase();
}

function sameSignature(actual, expected) {
  const left = Buffer.from(String(actual || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createPaymentPayload({ orderNumber, amount, itemDescription, email, returnUrl, notifyUrl }) {
  const config = paymentConfig();
  const timeStamp = Math.floor(Date.now() / 1000);
  const tradeInfo = encryptTradeInfo({
    MerchantID: config.merchantId,
    RespondType: 'JSON',
    TimeStamp: String(timeStamp),
    Version: '2.0',
    MerchantOrderNo: orderNumber,
    Amt: String(amount),
    ItemDesc: itemDescription,
    Email: email,
    LoginType: '0',
    TradeLimit: '1800',
    ReturnURL: returnUrl,
    NotifyURL: notifyUrl,
    ClientBackURL: returnUrl
  }, config);
  return {
    gatewayUrl: MPG_GATEWAY,
    fields: {
      MerchantID: config.merchantId,
      TradeInfo: tradeInfo,
      TradeSha: tradeSha(tradeInfo, config),
      Version: '2.0'
    }
  };
}

function parsePaymentCallback(payload) {
  const config = paymentConfig();
  const tradeInfo = String(payload?.TradeInfo || '');
  const tradeShaValue = String(payload?.TradeSha || '');
  if (!tradeInfo || !tradeShaValue || !sameSignature(tradeShaValue, tradeSha(tradeInfo, config))) {
    throw new Error('付款通知簽章驗證失敗。');
  }
  let decoded;
  try {
    decoded = JSON.parse(decryptTradeInfo(tradeInfo, config));
  } catch (error) {
    throw new Error('付款通知資料無法驗證。');
  }
  return decoded;
}

module.exports = { createPaymentPayload, parsePaymentCallback };
