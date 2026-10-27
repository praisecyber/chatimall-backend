import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { LinkedDevice, User } from './models.js';

export const signToken = (userId, linkedDeviceId = null, sessionId = null) =>
  jwt.sign(
    {
      sub: String(userId),
      ...(linkedDeviceId ? { sid: String(linkedDeviceId) } : {}),
      ...(sessionId ? { session: sessionId } : {}),
    },
    config.jwtSecret,
    { expiresIn: '60d' }
  );

function verifyClaims(token) {
  try {
    const claims = jwt.verify(token, config.jwtSecret);
    if (typeof claims.sub !== 'string') return null;
    if (claims.sid !== undefined && typeof claims.sid !== 'string') return null;
    if (claims.session !== undefined && typeof claims.session !== 'string') return null;
    return { userId: claims.sub, linkedDeviceId: claims.sid ?? null, sessionId: claims.session ?? null };
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
  } else {
    if (!claims.sessionId) return null;
    const active = await User.exists({ _id: claims.userId, activeSessionId: claims.sessionId });
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

export function isUserAdmin(userOrPhone) {
  if (!userOrPhone) return false;
  if (typeof userOrPhone === 'object' && userOrPhone !== null) {
    if (userOrPhone.role === 'super_admin') return true;
  }
  const rawPhone = typeof userOrPhone === 'string' ? userOrPhone : userOrPhone.phone;
  if (!rawPhone) return false;
  const digits = String(rawPhone).replace(/\D/g, '');
  if (!digits) return false;
  return (config.adminPhones || []).some((adminP) => {
    if (adminP === digits) return true;
    if (digits.startsWith('234') && adminP === '0' + digits.slice(3)) return true;
    if (adminP.startsWith('234') && digits === '0' + adminP.slice(3)) return true;
    return false;
  });
}

export function getUserRole(user) {
  if (!user) return 'member';
  if (isUserAdmin(user)) return 'super_admin';
  if (user.role && ['super_admin', 'moderator', 'support_agent'].includes(user.role)) {
    return user.role;
  }
  return 'member';
}

export function isStaffOrAdmin(user) {
  if (!user) return false;
  if (isUserAdmin(user)) return true;
  return ['super_admin', 'moderator', 'support_agent'].includes(user.role);
}

export async function requireAdmin(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const user = await User.findById(req.userId).lean();
  if (!user || !isStaffOrAdmin(user)) {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied: Staff or Administrator privileges required.' });
  }
  req.adminUser = user;
  req.userRole = getUserRole(user);
  next();
}

export function requireSuperAdmin(req, res, next) {
  if (req.userRole !== 'super_admin') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Action restricted to Super-Admins only.' });
  }
  next();
}
