// Order + OPay security tests. The existing suite has no database harness (no mongodb-memory-server,
// no mocked DB), so — matching test/util.test.js — we test the pure OPay helpers directly and the
// exported state-transition rules, rather than inventing a DB setup.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/test-orders';
process.env.JWT_SECRET ||= 'test-secret-for-orders';
process.env.OPAY_MERCHANT_ID = 'test-merchant';
process.env.OPAY_PUBLIC_KEY = 'test-public-key';
process.env.OPAY_PRIVATE_KEY = 'test-private-key';

const { verifyCallback } = await import('../src/opay.js');
const { canCancelOrder, canReleaseOrder } = await import('../src/routes/orders.js');

const PRIVATE_KEY = 'test-private-key';

/** Rebuilds the exact OPay signed string, following the same rules as src/opay.js:
 * `Refunded` is the literal "t"/"f" and `Token` is empty when null. */
function signPayload(payload, key = PRIVATE_KEY) {
  const content =
    `{Amount:"${payload.amount}",Currency:"${payload.currency}",Reference:"${payload.reference}",` +
    `Refunded:${payload.refunded ? 't' : 'f'},Status:"${payload.status}",Timestamp:"${payload.timestamp}",` +
    `Token:"${payload.token ?? ''}",TransactionID:"${payload.transactionId}"}`;
  return crypto.createHmac('sha3-512', key).update(content, 'utf8').digest('hex');
}

const basePayload = {
  amount: '49160',
  channel: 'Web',
  country: 'NG',
  currency: 'NGN',
  displayedFailure: '',
  fee: '737',
  feeCurrency: 'NGN',
  instrumentType: 'BankCard',
  reference: '10023',
  refunded: false,
  status: 'SUCCESS',
  timestamp: '2022-05-07T06:20:46Z',
  token: '220507145660712931829',
  transactionId: '220507145660712931829',
  updated_at: '2022-05-07T07:20:46Z',
};

test('verifyCallback accepts a correctly signed OPay callback', () => {
  const body = { payload: basePayload, sha512: signPayload(basePayload), type: 'transaction-status' };
  const result = verifyCallback(body);
  assert.equal(result.ok, true);
  assert.equal(result.payload.reference, '10023');
});

test('verifyCallback accepts a signature sent in uppercase (case-insensitive)', () => {
  const body = { payload: basePayload, sha512: signPayload(basePayload).toUpperCase() };
  assert.equal(verifyCallback(body).ok, true);
});

test('verifyCallback rejects a tampered payload', () => {
  const sha512 = signPayload(basePayload);
  const tampered = { ...basePayload, amount: '1' }; // attacker lowers the amount after signing
  assert.equal(verifyCallback({ payload: tampered, sha512 }).ok, false);
});

test('verifyCallback rejects a signature made with the wrong key', () => {
  const body = { payload: basePayload, sha512: signPayload(basePayload, 'not-the-private-key') };
  assert.equal(verifyCallback(body).ok, false);
});

test('verifyCallback rejects a missing signature or payload', () => {
  assert.equal(verifyCallback({ payload: basePayload }).ok, false);
  assert.equal(verifyCallback({ sha512: signPayload(basePayload) }).ok, false);
  assert.equal(verifyCallback({}).ok, false);
});

test('verifyCallback signs Refunded as "t"/"f" and an empty Token when null', () => {
  const payload = { ...basePayload, refunded: true, token: null };
  const body = { payload, sha512: signPayload(payload) };
  assert.equal(verifyCallback(body).ok, true);
});

test('order state transitions: pending can be canceled, paid can be released', () => {
  assert.equal(canCancelOrder({ status: 'pending' }), true);
  assert.equal(canCancelOrder({ status: 'paid' }), false);

  // A pending order is NOT releasable — only a paid one is.
  assert.equal(canReleaseOrder({ status: 'pending' }), false);
  assert.equal(canReleaseOrder({ status: 'paid' }), true);
  assert.equal(canReleaseOrder({ status: 'released' }), false);
});
