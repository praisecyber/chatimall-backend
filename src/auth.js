import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { LinkedDevice } from './models.js';

export const signToken = (userId, linkedDeviceId = null) =>
  jwt.sign(
    { sub: String(userId), ...(linkedDeviceId ? { sid: String(linkedDeviceId) } : {}) },
    config.jwtSecret,
    { expiresIn: '60d' }
  );

function verifyClaims(token) {
  try {
    const claims = jwt.verify(token, config.jwtSecret);
    if (typeof claims.sub !== 'string') return null;
    if (claims.sid !== undefined && typeof claims.sid !== 'string') return null;
    return { userId: claims.sub, linkedDeviceId: claims.sid ?? null };
  } catch {
    return null;
  }
}

export function verifyToken(token) {
  return verifyClaims(token)?.userId ?? null;
}

export async function verifySessionToken(token) {
  const claims = verifyClaims(token);
  if (!claims) return null;
  if (claims.linkedDeviceId) {
    const active = await LinkedDevice.exists({ _id: claims.linkedDeviceId, user: claims.userId });
    if (!active) return null;
  }
  return claims;
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  try {
    const claims = token ? await verifySessionToken(token) : null;
    if (!claims) return res.status(401).json({ error: 'UNAUTHORIZED' });
    req.userId = claims.userId;
    req.linkedDeviceId = claims.linkedDeviceId;
    next();
  } catch (error) {
    next(error);
  }
}
