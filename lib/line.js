function isLineConfigured(settings) {
  return Boolean(settings?.channelAccessToken && settings?.recipientUserId);
}

async function sendLinePushMessage({ settings, text }) {
  if (!isLineConfigured(settings)) return { skipped: true, reason: 'LINE 通知尚未設定完成。' };

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.channelAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to: settings.recipientUserId,
      messages: [{ type: 'text', text: String(text || '').slice(0, 5000) }]
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LINE 推播失敗（${response.status}）：${detail.slice(0, 300)}`);
  }
  return { success: true };
}

module.exports = { isLineConfigured, sendLinePushMessage };
