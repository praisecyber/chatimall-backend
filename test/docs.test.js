// Makes sure the Swagger docs and the real routes never drift apart.
// Run with:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';

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
    .map((r) => r.replace(/:(\w+)/g, '{$1}').replace(/(.)\/$/, '$1'))
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
  for (const [method, path] of [['post', '/api/auth/otp/request'], ['post', '/api/auth/otp/verify'], ['get', '/api/health'], ['get', '/api/files/{key}']]) {
    assert.deepEqual(swaggerSpec.paths[path][method].security, [], `${method} ${path} should be public`);
  }
  assert.equal(swaggerSpec.paths['/api/chats'].get.security, undefined); // inherits the global bearerAuth
  assert.deepEqual(swaggerSpec.security, [{ bearerAuth: [] }]);
});
