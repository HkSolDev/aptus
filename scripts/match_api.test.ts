import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth/auth.js';
import { prisma } from '../src/db.js';

await test('matching validates input only after origin and session verification', async (t) => {
  const origin = 'https://aptus.example';
  const auth = createAuth({
    origin,
    secret: 'illustrative-test-secret-not-for-production-0123456789',
    googleClientId: 'example.apps.googleusercontent.com',
    googleClientSecret: 'illustrative-client-secret',
  });
  let sessionLookups = 0;
  Object.defineProperty(auth.api, 'getSession', {
    value: ({ headers }: { headers: Headers }) => {
      sessionLookups++;
      return Promise.resolve(
        headers.get('cookie') === 'illustrative-session=valid'
          ? {
              user: { id: 'illustrative-account' },
              session: { expiresAt: new Date(Date.now() + 60_000) },
            }
          : null,
      );
    },
  });
  const original: unknown = Reflect.get(prisma.user, 'upsert');
  let writes = 0;
  Object.defineProperty(prisma.user, 'upsert', {
    configurable: true,
    value: () => {
      writes++;
      return Promise.reject(new Error('Unexpected profile write'));
    },
  });
  t.after(() =>
    Object.defineProperty(prisma.user, 'upsert', {
      configurable: true,
      value: original,
    }),
  );
  const app = buildApp(auth);
  t.after(() => app.close());
  const headers = { origin, cookie: 'illustrative-session=valid' };
  const cases = [
    {
      name: 'missing DOB',
      payload: { educations: [{ level: 'BACHELORS' }] },
      error: 'A valid Date of Birth (dob) is required',
    },
    {
      name: 'invalid DOB',
      payload: { dob: 'invalid-date', educations: [{ level: 'BACHELORS' }] },
      error: 'A valid Date of Birth (dob) is required',
    },
    {
      name: 'empty education',
      payload: { dob: '1998-05-15', educations: [] },
      error: 'At least one education entry is required',
    },
    {
      name: 'invalid education level',
      payload: { dob: '1998-05-15', educations: [{ level: 'INVALID_LEVEL' }] },
      error: 'Invalid education level: INVALID_LEVEL',
    },
  ];
  for (const item of cases) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/match',
      headers,
      payload: item.payload,
    });
    assert.equal(response.statusCode, 400, item.name);
    assert.deepEqual(response.json(), { error: item.error });
  }
  const signedOut = await app.inject({
    method: 'POST',
    url: '/api/match',
    headers: { origin },
    payload: {},
  });
  assert.equal(signedOut.statusCode, 401);
  assert.deepEqual(signedOut.json(), { error: 'Please sign in again.' });
  const beforeWrongOrigin = sessionLookups;
  const wrongOrigin = await app.inject({
    method: 'POST',
    url: '/api/match',
    headers: { ...headers, origin: 'https://other.example' },
    payload: {},
  });
  assert.equal(wrongOrigin.statusCode, 403);
  assert.equal(sessionLookups, beforeWrongOrigin);
  assert.equal(writes, 0);
});
