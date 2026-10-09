import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { makeOriginChecker } from './util.js';
import { swaggerDocs } from './swagger.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import settingsRoutes from './routes/settings.js';
import chatRoutes from './routes/chats.js';
import groupRoutes from './routes/groups.js';
import watchRoutes from './routes/watch.js';
import listingRoutes from './routes/listings.js';
import statusRoutes from './routes/status.js';
import channelRoutes from './routes/channels.js';
import callRoutes from './routes/calls.js';
import deviceRoutes from './routes/devices.js';
import fileRoutes from './routes/files.js';

/** Builds the Express app (no database connection, no listening) so it can also be tested. */
export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  const allowed = makeOriginChecker(config.clientOrigins);
  const origin = (o, cb) => cb(null, allowed(o));
  app.use(cors({ origin }));
  app.use(express.json({ limit: '100kb' }));

  swaggerDocs(app);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/me', meRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/chats', chatRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/watch', watchRoutes);
  app.use('/api/listings', listingRoutes);
  app.use('/api/status', statusRoutes);
  app.use('/api/channels', channelRoutes);
  app.use('/api/calls', callRoutes);
  app.use('/api/devices', deviceRoutes);
  app.use('/api', fileRoutes); // /api/upload and /api/files/:key

  app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'SERVER', message: 'Something went wrong on the server.' });
  });

  return { app, origin };
}
