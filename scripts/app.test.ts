import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

const token = 'fictional-ingest-credential-for-tests-only';

await test('setup health check is public and does not create a session', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, '{"status":"ok"}');
  assert.equal(response.headers['set-cookie'], undefined);
});

await test('unknown routes do not echo request details', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/unknown?example=illustrative-value',
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.body, '{"error":"Not Found"}');
});

await test('unexpected errors do not expose internal messages', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  app.get('/failure', () => {
    throw new Error('illustrative internal detail');
  });
  const response = await app.inject({ method: 'GET', url: '/failure' });
  assert.equal(response.statusCode, 500);
  assert.equal(
    response.body,
    '{"error":"Something went wrong. Please try again."}',
  );
});

await test('authentication routes remain unavailable during setup', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: 'GET',
    url: '/api/auth/get-session',
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.headers['set-cookie'], undefined);
});

await test('Fastify rejects malformed and non-object JSON before database access', async (t) => {
  const app = buildApp(undefined, {
    AUTH_ENABLED: 'false',
    INGEST_TOKEN: token,
  });
  t.after(() => app.close());
  for (const url of ['/api/match', '/api/explain', '/api/internal/ingest']) {
    for (const payload of ['{', 'null', '[]']) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        payload,
      });
      assert.equal(response.statusCode, 400);
      assert.equal(
        response.body,
        '{"error":"Please check your request and try again."}',
      );
    }
  }
});

await test('Fastify enforces the request body limit', async (t) => {
  const app = buildApp(undefined, {
    AUTH_ENABLED: 'false',
    INGEST_TOKEN: token,
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/internal/ingest',
    headers: { authorization: `Bearer ${token}` },
    payload: { source_text: 'x'.repeat(1_048_576) },
  });
  assert.equal(response.statusCode, 413);
  assert.equal(
    response.body,
    '{"error":"Please check your request and try again."}',
  );
});

await test('the jobs API remains GET-only, including HEAD and unsupported bodies', async (t) => {
  const app = buildApp();
  t.after(() => app.close());
  for (const method of ['HEAD', 'POST', 'DELETE'] as const) {
    const response = await app.inject({
      method,
      url: '/api/jobs',
      ...(method === 'POST'
        ? {
            payload: 'not JSON',
            headers: { 'content-type': 'application/json' },
          }
        : {}),
    });
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.allow, 'GET');
  }
});
