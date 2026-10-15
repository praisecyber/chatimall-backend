import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const frontendDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend/dist');
const frontendIndex = path.join(frontendDist, 'index.html');

/** Builds the Express app (no database connection, no listening) so it can also be tested. */
export function createApp() {
  const hasFrontend = existsSync(frontendIndex);

  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
        },
      },
    })
  );

  const allowed = makeOriginChecker(config.clientOrigins);
  const origin = (o, cb) => cb(null, allowed(o));
  app.use(cors({ origin }));
  app.use(express.json({ limit: '100kb' }));

  swaggerDocs(app);

  if (!hasFrontend) {
    app.get('/', (_req, res) => {
      if (config.nodeEnv === 'production') {
        return res.status(503).json({
          error: 'FRONTEND_BUILD_MISSING',
          message: 'Frontend build is missing. Configure the Render build command to build frontend.',
          health: '/api/health',
        });
      }
      res.json({
        ok: true,
        service: 'Chatimall API',
        message: 'Backend is running. Build the frontend to serve the app here.',
        health: '/api/health',
      });
    });
  }
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
  if (hasFrontend) {
    app.use(express.static(frontendDist));
    app.get('*', (_req, res, next) => {
      res.sendFile(frontendIndex, (error) => {
        if (error) next(error);
      });
    });
  }
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'SERVER', message: 'Something went wrong on the server.' });
  });

  return { app, origin };
}
