import { config } from './config.js';

function twilioAuthorization() {
  const { twilioAccountSid, twilioAuthToken, twilioApiKeySid, twilioApiKeySecret } = config;
  if (!/^AC[0-9a-f]{32}$/i.test(twilioAccountSid)) {
    throw new Error('SMS_NOT_CONFIGURED');
  }
  if (twilioApiKeySid || twilioApiKeySecret) {
    if (!/^SK[0-9a-f]{32}$/i.test(twilioApiKeySid) || !twilioApiKeySecret) {
      throw new Error('SMS_NOT_CONFIGURED');
    }
    return `Basic ${Buffer.from(`${twilioApiKeySid}:${twilioApiKeySecret}`).toString('base64')}`;
  }
  if (!twilioAuthToken) throw new Error('SMS_NOT_CONFIGURED');
  return `Basic ${Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64')}`;
}

function verifyServiceUrl(serviceSid, endpoint) {
  if (!/^VA[0-9a-f]{32}$/i.test(serviceSid)) throw new Error('SMS_NOT_CONFIGURED');
  return `https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}/${endpoint}`;
}

async function postTwilioForm(url, authorization, form) {
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!response.ok) {
    let code;
    try {
      code = JSON.parse(await response.text()).code;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    const codeMessage = Number.isInteger(code) ? ` (Twilio error ${code})` : '';
    throw new Error(`Twilio SMS gateway responded ${response.status}${codeMessage}`);
  }
  return response.json();
}

export async function startPhoneVerification(phoneDigits) {
  const authorization = twilioAuthorization();
  const serviceSid = config.twilioVerifyServiceSid;
  const form = new URLSearchParams({ To: `+${phoneDigits}`, Channel: 'sms' });
  await postTwilioForm(verifyServiceUrl(serviceSid, 'Verifications'), authorization, form);
}

export async function checkPhoneVerification(phoneDigits, code) {
  const authorization = twilioAuthorization();
  const serviceSid = config.twilioVerifyServiceSid;
  const form = new URLSearchParams({ To: `+${phoneDigits}`, Code: code });
  const result = await postTwilioForm(verifyServiceUrl(serviceSid, 'VerificationCheck'), authorization, form);
  return result.status === 'approved';
}

/**
 * >>> THIS IS THE ONLY PLACE YOU NEED TO CHANGE TO SEND REAL OTP SMS <<<
 *
 * Twilio direct sending is configured with SMS_PROVIDER=twilio and its credentials.
 * A custom provider adapter can still be used with SMS_PROVIDER=webhook.
 *
 * In development (NODE_ENV != production) with no provider set, the message is printed to the
 * server console so you can log in without any SMS service.
 */
export async function sendSms(phoneDigits, message) {
  const to = `+${phoneDigits}`;
  if (config.smsProvider === 'termii') {
    const { termiiApiKey, termiiSenderId } = config;
    if (!termiiApiKey || !termiiSenderId) throw new Error('SMS_NOT_CONFIGURED');

    const response = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: termiiApiKey,
        to: phoneDigits,
        from: termiiSenderId,
        sms: message,
        type: 'plain',
        channel: 'generic',
      }),
    });

    let result;
    try {
      result = await response.json();
    } catch (error) {
      if (response.ok) throw error;
      throw new Error(`Termii SMS gateway responded ${response.status}`);
    }

    const providerCode = typeof result.code === 'string' ? result.code : '';
    if (!response.ok || providerCode.toLowerCase() !== 'ok') {
      const codeMessage = providerCode ? ` (Termii code ${providerCode})` : '';
      throw new Error(`Termii SMS gateway responded ${response.status}${codeMessage}`);
    }
    return;
  }
  if (config.smsProvider === 'twilio') {
    const { twilioAccountSid, twilioFromNumber, twilioMessagingServiceSid } = config;
    if (!/^AC[0-9a-f]{32}$/i.test(twilioAccountSid)
      || (!twilioFromNumber && !/^MG[0-9a-f]{32}$/i.test(twilioMessagingServiceSid))) {
      throw new Error('SMS_NOT_CONFIGURED');
    }
    const form = new URLSearchParams({ To: to, Body: message });
    if (twilioMessagingServiceSid) form.set('MessagingServiceSid', twilioMessagingServiceSid);
    else form.set('From', twilioFromNumber);
    await postTwilioForm(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}/Messages.json`,
      twilioAuthorization(),
      form
    );
    return;
  }
  if (config.smsProvider === 'webhook' && config.smsWebhookUrl) {
    const endpoint = new URL(config.smsWebhookUrl);
    if (config.nodeEnv === 'production' && endpoint.protocol !== 'https:') {
      throw new Error('SMS_WEBHOOK_URL_MUST_USE_HTTPS');
    }
    const res = await fetch(config.smsWebhookUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
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
