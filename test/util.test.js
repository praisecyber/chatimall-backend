import test from 'node:test';
import assert from 'node:assert/strict';
import { hashOtp, isOwnFileUrl, makeOriginChecker, normalizePhone, parseWatchUrl, previewOf, publicEncryptionKeyId, safeEqual } from '../src/util.js';
import { messageJson, userJson } from '../src/serialize.js';

test('normalizePhone strips formatting and rejects junk', () => {
  assert.equal(normalizePhone('+1 (555) 123-4567'), '15551234567');
  assert.equal(normalizePhone('12'), null);
  assert.equal(normalizePhone('1'.repeat(16)), null);
  assert.equal(normalizePhone(undefined), null);
});

test('otp hashing is deterministic and phone/code specific', () => {
  const a = hashOtp('s', '1555', '123456');
  assert.equal(a, hashOtp('s', '1555', '123456'));
  assert.notEqual(a, hashOtp('s', '1555', '123457'));
  assert.notEqual(a, hashOtp('s', '1556', '123456'));
  assert.ok(safeEqual(a, a));
  assert.ok(!safeEqual(a, 'short'));
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
  assert.equal(userJson({ _id: 'u', phone: '1', name: 'N', bio: 'b', lastSeen: now }).avatar_url, null);
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
