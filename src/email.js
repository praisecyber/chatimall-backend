import { config } from './config.js';

export async function sendEmailOtp(to, code) {
  const subject = 'Your Chatimall sign-in code';
  const message = `Your Chatimall code is ${code}. It expires in 5 minutes. If you did not request this code, you can ignore this email.`;

  if (config.emailProvider === 'resend') {
    if (!config.resendApiKey || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.emailFromAddress)) {
      throw new Error('EMAIL_NOT_CONFIGURED');
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: ['Bearer', config.resendApiKey].join(' '),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Chatimall <${config.emailFromAddress}>`,
        to: [to],
        subject,
        text: message,
      }),
    });
    if (!response.ok) throw new Error(`Email provider responded ${response.status}`);
    return;
  }
  if (config.emailProvider === 'webhook' && config.emailWebhookUrl) {
    const endpoint = new URL(config.emailWebhookUrl);
    if (config.nodeEnv === 'production' && endpoint.protocol !== 'https:') {
      throw new Error('EMAIL_WEBHOOK_URL_MUST_USE_HTTPS');
    }
    const response = await fetch(config.emailWebhookUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'Content-Type': 'application/json',
        ...(config.emailWebhookToken ? { Authorization: ['Bearer', config.emailWebhookToken].join(' ') } : {}),
      },
      body: JSON.stringify({ to, subject, message }),
    });
    if (!response.ok) throw new Error(`Email gateway responded ${response.status}`);
    return;
  }

  if (config.nodeEnv !== 'production') {
    console.log(`[DEV EMAIL] to ${to}: ${message}`);
    return;
  }
  throw new Error('EMAIL_NOT_CONFIGURED');
}
