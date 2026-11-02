import crypto from 'node:crypto';
import type { QualityTier } from '@auris/shared';

export interface StreamClaims {
  t: string; // track id
  q: QualityTier;
  u: number; // user id
  e: number; // expiry, unix seconds
}

/** Short-lived HMAC token so <audio src> works without exposing auth headers or upstream URLs. */
export class StreamSigner {
  private key: Buffer;
  constructor(secret?: string) {
    this.key = secret ? Buffer.from(secret) : crypto.randomBytes(32);
  }
  sign(c: Omit<StreamClaims, 'e'>, ttlSec = 6 * 3600): { token: string; exp: number } {
    const claims: StreamClaims = { ...c, e: Math.floor(Date.now() / 1000) + ttlSec };
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const mac = crypto.createHmac('sha256', this.key).update(body).digest('base64url');
    return { token: `${body}.${mac}`, exp: claims.e };
  }
  verify(token: string): StreamClaims | null {
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    const expected = crypto.createHmac('sha256', this.key).update(body).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    try {
      const c = JSON.parse(Buffer.from(body, 'base64url').toString()) as StreamClaims;
      return c.e > Date.now() / 1000 ? c : null;
    } catch {
      return null;
    }
  }
}
