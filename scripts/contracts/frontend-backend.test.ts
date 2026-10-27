import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createAuth } from '../../src/auth/auth.js';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { fetchProfile, saveProfileApi } from '../../frontend/profile-api.js';
import { saveJobApi, unsaveJobApi } from '../../frontend/saved-jobs-api.js';
import { contractChecker, stub } from './support.js';

const origin = 'https://aptus.example';
function server(t: TestContext) {
  const auth = createAuth({
    origin,
    secret: 'fictional-contract-secret-not-for-production-0123456789',
    googleClientId: 'example.apps.googleusercontent.com',
    googleClientSecret: 'fictional-client-secret',
  });
  t.mock.method(auth.api, 'getSession', async () => ({
    user: { id: 'contract-account' },
    session: { expiresAt: new Date(Date.now() + 60_000) },
  }));
  const app = buildApp(auth, { AUTH_ENABLED: 'false' });
  t.after(() => app.close());
  return app;
}

test('profile consumer crosses real route validation and serializer, including nulls', async (t) => {
  const app = server(t);
  const check = await contractChecker();
  t.after(() => check.close());
  const payload = {
    dob: '2000-02-29',
    category: null,
    educations: [{ level: 'BACHELORS' as const, marksPercent: null }],
  };
  const row = {
    dob: new Date('2000-02-29T00:00:00Z'),
    category: 'UNSPECIFIED',
    educations: payload.educations,
  };
  stub(
    t,
    prisma.user,
    'upsert',
    async (args: { where: unknown; create: { category: unknown } }) => {
      assert.deepEqual(args.where, { authUserId: 'contract-account' });
      assert.equal(args.create.category, 'UNSPECIFIED');
      return row;
    },
  );
  stub(t, prisma.user, 'findUnique', async (args: { where: unknown }) => {
    assert.deepEqual(args.where, { authUserId: 'contract-account' });
    return row;
  });
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, options: RequestInit) => {
      assert.equal(url, '/api/profile');
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      if (body) await check.assert('ProfileInput', body);
      const result = await app.inject({
        method: options.method === 'PUT' ? 'PUT' : 'GET',
        url,
        headers: {
          ...Object.fromEntries(new Headers(options.headers)),
          origin,
        },
        ...(body ? { payload: body } : {}),
      });
      assert.equal(result.statusCode, 200, result.body);
      await check.assert('ProfileResponse', result.json());
      return new Response(result.body, { status: result.statusCode });
    },
  );
  assert.deepEqual(await saveProfileApi(payload), payload);
  assert.deepEqual(await fetchProfile(), payload);
  assert.equal(
    await check.accepts('ProfileInput', { ...payload, userId: 'other' }),
    false,
  );
  assert.equal(
    await check.accepts('ProfileInput', { ...payload, dob: null }),
    false,
  );
});

test('Save and Remove clients consume real route receipts and preserve account ownership', async (t) => {
  const app = server(t);
  const check = await contractChecker();
  t.after(() => check.close());
  stub(t, prisma.post, 'findUnique', async () => ({ id: 'contract-job' }));
  stub(
    t,
    prisma.savedJob,
    'upsert',
    async (args: { where: { authUserId_postId: unknown } }) => {
      assert.deepEqual(args.where.authUserId_postId, {
        authUserId: 'contract-account',
        postId: 'contract-job',
      });
      return { savedAt: new Date('2026-10-27T00:00:00Z') };
    },
  );
  stub(t, prisma.savedJob, 'deleteMany', async (args: { where: unknown }) => {
    assert.deepEqual(args.where, {
      authUserId: 'contract-account',
      postId: 'contract-job',
    });
    return { count: 0 };
  });
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string, options: RequestInit) => {
      assert.equal(url, '/api/saved-jobs/contract-job');
      const result = await app.inject({
        method: options.method === 'PUT' ? 'PUT' : 'DELETE',
        url,
        headers: {
          ...Object.fromEntries(new Headers(options.headers)),
          origin,
        },
      });
      assert.equal(result.statusCode, 200, result.body);
      await check.assert(
        options.method === 'PUT' ? 'SaveResponse' : 'UnsaveResponse',
        result.json(),
      );
      return new Response(result.body, { status: result.statusCode });
    },
  );
  assert.equal(await saveJobApi('contract-job'), true);
  assert.equal(await unsaveJobApi('contract-job'), false);
});

test('origin rejection and forged ownership cannot reach profile storage', async (t) => {
  const app = server(t);
  const write = stub(t, prisma.user, 'upsert', async () => {
    throw new Error('Storage must not be reached');
  });
  const body = { dob: '2000-02-29', educations: [{ level: 'TENTH' }] };
  const rejected = await app.inject({
    method: 'PUT',
    url: '/api/profile',
    headers: { origin: 'https://other.example' },
    payload: body,
  });
  assert.equal(rejected.statusCode, 403);
  const forged = await app.inject({
    method: 'PUT',
    url: '/api/profile',
    headers: { origin },
    payload: { ...body, userId: 'other-account' },
  });
  assert.equal(forged.statusCode, 400);
  assert.equal(write.mock.callCount(), 0);
});
