import { createHash, timingSafeEqual } from 'node:crypto';
import {
  fetchPublicJobs,
  invalidateJobsCache,
  JOBS_CACHE_TAG,
} from '@/components/jobs/catalogue-grid';
import type { JobFilters } from '@/frontend/public-job-filters';

// Internal endpoint: after a publication commits, the API notifies this
// route with the same Bearer convention as /api/internal/ingest
// (INGEST_TOKEN). Delivery is idempotent: repeated calls only re-mark the
// shared jobs tag stale and re-warm the same page-one entries.
function authorized(request: Request): boolean {
  const token = process.env.INGEST_TOKEN;
  if (!token) return false;
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!/^[A-Za-z0-9_-]{32,512}$/.test(supplied)) return false;
  const expected = createHash('sha256').update(token).digest();
  const actual = createHash('sha256').update(supplied).digest();
  return timingSafeEqual(expected, actual);
}

const WARM_SORTS: JobFilters['sort'][] = ['newest', 'soonest', 'furthest'];

export async function POST(request: Request) {
  if (!process.env.INGEST_TOKEN) {
    return Response.json(
      { error: 'Revalidation is unavailable.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
  if (!authorized(request)) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }
  // Clear the whole shared `jobs` group, so the warming fetches below —
  // and the next reader of any identity — fetch fresh upstream data
  // instead of being served the previous entry.
  invalidateJobsCache();
  // Warm only common page-one entries, through the same fetch path and
  // cache identity as real readers. A warming failure stays visible in
  // `warmed` and never turns into a cached empty success.
  const warmed: Record<string, boolean> = {};
  for (const sort of WARM_SORTS) {
    const result = await fetchPublicJobs(1, {
      q: '',
      qualification: '',
      sort,
    });
    warmed[sort] = result !== null && !result.freshnessUnconfirmed;
  }
  return Response.json(
    { revalidated: JOBS_CACHE_TAG, warmed },
    { headers: { 'cache-control': 'no-store' } },
  );
}
