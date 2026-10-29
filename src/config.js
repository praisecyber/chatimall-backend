import 'dotenv/config';

const need = (keys) => {
  if (!Array.isArray(keys)) keys = [keys];
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `Missing required environment variable(s): ${missing.join(', ')}.\n` +
        `Copy .env.example to .env and fill them in, or add them in the Render Environment tab.`
    );
    process.exit(1);
  }
  const [first] = keys;
  return keys.length === 1 ? process.env[first] : Object.fromEntries(keys.map((k) => [k, process.env[k]]));
};

const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
const smsProvider = process.env.SMS_PROVIDER || 'webhook';
if (!['webhook', 'twilio', 'twilio-verify', 'termii'].includes(smsProvider)) {
  throw new Error('SMS_PROVIDER must be "webhook", "twilio", "twilio-verify", or "termii".');
}
const emailProvider = process.env.EMAIL_PROVIDER || 'webhook';
if (!['webhook', 'resend'].includes(emailProvider)) {
  throw new Error('EMAIL_PROVIDER must be either "webhook" or "resend".');
}

const DEFAULT_CLIENT_ORIGINS_PRODUCTION = [
  'https://chatimall-frontend.vercel.app',
  'https://*.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'capacitor://localhost',
  'http://localhost',
  'http://127.0.0.1',
];

const envClientOrigins = (process.env.CLIENT_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// In development, an empty CLIENT_ORIGINS means "allow everything" (old behavior).
// In production, an empty CLIENT_ORIGINS falls back to the safe list above so a
// forgotten env var never accidentally opens CORS to the whole internet AND never
// blocks the default Vercel frontend + local dev + Capacitor Android wrapper.
const computedClientOrigins =
  envClientOrigins.length > 0
    ? envClientOrigins
    : nodeEnv === 'development'
      ? []
      : DEFAULT_CLIENT_ORIGINS_PRODUCTION;

const configuredTestPhones = {};
for (const pair of (process.env.TEST_PHONES || '').split(',')) {
  const [phone, code] = pair.split(':').map((s) => s?.trim());
  if (phone && code) configuredTestPhones[phone.replace(/\D/g, '')] = code;
}
const testPhones = nodeEnv === 'production' ? {} : configuredTestPhones;
if (nodeEnv === 'production' && Object.keys(configuredTestPhones).length > 0) {
  console.error('[config] TEST_PHONES is ignored in production; remove it from the environment.');
}

const configuredAdminPhones = (process.env.ADMIN_PHONES || '')
  .split(',')
  .map((p) => p.replace(/\D/g, ''))
  .filter(Boolean);

const configuredAdminEmails = (process.env.ADMIN_EMAILS || 'praisecyber2005@gmail.com')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const { MONGODB_URI: mongoUri, JWT_SECRET: jwtSecret } = need(['MONGODB_URI', 'JWT_SECRET']);

export const config = {
  adminPhones: configuredAdminPhones,
  adminEmails: configuredAdminEmails,
  nodeEnv,
  port: Number(process.env.PORT || 4000),
  mongoUri,
  jwtSecret,
  clientOrigins: computedClientOrigins,
  smsProvider,
  smsWebhookUrl: process.env.SMS_WEBHOOK_URL || '',
  smsWebhookToken: process.env.SMS_WEBHOOK_TOKEN || '',
  termiiApiKey: process.env.TERMII_API_KEY || '',
  termiiSenderId: process.env.TERMII_SENDER_ID || '',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioApiKeySid: process.env.TWILIO_API_KEY_SID || '',
  twilioApiKeySecret: process.env.TWILIO_API_KEY_SECRET || '',
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER || '',
  twilioMessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || '',
  twilioVerifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || '',
  emailWebhookUrl: process.env.EMAIL_WEBHOOK_URL || '',
  emailWebhookToken: process.env.EMAIL_WEBHOOK_TOKEN || '',
  emailProvider,
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFromAddress: process.env.EMAIL_FROM_ADDRESS || '',
  devOtpEcho: process.env.DEV_OTP_ECHO === 'true' && nodeEnv !== 'production',
  testPhones,
  // Base URL of the voice-translation microservice (translate-service/). Optional: if it's
  // not reachable, voice notes just behave like before — no translation, no crash.
  translateServiceUrl: process.env.TRANSLATE_SERVICE_URL || 'http://localhost:8787',
  tiktokClientKey: process.env.TIKTOK_CLIENT_KEY || '',
  tiktokClientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
  tiktokRedirectUri: process.env.TIKTOK_REDIRECT_URI || '',
  tiktokFrontendUrl: process.env.TIKTOK_FRONTEND_URL || 'https://chatimall-frontend.vercel.app',
  tiktokTokenEncryptionKey: process.env.TIKTOK_TOKEN_ENCRYPTION_KEY || '',
};

if (config.tiktokTokenEncryptionKey) {
  const encryptionKey = Buffer.from(config.tiktokTokenEncryptionKey, 'base64');
  if (encryptionKey.length !== 32) {
    throw new Error('TIKTOK_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
}
