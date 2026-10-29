// Makes sure the Swagger docs and the real routes never drift apart.
// Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/test-docs';
process.env.JWT_SECRET ||= 'test-secret-for-docs-check';

const { createApp } = await import('../src/app.js');
const { swaggerSpec } = await import('../src/swagger.js');

/** All "METHOD /path/{param}" routes that Express really serves. */
function listRoutes(app) {
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          out.push(`${method.toUpperCase()} ${prefix}${layer.route.path}`);
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        const mount = layer.regexp.source
          .replace('^\\/', '/')
          .replace('\\/?(?=\\/|$)', '')
          .replace(/\\\//g, '/');
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  walk(app._router.stack, '');
  return out
    .map((r) => {
      const formatted = r.replace(/:(\w+)/g, '{$1}');
      return formatted.endsWith(' /') ? formatted : formatted.replace(/\/$/, '');
    })
    .filter((r) => !r.includes('/api/docs'));
}

/** All "METHOD /path/{param}" operations in the Swagger spec. */
function listDocumented(spec) {
  const out = [];
  for (const [p, ops] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(ops)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) out.push(`${method.toUpperCase()} ${p}`);
    }
  }
  return out;
}

const { app } = createApp();
const real = listRoutes(app);
const documented = listDocumented(swaggerSpec);

test('every real route is documented in Swagger', () => {
  const missing = real.filter((r) => !documented.includes(r));
  assert.deepEqual(missing, [], `Undocumented routes:\n${missing.join('\n')}`);
});

test('Swagger does not describe routes that do not exist', () => {
  const stale = documented.filter((r) => !real.includes(r));
  assert.deepEqual(stale, [], `Documented but missing routes:\n${stale.join('\n')}`);
});

test('every $ref in the spec points to something that exists', () => {
  const text = JSON.stringify(swaggerSpec);
  const refs = [...text.matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 10);
  for (const ref of refs) {
    let node = swaggerSpec;
    for (const part of ref.split('/')) node = node?.[part];
    assert.ok(node, `Broken $ref: #/${ref}`);
  }
});

test('public endpoints have no lock, private ones need the bearer token', () => {
  for (const [method, path] of [
    ['get', '/'],
    ['post', '/api/auth/otp/request'],
    ['post', '/api/auth/otp/verify'],
    ['post', '/api/auth/otp/email/request'],
    ['post', '/api/auth/otp/email/verify'],
    ['post', '/api/auth/phone/recovery/request'],
    ['post', '/api/auth/phone/recovery/verify'],
    ['get', '/api/health'],
    ['get', '/api/files/{key}'],
  ]) {
    assert.deepEqual(swaggerSpec.paths[path][method].security, [], `${method} ${path} should be public`);
  }
  assert.equal(swaggerSpec.paths['/api/chats'].get.security, undefined); // inherits the global bearerAuth
  assert.deepEqual(swaggerSpec.security, [{ bearerAuth: [] }]);
});

test('root endpoint returns backend status and health URL', async () => {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: 'Chatimall API',
      message: 'Backend is running. Use the frontend app to access Chatimall.',
      health: '/api/health',
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('bulk account reset rejects unauthenticated requests', async () => {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/reset/non-admin-users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'RESET NON-ADMIN DATA' }),
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('device-link endpoints validate requests and require an authenticated approver', async () => {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const invalidStart = await fetch(`${baseUrl}/api/devices/link/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'desktop' }),
    });
    assert.equal(invalidStart.status, 400);

    const invalidStatus = await fetch(`${baseUrl}/api/devices/link/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ link_id: 'invalid', secret: 'invalid' }),
    });
    assert.equal(invalidStatus.status, 404);

    const unauthenticatedApproval = await fetch(`${baseUrl}/api/devices/link/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ link_id: 'invalid', secret: 'invalid' }),
    });
    assert.equal(unauthenticatedApproval.status, 401);

    const unauthenticatedCodeApproval = await fetch(`${baseUrl}/api/devices/link/approve-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '123456789' }),
    });
    assert.equal(unauthenticatedCodeApproval.status, 401);

    const invalidEmailRequest = await fetch(`${baseUrl}/api/auth/email/otp/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    assert.equal(invalidEmailRequest.status, 400);

    const invalidEmailVerification = await fetch(`${baseUrl}/api/auth/email/otp/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', code: '123456' }),
    });
    assert.equal(invalidEmailVerification.status, 400);

    const invalidPhoneEmailRequest = await fetch(`${baseUrl}/api/auth/otp/email/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: 'invalid', email: 'not-an-email' }),
    });
    assert.equal(invalidPhoneEmailRequest.status, 400);

    const invalidPhoneEmailVerification = await fetch(`${baseUrl}/api/auth/otp/email/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: 'invalid', email: 'not-an-email', code: '123456' }),
    });
    assert.equal(invalidPhoneEmailVerification.status, 400);

    const invalidPhoneRecoveryRequest = await fetch(`${baseUrl}/api/auth/phone/recovery/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: 'invalid' }),
    });
    assert.equal(invalidPhoneRecoveryRequest.status, 400);

    const invalidPhoneRecoveryVerification = await fetch(`${baseUrl}/api/auth/phone/recovery/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: 'invalid', code: '123456' }),
    });
    assert.equal(invalidPhoneRecoveryVerification.status, 400);

    const unauthenticatedEmailLink = await fetch(`${baseUrl}/api/me/email/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' }),
    });
    assert.equal(unauthenticatedEmailLink.status, 401);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
