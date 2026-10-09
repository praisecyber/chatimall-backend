import { Router } from 'express';
import { DeviceToken } from '../models.js';
import { requireAuth } from '../auth.js';
import { wrap } from '../util.js';

const router = Router();
router.use(requireAuth);

// Register (or move to this account) a phone's push token.
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
