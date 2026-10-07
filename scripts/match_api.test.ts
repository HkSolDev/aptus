import { test, describe, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { createAuth } from '../src/auth/auth.js';

const origin = 'https://aptus.example';
const authConfig = {
  origin,
  secret: 'fictional-test-only-secret-not-for-production-0123456789',
  googleClientId: 'example.apps.googleusercontent.com',
  googleClientSecret: 'fictional-client-secret',
};

interface InvokeResult {
  status: number;
  body: Record<string, unknown>;
}

async function testApp(t: TestContext) {
  const auth = createAuth(authConfig);
  t.mock.method(auth.api, 'getSession', async () => ({
    user: { id: 'fictional-auth-user' },
    session: { expiresAt: new Date(Date.now() + 60_000) },
  }));
  const app = buildApp(auth);
  t.after(() => app.close());
  return app;
}

async function invokeServer(
  app: Awaited<ReturnType<typeof testApp>>,
  method: 'POST',
  urlPath: string,
  body?: unknown,
): Promise<InvokeResult> {
  const response = await app.inject({
    method,
    url: urlPath,
    headers: { 'content-type': 'application/json', origin },
    payload: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
  });
  return {
    status: response.statusCode,
    body: response.json<Record<string, unknown>>(),
  };
}

await describe('POST /api/match validation', async () => {
  await test('returns 400 when dob is missing or invalid', async (t) => {
    const app = await testApp(t);
    const res = await invokeServer(app, 'POST', '/api/match', {
      educations: [{ level: 'BACHELORS' }],
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(
      res.body.error,
      'A valid Date of Birth (dob) is required',
    );
  });

  await test('returns 400 when educations is empty', async (t) => {
    const app = await testApp(t);
    const res = await invokeServer(app, 'POST', '/api/match', {
      dob: '1998-05-15',
      educations: [],
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(
      res.body.error,
      'At least one education entry is required',
    );
  });

  await test('returns 400 when education level is invalid', async (t) => {
    const app = await testApp(t);
    const res = await invokeServer(app, 'POST', '/api/match', {
      dob: '1998-05-15',
      educations: [{ level: 'INVALID_LEVEL' }],
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(
      res.body.error,
      'Invalid education level: INVALID_LEVEL',
    );
  });
});
