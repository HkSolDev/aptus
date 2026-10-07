import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import Fastify, { type LightMyRequestResponse } from 'fastify';
import { createAuth, type AppAuth } from '../src/auth/auth.js';
import { registerAuthRoutes } from '../src/auth/routes.js';
import { authDatabase } from './helpers/auth-database.js';
import { mockGoogle } from './helpers/google-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const config = {
  origin: 'https://aptus.example',
  secret: 'fictional-test-only-secret-not-for-production-0123456789',
  googleClientId: 'example.apps.googleusercontent.com',
  googleClientSecret: 'fictional-client-secret',
};

function cookies(response: LightMyRequestResponse) {
  const value = response.headers['set-cookie'];
  return (
    Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  )
    .map((entry) => entry.split(';')[0])
    .join('; ');
}

async function protectedApp(t: TestContext, auth: AppAuth) {
  // Load inside tests so unavailable database checks still report explicit skips.
  const { requireSession } = await import('../src/auth/require-session.js');
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  let handlerCalls = 0;
  app.route({
    method: ['GET', 'POST'],
    url: '/private/:userId',
    preHandler: requireSession(auth),
    handler: (request) => {
      handlerCalls += 1;
      return { accountId: Reflect.get(request, 'authUserId') };
    },
  });
  return { app, calls: () => handlerCalls };
}

function safeFailure(
  response: LightMyRequestResponse,
  status: number,
  privateValues: string[] = [],
) {
  assert.equal(response.statusCode, status);
  const body: unknown = response.json();
  assert.ok(body && typeof body === 'object' && 'error' in body);
  assert.equal(typeof body.error, 'string');
  if (status === 401) assert.equal(body.error, 'Please sign in again.');
  else assert.match(String(body.error), /temporarily|unavailable|try again/i);
  const output = response.body + JSON.stringify(response.headers);
  for (const value of privateValues.filter(Boolean)) {
    assert.ok(
      !output.includes(value),
      'Error response exposed a private value.',
    );
  }
  assert.doesNotMatch(
    output,
    /session_token|access_token|refresh_token|"(?:token|cookie|stack|path)"|Prisma|AuthSession|UnavailableSession|node_modules|file:\/\/|\/Users\/|\/private\/|[A-Z]:\\|\bat .+\.(?:ts|js|mjs):\d+/i,
  );
}

await test('missing session returns safe 401 and never executes the handler', async (t) => {
  const { app, calls } = await protectedApp(t, createAuth(config));
  for (const method of ['GET', 'POST'] as const) {
    const response = await app.inject({
      method,
      url: '/private/fictional-other-account?userId=fictional-other-account',
      headers: {
        origin: config.origin,
        'x-user-id': 'fictional-other-account',
      },
      ...(method === 'POST'
        ? { payload: { userId: 'fictional-other-account' } }
        : {}),
    });
    safeFailure(response, 401, ['fictional-other-account']);
    assert.equal(calls(), 0);
  }
});

await test(
  'session guard verifies real cookies against disposable PostgreSQL storage',
  {
    skip:
      !databaseUrl &&
      'Requires TEST_DATABASE_URL; creates and removes an isolated schema',
  },
  async (t) => {
    if (!databaseUrl) throw new Error('Missing test database.');
    const google = mockGoogle(t, config.googleClientId);
    const { database, client } = await authDatabase(t, databaseUrl);
    const auth = createAuth(config, database);
    const { app, calls } = await protectedApp(t, auth);
    registerAuthRoutes(app, auth);

    const start = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin: config.origin },
      payload: { provider: 'google' },
    });
    assert.equal(start.statusCode, 200);
    const redirect: { url: string } = start.json();
    const url = new URL(redirect.url);
    google.nonce = url.searchParams.get('nonce') ?? '';
    google.challenge = url.searchParams.get('code_challenge') ?? '';
    const login = await app.inject({
      url: `/api/auth/callback/google?code=fictional-code&state=${encodeURIComponent(url.searchParams.get('state') ?? '')}`,
      headers: { cookie: cookies(start) },
    });
    assert.equal(login.statusCode, 302);
    assert.equal(login.headers.location, `${config.origin}/`);
    const cookie = cookies(login);
    const account = await database.authUser.findFirstOrThrow();
    const session = await database.authSession.findFirstOrThrow();
    assert.equal(session.userId, account.id);
    const privateValues = [cookie, session.token];
    const validExpiry = new Date(Date.now() + 5 * 86400_000);
    const setExpiry = (expiresAt: Date) =>
      database.authSession.update({
        where: { id: session.id },
        data: { expiresAt },
      });
    const request = () =>
      app.inject({ url: '/private/ignored', headers: { cookie } });

    await t.test(
      'valid session reaches the handler with the Aptus account ID',
      async () => {
        const before = calls();
        const response = await request();
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), { accountId: account.id });
        assert.equal(calls(), before + 1);
      },
    );

    await t.test(
      'body, query, path and header user IDs cannot replace verified identity',
      async () => {
        const other = await database.authUser.create({
          data: { name: 'Other Learner', email: 'other@example.invalid' },
        });
        const before = calls();
        const response = await app.inject({
          method: 'POST',
          url: `/private/${other.id}?userId=${other.id}&authUserId=${other.id}`,
          headers: {
            cookie,
            origin: config.origin,
            'x-user-id': other.id,
            'x-auth-user-id': other.id,
          },
          payload: {
            userId: other.id,
            authUserId: other.id,
            accountId: other.id,
          },
        });
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), { accountId: account.id });
        assert.equal(calls(), before + 1);
      },
    );

    await t.test(
      'GET and POST verification never renew a session due for renewal',
      async () => {
        await setExpiry(validExpiry);
        const before = await database.authSession.findUniqueOrThrow({
          where: { id: session.id },
        });
        for (const method of ['GET', 'POST'] as const) {
          const response = await app.inject({
            method,
            url: '/private/ignored',
            headers: { cookie, origin: config.origin },
            ...(method === 'POST' ? { payload: {} } : {}),
          });
          assert.equal(response.statusCode, 200);
          assert.deepEqual(response.json(), { accountId: account.id });
          assert.equal(response.headers['set-cookie'], undefined);
          const after = await database.authSession.findUniqueOrThrow({
            where: { id: session.id },
          });
          assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime());
          assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
        }
      },
    );

    await t.test(
      'tampered signature is rejected while its database session remains valid',
      async () => {
        const match = cookie.match(
          /(?:^|; )([^=]*aptus\.session_token)=([^;]+)/,
        );
        assert.ok(
          match,
          'Login must issue the existing signed session cookie.',
        );
        const signed = decodeURIComponent(match[2]);
        assert.ok(
          signed.includes('.'),
          'Session cookie must have a signature.',
        );
        const tampered = signed.replace(
          /\.(.)/,
          (_match, first: string) => `.${first === 'A' ? 'B' : 'A'}`,
        );
        const badCookie = `${match[1]}=${encodeURIComponent(tampered)}`;
        const before = calls();
        safeFailure(
          await app.inject({
            url: '/private/ignored',
            headers: { cookie: badCookie },
          }),
          401,
          [...privateValues, badCookie, signed, tampered],
        );
        assert.equal(calls(), before);
        assert.equal((await request()).statusCode, 200);
      },
    );

    for (const [name, offset] of [
      ['expired', -1],
      ['expiring exactly now', 0],
    ] as const) {
      await t.test(
        `${name} session returns 401 without executing the handler`,
        async (boundary) => {
          const now = Date.now();
          await setExpiry(new Date(now + offset));
          // Freeze only Date: real cookie verification and PostgreSQL reads still run.
          boundary.mock.timers.enable({ apis: ['Date'], now });
          const before = calls();
          try {
            safeFailure(await request(), 401, privateValues);
            assert.equal(calls(), before);
          } finally {
            boundary.mock.timers.reset();
            // Expired-session cleanup may delete the row; restore only this fixture.
            await database.authSession.upsert({
              where: { id: session.id },
              update: { expiresAt: validExpiry },
              create: { ...session, expiresAt: validExpiry },
            });
          }
        },
      );
    }

    await t.test(
      'database failure returns safe readable 503 without executing the handler',
      async () => {
        const before = calls();
        await client.query(
          'ALTER TABLE "AuthSession" RENAME TO "UnavailableSession"',
        );
        try {
          safeFailure(await request(), 503, privateValues);
          assert.equal(calls(), before);
        } finally {
          await client.query(
            'ALTER TABLE "UnavailableSession" RENAME TO "AuthSession"',
          );
        }
      },
    );

    await t.test(
      'logout revocation rejects the copied cookie without executing the handler',
      async () => {
        assert.equal((await request()).statusCode, 200);
        const logout = await app.inject({
          method: 'POST',
          url: '/api/auth/sign-out',
          headers: { cookie, origin: config.origin },
          payload: {},
        });
        assert.equal(logout.statusCode, 200);
        assert.equal(await database.authSession.count(), 0);
        const before = calls();
        safeFailure(await request(), 401, privateValues);
        assert.equal(calls(), before);
      },
    );
  },
);
