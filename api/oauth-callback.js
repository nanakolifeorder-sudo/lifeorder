const { query } = require('../lib/db');
const {
  verifyOauthState,
  exchangeCode,
  googleUserInfo,
  encryptedRefreshToken
} = require('../lib/google');

module.exports = async function handler(req, res) {
  try {
    const { code, state, error } = req.query || {};
    if (error) throw new Error(error);
    if (!code || !state) throw new Error('Google OAuth callback 缺少 code 或 state。');

    const parsedState = verifyOauthState(state);
    const tokenData = await exchangeCode(code);
    const userInfo = await googleUserInfo(tokenData.access_token);

    const refreshToken = tokenData.refresh_token;
    if (!refreshToken) {
      throw new Error('Google 沒有回傳 refresh token，請重新按一次連接並確認授權。');
    }

    await query(
      `update consultants
          set google_refresh_token = $3,
              google_email = $4,
              calendar_id = 'primary'
        where tenant_slug = $1 and id = $2`,
      [
        parsedState.tenant,
        parsedState.consultantId,
        encryptedRefreshToken(refreshToken),
        userInfo.email || ''
      ]
    );

    const returnTo = parsedState.returnTo || `/admin?tenant=${parsedState.tenant}`;
    res.statusCode = 302;
    res.setHeader('Location', `${returnTo}${returnTo.includes('?') ? '&' : '?'}googleConnected=1`);
    res.end();
  } catch (error) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`
      <h1>Google 授權失敗</h1>
      <p>${String(error.message || error)}</p>
      <p>請回到後台重新連接。</p>
    `);
  }
};
