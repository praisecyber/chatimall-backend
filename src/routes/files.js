import crypto from 'node:crypto';
import mongoose from 'mongoose';
import multer from 'multer';
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { wrap } from '../util.js';

const MAX_BYTES = 50 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });
const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'media' });

const router = Router();

/**
 * Store a server-generated file (e.g. translated voice-note TTS audio) in GridFS,
 * without going through the multer upload route. Returns the same `/api/files/:key` URL shape.
 */
export async function storeGeneratedAudio(buffer, ownerId, { contentType = 'audio/mpeg', name = 'translation.mp3' } = {}) {
  const key = crypto.randomUUID();
  await new Promise((resolve, reject) => {
    const stream = bucket().openUploadStream(key, {
      contentType,
      metadata: { owner: ownerId, name, generated: true },
    });
    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end(buffer);
  });
  return `/api/files/${key}`;
}

// Files live inside MongoDB itself (GridFS), so no extra storage service is needed.
router.post(
  '/upload',
  requireAuth,
  (req, res, next) =>
    upload.single('file')(req, res, (err) => {
      if (err) {
        const tooBig = err.code === 'LIMIT_FILE_SIZE';
        return res.status(tooBig ? 413 : 400).json({
          error: 'UPLOAD_FAILED',
          message: tooBig ? 'File is too large (50 MB max).' : 'Upload failed.',
        });
      }
      next();
    }),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'NO_FILE', message: 'No file received.' });
    const key = crypto.randomUUID();
    await new Promise((resolve, reject) => {
      const stream = bucket().openUploadStream(key, {
        contentType: req.file.mimetype,
        metadata: { owner: req.userId, name: req.file.originalname },
      });
      stream.on('error', reject);
      stream.on('finish', resolve);
      stream.end(req.file.buffer);
    });
    res.json({
      url: `/api/files/${key}`,
      name: req.file.originalname,
      size: req.file.size,
      content_type: req.file.mimetype,
    });
  })
);

// Public read by unguessable key (so <img>/<audio>/<video> tags work without headers).
export { bucket };

router.get(
  '/files/:key',
  wrap(async (req, res) => {
    const { key } = req.params;
    if (!/^[\w-]{20,}$/.test(key)) return res.sendStatus(404);
    const file = await mongoose.connection.db.collection('media.files').findOne({ filename: key });
    if (!file) return res.sendStatus(404);

    const type = file.contentType || 'application/octet-stream';
    const inline = /^(image\/(png|jpe?g|gif|webp|avif)|audio\/|video\/)/.test(type);
    const size = file.length;
    let start = 0;
    let end = size - 1;

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        if (m[1] !== '') {
          start = parseInt(m[1], 10);
          if (m[2] !== '') end = Math.min(parseInt(m[2], 10), size - 1);
        } else if (m[2] !== '') {
          start = Math.max(size - parseInt(m[2], 10), 0);
        }
        if (start > end || start >= size) {
          res.status(416).set('Content-Range', `bytes */${size}`).end();
          return;
        }
        res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
      }
    }

    // Never let uploaded files run as web pages on our origin.
    res.set({
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Disposition': inline ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(file.metadata?.name || 'file')}`,
    });
    if (size === 0) return res.end();
    const stream = bucket().openDownloadStreamByName(key, { start, end: end + 1 });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  })
);

export default router;
