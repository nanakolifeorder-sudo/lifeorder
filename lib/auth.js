const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('./db');

function jwtSecret() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set.');
  return process.env.JWT_SECRET;
}

async function hashPassword(password) {
  return bcrypt.hash(String(password), 12);
}

async function checkPassword(password, hash) {
  if (!password || !hash) return false;
  return bcrypt.compare(String(password), hash);
}

function signSession(user) {
  return jwt.sign({
    tenant: user.tenant_slug,
    consultantId: user.id,
    name: user.name,
    email: user.login_email,
    permissions: user.permissions || ''
  }, jwtSecret(), { expiresIn: '7d' });
}

function verifyToken(token) {
  return jwt.verify(token, jwtSecret());
}

function readBearer(req, payload = {}) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return payload.authToken || payload.token || '';
}

async function login(tenantSlug, email, password) {
  const result = await query(
    `select id, tenant_slug, name, login_email, password_hash, permissions
       from consultants
      where tenant_slug = $1 and lower(login_email) = lower($2)
      limit 1`,
    [tenantSlug, email]
  );
  const user = result.rows[0];
  if (!user || !(await checkPassword(password, user.password_hash))) {
    return null;
  }
  return user;
}

async function requireUser(req, payload = {}) {
  const token = readBearer(req, payload);
  if (!token) throw new Error('請先登入。');
  const decoded = verifyToken(token);
  const result = await query(
    `select id, tenant_slug, name, login_email, permissions
       from consultants
      where tenant_slug = $1 and id = $2
      limit 1`,
    [decoded.tenant, decoded.consultantId]
  );
  const user = result.rows[0];
  if (!user) throw new Error('登入已失效，請重新登入。');
  return user;
}

function isAdmin(user) {
  return user && (user.permissions === 'ALL' || String(user.permissions || '').includes('顧問管理'));
}

module.exports = {
  hashPassword,
  login,
  signSession,
  verifyToken,
  requireUser,
  isAdmin
};
