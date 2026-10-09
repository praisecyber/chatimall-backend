import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { Otp, User } from '../models.js';
import { signToken } from '../auth.js';
import { sendSms } from '../sms.js';
import { serialize } from './_shared.js';
import { hashOtp, normalizePhone, safeEqual, wrap } from '../util.js';

const router = Router();

/**
 * @openapi
 * /api/auth/otp/request:
 *   post:
 *     summary: Request a one-time code for phone login
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "+15551234567"
 *     responses:
 *       200:
 *         description: Code sent (dev_code is only returned in development mode)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean, example: true }
 *                 dev_code: { type: string, example: "123456" }
 *       400:
 *         description: Invalid phone number
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       429:
 *         description: Too many attempts
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       502:
 *         description: The SMS could not be sent (provider problem or not configured)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many verification attempts. Try again later.' },
});

router.post(
  '/otp/request',
  limiter,
  wrap(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: 'INVALID_PHONE', message: 'Enter a valid phone number with country code.' });

    if (config.testPhones[phone]) return res.json({ ok: true }); // fixed-code test account, no SMS

    const recent = await Otp.countDocuments({ phone, createdAt: { $gt: new Date(Date.now() - 3600 * 1000) } });
    if (recent >= 5) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many codes requested for this number. Try again in an hour.' });
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await Otp.create({
      phone,
      codeHash: hashOtp(config.jwtSecret, phone, code),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    try {
      await sendSms(phone, `Your Chatimall code is ${code}. It expires in 5 minutes.`);
    } catch (err) {
      console.error('SMS failed:', err.message);
      return res.status(502).json({
        error: 'SMS_FAILED',
        message: err.message === 'SMS_NOT_CONFIGURED' ? 'SMS sending is not set up on the server yet.' : 'Could not send the SMS. Try again.',
      });
    }
    res.json({ ok: true, ...(config.devOtpEcho ? { dev_code: code } : {}) });
  })
);

/**
 * @openapi
 * /api/auth/otp/verify:
 *   post:
 *     summary: Verify the one-time code and return a JWT
 *     description: Copy the returned `token`, click **Authorize** at the top of this page and paste it to unlock the other endpoints.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, code]
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "+15551234567"
 *               code:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string, description: Send as "Authorization Bearer <token>" }
 *                 user: { $ref: '#/components/schemas/User' }
 *       400:
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       401:
 *         description: Invalid or expired code
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       429:
 *         description: Too many wrong codes
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post(
  '/otp/verify',
  verifyLimiter,
  wrap(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code ?? '').trim();
    if (!phone || !/^\d{4,8}$/.test(code)) {
      return res.status(400).json({ error: 'INVALID', message: 'Enter the code we sent you.' });
    }

    let ok = false;
    const fixed = config.testPhones[phone];
    if (fixed) {
      ok = safeEqual(fixed, code);
    } else {
      const otp = await Otp.findOne({ phone, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
      if (otp) {
        // atomically count the attempt; give up after 5 wrong tries
        const updated = await Otp.findOneAndUpdate({ _id: otp._id, attempts: { $lt: 5 } }, { $inc: { attempts: 1 } }, { new: true });
        if (!updated) {
          return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many wrong codes. Request a new one.' });
        }
        ok = safeEqual(updated.codeHash, hashOtp(config.jwtSecret, phone, code));
      }
    }
    if (!ok) return res.status(401).json({ error: 'BAD_CODE', message: 'That code is incorrect or has expired.' });

    const user = await User.findOneAndUpdate(
      { phone },
      { $setOnInsert: { phone } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (user.settings?.security?.twoFactorAuth) {
      const pin = String(req.body?.pin ?? '').trim();
      if (!/^\d{6,12}$/.test(pin)) {
        return res.status(428).json({ error: 'SECOND_FACTOR_REQUIRED', message: 'Enter your account security PIN.' });
      }
      const expected = user.twoFactorPinHash ?? await User.findById(user._id).select('+twoFactorPinHash').then((record) => record?.twoFactorPinHash);
      if (!expected || !safeEqual(expected, hashOtp(config.jwtSecret, phone, `two-factor:${pin}`))) {
        return res.status(401).json({ error: 'BAD_SECOND_FACTOR', message: 'The account security PIN is incorrect.' });
      }
    }
    await Otp.deleteMany({ phone });
    res.json({ token: signToken(user._id), user: serialize.user(user) });
  })
);

export default router;
