function isZoomConfigured(settings = {}) {
  return Boolean(settings.accountId && settings.clientId && settings.clientSecret);
}

function zonedZoomDateTime(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const hour = fields.hour === '24' ? '00' : fields.hour;
  return `${fields.year}-${fields.month}-${fields.day}T${hour}:${fields.minute}:${fields.second}`;
}

async function zoomAccessToken(settings) {
  if (!isZoomConfigured(settings)) throw new Error('Zoom 金鑰尚未設定完整。');
  const authorization = Buffer.from(`${settings.clientId}:${settings.clientSecret}`, 'utf8').toString('base64');
  const body = new URLSearchParams({
    grant_type: 'account_credentials',
    account_id: settings.accountId
  });
  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.reason || data.message || '無法取得 Zoom 授權，請確認 Zoom 金鑰與應用程式狀態。');
  }
  return data.access_token;
}

async function createZoomMeeting({ settings, topic, startAt, durationMinutes = 60, timeZone = 'Asia/Taipei', agenda = '' }) {
  const accessToken = await zoomAccessToken(settings);
  const response = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      topic,
      type: 2,
      // Zoom expects local wall-clock time when a timezone is supplied. Do not append UTC "Z" here.
      start_time: zonedZoomDateTime(startAt, timeZone),
      duration: durationMinutes,
      timezone: timeZone,
      agenda,
      settings: { waiting_room: true }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id || !data.join_url) {
    throw new Error(data.message || '無法建立 Zoom 會議，請確認 Zoom App 已啟用且具有建立會議權限。');
  }
  return data;
}

async function updateZoomMeeting({ settings, meetingId, startAt, durationMinutes = 60, timeZone = 'Asia/Taipei' }) {
  if (!meetingId) throw new Error('缺少 Zoom 會議識別碼。');
  const accessToken = await zoomAccessToken(settings);
  const response = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 2,
      start_time: zonedZoomDateTime(startAt, timeZone),
      duration: durationMinutes,
      timezone: timeZone
    })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || '無法更新 Zoom 會議時間。');
  }
}

async function deleteZoomMeeting({ settings, meetingId }) {
  if (!meetingId) return;
  const accessToken = await zoomAccessToken(settings);
  const response = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok && response.status !== 404) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || '無法取消 Zoom 會議。');
  }
}

module.exports = { isZoomConfigured, createZoomMeeting, updateZoomMeeting, deleteZoomMeeting };
