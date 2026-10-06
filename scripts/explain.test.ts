import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../src/server.js';
import { explainStoredPost } from '../src/routes/explain.js';

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

await describe('POST /api/explain validation', async () => {
  await test('returns 400 when postId is missing', async () => {
    const res = await invokeServer('POST', '/api/explain', {});
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'postId is required');
  });

  await test('returns 400 when postId is not a string', async () => {
    const res = await invokeServer('POST', '/api/explain', { postId: 12345 });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'postId is required');
  });

  await test('Fastify rejects an empty JSON body before the handler', async () => {
    const res = await invokeServer('POST', '/api/explain', '');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(
      res.body.error,
      'Please check your request and try again.',
    );
  });
});

const savedPost = {
  postName: 'Teacher',
  minAge: 18,
  maxAge: 37,
  minEducationLevel: 'BACHELORS' as const,
  minMarksPercent: 60,
  educationRequired: 'Bachelor degree',
  payLevel: '6',
  categoryRelaxationRules: {},
  eligibilityRules: null,
};
const candidate = {
  dob: new Date('2001-01-01'),
  category: 'UNSPECIFIED',
  educations: [{ level: 'BACHELORS' as const, marksPercent: 80 }],
};

await test('explains saved job facts and deterministic candidate comparisons', () => {
  const text = explainStoredPost(savedPost, candidate);
  assert.match(text, /Bachelor degree/);
  assert.match(text, /Age check: passes/);
  assert.match(text, /Education check: passes/);
  assert.match(text, /Marks check: passes/);
});

await test('explains failed checks and missing data without an eligibility verdict', () => {
  const failed = explainStoredPost(savedPost, {
    ...candidate,
    educations: [{ level: 'BACHELORS', marksPercent: 50 }],
  });
  assert.match(failed, /Marks check: fails/);
  const missing = explainStoredPost(
    { ...savedPost, maxAge: null },
    {
      ...candidate,
      educations: [{ level: 'BACHELORS', marksPercent: null }],
    },
  );
  assert.match(missing, /Age check: needs manual verification/);
  assert.match(missing, /Marks check: needs manual verification/);
});

await test('provides a database summary without a candidate and flags detailed rules', () => {
  const text = explainStoredPost(
    { ...savedPost, eligibilityRules: { age_rules: [] } },
    null,
  );
  assert.match(text, /Teacher/);
  assert.doesNotMatch(text, /Candidate age/);
  assert.match(text, /Additional saved conditions require manual verification/);
});
