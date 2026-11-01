import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../src/db.js';
import { handleMatch } from '../src/routes/match.js';

test('HTTP matching separates confirmed/manual/excluded posts and uses notice-age explanations', async (t) => {
  const user = {
    id: 'illustrative-profile',
    dob: new Date('2000-06-15'),
    category: 'OBC',
    educations: [{ level: 'BACHELORS', marksPercent: 70 }],
  };
  const post = {
    id: 'confirmed',
    postName: 'Illustrative officer',
    minAge: 18,
    maxAge: 30,
    ageAsOnDate: new Date('2030-06-15'),
    minEducationLevel: 'BACHELORS',
    minMarksPercent: 60,
    categoryRelaxationApplies: false,
    categoryRelaxationRules: { OBC: 3 },
    eligibilityRules: null,
    reviewedDetails: null,
    payLevel: null,
    educationRequired: 'Bachelor degree',
    source: { name: 'Illustrative source', url: 'https://example.org/notice' },
  };
  const stub = (
    target: object,
    key: string,
    implementation: (...args: unknown[]) => unknown,
  ) => {
    const original: unknown = Reflect.get(target, key);
    Reflect.set(target, key, implementation);
    t.after(() => {
      Reflect.set(target, key, original);
    });
  };
  stub(prisma.user, 'findUnique', (query) => {
    assert.deepEqual(query, {
      where: { authUserId: 'illustrative-owner' },
      include: { educations: true },
    });
    return Promise.resolve(user);
  });
  stub(prisma.user, 'findUniqueOrThrow', () => Promise.resolve(user));
  stub(prisma.post, 'findMany', () =>
    Promise.resolve([
      post,
      { ...post, id: 'missing-date', ageAsOnDate: null },
      { ...post, id: 'invalid-date', ageAsOnDate: new Date('invalid') },
      {
        ...post,
        id: 'unknown-relaxation',
        maxAge: 29,
        categoryRelaxationApplies: null,
      },
      {
        ...post,
        id: 'nationality',
        reviewedDetails: { nationality_requirement: 'Indian citizens' },
      },
      {
        ...post,
        id: 'gender',
        eligibilityRules: {
          gender_requirement: 'Male',
          category_requirement: [],
          education_options: [],
          age_rules: [],
          relaxation_combination_rule: null,
        },
      },
      {
        ...post,
        id: 'hard-age-failure',
        maxAge: 29,
        reviewedDetails: { nationality_requirement: 'Indian citizens' },
      },
      {
        ...post,
        id: 'hard-minimum-failure',
        minAge: 31,
        categoryRelaxationApplies: null,
      },
      {
        ...post,
        id: 'hard-education-failure',
        minEducationLevel: 'MASTERS',
        ageAsOnDate: null,
      },
      {
        ...post,
        id: 'hard-marks-failure',
        minMarksPercent: 90,
        ageAsOnDate: null,
      },
    ]),
  );
  stub(prisma.source, 'findMany', () => Promise.resolve([]));
  const app = Fastify();
  t.after(() => app.close());
  app.post<{ Body: Parameters<typeof handleMatch>[0]['body'] }>(
    '/match',
    (request, reply) => {
      request.authUserId = 'illustrative-owner';
      return handleMatch(request, reply);
    },
  );
  const response = await app.inject({
    method: 'POST',
    url: '/match',
    payload: {},
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(
    body.matches.map((row: { id: string }) => row.id),
    ['confirmed'],
  );
  assert.equal(body.matches[0].userAge, 30);
  assert.equal(body.matches[0].ageComparison, 'Age 30 (Allowed: 18–30)');
  assert.equal(body.matches[0].categoryRelaxationApplied, null);
  assert.deepEqual(
    body.needsManualCheck.map((row: { id: string }) => row.id),
    [
      'missing-date',
      'invalid-date',
      'unknown-relaxation',
      'nationality',
      'gender',
    ],
  );
  for (const row of body.needsManualCheck) assert.ok(row.reason.length > 0);
});
