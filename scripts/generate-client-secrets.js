const crypto = require('crypto');
const keys = ['JWT_SECRET', 'TOKEN_ENCRYPTION_KEY', 'WEBHOOK_SECRET', 'CRON_SECRET', 'INSTALLER_SECRET'];
for (const key of keys) {
  console.log(`${key}=${crypto.randomBytes(32).toString('base64url')}`);
}