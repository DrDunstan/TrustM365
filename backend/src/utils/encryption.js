const crypto = require('crypto');
const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex chars. Run: npm run generate:key');
  return Buffer.from(key, 'hex');
}

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decrypt(data) {
  const [ivB64, tagB64, encB64] = data.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return decipher.update(Buffer.from(encB64, 'base64')) + decipher.final('utf8');
}

module.exports = { encrypt, decrypt };
