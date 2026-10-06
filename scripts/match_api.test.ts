import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../src/server.js';

interface InvokeResult {
  status: number;
  body: Record<string, unknown>;
}

async function invokeServer(
  method: 'POST',
  urlPath: string,
  body?: unknown,
): Promise<InvokeResult> {
  const response = await server.inject({
    method,
    url: urlPath,
    headers: { 'content-type': 'application/json' },
    payload: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
  });
  return {
    status: response.statusCode,
    body: response.json<Record<string, unknown>>(),
  };
}

await describe('POST /api/match validation', async () => {
  await test('returns 400 when dob is missing or invalid', async () => {
    const res = await invokeServer('POST', '/api/match', {
      educations: [{ level: 'BACHELORS' }],
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(
      res.body.error,
      'A valid Date of Birth (dob) is required',
    );
  });

  await test('returns 400 when educations is empty', async () => {
    const res = await invokeServer('POST', '/api/match', {
      dob: '1998-05-15',
      educations: [],
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(
      res.body.error,
      'At least one education entry is required',
    );
  });

  await test('returns 400 when education level is invalid', async () => {
    const res = await invokeServer('POST', '/api/match', {
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
