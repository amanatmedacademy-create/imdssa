import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [scheme, salt, expectedHex] = encoded.split(':');
  if (scheme !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validatePassword(password: string): string | null {
  if (password.length < 16) return 'PASSWORD_TOO_SHORT';
  if (!/[a-z]/.test(password)) return 'PASSWORD_LOWERCASE_REQUIRED';
  if (!/[A-Z]/.test(password)) return 'PASSWORD_UPPERCASE_REQUIRED';
  if (!/[0-9]/.test(password)) return 'PASSWORD_NUMBER_REQUIRED';
  if (!/[^A-Za-z0-9]/.test(password)) return 'PASSWORD_SYMBOL_REQUIRED';
  if (/\s/.test(password)) return 'PASSWORD_WHITESPACE_NOT_ALLOWED';
  return null;
}

export function createSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
