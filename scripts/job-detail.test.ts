import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../src/db.js';
import { registerPublicRoutes } from '../src/routes/public.js';

await test('public job detail JSON contract', async (t) => {
  const app = Fastify();
  registerPublicRoutes(app);
  const original: unknown = Reflect.get(prisma.post, 'findUnique');
  let mode: 'found' | 'missing' | 'failed' = 'found';
  let query: unknown;
  const job = {
    id: 'fixture-job',
    postName: 'Assistant',
    educationRequired: 'Graduate',
    eligibilityRules: { age_rules: [] },
    reviewedDetails: null,
    source: { name: 'Example notification', url: 'https://example.org' },
  };
  Object.defineProperty(prisma.post, 'findUnique', {
    configurable: true,
    value: (args: unknown) => {
      query = args;
      if (mode === 'failed') throw new Error('private database error');
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
    'returns the top-level object expected by the frontend',
    async () => {
      const response = await app.inject('/api/jobs/fixture-job');
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), job);
      assert.equal(response.headers['cache-control'], 'no-store');
      const selected = JSON.stringify(query);
      assert(selected.includes('eligibilityRules'));
      assert(selected.includes('reviewedDetails'));
      assert(!selected.includes('user'));
      assert(!selected.includes('rawHash'));
    },
  );

  await t.test('invalid IDs and writes never query the database', async () => {
    query = undefined;
    assert.equal((await app.inject('/api/jobs/bad%20id')).statusCode, 404);
    const response = await app.inject({
      method: 'POST',
      url: '/api/jobs/fixture-job',
    });
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.allow, 'GET');
    assert.equal(query, undefined);
  });

  await t.test(
    'missing jobs return 404 and database errors stay private',
    async () => {
      mode = 'missing';
      assert.equal((await app.inject('/api/jobs/missing')).statusCode, 404);
      mode = 'failed';
      const response = await app.inject('/api/jobs/fixture-job');
      assert.equal(response.statusCode, 503);
      assert(!response.body.includes('private database error'));
    },
  );
});
