import { test, describe, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { prisma } from '../src/db.js';
import { explainStoredPost, handleExplain } from '../src/routes/explain.js';

interface InvokeResult {
  status: number;
  body: Record<string, unknown>;
}

function mockLookup(t: TestContext, delegate: object, value: unknown) {
  const original: unknown = Reflect.get(delegate, 'findUnique');
  const lookup = t.mock.fn((query: unknown) => {
    assert.ok(query);
    return Promise.resolve(value);
  });
  Reflect.set(delegate, 'findUnique', lookup);
  t.after(() => {
    Reflect.set(delegate, 'findUnique', original);
  });
  return lookup;
}

async function invokeServer(
  method: 'POST',
  urlPath: string,
  body?: unknown,
): Promise<InvokeResult> {
  const app = Fastify();
  app.post(
    '/api/explain',
    {
      schema: { body: { type: 'object' } },
      // Handler tests supply a fictional identity; session verification has its own suite.
      preHandler: (request) => {
        request.authUserId = 'fictional-owner';
        return Promise.resolve();
      },
    },
    handleExplain,
  );
  app.setErrorHandler((_error, _request, reply) =>
    reply.code(400).send({ error: 'Please check your request and try again.' }),
  );
  const response = await app.inject({
    method,
    url: urlPath,
    headers: { 'content-type': 'application/json' },
    payload: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
  });
  await app.close();
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
  ageAsOnDate: new Date('2026-01-01'),
  categoryRelaxationApplies: false,
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

await test('explanation selects only the signed-in profile despite a supplied victim ID', async (t) => {
  mockLookup(t, prisma.post, savedPost);
  const lookup = mockLookup(t, prisma.user, candidate);
  const response = await invokeServer('POST', '/api/explain', {
    postId: 'fictional-job',
    userId: 'victim-profile',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(lookup.mock.calls[0].arguments[0], {
    where: { authUserId: 'fictional-owner' },
    include: { educations: true },
  });
  assert.match(String(response.body.explanation), /Candidate age/);
});

await test('an account without its own profile cannot use an unclaimed profile', async (t) => {
  mockLookup(t, prisma.post, savedPost);
  mockLookup(t, prisma.user, null);
  const response = await invokeServer('POST', '/api/explain', {
    postId: 'fictional-job',
    userId: 'unclaimed-profile',
  });
  assert.equal(response.status, 404);
  assert.match(String(response.body.error), /Add your profile/);
  assert.equal(response.body.explanation, undefined);
});

await test('missing verified identity stops explanation before database access', async (t) => {
  const lookup = mockLookup(t, prisma.post, null);
  const app = Fastify();
  t.after(() => app.close());
  app.post('/api/explain', handleExplain);
  const response = await app.inject({
    method: 'POST',
    url: '/api/explain',
    payload: { postId: 'fictional-job' },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(lookup.mock.callCount(), 0);
});

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
