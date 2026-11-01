import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prisma } from '../src/db.js';
import { listPublicJobs } from '../src/lib/public-jobs.js';
import { readJobFilters } from '../frontend/public-job-filters.js';

function replaceTransaction(run: unknown) {
  const original: unknown = Reflect.get(prisma, '$transaction');
  Object.defineProperty(prisma, '$transaction', {
    value: run,
    configurable: true,
    writable: true,
  });
  return () =>
    Object.defineProperty(prisma, '$transaction', {
      value: original,
      configurable: true,
      writable: true,
    });
}

async function captureQuery(
  filters: Parameters<typeof listPublicJobs>[2],
  page = 1,
  pageSize = 6,
) {
  let query: Record<string, unknown> = {};
  const restore = replaceTransaction(
    async (run: (db: unknown) => Promise<unknown>) =>
      run({
        post: {
          count: () => Promise.resolve(13),
          findMany: (args: Record<string, unknown>) => {
            query = args;
            return Promise.resolve([]);
          },
        },
      }),
  );
  try {
    await listPublicJobs(page, pageSize, filters);
  } finally {
    restore();
  }
  return query;
}

const base = { q: '', qualification: '' as const };

await test('public jobs sort ordering', async (t) => {
  await t.test('default sort is newest', () => {
    const filters = readJobFilters(new URLSearchParams());
    assert.equal(filters?.sort, 'newest');
  });

  await t.test(
    'newest orders by first publication desc, unknown last',
    async () => {
      const query = await captureQuery({ ...base, sort: 'newest' }, 2, 6);
      assert.deepEqual(query.orderBy, [
        { publishedAt: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ]);
      // Global ordering before pagination: page 2 skips a full sorted page.
      assert.equal(query.skip, 6);
      assert.equal(query.take, 6);
    },
  );

  await t.test('soonest orders by deadline asc, missing last', async () => {
    const query = await captureQuery({ ...base, sort: 'soonest' });
    assert.deepEqual(query.orderBy, [
      { applicationLastDate: { sort: 'asc', nulls: 'last' } },
      { id: 'asc' },
    ]);
  });

  await t.test('furthest orders by deadline desc, missing last', async () => {
    const query = await captureQuery({ ...base, sort: 'furthest' });
    assert.deepEqual(query.orderBy, [
      { applicationLastDate: { sort: 'desc', nulls: 'last' } },
      { id: 'asc' },
    ]);
  });

  await t.test('unknown sort is rejected, explicit sorts parse', () => {
    assert.equal(readJobFilters(new URLSearchParams('sort=salary')), null);
    assert.equal(
      readJobFilters(new URLSearchParams('sort=soonest'))?.sort,
      'soonest',
    );
    assert.equal(
      readJobFilters(new URLSearchParams('sort=furthest'))?.sort,
      'furthest',
    );
    assert.equal(
      readJobFilters(new URLSearchParams('sort=newest'))?.sort,
      'newest',
    );
  });
});
