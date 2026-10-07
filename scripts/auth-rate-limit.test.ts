import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { LightMyRequestResponse } from 'fastify';
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
let sourceNumber = 0;
const nextSource = () => `192.0.2.${++sourceNumber}`;

// Characterize the current policy without inventing or approving Aptus thresholds.
// docs/LEARNING_PLAN.md still marks the exact rates/windows as unapproved.
// References: https://better-auth.com/docs/concepts/rate-limit
// https://github.com/fastify/fastify/blob/v5.12.5/docs/Guides/Testing.md
async function rateLimitedApp(
  t: TestContext,
  database?: Parameters<typeof createAuth>[1],
) {
  const google = mockGoogle(t, config.googleClientId);
  const auth = createAuth(config, database);
  const context = await auth.$context;
  const app = buildApp(auth);
  t.after(() => app.close());
  // Keep bursts within one window without sleeping or replacing the limiter.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const start = (remoteAddress: string) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      remoteAddress,
      headers: { origin: config.origin },
      payload: { provider: 'google' },
    });
  // Missing-state callbacks reach the real limiter, then fail safely without DB/OAuth I/O.
  const callback = (
    remoteAddress: string,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      url: '/api/auth/callback/google?error=access_denied',
      remoteAddress,
      headers,
    });
  return { app, start, callback, google, rateLimit: context.rateLimit };
}

async function exhaust(
  request: () => Promise<LightMyRequestResponse>,
  expectedStatus: number,
  maximumRequests: number,
) {
  let allowed = 0;
  // Use the current global ceiling as a finite probe budget, not a new policy.
  for (let attempt = 0; attempt <= maximumRequests; attempt += 1) {
    const response = await request();
    if (response.statusCode === 429) {
      assert.ok(allowed > 0, 'A fresh source must have an allowed request.');
      return response;
    }
    assert.equal(response.statusCode, expectedStatus);
    allowed += 1;
  }
  assert.fail(
    'The configured request allowance was exceeded without HTTP 429.',
  );
}

function usefulRetryAfter(response: LightMyRequestResponse) {
  assert.equal(response.statusCode, 429);
  const seconds = response.headers['retry-after'];
  assert.ok(
    typeof seconds === 'string' && /^[1-9]\d*$/.test(seconds),
    'HTTP 429 must include Retry-After as positive whole seconds.',
  );
  const body: unknown = response.json();
  assert.ok(body && typeof body === 'object' && 'error' in body);
  assert.equal(typeof body.error, 'string');
  assert.match(String(body.error), /wait|try again/i);
  return Number(seconds);
}

async function reachCooldown(
  t: TestContext,
  request: () => Promise<LightMyRequestResponse>,
  maximumRequests: number,
) {
  let wait = usefulRetryAfter(await exhaust(request, 302, maximumRequests));
  let increased = false;
  for (let attempt = 0; attempt < maximumRequests; attempt += 1) {
    // Follow server-provided timing; no invented penalty or cooldown duration.
    t.mock.timers.setTime(Date.now() + wait * 1000);
    const response = await request();
    if (response.statusCode === 429) {
      const cooldown = usefulRetryAfter(response);
      assert.ok(increased, 'Repeated excess attempts must increase the wait.');
      assert.ok(
        cooldown > wait,
        'Repeated violations must eventually enter a longer cooldown.',
      );
      return { blockedAt: Date.now(), cooldown };
    }
    assert.equal(response.statusCode, 302);
    const nextWait = usefulRetryAfter(await request());
    assert.ok(
      nextWait >= wait,
      'A repeated violation must not shorten the wait.',
    );
    increased ||= nextWait > wait;
    wait = nextWait;
  }
  assert.fail(
    'Repeated excess attempts never entered a temporary cooldown within the configured ceiling.',
  );
}

await test('Google callbacks within the current allowance proceed; excess returns 429 with Retry-After', async (t) => {
  const { callback, rateLimit } = await rateLimitedApp(t);
  const source = nextSource();
  usefulRetryAfter(await exhaust(() => callback(source), 302, rateLimit.max));
});

await test('ignoring the frontend countdown cannot reopen a throttled callback endpoint', async (t) => {
  const { callback, rateLimit } = await rateLimitedApp(t);
  const source = nextSource();
  await exhaust(() => callback(source), 302, rateLimit.max);
  assert.equal((await callback(source)).statusCode, 429);
  assert.equal((await callback(source)).statusCode, 429);
});

await test('a callback burst cannot block a different request source', async (t) => {
  const { callback, rateLimit } = await rateLimitedApp(t);
  const source = nextSource();
  const otherSource = nextSource();
  await exhaust(() => callback(source), 302, rateLimit.max);
  const other = await callback(otherSource);
  assert.equal(other.statusCode, 302);
  assert.equal(other.headers.location, `${config.origin}/auth/error`);
  assert.equal((await callback(source)).statusCode, 429);
});

await test('invented IP headers cannot evade the callback limit for the same peer', async (t) => {
  const { callback, rateLimit } = await rateLimitedApp(t);
  const source = nextSource();
  await exhaust(() => callback(source), 302, rateLimit.max);
  for (const name of [
    'x-forwarded-for',
    'x-real-ip',
    'cf-connecting-ip',
    'x-aptus-peer-ip',
    'forwarded',
  ]) {
    const invented = nextSource();
    const value = name === 'forwarded' ? `for=${invented}` : invented;
    assert.equal((await callback(source, { [name]: value })).statusCode, 429);
  }
});

await test('repeated excess callbacks produce progressively longer waits, then a temporary cooldown', async (t) => {
  const { callback, rateLimit } = await rateLimitedApp(t);
  const source = nextSource();
  const { cooldown } = await reachCooldown(
    t,
    () => callback(source),
    rateLimit.max,
  );
  assert.equal(usefulRetryAfter(await callback(source)), cooldown);
  assert.equal(usefulRetryAfter(await callback(source)), cooldown);
});

await test('the advertised temporary cooldown remains enforced until expiry, then callbacks proceed again', async (t) => {
  const { callback, rateLimit } = await rateLimitedApp(t);
  const source = nextSource();
  const { blockedAt, cooldown } = await reachCooldown(
    t,
    () => callback(source),
    rateLimit.max,
  );
  t.mock.timers.setTime(blockedAt + cooldown * 1000 - 1);
  assert.equal((await callback(source)).statusCode, 429);
  t.mock.timers.setTime(blockedAt + cooldown * 1000);
  const recovered = await callback(source);
  assert.equal(recovered.statusCode, 302);
  assert.equal(recovered.headers.location, `${config.origin}/auth/error`);
});

await test(
  'Google start/callback separation and account access with disposable PostgreSQL',
  {
    skip:
      !databaseUrl &&
      'Requires TEST_DATABASE_URL; creates and removes an isolated schema',
  },
  async (t) => {
    if (!databaseUrl) throw new Error('Missing test database.');
    const { database } = await authDatabase(t, databaseUrl);
    const { app, start, callback, google, rateLimit } = await rateLimitedApp(
      t,
      database,
    );
    const cookieHeader = (response: LightMyRequestResponse) => {
      const value = response.headers['set-cookie'];
      return (
        Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
      )
        .map((entry) => entry.split(';')[0])
        .join('; ');
    };
    const login = async (source: string) => {
      const begin = await start(source);
      assert.equal(begin.statusCode, 200);
      const body: { url: string } = begin.json();
      const url = new URL(body.url);
      google.nonce = url.searchParams.get('nonce') ?? '';
      google.challenge = url.searchParams.get('code_challenge') ?? '';
      const response = await app.inject({
        url: `/api/auth/callback/google?code=fictional-code&state=${encodeURIComponent(url.searchParams.get('state') ?? '')}`,
        remoteAddress: source,
        headers: { cookie: cookieHeader(begin) },
      });
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, `${config.origin}/`);
      return cookieHeader(response);
    };

    await t.test(
      'Google starts within the current allowance succeed; excess has a useful Retry-After',
      async () => {
        const source = nextSource();
        usefulRetryAfter(
          await exhaust(() => start(source), 200, rateLimit.max),
        );
      },
    );

    await t.test(
      'start and callback limits are independent in both directions',
      async () => {
        const startSource = nextSource();
        await exhaust(() => start(startSource), 200, rateLimit.max);
        assert.equal((await callback(startSource)).statusCode, 302);
        const callbackSource = nextSource();
        await exhaust(() => callback(callbackSource), 302, rateLimit.max);
        assert.equal((await start(callbackSource)).statusCode, 200);
      },
    );

    await t.test(
      'one source exhausting starts cannot lock the same Aptus account at another source',
      async () => {
        const source = nextSource();
        const cookie = await login(source);
        const before = await app.inject({
          url: '/api/auth/get-session',
          remoteAddress: source,
          headers: { cookie },
        });
        assert.equal(before.statusCode, 200);
        const original: { user: { id: string } } = before.json();
        await exhaust(() => start(source), 200, rateLimit.max);
        const otherSource = nextSource();
        const otherCookie = await login(otherSource);
        const after = await app.inject({
          url: '/api/auth/get-session',
          remoteAddress: otherSource,
          headers: { cookie: otherCookie },
        });
        assert.equal(after.statusCode, 200);
        const recovered: { user: { id: string } } = after.json();
        assert.equal(recovered.user.id, original.user.id);
        assert.equal((await start(source)).statusCode, 429);
      },
    );

    await t.test(
      'the stricter start limit leaves normal session reads, renewal and sign-out available',
      async () => {
        const source = nextSource();
        const cookie = await login(source);
        await exhaust(() => start(source), 200, rateLimit.max);
        for (const method of ['GET', 'POST'] as const) {
          const response = await app.inject({
            method,
            url: '/api/auth/get-session',
            remoteAddress: source,
            headers: { cookie, origin: config.origin },
            ...(method === 'POST' ? { payload: {} } : {}),
          });
          assert.equal(response.statusCode, 200);
        }
        const logout = await app.inject({
          method: 'POST',
          url: '/api/auth/sign-out',
          remoteAddress: source,
          headers: { cookie, origin: config.origin },
          payload: {},
        });
        assert.equal(logout.statusCode, 200);
        assert.equal((await start(source)).statusCode, 429);
        assert.equal(
          (
            await app.inject({
              url: '/api/auth/get-session',
              remoteAddress: source,
              headers: { cookie },
            })
          ).statusCode,
          401,
        );
      },
    );
  },
);
