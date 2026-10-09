import 'dotenv/config';

const need = (key) => {
  const v = process.env[key];
  if (!v) {
    console.error(`Missing required environment variable ${key}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
};

const nodeEnv = process.env.NODE_ENV || 'development';

const testPhones = {};
for (const pair of (process.env.TEST_PHONES || '').split(',')) {
  const [phone, code] = pair.split(':').map((s) => s?.trim());
  if (phone && code) testPhones[phone.replace(/\D/g, '')] = code;
}

export const config = {
  nodeEnv,
  port: Number(process.env.PORT || 4000),
  mongoUri: need('MONGODB_URI'),
  jwtSecret: need('JWT_SECRET'),
  clientOrigins: (process.env.CLIENT_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  smsWebhookUrl: process.env.SMS_WEBHOOK_URL || '',
  smsWebhookToken: process.env.SMS_WEBHOOK_TOKEN || '',
  devOtpEcho: process.env.DEV_OTP_ECHO === 'true' && nodeEnv !== 'production',
  testPhones,
  // Base URL of the voice-translation microservice (translate-service/). Optional: if it's
  // not reachable, voice notes just behave like before — no translation, no crash.
  translateServiceUrl: process.env.TRANSLATE_SERVICE_URL || 'http://localhost:8787',
};
