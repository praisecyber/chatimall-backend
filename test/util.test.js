import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { hashOtp, isOwnFileUrl, makeOriginChecker, normalizeEmail, normalizePhone, parseWatchUrl, previewOf, publicEncryptionKeyId, safeEqual } from '../src/util.js';
import { messageJson, userJson } from '../src/serialize.js';
import { privateProfileJson } from '../src/routes/_shared.js';

test('normalizePhone strips formatting and accepts any valid international code', () => {
  assert.equal(normalizePhone('+1 (555) 123-4567'), '15551234567');
  assert.equal(normalizePhone('+234 801 234 5678'), '2348012345678');
  assert.equal(normalizePhone('+44 20 7946 0958'), '442079460958');
  assert.equal(normalizePhone('12'), null);
  assert.equal(normalizePhone('1'.repeat(16)), null);
  assert.equal(normalizePhone(undefined), null);
});

test('normalizeEmail lowercases valid addresses and rejects malformed input', () => {
  assert.equal(normalizeEmail('  Example.User@Mail.COM '), 'example.user@mail.com');
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.equal(normalizeEmail('user@localhost'), null);
  assert.equal(normalizeEmail('x'.repeat(250) + '@example.com'), null);
});

test('otp hashing is deterministic and phone/code specific', () => {
  const a = hashOtp('s', '1555', '123456');
  assert.equal(a, hashOtp('s', '1555', '123456'));
  assert.notEqual(a, hashOtp('s', '1555', '123457'));
  assert.notEqual(a, hashOtp('s', '1556', '123456'));
  assert.ok(safeEqual(a, a));
  assert.ok(!safeEqual(a, 'short'));
});

test('production config ignores fixed test OTPs', () => {
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', "import('./src/config.js').then(({ config }) => console.log(JSON.stringify(config.testPhones)))"],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb://127.0.0.1:27017/test-config',
        JWT_SECRET: 'test-secret',
        TEST_PHONES: '+2348012345678:123456',
      },
    }
  );
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim()), {});
});

test('Twilio SMS uses the configured sender and authenticated API payload', () => {
  const script = `
    globalThis.fetch = async (url, options) => {
      console.log(JSON.stringify({ url: String(url), authorization: options.headers.Authorization, body: options.body }));
      return { ok: true };
    };
    const { sendSms } = await import('./src/sms.js');
    await sendSms('2348012345678', 'Your Chatimall code is 123456.');
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/test-sms',
      JWT_SECRET: 'test-secret',
      SMS_PROVIDER: 'twilio',
      TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
      TWILIO_AUTH_TOKEN: 'test-auth-token',
      TWILIO_FROM_NUMBER: '+15005550006',
      TWILIO_MESSAGING_SERVICE_SID: '',
    },
  });
  assert.equal(child.status, 0, child.stderr);
  const request = JSON.parse(child.stdout.trim());
  assert.match(request.url, /\/Accounts\/ACa{32}\/Messages\.json$/);
  assert.equal(request.authorization, `Basic ${Buffer.from(`AC${'a'.repeat(32)}:test-auth-token`).toString('base64')}`);
  const body = new URLSearchParams(request.body);
  assert.equal(body.get('To'), '+2348012345678');
  assert.equal(body.get('From'), '+15005550006');
  assert.equal(body.get('Body'), 'Your Chatimall code is 123456.');
});

test('Twilio Verify starts an SMS verification using the configured service', () => {
  const script = `
    globalThis.fetch = async (url, options) => {
      console.log(JSON.stringify({ url: String(url), authorization: options.headers.Authorization, body: options.body }));
      return { ok: true, json: async () => ({ status: 'pending' }) };
    };
    const { startPhoneVerification } = await import('./src/sms.js');
    await startPhoneVerification('2348012345678');
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/test-twilio-verify',
      JWT_SECRET: 'test-secret',
      SMS_PROVIDER: 'twilio-verify',
      TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
      TWILIO_AUTH_TOKEN: 'test-auth-token',
      TWILIO_VERIFY_SERVICE_SID: `VA${'b'.repeat(32)}`,
    },
  });
  assert.equal(child.status, 0, child.stderr);
  const request = JSON.parse(child.stdout.trim());
  assert.equal(request.url, `https://verify.twilio.com/v2/Services/VA${'b'.repeat(32)}/Verifications`);
  assert.equal(request.authorization, `Basic ${Buffer.from(`AC${'a'.repeat(32)}:test-auth-token`).toString('base64')}`);
  const body = new URLSearchParams(request.body);
  assert.equal(body.get('To'), '+2348012345678');
  assert.equal(body.get('Channel'), 'sms');
});

test('Twilio Verify accepts only approved verification checks', () => {
  const script = `
    globalThis.fetch = async (url, options) => {
      console.log(JSON.stringify({ url: String(url), body: options.body }));
      return { ok: true, json: async () => ({ status: 'approved' }) };
    };
    const { checkPhoneVerification } = await import('./src/sms.js');
    console.log(JSON.stringify({ approved: await checkPhoneVerification('442079460958', '123456') }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/test-twilio-verify-check',
      JWT_SECRET: 'test-secret',
      SMS_PROVIDER: 'twilio-verify',
      TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
      TWILIO_AUTH_TOKEN: 'test-auth-token',
      TWILIO_VERIFY_SERVICE_SID: `VA${'b'.repeat(32)}`,
    },
  });
  assert.equal(child.status, 0, child.stderr);
  const [requestLine, resultLine] = child.stdout.trim().split(/\r?\n/);
  const request = JSON.parse(requestLine);
  assert.equal(request.url, `https://verify.twilio.com/v2/Services/VA${'b'.repeat(32)}/VerificationCheck`);
  const body = new URLSearchParams(request.body);
  assert.equal(body.get('To'), '+442079460958');
  assert.equal(body.get('Code'), '123456');
  assert.deepEqual(JSON.parse(resultLine), { approved: true });
});

test('SendGrid email uses the configured sender and message payload', () => {
  const script = `
    globalThis.fetch = async (url, options) => {
      console.log(JSON.stringify({ url: String(url), authorization: options.headers.Authorization, body: options.body }));
      return { ok: true };
    };
    const { sendEmailOtp } = await import('./src/email.js');
    await sendEmailOtp('person@example.com', '123456');
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/test-email',
      JWT_SECRET: 'test-secret',
      EMAIL_PROVIDER: 'sendgrid',
      SENDGRID_API_KEY: 'test-sendgrid-key',
      EMAIL_FROM_ADDRESS: 'noreply@chatimall.example',
      EMAIL_WEBHOOK_URL: '',
    },
  });
  assert.equal(child.status, 0, child.stderr);
  const request = JSON.parse(child.stdout.trim());
  assert.equal(request.url, 'https://api.sendgrid.com/v3/mail/send');
  assert.equal(request.authorization, 'Bearer test-sendgrid-key');
  const body = JSON.parse(request.body);
  assert.deepEqual(body.personalizations[0].to, [{ email: 'person@example.com' }]);
  assert.deepEqual(body.from, { email: 'noreply@chatimall.example', name: 'Chatimall' });
  assert.match(body.content[0].value, /123456/);
});

test('only our own file urls are accepted as media', () => {
  assert.ok(isOwnFileUrl('/api/files/3f2b8c1e-4d5a-4b6c-9d7e-1a2b3c4d5e6f'));
  assert.ok(!isOwnFileUrl('https://evil.example/x.png'));
  assert.ok(!isOwnFileUrl('/api/files/../../etc/passwd'));
  assert.ok(!isOwnFileUrl(null));
});

test('encryption key ids accept only public P-256 JWKs', () => {
  const key = { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43) };
  assert.equal(publicEncryptionKeyId(key), publicEncryptionKeyId(key));
  assert.equal(publicEncryptionKeyId({ ...key, d: 'private' }), null);
  assert.equal(publicEncryptionKeyId({ ...key, crv: 'P-384' }), null);
});

test('previews and serializers', () => {
  assert.equal(previewOf('voice', ''), '🎤 Voice note');
  assert.equal(previewOf('text', 'hi'), 'hi');
  const now = new Date();
  const m = messageJson({ _id: 'a', conversation: 'c', sender: 's', type: 'text', body: 'x', createdAt: now });
  assert.equal(m.conversation_id, 'c');
  assert.equal(m.created_at, now.toISOString());
  const profile = userJson({
    _id: 'u',
    phone: '1',
    email: 'private@example.com',
    emailVerifiedAt: now,
    name: 'N',
    bio: 'b',
    lastSeen: now,
  });
  assert.equal(profile.avatar_url, null);
  assert.equal(Object.hasOwn(profile, 'email'), false);
  const privateProfile = privateProfileJson({
    _id: 'u',
    phone: '1',
    email: 'private@example.com',
    emailVerifiedAt: now,
    name: 'N',
    bio: 'b',
    lastSeen: now,
  });
  assert.equal(privateProfile.email, 'private@example.com');
  assert.equal(privateProfile.email_verified, true);
});

test('CORS origin checker: exact, wildcard, empty list, no origin', () => {
  const open = makeOriginChecker([]);
  assert.ok(open('https://anything.example'));

  const check = makeOriginChecker(['https://chatimall.vercel.app/', 'https://*.vercel.app', 'https://localhost']);
  assert.ok(check('https://chatimall.vercel.app'));
  assert.ok(check('https://chatimall-git-main-team.vercel.app'));
  assert.ok(check('https://localhost'));
  assert.ok(check(undefined)); // native app / curl
  assert.ok(!check('https://evil.example'));
  assert.ok(!check('https://vercel.app.evil.example'));
  assert.ok(!check('http://chatimall.vercel.app')); // wrong scheme
});

test('parseWatchUrl: TikTok links', () => {
  assert.deepEqual(parseWatchUrl('https://www.tiktok.com/@user/video/7312345678901234567'), {
    platform: 'tiktok',
    videoId: '7312345678901234567',
  });
  assert.deepEqual(parseWatchUrl('https://tiktok.com/@user/video/123'), { platform: 'tiktok', videoId: '123' });
  assert.equal(parseWatchUrl('https://www.tiktok.com/@user'), null); // profile, not a video
  assert.equal(parseWatchUrl('https://vm.tiktok.com/ZMabc123/'), null); // short link — not resolvable without a fetch
});

test('parseWatchUrl: YouTube links', () => {
  assert.deepEqual(parseWatchUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), {
    platform: 'youtube',
    videoId: 'dQw4w9WgXcQ',
  });
  assert.deepEqual(parseWatchUrl('https://youtu.be/dQw4w9WgXcQ'), { platform: 'youtube', videoId: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseWatchUrl('https://www.youtube.com/shorts/abc123XYZ_-'), {
    platform: 'youtube',
    videoId: 'abc123XYZ_-',
  });
  assert.equal(parseWatchUrl('https://www.youtube.com/'), null);
});

test('parseWatchUrl: rejects everything else', () => {
  assert.equal(parseWatchUrl('https://example.com/video/123'), null);
  assert.equal(parseWatchUrl('not a url'), null);
  assert.equal(parseWatchUrl(''), null);
  assert.equal(parseWatchUrl(null), null);
  assert.equal(parseWatchUrl(undefined), null);
});
