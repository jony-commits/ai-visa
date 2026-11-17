import crypto from 'node:crypto';

const DEFAULT_DEV_KEY = crypto
  .createHash('sha256')
  .update('meridian-visa-dev-encryption-key-change-in-prod')
  .digest();

function getEncryptionKey(): Buffer {
  const configured = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!configured) {
    return DEFAULT_DEV_KEY;
  }
  if (/^[0-9a-fA-F]{64}$/.test(configured)) {
    return Buffer.from(configured, 'hex');
  }
  const decoded = Buffer.from(configured, 'base64');
  if (decoded.length === 32) {
    return decoded;
  }
  return crypto.createHash('sha256').update(configured).digest();
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  if (!salt || !originalHex) return false;
  const derivedBuf = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const originalBuf = Buffer.from(originalHex, 'hex');
  if (derivedBuf.length !== originalBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, originalBuf);
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function encryptField(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: authTag.toString('base64'),
    ct: encrypted.toString('base64'),
  });
}

export function decryptField(payload: string): string {
  const parsed = JSON.parse(payload) as {
    v: number;
    alg: string;
    iv: string;
    tag: string;
    ct: string;
  };
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(parsed.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.ct, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function maskPassportNumber(passportNumber: string): string {
  const cleaned = passportNumber.trim();
  if (cleaned.length <= 4) {
    return '••••';
  }
  const visible = cleaned.slice(-4);
  return `${'•'.repeat(Math.max(4, cleaned.length - 4))}${visible}`;
}
