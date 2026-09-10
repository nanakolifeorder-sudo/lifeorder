const crypto = require('crypto');
const { query, transaction } = require('./db');
const { appUrl } = require('./config');
const { createPaymentPayload, parsePaymentCallback } = require('./newebpay');

const PRODUCT = Object.freeze({
  code: 'LO-FULL-980',
  name: '人生秩序完整版測驗',
  amount: 980,
  projectCode: 'LO',
  versionCode: 'FULL'
});
let paymentSchemaPromise;

function ensurePaymentOrderSchema() {
  if (!paymentSchemaPromise) {
    paymentSchemaPromise = (async () => {
      await query(`create table if not exists payment_orders (
        id bigserial primary key,
        tenant_slug text not null references tenants(slug) on delete cascade,
        project_code text not null,
        version_code text not null default '',
        product_code text not null,
        product_name text not null,
        amount integer not null check (amount > 0),
        merchant_order_no text not null unique,
        public_token uuid not null unique,
        client_name text not null,
        client_email text not null,
        client_phone text not null,
        status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'expired', 'refunded')),
        trade_no text default '',
        payment_type text default '',
        callback_payload jsonb not null default '{}'::jsonb,
        expires_at timestamptz,
        paid_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`);
      await query('create index if not exists idx_payment_orders_tenant_status on payment_orders(tenant_slug, status, created_at desc)');
    })().catch(error => {
      paymentSchemaPromise = null;
      throw error;
    });
  }
  return paymentSchemaPromise;
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizedPhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function paymentOrderNumber() {
  return `LO${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function requireLifeOrderProduct(payload = {}) {
  if (String(payload.productCode || '') !== PRODUCT.code) throw new Error('不支援的付款商品。');
  return PRODUCT;
}

function paymentUrls() {
  const root = appUrl();
  return {
    returnUrl: `${root}/api/newebpay-return`,
    notifyUrl: `${root}/api/newebpay-notify`
  };
}

async function createLifeOrderPayment(payload, tenant) {
  if (tenant !== 'lifeorder') throw new Error('此付款商品尚未開放。');
  await ensurePaymentOrderSchema();
  const product = requireLifeOrderProduct(payload);
  const name = String(payload.name || '').trim().slice(0, 120);
  const email = normalizedEmail(payload.email);
  const phone = normalizedPhone(payload.phone);
  if (!name) throw new Error('請輸入姓名。');
  if (!email || !email.includes('@')) throw new Error('請輸入正確的 Email。');
  if (!/^09[0-9]{8}$/.test(phone)) throw new Error('請輸入 09 開頭的 10 碼手機號碼。');

  const publicToken = crypto.randomUUID();
  const orderNumber = paymentOrderNumber();
  await query(
    `insert into payment_orders(
       tenant_slug, project_code, version_code, product_code, product_name, amount,
       merchant_order_no, public_token, client_name, client_email, client_phone,
       status, expires_at
     ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',now() + interval '30 minutes')`,
    [tenant, product.projectCode, product.versionCode, product.code, product.name, product.amount, orderNumber, publicToken, name, email, phone]
  );
  const urls = paymentUrls();
  const payment = createPaymentPayload({
    orderNumber,
    amount: product.amount,
    itemDescription: product.name,
    email,
    returnUrl: urls.returnUrl,
    notifyUrl: urls.notifyUrl
  });
  return { success: true, orderToken: publicToken, payment };
}

async function settlePayment(payload) {
  const callback = parsePaymentCallback(payload);
  const result = callback.Result || {};
  const orderNumber = String(result.MerchantOrderNo || '');
  if (!orderNumber) throw new Error('付款通知缺少訂單編號。');

  const settled = await transaction(async client => {
    const row = await client.query(
      `select * from payment_orders where merchant_order_no = $1 for update`,
      [orderNumber]
    );
    const order = row.rows[0];
    if (!order) throw new Error('找不到付款訂單。');
    const paid = String(callback.Status || '').toUpperCase() === 'SUCCESS';
    const amountMatches = Number(result.Amt || 0) === Number(order.amount);
    if (paid && amountMatches && order.product_code === PRODUCT.code) {
      await client.query(
        `update payment_orders
            set status = 'paid', trade_no = $2, payment_type = $3, paid_at = coalesce(paid_at, now()), callback_payload = $4::jsonb, updated_at = now()
          where id = $1`,
        [order.id, String(result.TradeNo || ''), String(result.PaymentType || ''), JSON.stringify(callback)]
      );
      order.status = 'paid';
    } else if (order.status === 'pending') {
      await client.query(
        `update payment_orders set status = 'failed', callback_payload = $2::jsonb, updated_at = now() where id = $1`,
        [order.id, JSON.stringify(callback)]
      );
      order.status = 'failed';
    }
    return order;
  });
  return settled;
}

async function getLifeOrderPayment(payload, tenant) {
  if (tenant !== 'lifeorder') throw new Error('找不到付款訂單。');
  const token = String(payload.orderToken || payload.order || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error('付款訂單識別碼無效。');
  const result = await query(
    `select product_code, product_name, amount, status, paid_at
       from payment_orders
      where tenant_slug = $1 and public_token = $2
      limit 1`,
    [tenant, token]
  );
  const order = result.rows[0];
  if (!order) throw new Error('找不到付款訂單。');
  return {
    success: true,
    status: order.status,
    productName: order.product_name,
    amount: Number(order.amount),
    quizUrl: order.status === 'paid' && order.product_code === PRODUCT.code
      ? `${appUrl()}/quiz?tenant=lifeorder&p=LO&version=full`
      : ''
  };
}

module.exports = { createLifeOrderPayment, settlePayment, getLifeOrderPayment };
