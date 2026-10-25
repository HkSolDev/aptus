import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { saveJobApi } from '../frontend/saved-jobs-api.js';
import { registerSavedJobsRoutes } from '../src/routes/saved-jobs.js';
import { handleMatch } from '../src/routes/match.js';
import { createAuth } from '../src/auth/auth.js';
import { prisma } from '../src/db.js';

test('browser Save request reaches authenticated storage instead of failing JSON parsing', async (t) => {
  const app = Fastify();
  const auth = createAuth({
    origin: 'https://aptus.example',
    secret: 'fictional-test-only-secret-not-for-production-0123456789',
    googleClientId: 'example.apps.googleusercontent.com',
    googleClientSecret: 'fictional-client-secret',
  });
  t.mock.method(auth.api, 'getSession', async () => ({
    user: { id: 'fixture-account' },
    session: { expiresAt: new Date(Date.now() + 60000) },
  }));
  for (const [target, key, implementation] of [
    [prisma.post, 'findUnique', async () => ({ id: 'fixture-job' })],
    [
      prisma.savedJob,
      'findUniqueOrThrow',
      async () => ({ savedAt: new Date('2026-10-25T00:00:00Z') }),
    ],
    [prisma.savedJob, 'createMany', async () => ({ count: 1 })],
  ] as const) {
    const original = Reflect.get(target, key);
    Object.defineProperty(target, key, {
      configurable: true,
      value: implementation,
    });
    t.after(() =>
      Object.defineProperty(target, key, {
        configurable: true,
        value: original,
      }),
    );
  }
  registerSavedJobsRoutes(app, auth);
  t.after(() => app.close());
  let headers: Headers | undefined;
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, options: RequestInit) => {
      headers = new Headers(options.headers);
      headers.set('origin', 'https://aptus.example');
      const response = await app.inject({
        method: 'PUT',
        url: '/api/saved-jobs/fixture-job',
        headers: Object.fromEntries(headers),
        ...(options.body ? { payload: String(options.body) } : {}),
      });
      assert.equal(response.statusCode, 200, response.body);
      return new Response(response.body, { status: response.statusCode });
    },
  );
  assert.equal(await saveJobApi('fixture-job'), true);
});

test('matching distinguishes missing profile from a storage outage with one read and no writes', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  app.post<{ Body: Parameters<typeof handleMatch>[0]['body'] }>(
    '/match',
    (request, reply) => {
      request.authUserId = 'fixture-account';
      return handleMatch(request, reply);
    },
  );
  const stub = (key: string, implementation: () => Promise<unknown>) => {
    const original = Reflect.get(prisma.user, key);
    const fn = t.mock.fn(implementation);
    Object.defineProperty(prisma.user, key, { configurable: true, value: fn });
    t.after(() =>
      Object.defineProperty(prisma.user, key, {
        configurable: true,
        value: original,
      }),
    );
    return fn;
  };
  const read = stub('findUnique', async () => null);
  const fallback = stub('findUniqueOrThrow', async () => {
    throw new Error('unexpected second query');
  });
  const write = stub('upsert', async () => {
    throw new Error('unexpected write');
  });
  assert.equal(
    (await app.inject({ method: 'POST', url: '/match', payload: {} }))
      .statusCode,
    400,
  );
  read.mock.mockImplementation(async () => {
    throw new Error('fixture storage unavailable');
  });
  const failed = await app.inject({
    method: 'POST',
    url: '/match',
    payload: {},
  });
  assert.equal(failed.statusCode, 503);
  assert.doesNotMatch(failed.body, /fixture storage|save your profile/);
  assert.equal(read.mock.callCount(), 2);
  assert.equal(fallback.mock.callCount(), 0);
  assert.equal(write.mock.callCount(), 0);
});
