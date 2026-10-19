import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { DeviceLinkRequest, DeviceToken, LinkedDevice, User } from '../models.js';
import { requireAuth, signToken } from '../auth.js';
import { disconnectLinkedDevice } from '../realtime.js';
import { wrap } from '../util.js';

const router = Router();
const LINKED_DEVICE_LIMIT = 5;
const LINK_LIFETIME_MS = 2 * 60 * 1000;
const hashLinkSecret = (secret) => crypto.createHash('sha256').update(secret).digest('hex');
const startLinkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const pollLinkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 150, standardHeaders: true, legacyHeaders: false });
const approveCodeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });

/**
 * @openapi
 * /api/devices/link/start:
 *   post:
 *     summary: Start a QR device-link request
 *     tags: [Devices]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [platform]
 *             properties:
 *               platform: { type: string, enum: [web, android] }
 *     responses:
 *       200: { description: Short-lived QR pairing challenge }
 *       429: { description: Pairing request rate limit reached }
 */
router.post(
  '/link/start',
  startLinkLimiter,
  wrap(async (req, res) => {
    const platform = req.body?.platform;
    if (!['web', 'android'].includes(platform)) {
      return res.status(400).json({ error: 'INVALID_PLATFORM', message: 'Platform must be web or android.' });
    }
    const linkId = crypto.randomUUID();
    const secret = crypto.randomBytes(32).toString('base64url');
    const pairingCode = String(crypto.randomInt(0, 1_000_000_000)).padStart(9, '0');
    const expiresAt = new Date(Date.now() + LINK_LIFETIME_MS);
    await DeviceLinkRequest.create({
      linkId,
      secretHash: hashLinkSecret(secret),
      pairingCodeHash: hashLinkSecret(pairingCode),
      platform,
      expiresAt,
    });
    res.json({ link_id: linkId, secret, pairing_code: pairingCode, platform, expires_at: expiresAt.toISOString() });
  })
);

/**
 * @openapi
 * /api/devices/link/status:
 *   post:
 *     summary: Poll a QR device-link request
 *     tags: [Devices]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [link_id, secret]
 *             properties:
 *               link_id: { type: string }
 *               secret: { type: string }
 *     responses:
 *       200: { description: Pairing state; includes a session token after approval }
 *       404: { description: Pairing request does not exist }
 */
router.post(
  '/link/status',
  pollLinkLimiter,
  wrap(async (req, res) => {
    const linkId = String(req.body?.link_id ?? '');
    const secret = String(req.body?.secret ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(linkId) || !/^[A-Za-z0-9_-]{40,50}$/.test(secret)) {
      return res.status(404).json({ error: 'LINK_NOT_FOUND', message: 'This QR code has expired. Start a new link request.' });
    }
    const request = await DeviceLinkRequest.findOne({ linkId }).lean();
    if (!request || !crypto.timingSafeEqual(Buffer.from(request.secretHash), Buffer.from(hashLinkSecret(secret)))) {
      return res.status(404).json({ error: 'LINK_NOT_FOUND', message: 'This QR code has expired. Start a new link request.' });
    }
    if (request.expiresAt <= new Date()) return res.json({ status: 'expired' });
    if (request.status === 'completed') return res.json({ status: 'completed' });
    if (request.status === 'pending' || request.status === 'approving') return res.json({ status: 'pending' });
    if (!request.user || !request.linkedDevice) return res.json({ status: 'expired' });
    const device = await LinkedDevice.findOne({ _id: request.linkedDevice, user: request.user }).lean();
    if (!device) return res.json({ status: 'expired' });
    res.json({
      status: request.status,
      token: signToken(request.user, device._id),
      device: { id: String(device._id), name: device.name, platform: device.platform },
    });
  })
);

// Register (or move to this account) a phone's push token.
router.use(requireAuth);

async function approveDeviceLink(req, res, request) {
  if (!(await User.exists({ _id: req.userId }))) {
    await DeviceLinkRequest.updateOne({ _id: request._id }, { $set: { status: 'pending' } });
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const deviceId = new mongoose.Types.ObjectId();
  const reservation = await User.updateOne(
    {
      _id: req.userId,
      $expr: { $lt: [{ $size: { $ifNull: ['$linkedDeviceIds', []] } }, LINKED_DEVICE_LIMIT] },
    },
    { $addToSet: { linkedDeviceIds: deviceId } }
  );
  if (!reservation.modifiedCount) {
    await DeviceLinkRequest.updateOne({ _id: request._id }, { $set: { status: 'pending' } });
    return res.status(409).json({ error: 'DEVICE_LIMIT', message: 'You can link up to five devices. Unlink a device first.' });
  }

  const fallbackName = request.platform === 'android' ? 'Android device' : 'Web browser';
  const name = String(req.body?.name ?? '').trim().slice(0, 80) || fallbackName;
  try {
    await LinkedDevice.create({
      _id: deviceId,
      user: req.userId,
      name,
      platform: request.platform,
    });
    const approved = await DeviceLinkRequest.updateOne(
      { _id: request._id, status: 'approving', expiresAt: { $gt: new Date() } },
      {
        $set: {
          status: 'approved',
          user: req.userId,
          linkedDevice: deviceId,
          expiresAt: new Date(Date.now() + LINK_LIFETIME_MS),
        },
      }
    );
    if (!approved.modifiedCount) {
      await LinkedDevice.deleteOne({ _id: deviceId });
      await User.updateOne({ _id: req.userId }, { $pull: { linkedDeviceIds: deviceId } });
      return res.status(404).json({ error: 'LINK_EXPIRED', message: 'This QR code has expired. Start a new link request.' });
    }
  } catch (error) {
    await LinkedDevice.deleteOne({ _id: deviceId }).catch((cleanupError) => {
      console.error('Could not remove a partially created linked device', cleanupError);
    });
    await User.updateOne({ _id: req.userId }, { $pull: { linkedDeviceIds: deviceId } }).catch((cleanupError) => {
      console.error('Could not release linked-device capacity after pairing failed', cleanupError);
    });
    await DeviceLinkRequest.updateOne(
      { _id: request._id, status: 'approving' },
      { $set: { status: 'pending' } }
    ).catch((cleanupError) => {
      console.error('Could not reset a failed device-link request', cleanupError);
    });
    throw error;
  }
  return res.json({ ok: true, name });
}

/**
 * @openapi
 * /api/devices/link/approve:
 *   post:
 *     summary: Approve a QR pairing from a signed-in device
 *     tags: [Devices]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [link_id, secret]
 *             properties:
 *               link_id: { type: string }
 *               secret: { type: string }
 *               name: { type: string, maxLength: 80 }
 *     responses:
 *       200: { description: Device linked }
 *       404: { description: Pairing request is invalid or expired }
 *       409: { description: Maximum of five linked devices reached }
 */
router.post(
  '/link/approve',
  wrap(async (req, res) => {
    const linkId = String(req.body?.link_id ?? '');
    const secret = String(req.body?.secret ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(linkId) || !/^[A-Za-z0-9_-]{40,50}$/.test(secret)) {
      return res.status(404).json({ error: 'LINK_NOT_FOUND', message: 'This QR code is invalid or has expired.' });
    }
    const request = await DeviceLinkRequest.findOneAndUpdate(
      { linkId, secretHash: hashLinkSecret(secret), status: 'pending', expiresAt: { $gt: new Date() } },
      { $set: { status: 'approving' } },
      { new: true }
    );
    if (!request) return res.status(404).json({ error: 'LINK_NOT_FOUND', message: 'This QR code is invalid, expired, or already used.' });
    return approveDeviceLink(req, res, request);
  })
);

/**
 * @openapi
 * /api/devices/link/approve-code:
 *   post:
 *     summary: Approve a device-link request using its pairing code
 *     tags: [Devices]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string, pattern: '^\\d{9}$' }
 *               name: { type: string, maxLength: 80 }
 *     responses:
 *       200: { description: Device linked }
 *       404: { description: Pairing code is invalid or expired }
 *       409: { description: Maximum of five linked devices reached }
 *       429: { description: Pairing code attempts rate limit reached }
 */
router.post(
  '/link/approve-code',
  approveCodeLimiter,
  wrap(async (req, res) => {
    const code = String(req.body?.code ?? '');
    if (!/^\d{9}$/.test(code)) {
      return res.status(404).json({ error: 'LINK_NOT_FOUND', message: 'This linking code is invalid or expired.' });
    }
    const request = await DeviceLinkRequest.findOneAndUpdate(
      { pairingCodeHash: hashLinkSecret(code), status: 'pending', expiresAt: { $gt: new Date() } },
      { $set: { status: 'approving' } },
      { new: true }
    );
    if (!request) return res.status(404).json({ error: 'LINK_NOT_FOUND', message: 'This linking code is invalid, expired, or already used.' });
    return approveDeviceLink(req, res, request);
  })
);

/**
 * @openapi
 * /api/devices/link/complete:
 *   post:
 *     summary: Confirm the new linked device received its session
 *     tags: [Devices]
 *     responses:
 *       200: { description: Pairing completed }
 *       403: { description: Caller is not a linked device }
 */
router.post(
  '/link/complete',
  wrap(async (req, res) => {
    if (!req.linkedDeviceId) return res.status(403).json({ error: 'NOT_LINKED_DEVICE' });
    await DeviceLinkRequest.updateOne(
      { linkedDevice: req.linkedDeviceId, user: req.userId, status: 'approved' },
      { $set: { status: 'completed' } }
    );
    await LinkedDevice.updateOne({ _id: req.linkedDeviceId, user: req.userId }, { $set: { lastSeenAt: new Date() } });
    res.json({ ok: true });
  })
);

/**
 * @openapi
 * /api/devices/linked:
 *   get:
 *     summary: List linked devices
 *     tags: [Devices]
 *     responses:
 *       200: { description: Linked devices and remaining capacity }
 */
router.get(
  '/linked',
  wrap(async (req, res) => {
    const devices = await LinkedDevice.find({ user: req.userId }).sort({ createdAt: -1 }).lean();
    res.json({
      devices: devices.map((device) => ({
        id: String(device._id),
        name: device.name,
        platform: device.platform,
        created_at: device.createdAt,
        last_seen_at: device.lastSeenAt,
        current: String(device._id) === req.linkedDeviceId,
      })),
      limit: LINKED_DEVICE_LIMIT,
      remaining: Math.max(0, LINKED_DEVICE_LIMIT - devices.length),
    });
  })
);

/**
 * @openapi
 * /api/devices/linked/current:
 *   delete:
 *     summary: Sign out and unlink this linked device
 *     tags: [Devices]
 *     responses:
 *       200: { description: Current device session revoked }
 */
router.delete(
  '/linked/current',
  wrap(async (req, res) => {
    if (!req.linkedDeviceId) return res.json({ ok: true });
    await LinkedDevice.deleteOne({ _id: req.linkedDeviceId, user: req.userId });
    await User.updateOne({ _id: req.userId }, { $pull: { linkedDeviceIds: req.linkedDeviceId } });
    disconnectLinkedDevice(req.linkedDeviceId);
    res.json({ ok: true });
  })
);

/**
 * @openapi
 * /api/devices/linked/{id}:
 *   delete:
 *     summary: Unlink a device and revoke its active sessions
 *     tags: [Devices]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Device unlinked }
 *       404: { description: Device not found }
 */
router.delete(
  '/linked/:id',
  wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'DEVICE_NOT_FOUND' });
    const device = await LinkedDevice.findOneAndDelete({ _id: req.params.id, user: req.userId }).lean();
    if (!device) return res.status(404).json({ error: 'DEVICE_NOT_FOUND' });
    await User.updateOne({ _id: req.userId }, { $pull: { linkedDeviceIds: device._id } });
    disconnectLinkedDevice(String(device._id));
    res.json({ ok: true });
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const token = String(req.body?.token ?? '');
    if (token.length < 20) return res.status(400).json({ error: 'INVALID_TOKEN' });
    await DeviceToken.updateOne(
      { token },
      { $set: { user: req.userId, platform: String(req.body?.platform ?? 'android'), updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true });
  })
);

// Called on logout so the next person on this phone doesn't get your notifications.
router.post(
  '/remove',
  wrap(async (req, res) => {
    await DeviceToken.deleteOne({ token: String(req.body?.token ?? ''), user: req.userId });
    res.json({ ok: true });
  })
);

export default router;
