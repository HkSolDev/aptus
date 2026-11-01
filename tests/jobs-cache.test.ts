import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tsImport } from 'tsx/esm/api';
import type { JobFilters } from '../frontend/public-job-filters';

// TTL 0: every read attempts a refresh, so hit/expiry/failure/recovery can
// be exercised without waiting. The default in production is 7200 seconds (2 hours).
process.env.APTUS_JOBS_CACHE_SECONDS = '0';
process.env.BACKEND_INTERNAL_URL = 'http://fixture.invalid';

const { fetchPublicJobsCached, indiaDateKey, invalidateJobsCache } =
  (await tsImport('../components/jobs/jobs-server-cache.ts', {
    parentURL: import.meta.url,
    tsconfig: 'tsconfig.next.json',
  })) as typeof import('../components/jobs/jobs-server-cache');

interface FixtureResult {
  freshnessUnconfirmed?: boolean;
  data: { id: string }[];
}
const fetchPublicJobs = (page: number, filters: JobFilters) =>
  fetchPublicJobsCached<FixtureResult>(page, filters);

const filters: JobFilters = { q: '', qualification: '', sort: 'soonest' };
let fetches = 0;
let mode: 'ok' | 'fail' = 'ok';
let marker = 'v1';

globalThis.fetch = (async () => {
  fetches += 1;
  if (mode === 'fail') return new Response('{}', { status: 503 });
  return Response.json({
    data: [{ id: `job-${marker}` }],
    pagination: { page: 1, pageSize: 6, totalItems: 1, totalPages: 1 },
  });
}) as typeof fetch;

await test('public jobs server cache', async (t) => {
  invalidateJobsCache();

  await t.test(
    'sequential identical reads within TTL return cached result without refetching',
    async () => {
      process.env.APTUS_JOBS_CACHE_SECONDS = '7200';
      invalidateJobsCache();
      marker = 'cache-hit';
      const before = fetches;
      const first = await fetchPublicJobs(1, filters);
      assert.equal(fetches, before + 1, 'first read fetches from backend');
      assert.equal(first?.data[0]?.id, 'job-cache-hit');
      assert.equal(first?.freshnessUnconfirmed, undefined);

      const second = await fetchPublicJobs(1, filters);
      assert.equal(fetches, before + 1, 'second identical read returns cached result');
      assert.equal(second?.data[0]?.id, 'job-cache-hit');
      assert.equal(second?.freshnessUnconfirmed, undefined);

      process.env.APTUS_JOBS_CACHE_SECONDS = '0';
      marker = 'v1';
      invalidateJobsCache();
    },
  );

  await t.test(
    'failed refresh serves last success, marked unconfirmed, then recovers',
    async () => {
      const first = await fetchPublicJobs(1, filters);
      assert.equal(first?.data[0]?.id, 'job-v1');
      assert.equal(first?.freshnessUnconfirmed, undefined);
      mode = 'fail';
      const stale = await fetchPublicJobs(1, filters);
      assert.equal(stale?.data[0]?.id, 'job-v1');
      assert.equal(stale?.freshnessUnconfirmed, true);
      mode = 'ok';
      marker = 'v2';
      const recovered = await fetchPublicJobs(1, filters);
      assert.equal(recovered?.data[0]?.id, 'job-v2');
      assert.equal(recovered?.freshnessUnconfirmed, undefined);
      assert.ok(fetches >= 3);
    },
  );

  await t.test(
    'failure with no cached entry is not an empty success',
    async () => {
      invalidateJobsCache();
      mode = 'fail';
      const result = await fetchPublicJobs(1, {
        q: 'nothing-cached',
        qualification: '',
        sort: 'furthest',
      });
      assert.equal(result, null);
      mode = 'ok';
    },
  );

  await t.test('cache identity separates sorts', async () => {
    invalidateJobsCache();
    marker = 'v9';
    const before = fetches;
    await fetchPublicJobs(1, { q: '', qualification: '', sort: 'newest' });
    await fetchPublicJobs(1, { q: '', qualification: '', sort: 'furthest' });
    assert.equal(fetches, before + 2);
  });

  await t.test(
    'concurrent reads coalesce into one upstream fetch',
    async () => {
      invalidateJobsCache();
      mode = 'ok';
      marker = 'conc';
      const before = fetches;
      const results = await Promise.all([
        fetchPublicJobs(1, { q: '', qualification: '', sort: 'newest' }),
        fetchPublicJobs(1, { q: '', qualification: '', sort: 'newest' }),
        fetchPublicJobs(1, { q: '', qualification: '', sort: 'newest' }),
      ]);
      assert.equal(fetches, before + 1);
      assert.ok(results.every((r) => r?.data[0]?.id === 'job-conc'));
    },
  );

  await t.test('india date key rolls over at IST midnight', () => {
    // 2026-01-01T18:29Z is 23:59 IST; 18:31Z is 00:01 IST the next day.
    assert.equal(indiaDateKey(new Date('2026-01-01T18:29:00Z')), '2026-01-01');
    assert.equal(indiaDateKey(new Date('2026-01-01T18:31:00Z')), '2026-01-02');
  });

  await t.test(
    'invalidation separates active fetches and rejects their late cache writes',
    async () => {
      invalidateJobsCache();
      const originalFetch = globalThis.fetch;
      const responses: Array<(response: Response) => void> = [];
      globalThis.fetch = (() =>
        new Promise<Response>((resolve) => {
          responses.push(resolve);
        })) as typeof fetch;
      try {
        const oldRead = fetchPublicJobs(1, filters);
        invalidateJobsCache();
        const warm = fetchPublicJobs(1, filters);
        assert.equal(
          responses.length,
          2,
          'warming must start a post-invalidation fetch',
        );
        responses[1]!(Response.json({ data: [{ id: 'new-publication' }] }));
        assert.equal((await warm)?.data[0]?.id, 'new-publication');
        responses[0]!(Response.json({ data: [{ id: 'old-publication' }] }));
        await oldRead;
        globalThis.fetch = (async () =>
          new Response('{}', { status: 503 })) as typeof fetch;
        const fallback = await fetchPublicJobs(1, filters);
        assert.equal(fallback?.data[0]?.id, 'new-publication');
        assert.equal(fallback?.freshnessUnconfirmed, true);
      } finally {
        globalThis.fetch = originalFetch;
        invalidateJobsCache();
      }
    },
  );
});
