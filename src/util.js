import crypto from 'node:crypto';

/** "+1 (555) 123-4567" -> "15551234567". Returns null when it is not a plausible phone number. */
export function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

export function hashOtp(secret, phone, code) {
  return crypto.createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function publicEncryptionKeyId(value) {
  if (!value || value.kty !== 'EC' || value.crv !== 'P-256'
    || typeof value.x !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.x)
    || typeof value.y !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.y)
    || Object.hasOwn(value, 'd')) return null;
  return crypto.createHash('sha256').update(`${value.crv}:${value.x}:${value.y}`).digest('base64');
}

export function previewOf(type, body) {
  switch (type) {
    case 'text': return String(body).slice(0, 80);
    case 'image': return '📷 Photo';
    case 'video': return '🎥 Video';
    case 'voice': return '🎤 Voice note';
    default: return `📎 ${String(body).slice(0, 60) || 'File'}`;
  }
}

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Only allow media that we stored ourselves. */
export const isOwnFileUrl = (u) => typeof u === 'string' && /^\/api\/files\/[\w-]{20,}$/.test(u);

/**
 * Builds a CORS origin checker from CLIENT_ORIGINS.
 * - empty list  -> allow everything (development)
 * - exact match -> "https://chatimall.vercel.app"
 * - wildcard    -> "https://*.vercel.app" (handy for Vercel preview deployments)
 * Requests without an Origin header (mobile/native, curl) are allowed.
 */
export function makeOriginChecker(list) {
  const rules = list.map((o) => o.replace(/\/$/, ''));
  const wildcard = rules
    .filter((r) => r.includes('*'))
    .map((r) => new RegExp('^' + r.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^.]+(?:\\.[^.]+)*') + '$'));
  return (origin) => {
    if (!origin || rules.length === 0) return true;
    const o = origin.replace(/\/$/, '');
    return rules.includes(o) || wildcard.some((re) => re.test(o));
  };
}

/**
 * Pulls a platform + video id out of a TikTok or YouTube link. Returns null for anything else —
 * callers should treat that as "not a link we can embed", not throw.
 */
export function parseWatchUrl(input) {
  if (typeof input !== 'string') return null;
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');

  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    // https://www.tiktok.com/@user/video/7312345678901234567
    const m = url.pathname.match(/\/video\/(\d+)/);
    if (m) return { platform: 'tiktok', videoId: m[1] };
    return null;
  }

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return id ? { platform: 'youtube', videoId: id } : null;
    }
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v');
      return id ? { platform: 'youtube', videoId: id } : null;
    }
    const short = url.pathname.match(/^\/(shorts|embed)\/([\w-]+)/);
    if (short) return { platform: 'youtube', videoId: short[2] };
    return null;
  }

  return null;
}
