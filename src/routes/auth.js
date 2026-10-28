import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { EmailOtp, Otp, User } from '../models.js';
import { signToken } from '../auth.js';
import { disconnectPrimarySession } from '../realtime.js';
import { checkPhoneVerification, sendSms, startPhoneVerification } from '../sms.js';
import { sendEmailOtp } from '../email.js';
import { privateProfileJson, serialize } from './_shared.js';
import { hashOtp, normalizeEmail, normalizePhone, phoneEmailAccountConflict, safeEqual, wrap } from '../util.js';

const router = Router();
const accountConflictMessages = {
  PHONE_ALREADY_USED: 'This phone number is already linked to a different email. Sign in using the email already linked to this number.',
  EMAIL_ALREADY_USED: 'This email is already linked to a different phone number. Use the email linked to this number or sign in using the phone linked to this email.',
  PHONE_EMAIL_NOT_LINKED: 'This phone account has no verified email linked to it. Sign in with the existing phone verification method or contact support to link an email.',
  ACCOUNT_DETAILS_MISMATCH: 'This phone number and email are already associated with different accounts.',
};

function respondWithAccountConflict(res, conflict) {
  return res.status(409).json({
    error: conflict,
    message: accountConflictMessages[conflict],
  });
}

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
 *         description: The SMS provider could not send the code
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       503:
 *         description: SMS delivery is not configured
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

const phoneRecoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many recovery attempts. Try again later.' },
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
    const otp = await Otp.create({
      phone,
      codeHash: hashOtp(config.jwtSecret, phone, code),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    try {
      if (config.smsProvider === 'twilio-verify') {
        await startPhoneVerification(phone);
      } else {
        await sendSms(phone, `Your Chatimall code is ${code}. It expires in 5 minutes.`);
      }
    } catch (err) {
      await Otp.deleteOne({ _id: otp._id }).catch((cleanupError) => {
        console.error('Could not remove an OTP after SMS delivery failed:', cleanupError);
      });
      if (err.message === 'SMS_NOT_CONFIGURED') {
        console.error('[auth] SMS delivery is not configured.');
        return res.status(503).json({
          error: 'SMS_NOT_CONFIGURED',
          message: 'Phone sign-in is temporarily unavailable. Please try again later.',
        });
      }
      console.error('SMS failed:', err.message);
      return res.status(502).json({
        error: 'SMS_FAILED',
        message: 'Could not send the SMS. Try again.',
      });
    }
    res.json({ ok: true, ...(config.devOtpEcho && config.smsProvider !== 'twilio-verify' ? { dev_code: code } : {}) });
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
 *                 user: { $ref: '#/components/schemas/MyProfile' }
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
    } else if (config.smsProvider === 'twilio-verify') {
      const otp = await Otp.findOne({ phone, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
      if (otp) {
        const updated = await Otp.findOneAndUpdate({ _id: otp._id, attempts: { $lt: 5 } }, { $inc: { attempts: 1 } }, { new: true });
        if (!updated) {
          return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many wrong codes. Request a new one.' });
        }
        try {
          ok = await checkPhoneVerification(phone, code);
        } catch (err) {
          console.error('Twilio Verify check failed:', err.message);
          return res.status(502).json({ error: 'SMS_VERIFY_FAILED', message: 'Could not verify the SMS code. Try again.' });
        }
      }
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
    user.phoneVerifiedAt = new Date();
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
    const sessionId = crypto.randomUUID();
    user.activeSessionId = sessionId;
    await user.save();
    disconnectPrimarySession(String(user._id));
    await Otp.deleteMany({ phone });
    res.json({ token: signToken(user._id, null, sessionId), user: privateProfileJson(user) });
  })
);

/**
 * @openapi
 * /api/auth/phone/recovery/request:
 *   post:
 *     summary: Send an account recovery code to the email linked to a phone account
 *     description: The response does not reveal whether the phone is registered. Codes are sent only to that account's verified email; this does not change account identifiers.
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
 *               phone: { type: string, example: "+15551234567" }
 *     responses:
 *       200: { description: If eligible, a recovery code was sent to the linked verified email }
 *       400: { description: Invalid phone number }
 *       429: { description: Too many recovery attempts }
 *       502: { description: Email provider could not send the code }
 *       503: { description: Email delivery is not configured }
 */
router.post(
  '/phone/recovery/request',
  phoneRecoveryLimiter,
  wrap(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: 'INVALID_PHONE', message: 'Enter a valid phone number.' });

    const genericResponse = {
      ok: true,
      message: 'If this number is eligible for recovery, follow the instructions sent to its linked verified email.',
    };
    const user = await User.findOne({ phone, email: { $exists: true, $ne: null }, emailVerifiedAt: { $ne: null } })
      .select('_id phone email emailVerifiedAt')
      .lean();
    if (!user) return res.json(genericResponse);

    const recent = await EmailOtp.countDocuments({
      phone,
      purpose: 'phone-recovery',
      createdAt: { $gt: new Date(Date.now() - 3600 * 1000) },
    });
    if (recent >= 5) return res.json(genericResponse);

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const otp = await EmailOtp.create({
      phone,
      email: user.email,
      user: user._id,
      purpose: 'phone-recovery',
      codeHash: hashOtp(config.jwtSecret, `${phone}:${user.email}:recovery`, code),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    try {
      await sendEmailOtp(user.email, code);
    } catch (err) {
      await EmailOtp.deleteOne({ _id: otp._id }).catch((cleanupError) => {
        console.error('Could not remove a phone recovery OTP after email delivery failed:', cleanupError);
      });
      if (err.message === 'EMAIL_NOT_CONFIGURED') {
        console.error('[auth] Email delivery is not configured.');
        return res.status(503).json({
          error: 'EMAIL_NOT_CONFIGURED',
          message: 'Account recovery by email is temporarily unavailable. Please try again later.',
        });
      }
      console.error('Phone recovery email OTP delivery failed:', err.message);
      return res.status(502).json({ error: 'EMAIL_FAILED', message: 'Could not send the recovery email. Try again.' });
    }

    return res.json({ ...genericResponse, ...(config.devOtpEcho ? { dev_code: code } : {}) });
  })
);

/**
 * @openapi
 * /api/auth/phone/recovery/verify:
 *   post:
 *     summary: Complete phone-based account recovery with the linked-email code
 *     description: The phone only locates the account. The code must be read from its already-linked verified email.
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
 *               phone: { type: string, example: "+15551234567" }
 *               code: { type: string, pattern: '^\\d{6}$' }
 *               pin: { type: string, description: Required when account security PIN is enabled }
 *     responses:
 *       200: { description: Account recovery successful }
 *       400: { description: Invalid input }
 *       401: { description: Invalid or expired code, or invalid security PIN }
 *       428: { description: Account security PIN required }
 *       429: { description: Too many verification attempts }
 */
router.post(
  '/phone/recovery/verify',
  verifyLimiter,
  wrap(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const code = String(req.body?.code ?? '').trim();
    if (!phone || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'INVALID', message: 'Enter your phone number and the 6-digit recovery code.' });
    }

    const otp = await EmailOtp.findOne({
      phone,
      purpose: 'phone-recovery',
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
    if (!safeEqual(updatedOtp.codeHash, hashOtp(config.jwtSecret, phone + ':' + otp.email + ':recovery', code))) {
      return res.status(401).json({ error: 'BAD_CODE', message: 'That code is incorrect or has expired.' });
    }

    const user = await User.findOne({
      _id: otp.user,
      phone,
      email: otp.email,
      emailVerifiedAt: { $ne: null },
    }).select('+twoFactorPinHash');
    if (!user) return res.status(401).json({ error: 'BAD_CODE', message: 'That code is incorrect or has expired.' });

    if (user.settings?.security?.twoFactorAuth) {
      const pin = String(req.body?.pin ?? '').trim();
      if (!/^\d{6,12}$/.test(pin)) {
        return res.status(428).json({ error: 'SECOND_FACTOR_REQUIRED', message: 'Enter your account security PIN.' });
      }
      const identity = user.phone ?? user.email;
      if (!user.twoFactorPinHash || !safeEqual(user.twoFactorPinHash, hashOtp(config.jwtSecret, identity, `two-factor:${pin}`))) {
        return res.status(401).json({ error: 'BAD_SECOND_FACTOR', message: 'The account security PIN is incorrect.' });
      }
    }

    const sessionId = crypto.randomUUID();
    user.phoneVerifiedAt = new Date();
    user.activeSessionId = sessionId;
    await user.save();
    disconnectPrimarySession(String(user._id));
    await EmailOtp.deleteMany({ phone, purpose: 'phone-recovery' });
    return res.json({ token: signToken(user._id, null, sessionId), user: privateProfileJson(user) });
  })
);

/**
 * @openapi
 * /api/auth/otp/email/request:
 *   post:
 *     summary: Send a phone sign-in code to the supplied email address
 *     description: Codes are sent to the email linked to the account. Completing email OTP marks the submitted phone as verified for this account; it confirms access to the email, not possession of the SIM.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, email]
 *             properties:
 *               phone: { type: string, example: "+2349121598033" }
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: Code sent by email }
 *       400: { description: Invalid phone number or email }
 *       409: { description: Email or phone is already linked elsewhere, or this existing phone account has no verified email }
 *       429: { description: Too many code requests }
 *       502: { description: Email provider could not send the code }
 *       503: { description: Email delivery is not configured }
 */
router.post(
  '/otp/email/request',
  limiter,
  wrap(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const email = normalizeEmail(req.body?.email);
    if (!phone || !email) {
      return res.status(400).json({ error: 'INVALID', message: 'Enter a valid phone number and email address.' });
    }
    if (config.testPhones[phone]) return res.json({ ok: true });

    const [phoneUser, emailUser] = await Promise.all([
      User.findOne({ phone }).select('_id phone email emailVerifiedAt'),
      User.findOne({ email }).select('_id phone email'),
    ]);
    const accountConflict = phoneEmailAccountConflict(phoneUser, emailUser, phone, email);
    if (accountConflict) return respondWithAccountConflict(res, accountConflict);

    const recent = await EmailOtp.countDocuments({
      phone,
      purpose: 'phone-login',
      createdAt: { $gt: new Date(Date.now() - 3600 * 1000) },
    });
    if (recent >= 5) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many codes requested for this number. Try again in an hour.' });
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const otp = await EmailOtp.create({
      phone,
      email,
      user: phoneUser?._id ?? emailUser?._id,
      purpose: 'phone-login',
      codeHash: hashOtp(config.jwtSecret, `${phone}:${email}`, code),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    try {
      await sendEmailOtp(email, code);
    } catch (err) {
      await EmailOtp.deleteOne({ _id: otp._id }).catch((cleanupError) => {
        console.error('Could not remove a phone sign-in OTP after email delivery failed:', cleanupError);
      });
      if (err.message === 'EMAIL_NOT_CONFIGURED') {
        console.error('[auth] Email delivery is not configured.');
        return res.status(503).json({
          error: 'EMAIL_NOT_CONFIGURED',
          message: 'Email verification is temporarily unavailable. Please try again later.',
        });
      }
      console.error('Phone sign-in email OTP delivery failed:', err.message);
      return res.status(502).json({ error: 'EMAIL_FAILED', message: 'Could not send the verification email. Try again.' });
    }
    return res.json({ ok: true, ...(config.devOtpEcho ? { dev_code: code } : {}) });
  })
);

/**
 * @openapi
 * /api/auth/otp/email/verify:
 *   post:
 *     summary: Verify an email code for a phone sign-in
 *     description: The verified email is associated with the submitted phone account.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, email, code]
 *             properties:
 *               phone: { type: string, example: "+2349121598033" }
 *               email: { type: string, format: email }
 *               code: { type: string, pattern: '^\\d{4,8}$' }
 *               pin: { type: string, description: Required when account security PIN is enabled }
 *     responses:
 *       200: { description: Login successful }
 *       400: { description: Invalid input }
 *       401: { description: Invalid or expired code }
 *       409: { description: Phone and email are associated with different accounts }
 *       428: { description: Account security PIN required }
 *       429: { description: Too many verification attempts }
 */
router.post(
  '/otp/email/verify',
  verifyLimiter,
  wrap(async (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code ?? '').trim();
    if (!phone || !email || !/^\d{4,8}$/.test(code)) {
      return res.status(400).json({ error: 'INVALID', message: 'Enter your phone number, email, and the code we sent you.' });
    }

    let codeIsValid = false;
    const fixedCode = config.testPhones[phone];
    if (fixedCode) {
      codeIsValid = safeEqual(fixedCode, code);
    } else {
      const otp = await EmailOtp.findOne({
        phone,
        email,
        purpose: 'phone-login',
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
      codeIsValid = safeEqual(updatedOtp.codeHash, hashOtp(config.jwtSecret, `${phone}:${email}`, code));
    }
    if (!codeIsValid) {
      return res.status(401).json({ error: 'BAD_CODE', message: 'That code is incorrect or has expired.' });
    }

    const [phoneUser, emailUser] = await Promise.all([
      User.findOne({ phone }).select('+twoFactorPinHash'),
      User.findOne({ email }).select('+twoFactorPinHash'),
    ]);
    const accountConflict = phoneEmailAccountConflict(phoneUser, emailUser, phone, email);
    if (accountConflict) return respondWithAccountConflict(res, accountConflict);

    let user = phoneUser ?? emailUser;
    const pinIdentity = user?.phone ?? user?.email ?? phone;
    if (!user) {
      try {
        user = await User.create({ phone, email, emailVerifiedAt: new Date() });
      } catch (err) {
        if (err?.code === 11000) {
          const conflict = err.keyPattern?.phone
            ? 'PHONE_ALREADY_USED'
            : err.keyPattern?.email
              ? 'EMAIL_ALREADY_USED'
              : 'ACCOUNT_DETAILS_MISMATCH';
          return respondWithAccountConflict(res, conflict);
        }
        throw err;
      }
    } else {
      if (user.phone !== phone) {
        user.phone = phone;
        user.phoneVerifiedAt = null;
      }
      user.email = email;
      user.emailVerifiedAt = new Date();
    }

    if (user.settings?.security?.twoFactorAuth) {
      const pin = String(req.body?.pin ?? '').trim();
      if (!/^\d{6,12}$/.test(pin)) {
        return res.status(428).json({ error: 'SECOND_FACTOR_REQUIRED', message: 'Enter your account security PIN.' });
      }
      const expected = user.twoFactorPinHash;
      if (!expected || !safeEqual(expected, hashOtp(config.jwtSecret, pinIdentity, `two-factor:${pin}`))) {
        return res.status(401).json({ error: 'BAD_SECOND_FACTOR', message: 'The account security PIN is incorrect.' });
      }
      if (pinIdentity !== phone) {
        user.twoFactorPinHash = hashOtp(config.jwtSecret, phone, `two-factor:${pin}`);
      }
    }

    user.phoneVerifiedAt = new Date();
    const sessionId = crypto.randomUUID();
    user.activeSessionId = sessionId;
    try {
      await user.save();
    } catch (err) {
      if (err?.code === 11000) {
        const conflict = err.keyPattern?.phone
          ? 'PHONE_ALREADY_USED'
          : err.keyPattern?.email
            ? 'EMAIL_ALREADY_USED'
            : 'ACCOUNT_DETAILS_MISMATCH';
        return respondWithAccountConflict(res, conflict);
      }
      throw err;
    }
    disconnectPrimarySession(String(user._id));
    await EmailOtp.deleteMany({ phone, purpose: 'phone-login' });
    return res.json({ token: signToken(user._id, null, sessionId), user: privateProfileJson(user) });
  })
);

/**
 * @openapi
 * /api/auth/email/otp/request:
 *   post:
 *     summary: Request a sign-in code for a verified account email
 *     tags: [Auth]
 *     security: []
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
 *       200: { description: A code was sent if the email is linked and verified }
 *       400: { description: Invalid email address }
 *       429: { description: Too many code requests }
 *       502: { description: Email provider could not send the code }
 *       503: { description: Email delivery is not configured }
 */
router.post(
  '/email/otp/request',
  limiter,
  wrap(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: 'INVALID_EMAIL', message: 'Enter a valid email address.' });

    const recent = await EmailOtp.countDocuments({
      email,
      purpose: 'login',
      createdAt: { $gt: new Date(Date.now() - 3600 * 1000) },
    });
    if (recent >= 5) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many codes requested for this email. Try again in an hour.' });
    }

    const existingUser = await User.findOne({ email, emailVerifiedAt: { $ne: null } }).select('_id').lean();
    const userId = existingUser?._id ?? null;
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const otp = await EmailOtp.create({
      email,
      user: userId,
      purpose: 'login',
      codeHash: hashOtp(config.jwtSecret, email, code),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    try {
      await sendEmailOtp(email, code);
    } catch (err) {
      await EmailOtp.deleteOne({ _id: otp._id }).catch((cleanupError) => {
        console.error('Could not remove an email OTP after delivery failed:', cleanupError);
      });
      if (err.message === 'EMAIL_NOT_CONFIGURED') {
        console.error('[auth] Email delivery is not configured.');
        return res.status(503).json({
          error: 'EMAIL_NOT_CONFIGURED',
          message: 'Email sign-in is temporarily unavailable. Please try again later.',
        });
      }
      console.error('Email OTP delivery failed:', err.message);
      return res.status(502).json({ error: 'EMAIL_FAILED', message: 'Could not send the email. Try again.' });
    }
    return res.json({ ok: true, ...(config.devOtpEcho ? { dev_code: code } : {}) });
  })
);

/**
 * @openapi
 * /api/auth/email/otp/verify:
 *   post:
 *     summary: Verify an email sign-in code and return a session
 *     description: If this account has a phone number, successful email sign-in also marks that phone as verified for the account.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code]
 *             properties:
 *               email: { type: string, format: email }
 *               code: { type: string, pattern: '^\\d{4,8}$' }
 *               pin: { type: string, description: Required when two-step verification is enabled }
 *     responses:
 *       200: { description: Login successful }
 *       400: { description: Invalid input }
 *       401: { description: Invalid or expired code }
 *       428: { description: Account security PIN required }
 *       429: { description: Too many verification attempts }
 */
router.post(
  '/email/otp/verify',
  verifyLimiter,
  wrap(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code ?? '').trim();
    if (!email || !/^\d{4,8}$/.test(code)) {
      return res.status(400).json({ error: 'INVALID', message: 'Enter the code we sent you.' });
    }
    const otp = await EmailOtp.findOne({
      email,
      purpose: 'login',
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

    const existingUser = await User.findOne({ email, emailVerifiedAt: { $ne: null } }).select('+twoFactorPinHash').lean();
    let user = existingUser;
    if (!user) {
      user = await User.findOneAndUpdate(
        { email },
        {
          $set: { email, emailVerifiedAt: new Date() },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
      ).select('+twoFactorPinHash').lean();
    }
    if (!user) return res.status(401).json({ error: 'BAD_CODE', message: 'That code is incorrect or has expired.' });
    if (user.settings?.security?.twoFactorAuth) {
      const pin = String(req.body?.pin ?? '').trim();
      if (!/^\d{6,12}$/.test(pin)) {
        return res.status(428).json({ error: 'SECOND_FACTOR_REQUIRED', message: 'Enter your account security PIN.' });
      }
      const expected = user.twoFactorPinHash;
      if (!expected || !safeEqual(expected, hashOtp(config.jwtSecret, user.phone ?? email, `two-factor:${pin}`))) {
        return res.status(401).json({ error: 'BAD_SECOND_FACTOR', message: 'The account security PIN is incorrect.' });
      }
    }
    const sessionId = crypto.randomUUID();
    const update = { activeSessionId: sessionId };
    if (user.phone) update.phoneVerifiedAt = new Date();
    const updatedUser = await User.findByIdAndUpdate(user._id, { $set: update }, { new: true }).lean();
    if (!updatedUser) return res.status(401).json({ error: 'UNAUTHORIZED' });
    disconnectPrimarySession(String(user._id));
    await EmailOtp.deleteMany({ email, purpose: 'login' });
    return res.json({ token: signToken(user._id, null, sessionId), user: privateProfileJson(updatedUser) });
  })
);

export default router;
