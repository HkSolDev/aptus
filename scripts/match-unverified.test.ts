import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { getUnverifiedRequirements } from './match.js';
import { handleMatch } from '../src/routes/match.js';
import { prisma } from '../src/db.js';

const rules = {
  gender_requirement: null,
  category_requirement: [],
  age_rules: [],
  relaxation_combination_rule: null,
  education_options: [
    {
      minimum_level: 'DIPLOMA',
      minimum_marks_percent: null,
      qualification: 'Engineering Diploma',
      subject_requirement: null,
      conditions: '3-year duration',
    },
    {
      minimum_level: 'TENTH',
      minimum_marks_percent: null,
      qualification: 'High School with ITI',
      subject_requirement: null,
      conditions: null,
    },
  ],
};
const details = {
  experience_rules: [
    { minimum_years: 4, conditions: 'Engineering Diploma route' },
    { minimum_years: 9, conditions: 'High School with ITI route' },
  ],
  other_requirements: ['Desirable: spreadsheet skills'],
};

await test('qualification alternatives and experience stay explicit; desirable skills do not become eligibility requirements', () => {
  const reasons = getUnverifiedRequirements({
    eligibilityRules: rules,
    reviewedDetails: details,
  });
  assert.match(reasons[0], /Engineering Diploma.* OR High School with ITI/);
  assert.match(reasons[1], /4 years.*Engineering Diploma route/);
  assert.match(reasons[2], /9 years.*High School with ITI route/);
  assert.ok(!reasons.join(' ').includes('spreadsheet'));
  assert.deepEqual(
    getUnverifiedRequirements({
      reviewedDetails: { other_requirements: ['Desirable: Python'] },
    }),
    [],
  );
  assert.deepEqual(getUnverifiedRequirements({}), []);
});

await test('postgraduate-only experience keeps its scope without imposing it on PhD candidates', () => {
  const reasons = getUnverifiedRequirements({
    reviewedDetails: {
      experience_rules: [
        {
          minimum_years: 3,
          conditions: 'Relevant experience applicable to Postgraduate route',
        },
      ],
    },
  });
  assert.deepEqual(reasons, [
    'Verify experience for the applicable route: 3 years — Relevant experience applicable to Postgraduate route',
  ]);
});

await test('malformed stored qualification rules require verification rather than disappearing', () => {
  assert.deepEqual(
    getUnverifiedRequirements({ eligibilityRules: { unexpected: true } }),
    ['Detailed qualification rules require manual verification'],
  );
});

await test('match handler keeps unverified qualifications/experience manual even with known age and preserves missing-age warnings', async (t) => {
  const user = {
    id: 'illustrative-profile',
    dob: new Date('1995-01-01'),
    category: 'UNSPECIFIED',
    educations: [{ level: 'DIPLOMA', marksPercent: null }],
  };
  const post = {
    id: 'illustrative-job',
    postName: 'Illustrative Technician',
    minAge: 18,
    maxAge: 65,
    minEducationLevel: 'TENTH',
    minMarksPercent: null,
    categoryRelaxationRules: null,
    eligibilityRules: rules,
    reviewedDetails: details,
    payLevel: null,
    educationRequired: 'Diploma OR High School with ITI',
    source: { name: 'Illustrative source', url: 'https://example.org/notice' },
  };
  const stub = (
    target: object,
    key: string,
    implementation: () => Promise<unknown>,
  ) => {
    const original: unknown = Reflect.get(target, key);
    Object.defineProperty(target, key, {
      configurable: true,
      value: implementation,
    });
    t.after(() =>
      Object.defineProperty(target, key, {
        configurable: true,
        value: original,
      }),
    );
  };
  stub(prisma.user, 'findUnique', () => Promise.resolve(user));
  stub(prisma.user, 'findUniqueOrThrow', () => Promise.resolve(user));
  stub(prisma.post, 'findMany', () => Promise.resolve([post]));
  stub(prisma.source, 'findMany', () => Promise.resolve([]));
  const app = Fastify();
  t.after(() => app.close());
  app.post<{ Body: Parameters<typeof handleMatch>[0]['body'] }>(
    '/match',
    (request, reply) => {
      request.authUserId = 'illustrative-account';
      return handleMatch(request, reply);
    },
  );
  for (const unknownAge of [false, true]) {
    stub(prisma.post, 'findMany', () =>
      Promise.resolve([
        {
          ...post,
          minAge: unknownAge ? null : 18,
          maxAge: unknownAge ? null : 65,
        },
      ]),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/match',
      payload: {},
    });
    assert.equal(response.statusCode, 200);
    const body = response.json<{
      matches: unknown[];
      needsManualCheck: { reason: string }[];
    }>();
    assert.deepEqual(body.matches, []);
    assert.equal(body.needsManualCheck.length, 1);
    assert.match(body.needsManualCheck[0].reason, /High School with ITI/);
    assert.match(body.needsManualCheck[0].reason, /4 years.*9 years/);
    assert.equal(
      body.needsManualCheck[0].reason.includes(
        'Minimum age limit not specified',
      ),
      unknownAge,
    );
  }
});
