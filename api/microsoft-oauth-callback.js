const { query } = require('../lib/db');
const {
  verifyMicrosoftOauthState,
  exchangeMicrosoftCode,
  microsoftUserInfo,
  encryptedMicrosoftRefreshToken
} = require('../lib/microsoft');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = async function handler(req, res) {
  try {
    const { code, state, error, error_description: errorDescription } = req.query || {};
    if (error) throw new Error(errorDescription || error);
    if (!code || !state) throw new Error('Microsoft OAuth callback 缺少 code 或 state。');

    const parsedState = verifyMicrosoftOauthState(state);
    const tokenData = await exchangeMicrosoftCode(code);
    const userInfo = await microsoftUserInfo(tokenData.access_token);
    if (!tokenData.refresh_token) {
      throw new Error('Microsoft 沒有回傳 refresh token，請回到後台重新授權。');
    }

    await query(
      `update consultants
          set microsoft_refresh_token = $3,
              microsoft_email = $4,
              calendar_id = 'primary'
        where tenant_slug = $1 and id = $2`,
      [
        parsedState.tenant,
        parsedState.consultantId,
        encryptedMicrosoftRefreshToken(tokenData.refresh_token),
        userInfo.mail || userInfo.userPrincipalName || ''
      ]
    );

    const returnTo = parsedState.returnTo || `/admin?tenant=${parsedState.tenant}`;
    res.statusCode = 302;
    res.setHeader('Location', `${returnTo}${returnTo.includes('?') ? '&' : '?'}microsoftConnected=1`);
    res.end();
  } catch (error) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`
      <h1>Microsoft 授權失敗</h1>
      <p>${escapeHtml(error.message || error)}</p>
      <p>請回到後台重新連接。</p>
    `);
  }
};
