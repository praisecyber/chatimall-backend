// OPay Cashier client. Everything OPay-specific lives here so the rest of the app deals in plain
// objects and, if we ever swap gateways, only this file changes.
//
// Facts taken from OPay's official docs:
//   - create:  POST /cashier/create  — Authorization: Bearer {PublicKey} + MerchantId
//   - status:  POST /cashier/status  — MerchantId + Signature (HMAC-SHA512 of the exact JSON body)
//   - callback: OPay POSTs { payload, sha512, type } — verified with HMAC-SHA3-512 of a fixed string
import crypto from 'node:crypto';
import { config } from './config.js';

const REQUEST_TIMEOUT_MS = 15000; // don't let a hung gateway request pin a request handler forever

const baseUrl = () => `${config.opayBaseUrl}/cashier`;

/** HMAC-SHA512 (hex) of the exact request body, signed with the Private Key. Required on every
 * OPay endpoint other than cashier/create. Kept internal; the caller never sees the signature. */
function signRequest(bodyString) {
  return crypto.createHmac('sha512', config.opayPrivateKey).update(bodyString, 'utf8').digest('hex');
}

/** POSTs JSON to OPay, returns the parsed body. Throws a descriptive Error on transport/timeout
 * failure or a non-JSON/HTTP error response. */
async function postJson(path, body, { signed }) {
  const bodyString = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json',
    MerchantId: config.opayMerchantId,
    Authorization: `Bearer ${config.opayPublicKey}`,
  };
  // OPay signs the body it receives; the signature must be over the exact serialized string we send.
  if (signed) headers.Signature = signRequest(bodyString);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: 'POST',
      headers,
      body: bodyString,
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timed out' : err?.message || 'network error';
    throw new Error(`OPay request to ${path} failed: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`OPay returned a non-JSON response (HTTP ${response.status}).`);
  }
}

/**
 * Creates a Cashier checkout and returns where to send the buyer.
 * `amountCents` is the integer total in the currency's smallest unit (OPay's `amount.total`).
 */
export async function createCashier({
  reference,
  amountCents,
  currency,
  country,
  returnUrl,
  callbackUrl,
  cancelUrl,
  expireMinutes,
  userInfo,
  product,
}) {
  const body = {
    country,
    reference,
    amount: { total: amountCents, currency },
    returnUrl,
    ...(callbackUrl ? { callbackUrl } : {}),
    ...(cancelUrl ? { cancelUrl } : {}),
    ...(expireMinutes ? { expireAt: expireMinutes } : {}),
    ...(userInfo ? { userInfo } : {}),
    productList: product ? [product] : [],
  };

  const json = await postJson('/create', body, { signed: false });
  if (json?.code !== '00000') {
    throw new Error(`OPay create failed: ${json?.message || `code ${json?.code ?? 'unknown'}`}`);
  }
  const cashierUrl = json?.data?.cashierUrl ?? json?.cashierUrl ?? null;
  if (!cashierUrl) throw new Error('OPay create response did not include a cashier URL.');
  const orderNo = json?.data?.orderNo ?? json?.orderNo ?? null;
  return { cashierUrl: String(cashierUrl), orderNo, raw: json };
}

/**
 * Asks OPay for the current status of one of our orders. NOTE: OPay's exact status response shape
 * is not fully documented publicly, so we read the well-known fields defensively and always expose
 * the raw body so callers can persist/inspect whatever else came back.
 */
export async function queryStatus({ reference, country }) {
  const json = await postJson('/status', { country, reference }, { signed: true });
  if (json?.code !== '00000') {
    throw new Error(`OPay status failed: ${json?.message || `code ${json?.code ?? 'unknown'}`}`);
  }
  const data = json?.data ?? json ?? {};
  return {
    status: data.status ?? null,
    amount: data.amount ?? null,
    currency: data.currency ?? null,
    transactionId: data.transactionId ?? data.token ?? null,
    raw: json,
  };
}

/**
 * Verifies an OPay transaction-status callback. This is the security-critical path — anyone on the
 * internet can POST here, so nothing counts as paid until the signature checks out.
 *
 * Per OPay, the signed string is rebuilt from the payload with these EXACT rules (no spaces,
 * `Refunded` is the literal "t"/"f", `Token` is an empty string when null):
 *   {Amount:"%s",Currency:"%s",Reference:"%s",Refunded:%s,Status:"%s",Timestamp:"%s",Token:"%s",TransactionID:"%s"}
 * and signed with HMAC-SHA3-512 using the Private Key, compared case-insensitively to body.sha512.
 */
export function verifyCallback(body) {
  const payload = body?.payload;
  const sha512 = body?.sha512;
  if (!payload || !sha512) return { ok: false, payload: payload ?? null };

  const signContent =
    `{Amount:"${payload.amount}",Currency:"${payload.currency}",Reference:"${payload.reference}",` +
    `Refunded:${payload.refunded ? 't' : 'f'},Status:"${payload.status}",Timestamp:"${payload.timestamp}",` +
    `Token:"${payload.token ?? ''}",TransactionID:"${payload.transactionId}"}`;
  const expected = crypto.createHmac('sha3-512', config.opayPrivateKey).update(signContent, 'utf8').digest('hex');
  const ok = expected.toLowerCase() === String(sha512).toLowerCase();
  return { ok, payload };
}
