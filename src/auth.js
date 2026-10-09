import jwt from 'jsonwebtoken';
import { config } from './config.js';

export const signToken = (userId) => jwt.sign({ sub: String(userId) }, config.jwtSecret, { expiresIn: '60d' });

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret).sub ?? null;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const id = token ? verifyToken(token) : null;
  if (!id) return res.status(401).json({ error: 'UNAUTHORIZED' });
  req.userId = id;
  next();
}
