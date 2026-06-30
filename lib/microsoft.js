const jwt = require('jsonwebtoken');
const { appUrl } = require('./config');
const { encryptText, decryptText } = require('./crypto-box');

const SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite'
];

function microsoftEnabled() {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

function microsoftTenantId() {
  return process.env.MICROSOFT_TENANT_ID || 'organizations';
}

function microsoftRedirectUri() {
  return `${appUrl()}/api/microsoft-oauth-callback`;
}

function oauthState(payload) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set.');
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
}

function verifyMicrosoftOauthState(state) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set.');
  return jwt.verify(state, process.env.JWT_SECRET);
}

function microsoftAuthUrl({ tenant, consultantId, returnTo }) {
  if (!microsoftEnabled()) {
    throw new Error('尚未設定 Microsoft Entra OAuth。請先在 Vercel 加入 MICROSOFT_CLIENT_ID 與 MICROSOFT_CLIENT_SECRET。');
  }
  const state = oauthState({ tenant, consultantId, returnTo: returnTo || `${appUrl()}/admin?tenant=${tenant}` });
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: microsoftRedirectUri(),
    response_mode: 'query',
    scope: SCOPES.join(' '),
    state
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(microsoftTenantId())}/oauth2/v2.0/authorize?${params}`;
}

async function tokenRequest(params) {
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(microsoftTenantId())}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || 'Microsoft OAuth token exchange failed.');
  return data;
}

function exchangeMicrosoftCode(code) {
  return tokenRequest(new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    code,
    redirect_uri: microsoftRedirectUri(),
    grant_type: 'authorization_code',
    scope: SCOPES.join(' ')
  }));
}

async function refreshMicrosoftAccessToken(encryptedRefreshToken) {
  const refreshToken = decryptText(encryptedRefreshToken);
  if (!refreshToken) throw new Error('這位顧問還沒有連接 Microsoft Calendar。');
  const data = await tokenRequest(new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: SCOPES.join(' ')
  }));
  return data.access_token;
}

async function graphRequest(path, options = {}) {
  const accessToken = options.accessToken ||
    await refreshMicrosoftAccessToken(options.encryptedRefreshToken);
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: options.method || 'GET',
    headers: Object.assign({
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'outlook.timezone="UTC"'
    }, options.headers || {}),
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (response.status === 204) return {};
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Microsoft Graph request failed.');
  return data;
}

function microsoftUserInfo(accessToken) {
  return graphRequest('/me?$select=displayName,mail,userPrincipalName', { accessToken });
}

function microsoftCalendarPath(calendarId, suffix) {
  if (!calendarId || calendarId === 'primary') return `/me/calendar${suffix}`;
  return `/me/calendars/${encodeURIComponent(calendarId)}${suffix}`;
}

function utcDateTime(value) {
  const text = String(value || '');
  if (!text) return text;
  return /(?:Z|[+-]\d\d:\d\d)$/i.test(text) ? text : `${text}Z`;
}

async function microsoftCalendarEvents({ encryptedRefreshToken, calendarId = 'primary', timeMin, timeMax }) {
  const params = new URLSearchParams({
    startDateTime: new Date(timeMin).toISOString(),
    endDateTime: new Date(timeMax).toISOString(),
    $select: 'id,showAs,isCancelled,start,end'
  });
  const data = await graphRequest(
    `${microsoftCalendarPath(calendarId, '/calendarView')}?${params}`,
    { encryptedRefreshToken }
  );
  return (data.value || []).map(event => ({
    id: event.id,
    status: event.isCancelled ? 'cancelled' : 'confirmed',
    transparency: event.showAs === 'free' ? 'transparent' : 'opaque',
    start: { dateTime: utcDateTime(event.start?.dateTime) },
    end: { dateTime: utcDateTime(event.end?.dateTime) }
  }));
}

async function createMicrosoftCalendarEvent({ encryptedRefreshToken, calendarId = 'primary', event }) {
  return graphRequest(microsoftCalendarPath(calendarId, '/events'), {
    method: 'POST',
    encryptedRefreshToken,
    body: event
  });
}

async function deleteMicrosoftCalendarEvent({ encryptedRefreshToken, calendarId = 'primary', eventId }) {
  if (!eventId) return;
  await graphRequest(`${microsoftCalendarPath(calendarId, '/events')}/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    encryptedRefreshToken
  });
}

function encryptedMicrosoftRefreshToken(refreshToken) {
  return encryptText(refreshToken);
}

module.exports = {
  SCOPES,
  microsoftEnabled,
  microsoftAuthUrl,
  verifyMicrosoftOauthState,
  exchangeMicrosoftCode,
  microsoftUserInfo,
  microsoftCalendarEvents,
  createMicrosoftCalendarEvent,
  deleteMicrosoftCalendarEvent,
  encryptedMicrosoftRefreshToken
};
