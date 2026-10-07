import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth/auth.js';

const origin = 'https://aptus.example';
const config = {
  origin,
  secret: 'fictional-test-only-secret-not-for-production-0123456789',
  googleClientId: 'example.apps.googleusercontent.com',
  googleClientSecret: 'fictional-client-secret',
};

await test('profile updates reject missing or mismatched origins before session access', async (t) => {
  const auth = createAuth(config);
  const sessionLookup = t.mock.method(auth.api, 'getSession', () => {
    throw new Error('Session lookup must not run for an untrusted origin.');
  });
  const app = buildApp(auth);
  t.after(() => app.close());
  for (const suppliedOrigin of [
    undefined,
    'null',
    'https://attacker.example',
    'https://sub.aptus.example',
    'http://aptus.example',
    'https://aptus.example:8443',
    'https://aptus.example.attacker.example',
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/match',
      payload: {},
      headers: suppliedOrigin ? { origin: suppliedOrigin } : {},
    });
    assert.equal(response.statusCode, 403);
    assert.match(response.json<{ error: string }>().error, /Refresh Aptus/);
    assert.equal(response.headers['set-cookie'], undefined);
  }
  assert.equal(sessionLookup.mock.callCount(), 0);
});

await test('correct origin proceeds to authentication; public health needs no origin', async (t) => {
  const app = buildApp(createAuth(config));
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/match',
    payload: {},
    headers: { origin },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(
    response.json<{ error: string }>().error,
    'Please sign in again.',
  );
  assert.equal((await app.inject('/health')).statusCode, 200);
});
