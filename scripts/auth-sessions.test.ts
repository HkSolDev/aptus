import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth/auth.js';
import { authDatabase } from './helpers/auth-database.js';
import { mockGoogle } from './helpers/google-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const config = {
  origin: 'https://aptus.example',
  secret: 'fictional-test-only-secret-not-for-production-0123456789',
  googleClientId: 'example.apps.googleusercontent.com',
  googleClientSecret: 'fictional-client-secret',
};
const cookies = (headers: Record<string, unknown>) => {
  const value = headers['set-cookie'];
  return (
    Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  )
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.split(';')[0])
    .join('; ');
};

await test(
  'Google redirect and PostgreSQL session lifecycle',
  {
    skip:
      !databaseUrl &&
      'Requires TEST_DATABASE_URL; creates and removes an isolated schema',
  },
  async (t) => {
    if (!databaseUrl) throw new Error('Missing test database.');
    const google = mockGoogle(t, config.googleClientId);
    const errorLog = t.mock.method(console, 'error', () => undefined);
    const { database, client } = await authDatabase(t, databaseUrl);
    const app = buildApp(createAuth(config, database));
    t.after(() => app.close());
    let attemptNumber = 0;
    const start = async () => {
      // Independent identity scenarios use distinct peers; throttling is tested separately.
      const peerIp = `203.0.113.${++attemptNumber}`;
      const response = await app.inject({
        method: 'POST',
        remoteAddress: peerIp,
        url: '/api/auth/sign-in/social',
        headers: {
          origin: config.origin,
          host: 'attacker.example',
          'x-aptus-peer-ip': '203.0.113.42',
        },
        payload: { provider: 'google' },
      });
      assert.equal(response.statusCode, 200);
      const body: { url: string } = response.json();
      const url = new URL(body.url);
      assert.equal(url.origin, 'https://accounts.google.com');
      assert.equal(
        url.searchParams.get('redirect_uri'),
        `${config.origin}/api/auth/callback/google`,
      );
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(url.searchParams.get('code_challenge'));
      assert.ok(url.searchParams.get('nonce'));
      assert.equal(url.searchParams.get('access_type'), 'online');
      google.nonce = url.searchParams.get('nonce') ?? '';
      google.challenge = url.searchParams.get('code_challenge') ?? '';
      return {
        peerIp,
        state: url.searchParams.get('state') ?? '',
        cookie: cookies(response.headers),
      };
    };
    const callback = (
      attempt: Awaited<ReturnType<typeof start>>,
      cookie = attempt.cookie,
    ) =>
      app.inject({
        method: 'GET',
        remoteAddress: attempt.peerIp,
        url: `/api/auth/callback/google?code=fictional-code&state=${encodeURIComponent(attempt.state)}`,
        headers: { cookie },
      });

    await t.test(
      'browser mismatch, expired attempts and invalid identity tokens do not create accounts',
      async () => {
        const attempt = await start();
        const mismatch = await callback(attempt, '');
        assert.equal(mismatch.headers.location, `${config.origin}/auth/error`);
        assert.equal(await database.authUser.count(), 0);
        for (const fault of [
          'invalidNonce',
          'invalidAudience',
          'invalidIssuer',
          'expiredToken',
          'invalidSignature',
        ] as const) {
          google[fault] = true;
          const invalid = await callback(await start());
          assert.equal(
            invalid.headers.location,
            `${config.origin}/auth/error`,
            fault,
          );
          assert.equal(await database.authUser.count(), 0, fault);
          google[fault] = false;
        }
        const expired = await start();
        await database.authVerification.updateMany({
          data: { expiresAt: new Date(0) },
        });
        assert.equal(
          (await callback(expired)).headers.location,
          `${config.origin}/auth/error`,
        );
        assert.equal(await database.authUser.count(), 0);
      },
    );

    let cookie = '';
    await t.test(
      'valid callback persists one identity/session and discards unused Google credentials',
      async () => {
        const attempt = await start();
        const response = await callback(attempt);
        assert.equal(response.statusCode, 302);
        assert.equal(response.headers.location, `${config.origin}/`);
        cookie = cookies(response.headers);
        assert.match(cookie, /aptus.session_token/);
        assert.match(
          JSON.stringify(response.headers['set-cookie']),
          /HttpOnly/,
        );
        assert.match(JSON.stringify(response.headers['set-cookie']), /Secure/);
        assert.match(
          JSON.stringify(response.headers['set-cookie']),
          /SameSite=Lax/i,
        );
        assert.equal(await database.authUser.count(), 1);
        assert.equal(await database.authSession.count(), 1);
        const account = await database.authAccount.findFirstOrThrow();
        assert.equal(account.accountId, google.subject);
        assert.equal(account.accessToken, null);
        assert.equal(account.refreshToken, null);
        assert.equal(account.idToken, null);
        const session = await database.authSession.findFirstOrThrow();
        assert.ok(
          Math.abs(session.expiresAt.getTime() - Date.now() - 7 * 86400_000) <
            5000,
        );
        assert.equal(session.ipAddress, null);
        assert.equal(session.userAgent, null);
        assert.equal(
          (await callback(attempt)).headers.location,
          `${config.origin}/auth/error`,
        );
        assert.equal(await database.authSession.count(), 1);
      },
    );

    await t.test(
      'session JSON excludes bearer data; GET is read-only and POST renews daily',
      async () => {
        const fresh = await database.authSession.findFirstOrThrow();
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/auth/get-session',
              headers: { cookie, origin: config.origin },
              payload: {},
            })
          ).statusCode,
          200,
        );
        assert.equal(
          (await database.authSession.findFirstOrThrow()).expiresAt.getTime(),
          fresh.expiresAt.getTime(),
        );
        await database.authSession.updateMany({
          data: { expiresAt: new Date(Date.now() + 5 * 86400_000) },
        });
        const before = await database.authSession.findFirstOrThrow();
        const read = await app.inject({
          url: '/api/auth/get-session',
          headers: { cookie },
        });
        assert.equal(read.statusCode, 200);
        assert.doesNotMatch(read.body, /token|email|ipAddress|userAgent/);
        assert.equal(
          (await database.authSession.findFirstOrThrow()).expiresAt.getTime(),
          before.expiresAt.getTime(),
        );
        const renewed = await app.inject({
          method: 'POST',
          url: '/api/auth/get-session',
          headers: { cookie, origin: config.origin },
          payload: {},
        });
        assert.equal(renewed.statusCode, 200);
        assert.ok(
          (await database.authSession.findFirstOrThrow()).expiresAt.getTime() >
            Date.now() + 6 * 86400_000,
        );
        assert.ok(
          Math.abs(
            (
              await database.authSession.findFirstOrThrow()
            ).expiresAt.getTime() -
              Date.now() -
              7 * 86400_000,
          ) < 5000,
        );
        assert.ok(renewed.headers['set-cookie']);
      },
    );

    await t.test(
      'logout CSRF failure keeps the session; valid logout rejects the copied cookie',
      async () => {
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/auth/sign-out',
              payload: {},
              headers: { cookie },
            })
          ).statusCode,
          403,
        );
        assert.equal(await database.authSession.count(), 1);
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/auth/sign-out',
              payload: {},
              headers: { cookie, origin: config.origin },
            })
          ).statusCode,
          200,
        );
        assert.equal(await database.authSession.count(), 0);
        assert.equal(
          (
            await app.inject({
              url: '/api/auth/get-session',
              headers: { cookie },
            })
          ).statusCode,
          401,
        );
        assert.equal(await database.authAccount.count(), 1);
      },
    );

    await t.test(
      'expired sessions cannot renew; unavailable storage never reports successful logout',
      async () => {
        cookie = cookies((await callback(await start())).headers);
        await database.authSession.updateMany({
          data: { expiresAt: new Date(0) },
        });
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/auth/get-session',
              payload: {},
              headers: { cookie, origin: config.origin },
            })
          ).statusCode,
          401,
        );
        cookie = cookies((await callback(await start())).headers);
        await client.query(
          'ALTER TABLE "AuthSession" RENAME TO "UnavailableSession"',
        );
        try {
          assert.equal(
            (
              await app.inject({
                url: '/api/auth/get-session',
                headers: { cookie },
              })
            ).statusCode,
            503,
          );
          const logout = await app.inject({
            method: 'POST',
            url: '/api/auth/sign-out',
            payload: {},
            headers: { cookie, origin: config.origin },
          });
          assert.equal(logout.statusCode, 503);
          assert.equal(logout.headers['set-cookie'], undefined);
          assert.equal(
            (await callback(await start())).headers.location,
            `${config.origin}/auth/error`,
          );
        } finally {
          await client.query(
            'ALTER TABLE "UnavailableSession" RENAME TO "AuthSession"',
          );
        }
      },
    );
    await t.test(
      'repeat login keeps credentials empty; a different subject cannot claim the same email',
      async () => {
        const repeat = await callback(await start());
        assert.equal(repeat.headers.location, `${config.origin}/`);
        assert.equal(await database.authUser.count(), 1);
        assert.equal(await database.authAccount.count(), 1);
        const account = await database.authAccount.findFirstOrThrow();
        assert.equal(account.accessToken, null);
        assert.equal(account.refreshToken, null);
        assert.equal(account.idToken, null);
        const sessions = await database.authSession.count();
        google.subject = 'different-google-subject';
        assert.equal(
          (await callback(await start())).headers.location,
          `${config.origin}/auth/error`,
        );
        assert.equal(await database.authSession.count(), sessions);
        assert.equal(await database.authUser.count(), 1);
        assert.equal(
          (await database.authAccount.findFirstOrThrow()).accountId,
          'fictional-google-subject',
        );
      },
    );
    assert.equal(
      errorLog.mock.callCount(),
      0,
      'Auth failures must not print raw exceptions.',
    );
  },
);
