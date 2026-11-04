/**
 * HTTP headers for the Mini App pages (production server and Vite dev/preview).
 * Referrer-Policy: the YouTube embed must receive a Referer identifying AURIS (YouTube RMF);
 * "no-referrer" would break it. The CSP allows only the official YouTube player hosts.
 */
export const MINI_APP_CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.youtube.com https://s.ytimg.com",
  'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const MINI_APP_HEADERS: Record<string, string> = {
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'content-security-policy': MINI_APP_CSP,
  'permissions-policy': 'microphone=(self), camera=(), geolocation=()',
};
