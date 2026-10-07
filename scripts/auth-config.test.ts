import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAuthConfig } from '../src/auth/config.js';

const example = {
  AUTH_ENABLED: 'true',
  BETTER_AUTH_URL: 'http://localhost:8080',
  BETTER_AUTH_SECRET:
    'fictional-test-only-secret-not-for-production-0123456789',
  GOOGLE_CLIENT_ID: 'example.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'fictional-client-secret',
};

await test('auth stays disabled until explicitly enabled', () => {
  assert.equal(readAuthConfig({}), null);
  assert.equal(readAuthConfig({ AUTH_ENABLED: 'false' }), null);
  assert.throws(() => readAuthConfig({ AUTH_ENABLED: 'yes' }));
});

await test('enabled auth requires complete backend configuration', () => {
  for (const key of [
    'BETTER_AUTH_URL',
    'BETTER_AUTH_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
  ]) {
    assert.throws(() => readAuthConfig({ ...example, [key]: '' }));
  }
  assert.equal(readAuthConfig(example)?.origin, example.BETTER_AUTH_URL);
  assert.throws(() =>
    readAuthConfig({ ...example, BETTER_AUTH_SECRET: 'short' }),
  );
});

await test('origin must be exact and HTTPS outside local development', () => {
  for (const origin of [
    'http://example.com',
    'https://example.com/path',
    'https://example.com?returnTo=evil',
    'https://user:pass@example.com',
    'https://example.com/#fragment',
  ]) {
    assert.throws(() =>
      readAuthConfig({ ...example, BETTER_AUTH_URL: origin }),
    );
  }
  assert.throws(() => readAuthConfig({ ...example, NODE_ENV: 'production' }));
  assert.equal(
    readAuthConfig({
      ...example,
      BETTER_AUTH_URL: 'https://aptus.example',
      NODE_ENV: 'production',
    })?.origin,
    'https://aptus.example',
  );
});
