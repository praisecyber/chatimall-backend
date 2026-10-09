import { config } from './config.js';

/**
 * >>> THIS IS THE ONLY PLACE YOU NEED TO CHANGE TO SEND REAL OTP SMS <<<
 *
 * Option A (no code): set SMS_WEBHOOK_URL (+ SMS_WEBHOOK_TOKEN) in .env. The server will POST
 *                     {"to": "+15551234567", "message": "..."} to it.
 * Option B: replace the body of sendSms() with your provider's SDK/API call.
 *
 * In development (NODE_ENV != production) with no provider set, the message is printed to the
 * server console so you can log in without any SMS service.
 */
export async function sendSms(phoneDigits, message) {
  const to = `+${phoneDigits}`;
  if (config.smsWebhookUrl) {
    const res = await fetch(config.smsWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.smsWebhookToken ? { Authorization: `Bearer ${config.smsWebhookToken}` } : {}),
      },
      body: JSON.stringify({ to, message }),
    });
    if (!res.ok) throw new Error(`SMS gateway responded ${res.status}`);
    return;
  }
  if (config.nodeEnv !== 'production') {
    console.log(`[DEV SMS] to ${to}: ${message}`);
    return;
  }
  throw new Error('SMS_NOT_CONFIGURED');
}
