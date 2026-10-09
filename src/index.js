import http from 'node:http';
import mongoose from 'mongoose';
import { config } from './config.js';
import { createApp } from './app.js';
import { attachSocket } from './socket.js';

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log('MongoDB connected');

  try {
    await mongoose.connection.syncIndexes?.();
  } catch (e) {
    console.warn('index sync warning:', e.message);
  }

  const { app, origin } = createApp();
  const server = http.createServer(app);
  attachSocket(server, origin);

  server.listen(config.port, () => {
    console.log(`Chatimall server listening on :${config.port}`);
    console.log(`Node.js version: ${process.version}`);
    if (process.env.DISABLE_DOCS !== 'true') console.log(`API docs: http://localhost:${config.port}/api/docs`);
  });
}

main().catch((err) => {
  console.error('FATAL: failed to start Chatimall backend');
  console.error(err?.stack || err);
  process.exit(1);
});
