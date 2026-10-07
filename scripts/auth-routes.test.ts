import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth/auth.js';

const config = {
  origin: 'http://localhost:8080',
  secret: 'fictional-test-only-secret-not-for-production-0123456789',
  googleClientId: 'example.apps.googleusercontent.com',
  googleClientSecret: 'fictional-client-secret',
};

await test('auth mutations reject missing or foreign origins before any storage access', async (t) => {
  const app = buildApp(createAuth(config));
  t.after(() => app.close());
  for (const url of [
    '/api/auth/sign-in/social',
    '/api/auth/sign-out',
    '/api/auth/get-session',
  ]) {
    for (const origin of [undefined, 'https://attacker.example', 'null']) {
      const response = await app.inject({
        method: 'POST',
        url,
        payload: url.endsWith('social') ? { provider: 'google' } : {},
        headers: origin ? { origin } : {},
      });
      assert.equal(response.statusCode, 403);
      assert.equal(response.headers['set-cookie'], undefined);
    }
  }
});

await test('direct calls cannot select extra providers, ID-token login or return destinations', async (t) => {
  const app = buildApp(createAuth(config));
  t.after(() => app.close());
  for (const payload of [
    { provider: 'github' },
    { provider: 'google', callbackURL: 'https://attacker.example' },
    { provider: 'google', idToken: { token: 'fictional' } },
    { provider: 'google', scopes: ['contacts'] },
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      payload,
      headers: { origin: config.origin },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.headers['set-cookie'], undefined);
  }
  for (const url of [
    '/api/auth/link-social',
    '/api/auth/get-access-token',
    '/api/auth/revoke-sessions',
    '/api/auth/sign-up/email',
  ]) {
    const response = await app.inject({
      method: 'POST',
      url,
      payload: {},
      headers: { origin: config.origin },
    });
    assert.equal(response.statusCode, 404);
  }
});

await test('auth errors are readable and never echo callback contents', async (t) => {
  const app = buildApp(createAuth(config));
  t.after(() => app.close());
  const response = await app.inject(
    '/auth/error?error_description=fictional-private-value',
  );
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /start again/i);
  assert.doesNotMatch(response.body, /fictional-private-value/);
});
