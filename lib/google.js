const jwt = require('jsonwebtoken');
const { googleRedirectUri, appUrl } = require('./config');
const { encryptText, decryptText } = require('./crypto-box');

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send'
];

function oauthState(payload) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set.');
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
}

function verifyOauthState(state) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set.');
  return jwt.verify(state, process.env.JWT_SECRET);
}

function googleAuthUrl({ tenant, consultantId, returnTo }) {
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is not set.');
  const state = oauthState({ tenant, consultantId, returnTo: returnTo || `${appUrl()}/admin?tenant=${tenant}` });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCode(code) {
  const params = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: googleRedirectUri(),
    grant_type: 'authorization_code'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || 'Google OAuth token exchange failed.');
  return data;
}

async function refreshAccessToken(encryptedRefreshToken) {
  const refreshToken = decryptText(encryptedRefreshToken);
  if (!refreshToken) throw new Error('這位顧問還沒有連接 Google Calendar。');
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || 'Google refresh token failed.');
  return data.access_token;
}

async function googleUserInfo(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Cannot read Google profile.');
  return data;
}

async function calendarEvents({ encryptedRefreshToken, calendarId = 'primary', timeMin, timeMax }) {
  const accessToken = await refreshAccessToken(encryptedRefreshToken);
  const params = new URLSearchParams({
    timeMin: new Date(timeMin).toISOString(),
    timeMax: new Date(timeMax).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime'
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events?${params}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Cannot read Google Calendar events.');
  return data.items || [];
}

async function createCalendarEvent({ encryptedRefreshToken, calendarId = 'primary', event }) {
  const accessToken = await refreshAccessToken(encryptedRefreshToken);
  const params = new URLSearchParams({ conferenceDataVersion: '1', sendUpdates: 'all' });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events?${params}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(event)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Cannot create Google Calendar event.');
  return data;
}

async function deleteCalendarEvent({ encryptedRefreshToken, calendarId = 'primary', eventId }) {
  if (!eventId) return;
  const accessToken = await refreshAccessToken(encryptedRefreshToken);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${encodeURIComponent(eventId)}?sendUpdates=all`;
  const response = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok && response.status !== 404) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error?.message || 'Cannot delete Google Calendar event.');
  }
}

function encodeMimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ''), 'utf8').toString('base64')}?=`;
}

function base64Url(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function sendGmailMessage({ encryptedRefreshToken, to, subject, body, senderName, senderEmail }) {
  const accessToken = await refreshAccessToken(encryptedRefreshToken);
  const from = senderEmail
    ? `From: ${senderName ? `${encodeMimeHeader(senderName)} ` : ''}<${senderEmail}>`
    : '';
  const headers = [
    from,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit'
  ].filter(Boolean);
  const raw = base64Url(`${headers.join('\r\n')}\r\n\r\n${body || ''}`);
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Cannot send Gmail message.');
  return data;
}

function encryptedRefreshToken(refreshToken) {
  return encryptText(refreshToken);
}

module.exports = {
  googleAuthUrl,
  verifyOauthState,
  exchangeCode,
  googleUserInfo,
  encryptedRefreshToken,
  calendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
  sendGmailMessage,
  SCOPES
};
