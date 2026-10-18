import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { createAuth } from '../src/auth/auth.js';
import { requireSession } from '../src/auth/require-session.js';
import { requireIngestToken } from '../src/auth/require-ingest-token.js';
import { registerAuthRoutes } from '../src/auth/routes.js';
import {
  registerRequestLogging,
  safeLoggingOptions,
} from '../src/lib/logging.js';

const origin = 'https://aptus.example';
const privateValue = 'fictional-private-marker';

await test('ingestion accepts the worker credential without logging credentials', async (t) => {
  const { app, output, entries } = fixture();
  t.after(() => app.close());
  const token = 'fictional-ingest-credential-for-tests-only';
  app.post(
    '/ingest-fixture',
    { onRequest: requireIngestToken({ INGEST_TOKEN: token }) },
    () => ({ accepted: true }),
  );
  const denied = await app.inject({
    method: 'POST',
    url: '/ingest-fixture',
    headers: { authorization: `Bearer ${privateValue}` },
  });
  assert.equal(denied.statusCode, 401);
  const accepted = await app.inject({
    method: 'POST',
    url: '/ingest-fixture',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(accepted.json(), { accepted: true });
  assert.ok(entries().some((entry) => entry.event === 'auth_rejected'));
  assert.ok(!output().includes(token));
  assert.ok(!output().includes(privateValue));
});

function fixture() {
  let output = '';
  const app = Fastify({
    ...safeLoggingOptions,
    logger: {
      ...safeLoggingOptions.logger,
      stream: {
        write: (line: string) => {
          output += line;
        },
      },
    },
  });
  registerRequestLogging(app);
  const auth = createAuth({
    origin,
    secret: 'fictional-test-only-secret-not-for-production-0123456789',
    googleClientId: 'example.apps.googleusercontent.com',
    googleClientSecret: 'fictional-client-secret',
  });
  return {
    app,
    auth,
    output: () => output,
    entries: () =>
      output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

await test('request records exclude private input, raw paths, headers and error details', async (t) => {
  const { app, output, entries } = fixture();
  t.after(() => app.close());
  app.post('/example/:id', () => Promise.resolve({ secret: privateValue }));
  app.get('/failure', (request) => {
    request.log.error({ err: new Error(privateValue) }, 'Request failed');
    throw new Error(privateValue);
  });
  await app.inject({
    method: 'POST',
    url: `/example/${privateValue}?search=${privateValue}`,
    headers: {
      cookie: privateValue,
      authorization: privateValue,
      'x-request-id': privateValue,
    },
    payload: {
      dob: privateValue,
      education: privateValue,
      category: privateValue,
    },
  });
  await app.inject(`/missing-${privateValue}`);
  await app.inject('/failure');
  assert.ok(!output().includes(privateValue));
  const requests = entries().filter(
    (entry) => entry.event === 'request_completed',
  );
  assert.equal(requests.length, 3);
  assert.equal(requests[0].route, '/example/:id');
  assert.equal(requests[0].status, 200);
  assert.equal(typeof requests[0].durationMs, 'number');
  assert.match(String(requests[0].reqId), /^[0-9a-f-]{36}$/);
  assert.equal(requests[2].status, 500);
});

await test('origin and missing-session rejections produce safe security reasons', async (t) => {
  const { app, auth, output, entries } = fixture();
  t.after(() => app.close());
  registerAuthRoutes(app, auth);
  app.get('/private', { preHandler: requireSession(auth) }, () =>
    Promise.resolve('private'),
  );
  const rejected = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-out',
    headers: { origin: privateValue },
    payload: {},
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal((await app.inject('/private')).statusCode, 401);
  assert.ok(
    entries().some(
      (entry) =>
        entry.event === 'origin_rejected' && entry.reason === 'origin_mismatch',
    ),
  );
  assert.ok(
    entries().some(
      (entry) =>
        entry.event === 'session_rejected' &&
        entry.reason === 'session_not_found',
    ),
  );
  assert.ok(!output().includes(privateValue));
});

await test('callback outcomes omit codes, state, cookies and exception messages', async (t) => {
  const { app, auth, output, entries } = fixture();
  t.after(() => app.close());
  auth.handler = () =>
    Promise.resolve(
      new Response(null, {
        status: 302,
        headers: {
          location: `${origin}/`,
          'set-cookie': `fictional=${privateValue}`,
        },
      }),
    );
  registerAuthRoutes(app, auth);
  const callback = `/api/auth/callback/google?code=${privateValue}&state=${privateValue}`;
  assert.equal((await app.inject(callback)).statusCode, 302);
  assert.equal(
    entries().filter((entry) => entry.event === 'sign_in_completed').length,
    1,
  );
  auth.handler = () =>
    Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: `${origin}/auth/error?error=${privateValue}` },
      }),
    );
  assert.equal(
    (await app.inject(callback)).headers.location,
    `${origin}/auth/error`,
  );
  auth.handler = () => Promise.reject(new Error(privateValue));
  assert.equal(
    (await app.inject(callback)).headers.location,
    `${origin}/auth/error`,
  );
  assert.equal(
    entries().filter((entry) => entry.event === 'sign_in_completed').length,
    1,
  );
  assert.ok(entries().some((entry) => entry.reason === 'provider_rejected'));
  assert.ok(entries().some((entry) => entry.event === 'auth_unavailable'));
  assert.ok(!output().includes(privateValue));
});

await test('rate limits and sign-out outcomes are recorded without reading credentials', async (t) => {
  const { app, auth, output, entries } = fixture();
  t.after(() => app.close());
  // Exercise our HTTP boundary; provider/database behavior has separate integration tests.
  auth.handler = (request) =>
    Promise.resolve(
      new URL(request.url).pathname.endsWith('/sign-out')
        ? Response.json({ success: true })
        : new Response(privateValue, {
            status: 429,
            headers: { 'x-retry-after': '2' },
          }),
    );
  registerAuthRoutes(app, auth);
  const limited = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/social',
    headers: { origin },
    payload: { provider: 'google' },
  });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['retry-after'], '2');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/sign-out',
        headers: { origin },
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.ok(entries().some((entry) => entry.event === 'rate_limit_reached'));
  assert.ok(entries().some((entry) => entry.event === 'sign_out_completed'));
  assert.ok(!output().includes(privateValue));
});
