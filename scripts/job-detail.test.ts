import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../src/db.js';
import { registerPublicRoutes } from '../src/routes/public.js';

await test('anonymous public job detail contract', async (t) => {
  const app = Fastify();
  registerPublicRoutes(app);
  const original: unknown = Reflect.get(prisma.post, 'findUnique');
  let mode: 'found' | 'missing' | 'failed' = 'found';
  let query: unknown;
  const job = {
    id: 'fixture-job',
    postName: 'Fictional Assistant',
    organization: null,
    educationRequired: null,
    minAge: null,
    maxAge: null,
    applicationLastDate: null,
    categoryRelaxationApplies: true,
    categoryRelaxationRules: { SC: 5 },
    eligibilityRules: {
      education_options: [
        { qualification: 'BSc', conditions: 'Physics as a main subject' },
        {
          qualification: 'Diploma',
          conditions: 'Relevant experience required',
        },
      ],
      age_rules: [
        { category: 'SC', max_age: 35, conditions: 'Certificate required' },
      ],
    },
    source: {
      name: 'Fictional notification source',
      url: 'https://example.org/notice',
      notificationPdfUrl: 'https://example.org/notice.pdf',
      applyUrl: 'https://example.org/apply',
      officialSiteUrl: null,
      fetchedAt: '2026-10-01T00:00:00.000Z',
    },
  };
  Object.defineProperty(prisma.post, 'findUnique', {
    configurable: true,
    value: (args: unknown) => {
      query = args;
      if (mode === 'failed') throw new Error('private database connection');
      return Promise.resolve(mode === 'missing' ? null : job);
    },
  });
  t.after(async () => {
    Object.defineProperty(prisma.post, 'findUnique', {
      configurable: true,
      value: original,
    });
    await app.close();
  });

  await t.test(
    'returns stored alternatives, conditions, links and nulls without login',
    async () => {
      const response = await app.inject('/api/jobs/fixture-job');
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), job);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual(query, {
        where: { id: 'fixture-job' },
        select: {
          id: true,
          postName: true,
          organization: true,
          postGroup: true,
          payLevel: true,
          vacancies: true,
          applicationLastDate: true,
          ageAsOnDate: true,
          minAge: true,
          maxAge: true,
          educationRequired: true,
          minEducationLevel: true,
          minMarksPercent: true,
          source: {
            select: {
              name: true,
              url: true,
              notificationPdfUrl: true,
              officialSiteUrl: true,
              applyUrl: true,
              fetchedAt: true,
            },
          },
          reviewedDetails: true,
          eligibilityRules: true,
          categoryRelaxationApplies: true,
          categoryRelaxationRules: true,
        },
      });
    },
  );

  await t.test(
    'invalid IDs and unsupported methods never read storage',
    async () => {
      query = undefined;
      for (const id of ['bad%20id', 'bad%2Fid']) {
        assert.equal((await app.inject(`/api/jobs/${id}`)).statusCode, 404);
      }
      // Fastify's parameter-length limit rejects this before the handler.
      assert.equal(
        (await app.inject(`/api/jobs/${'x'.repeat(129)}`)).statusCode,
        414,
      );
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        const response = await app.inject({
          method,
          url: '/api/jobs/fixture-job',
        });
        assert.equal(response.statusCode, 405);
        assert.equal(response.headers.allow, 'GET');
      }
      assert.equal(query, undefined);
    },
  );

  await t.test(
    'missing jobs return 404 and failures return a private 503',
    async () => {
      mode = 'missing';
      const missing = await app.inject('/api/jobs/missing');
      assert.equal(missing.statusCode, 404);
      assert.deepEqual(missing.json(), { error: 'Not Found' });
      mode = 'failed';
      const failed = await app.inject('/api/jobs/fixture-job');
      assert.equal(failed.statusCode, 503);
      assert.deepEqual(failed.json(), {
        error: 'Job details are temporarily unavailable. Please try again.',
      });
    },
  );
});
