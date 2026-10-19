import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { EmailOtp, Otp, User } from '../models.js';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { sendEmailOtp } from '../email.js';
import { hashOtp, isOwnFileUrl, normalizeEmail, normalizePhone, safeEqual, wrap } from '../util.js';
import { privateProfileJson, serialize } from './_shared.js';

const router = Router();
router.use(requireAuth);
const emailLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const settingsRules = {
  privacy: {
    read_receipts: (value) => typeof value === 'boolean',
    last_seen: (value) => ['Everyone', 'Contacts', 'Nobody'].includes(value),
    disappearing_timer: (value) => ['Off', '24h', '7d', '90d'].includes(value),
  },
  security: {
    biometrics_lock: (value) => typeof value === 'boolean',
  },
  notifications: {
    sound: (value) => ['Pulse Chime', 'Aurora', 'Celestial Bell'].includes(value),
    vibrate: (value) => typeof value === 'boolean',
    preview: (value) => typeof value === 'boolean',
  },
  appearance: {
    wallpaper: (value) => ['default', 'light', 'plain'].includes(value),
  },
  translation: {
    mode: (value) => ['off', 'on'].includes(value),
    language: (value) => typeof value === 'string' && /^[a-z]{2,3}(-[a-z]+)?$/i.test(value),
  },
};

const defaultSettings = {
  privacy: { read_receipts: true, last_seen: 'Everyone', disappearing_timer: 'Off' },
  security: { two_factor_auth: false, biometrics_lock: false },
  notifications: { sound: 'Pulse Chime', vibrate: true, preview: true },
  appearance: { wallpaper: 'default' },
  // 'off': never translate. 'text': show a translated caption under received voice notes.
  // 'audio': also speak the translation back with TTS (falls back to text if the target
  // language has no TTS voice available).
  translation: { mode: 'off', language: 'en' },
};

function isPublicEncryptionKey(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && value.kty === 'EC' && value.crv === 'P-256'
    && typeof value.x === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.x)
    && typeof value.y === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.y)
    && !Object.hasOwn(value, 'd');
}

function settingsJson(settings = {}) {
  const security = settings.security ?? {};
  return {
    privacy: {
      read_receipts: settings.privacy?.readReceipts ?? defaultSettings.privacy.read_receipts,
      last_seen: settings.privacy?.lastSeen ?? defaultSettings.privacy.last_seen,
      disappearing_timer: settings.privacy?.disappearingTimer ?? defaultSettings.privacy.disappearing_timer,
    },
    security: {
      two_factor_auth: security.twoFactorAuth ?? defaultSettings.security.two_factor_auth,
      biometrics_lock: security.deviceLockConfigured === true && security.biometricsLock === true,
    },
    notifications: {
      sound: settings.notifications?.sound ?? defaultSettings.notifications.sound,
      vibrate: settings.notifications?.vibrate ?? defaultSettings.notifications.vibrate,
      preview: settings.notifications?.preview ?? defaultSettings.notifications.preview,
    },
    appearance: { wallpaper: settings.appearance?.wallpaper ?? defaultSettings.appearance.wallpaper },
    translation: {
      mode: settings.translation?.mode ?? defaultSettings.translation.mode,
      language: settings.translation?.language ?? defaultSettings.translation.language,
    },
  };
}

function settingsPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const patch = {};
  for (const [section, values] of Object.entries(body)) {
    if (!Object.hasOwn(settingsRules, section) || !values || typeof values !== 'object' || Array.isArray(values)) return null;
    const rules = settingsRules[section];
    for (const [key, value] of Object.entries(values)) {
      if (!Object.hasOwn(rules, key) || !rules[key](value)) return null;
      const modelKey = key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
      patch[`settings.${section}.${modelKey}`] = value;
      if (section === 'security' && key === 'biometrics_lock') {
        patch['settings.security.deviceLockConfigured'] = true;
      }
    }
  }
  return Object.keys(patch).length ? patch : null;
}

router.get(
  '/',
  wrap(async (req, res) => {
    const user = await User.findById(req.userId).lean();
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    res.json(privateProfileJson(user));
  })
);

router.get(
  '/settings',
  wrap(async (req, res) => {
    const user = await User.findById(req.userId).select('settings').lean();
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    res.json(settingsJson(user.settings));
  })
);

router.patch(
  '/settings',
  wrap(async (req, res) => {
    const patch = settingsPatch(req.body);
    if (!patch) return res.status(400).json({ error: 'INVALID_SETTINGS' });
    const user = await User.findByIdAndUpdate(req.userId, { $set: patch }, { new: true, runValidators: true })
      .select('settings')
      .lean();
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    res.json(settingsJson(user.settings));
  })
);

/**
 * @openapi
 * /api/me/phone:
 *   patch:
 *     summary: Change the signed-in user's phone number
 *     description: Requires an SMS code sent to the new number and, when enabled, the current account security PIN.
 *     tags: [Profile]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, code]
 *             properties:
 *               phone: { type: string, example: "+15551234567" }
 *               code: { type: string, example: "123456" }
 *               pin: { type: string, description: Required when two-step verification is enabled }
 *     responses:
 *       200: { description: Phone number updated }
 *       400: { description: Invalid phone number or verification code }
 *       401: { description: Invalid code or security PIN }
 *       409: { description: Phone number is already in use }
 */
router.patch(
  '/phone',
  wrap(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code ?? '').trim();
    const pin = String(req.body?.pin ?? '').trim();
    if (!phone || !/^\d{4,8}$/.test(code)) {
      return res.status(400).json({ error: 'INVALID_PHONE_CHANGE', message: 'Enter a valid phone number and SMS code.' });
    }

    const user = await User.findById(req.userId).select('+twoFactorPinHash phone settings.security.twoFactorAuth').lean();
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    if (phone === user.phone) return res.status(400).json({ error: 'PHONE_UNCHANGED', message: 'Enter a different phone number.' });

    if (await User.exists({ phone })) {
      return res.status(409).json({ error: 'PHONE_IN_USE', message: 'That phone number is already linked to an account.' });
    }

    let validCode = false;
    const fixedCode = config.testPhones[phone];
    if (fixedCode) {
      validCode = safeEqual(fixedCode, code);
    } else {
      const otp = await Otp.findOne({ phone, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
      if (otp) {
        const updatedOtp = await Otp.findOneAndUpdate(
          { _id: otp._id, attempts: { $lt: 5 } },
          { $inc: { attempts: 1 } },
          { new: true }
        );
        if (!updatedOtp) {
          return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many wrong codes. Request a new one.' });
        }
        validCode = safeEqual(updatedOtp.codeHash, hashOtp(config.jwtSecret, phone, code));
      }
    }
    if (!validCode) return res.status(401).json({ error: 'BAD_CODE', message: 'That code is incorrect or has expired.' });

    const update = { phone };
    if (user.settings?.security?.twoFactorAuth) {
      if (!/^\d{6,12}$/.test(pin) || !user.twoFactorPinHash
        || !safeEqual(user.twoFactorPinHash, hashOtp(config.jwtSecret, user.phone, `two-factor:${pin}`))) {
        return res.status(401).json({ error: 'BAD_PIN', message: 'Enter your current 6 to 12 digit security PIN.' });
      }
      update.twoFactorPinHash = hashOtp(config.jwtSecret, phone, `two-factor:${pin}`);
    }

    let updatedUser;
    try {
      updatedUser = await User.findOneAndUpdate(
        { _id: req.userId, phone: user.phone },
        { $set: update },
        { new: true, runValidators: true }
      ).lean();
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({ error: 'PHONE_IN_USE', message: 'That phone number is already linked to an account.' });
      }
      throw error;
    }
    if (!updatedUser) {
      return res.status(409).json({ error: 'PHONE_CHANGED', message: 'Your phone number changed in another session. Refresh and try again.' });
    }

    await Otp.deleteMany({ phone });
    res.json(privateProfileJson(updatedUser));
  })
);

/**
 * @openapi
 * /api/me/email/request:
 *   post:
 *     summary: Send a verification code to an email to link it to the signed-in account
 *     tags: [Profile]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: Verification code sent }
 *       400: { description: Invalid email }
 *       409: { description: Email is already linked or verified }
 *       429: { description: Too many verification requests }
 *       502: { description: Email delivery failed }
 *       503: { description: Email delivery is not configured }
 */
router.post(
  '/email/request',
  emailLinkLimiter,
  wrap(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: 'INVALID_EMAIL', message: 'Enter a valid email address.' });
    const user = await User.findById(req.userId).select('email emailVerifiedAt').lean();
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    if (user.email === email && user.emailVerifiedAt) {
      return res.status(409).json({ error: 'EMAIL_VERIFIED', message: 'This email is already verified on your account.' });
    }
    if (await User.exists({ email, _id: { $ne: req.userId } })) {
      return res.status(409).json({ error: 'EMAIL_IN_USE', message: 'That email is linked to another account.' });
    }
    const recent = await EmailOtp.countDocuments({
      user: req.userId,
      purpose: 'link',
      createdAt: { $gt: new Date(Date.now() - 3600 * 1000) },
    });
    if (recent >= 5) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many email verification requests. Try again in an hour.' });
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const otp = await EmailOtp.create({
      email,
      user: req.userId,
      purpose: 'link',
      codeHash: hashOtp(config.jwtSecret, email, code),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    try {
      await sendEmailOtp(email, code);
    } catch (err) {
      await EmailOtp.deleteOne({ _id: otp._id }).catch((cleanupError) => {
        console.error('Could not remove an email verification code after delivery failed:', cleanupError);
      });
      if (err.message === 'EMAIL_NOT_CONFIGURED') {
        return res.status(503).json({
          error: 'EMAIL_NOT_CONFIGURED',
          message: 'Email verification is temporarily unavailable. Please try again later.',
        });
      }
      console.error('Email verification delivery failed:', err.message);
      return res.status(502).json({ error: 'EMAIL_FAILED', message: 'Could not send the email. Try again.' });
    }
    return res.json({ ok: true, ...(config.devOtpEcho ? { dev_code: code } : {}) });
  })
);

/**
 * @openapi
 * /api/me/email/verify:
 *   post:
 *     summary: Verify and attach an email address to the signed-in account
 *     tags: [Profile]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code]
 *             properties:
 *               email: { type: string, format: email }
 *               code: { type: string, pattern: '^\\d{6}$' }
 *     responses:
 *       200: { description: Email verified and linked }
 *       400: { description: Invalid email or code }
 *       401: { description: Invalid or expired code }
 *       409: { description: Email is already linked to another account }
 */
router.post(
  '/email/verify',
  emailLinkLimiter,
  wrap(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code ?? '').trim();
    if (!email || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'INVALID_EMAIL_CODE', message: 'Enter a valid email and 6-digit code.' });
    }
    const otp = await EmailOtp.findOne({
      email,
      user: req.userId,
      purpose: 'link',
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });
    if (!otp) return res.status(401).json({ error: 'BAD_CODE', message: 'That code is incorrect or has expired.' });
    const updatedOtp = await EmailOtp.findOneAndUpdate(
      { _id: otp._id, attempts: { $lt: 5 } },
      { $inc: { attempts: 1 } },
      { new: true }
    );
    if (!updatedOtp) {
      return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many wrong codes. Request a new one.' });
    }
    if (!safeEqual(updatedOtp.codeHash, hashOtp(config.jwtSecret, email, code))) {
      return res.status(401).json({ error: 'BAD_CODE', message: 'That code is incorrect or has expired.' });
    }

    let user;
    try {
      user = await User.findOneAndUpdate(
        { _id: req.userId },
        { $set: { email, emailVerifiedAt: new Date() } },
        { new: true, runValidators: true }
      ).lean();
    } catch (err) {
      if (err?.code === 11000) {
        return res.status(409).json({ error: 'EMAIL_IN_USE', message: 'That email is linked to another account.' });
      }
      throw err;
    }
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    await EmailOtp.deleteMany({ user: req.userId, purpose: 'link' });
    return res.json(privateProfileJson(user));
  })
);

router.post(
  '/security/two-factor',
  wrap(async (req, res) => {
    const enabled = req.body?.enabled;
    const code = String(req.body?.code ?? '').trim();
    const pin = String(req.body?.pin ?? '').trim();
    const currentPin = String(req.body?.current_pin ?? '').trim();
    if (typeof enabled !== 'boolean' || !/^\d{4,8}$/.test(code)) {
      return res.status(400).json({ error: 'INVALID_SECURITY_SETUP' });
    }
    if (enabled && !/^\d{6,12}$/.test(pin)) {
      return res.status(400).json({ error: 'INVALID_PIN', message: 'Choose a 6 to 12 digit PIN.' });
    }

    const user = await User.findById(req.userId).select('+twoFactorPinHash phone').lean();
    if (!user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    if (!enabled) {
      if (!user.twoFactorPinHash || !/^\d{6,12}$/.test(currentPin)
        || !safeEqual(user.twoFactorPinHash, hashOtp(config.jwtSecret, user.phone, `two-factor:${currentPin}`))) {
        return res.status(401).json({ error: 'BAD_PIN', message: 'Current PIN is incorrect.' });
      }
    }

    let validCode = false;
    const fixedCode = config.testPhones[user.phone];
    if (fixedCode) {
      validCode = safeEqual(fixedCode, code);
    } else {
      const otp = await Otp.findOne({ phone: user.phone, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
      if (otp) {
        const updated = await Otp.findOneAndUpdate(
          { _id: otp._id, attempts: { $lt: 5 } },
          { $inc: { attempts: 1 } },
          { new: true }
        );
        validCode = Boolean(updated && safeEqual(updated.codeHash, hashOtp(config.jwtSecret, user.phone, code)));
      }
    }
    if (!validCode) return res.status(401).json({ error: 'BAD_CODE', message: 'The SMS code is incorrect or expired.' });

    await Otp.deleteMany({ phone: user.phone });
    const update = {
      'settings.security.twoFactorAuth': enabled,
      twoFactorPinHash: enabled ? hashOtp(config.jwtSecret, user.phone, `two-factor:${pin}`) : null,
    };
    await User.updateOne({ _id: req.userId }, { $set: update });
    res.json({ ok: true, enabled });
  })
);

router.patch(
  '/',
  wrap(async (req, res) => {
    const patch = {};
    const { name, bio, avatar_url: avatarUrl, public_key: publicKey } = req.body ?? {};
    if (name !== undefined) {
      const n = String(name).trim();
      if (!n || n.length > 40) return res.status(400).json({ error: 'INVALID_NAME', message: 'Name must be 1–40 characters.' });
      patch.name = n;
    }
    if (bio !== undefined) {
      const b = String(bio).trim();
      if (b.length > 140) return res.status(400).json({ error: 'INVALID_BIO', message: 'Bio is too long (140 max).' });
      patch.bio = b;
    }
    if (avatarUrl !== undefined) {
      if (avatarUrl === null) patch.avatarUrl = null;
      else if (isOwnFileUrl(avatarUrl)) patch.avatarUrl = avatarUrl;
      else return res.status(400).json({ error: 'INVALID_AVATAR' });
    }
    if (publicKey !== undefined) {
      if (publicKey === null || isPublicEncryptionKey(publicKey)) patch.publicKey = publicKey;
      else return res.status(400).json({ error: 'INVALID_PUBLIC_KEY' });
    }
    const user = await User.findByIdAndUpdate(req.userId, patch, { new: true }).lean();
    res.json(serialize.user(user));
  })
);

export default router;
