const crypto = require('crypto');

function secretKey() {
  const source = process.env.TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || '';
  if (!source) throw new Error('TOKEN_ENCRYPTION_KEY or JWT_SECRET is required.');
  return crypto.createHash('sha256').update(source).digest();
}

function encryptText(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url')
  ].join('.');
}

function decryptText(value) {
  if (!value) return '';
  const [ivPart, tagPart, dataPart] = String(value).split('.');
  if (!ivPart || !tagPart || !dataPart) return '';
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    secretKey(),
    Buffer.from(ivPart, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

module.exports = { encryptText, decryptText };
