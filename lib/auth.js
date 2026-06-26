const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('./db');
const { ownerEmail, ownerName, ownerPassword } = require('./config');

const ROLE_SYSTEM_OWNER = 'SYSTEM_OWNER';
const ROLE_TENANT_ADMIN = 'TENANT_ADMIN';
const ROLE_CONSULTANT = 'CONSULTANT';

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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isOwnerEmail(email) {
  return normalizeEmail(email) === normalizeEmail(ownerEmail());
}

function permissionTokens(user) {
  return String(user?.permissions || '')
    .split(/[,，\s]+/)
    .map(item => item.trim().toUpperCase())
    .filter(Boolean);
}

function roleOf(user) {
  if (!user) return '';
  if (isOwnerEmail(user.login_email || user.email) || permissionTokens(user).includes(ROLE_SYSTEM_OWNER)) {
    return ROLE_SYSTEM_OWNER;
  }
  const tokens = permissionTokens(user);
  if (tokens.includes(ROLE_TENANT_ADMIN) || tokens.includes('ALL')) return ROLE_TENANT_ADMIN;
  return ROLE_CONSULTANT;
}

function isSystemOwner(user) {
  return roleOf(user) === ROLE_SYSTEM_OWNER;
}

function isTenantAdmin(user) {
  const role = roleOf(user);
  return role === ROLE_SYSTEM_OWNER || role === ROLE_TENANT_ADMIN;
}

function isAdmin(user) {
  return isTenantAdmin(user);
}

function hasPermission(user, permission) {
  if (isTenantAdmin(user)) return true;
  const tokens = permissionTokens(user);
  return tokens.includes(String(permission || '').toUpperCase());
}

function signSession(user) {
  const role = roleOf(user);
  return jwt.sign({
    tenant: user.tenant_slug,
    consultantId: user.id,
    name: user.name,
    email: user.login_email,
    permissions: user.permissions || role,
    role
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

async function ownerFallbackUser(tenantSlug, email, password) {
  if (!isOwnerEmail(email) || String(password) !== String(ownerPassword())) return null;
  return {
    id: 0,
    tenant_slug: tenantSlug,
    name: ownerName(),
    login_email: ownerEmail(),
    permissions: ROLE_SYSTEM_OWNER
  };
}

async function login(tenantSlug, email, password) {
  const result = await query(
    `select id, tenant_slug, name, login_email, password_hash, permissions, project_codes
       from consultants
      where tenant_slug = $1 and lower(login_email) = lower($2)
      limit 1`,
    [tenantSlug, email]
  );
  const user = result.rows[0];
  if (user && await checkPassword(password, user.password_hash)) {
    if (isOwnerEmail(user.login_email)) {
      user.permissions = ROLE_SYSTEM_OWNER;
    }
    return user;
  }
  return ownerFallbackUser(tenantSlug, email, password);
}

async function requireUser(req, payload = {}) {
  const token = readBearer(req, payload);
  if (!token) throw new Error('請先登入。');

  const decoded = verifyToken(token);
  if (decoded.role === ROLE_SYSTEM_OWNER || isOwnerEmail(decoded.email)) {
    return {
      id: decoded.consultantId || 0,
      tenant_slug: decoded.tenant,
      name: decoded.name || ownerName(),
      login_email: decoded.email || ownerEmail(),
      permissions: ROLE_SYSTEM_OWNER
    };
  }

  const result = await query(
    `select id, tenant_slug, name, login_email, permissions, project_codes
       from consultants
      where tenant_slug = $1 and id = $2
      limit 1`,
    [decoded.tenant, decoded.consultantId]
  );
  const user = result.rows[0];
  if (!user) throw new Error('登入狀態已失效，請重新登入。');
  return user;
}

module.exports = {
  ROLE_SYSTEM_OWNER,
  ROLE_TENANT_ADMIN,
  ROLE_CONSULTANT,
  hashPassword,
  login,
  signSession,
  verifyToken,
  requireUser,
  isAdmin,
  isSystemOwner,
  isTenantAdmin,
  hasPermission,
  roleOf
};
