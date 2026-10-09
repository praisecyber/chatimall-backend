import { Router } from 'express';
import { Otp, User } from '../models.js';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { hashOtp, isOwnFileUrl, safeEqual, wrap } from '../util.js';
import { serialize } from './_shared.js';

const router = Router();
router.use(requireAuth);

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
    res.json(serialize.user(user));
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
