import {
  jobSearchParams,
  type JobFilters,
} from '@/frontend/public-job-filters';

// This module is shared by Next server code and plain Node tests, which
// type `process` differently; read the environment through globalThis.
const env: Record<string, string | undefined> =
  (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process?.env ?? {};

export const JOBS_CACHE_TAG = 'jobs';
// Freshness interval in seconds, not a maximum-staleness guarantee: an
// entry older than this is refreshed on the next read, and if that refresh
// fails the previous entry is served marked `freshnessUnconfirmed`.
export const JOBS_REVALIDATE_SECONDS = Number(
  env.APTUS_JOBS_CACHE_SECONDS ?? 60,
);
const PAGE_SIZE = 6;

// The API interprets deadlines by the India calendar date, so entries must
// roll over at IST midnight even if nobody invalidates them.
export function indiaDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// Explicit server cache for public catalogue results, grouped under the
// single `jobs` tag (invalidation clears the whole group). It lives in the
// Next server process: shared by its requests, not across replicas, and
// empty after a restart/redeploy — matching the single-frontend
// deployment. An explicit cache (instead of only the Next fetch cache) is
// used because the fetch cache serves stale entries on upstream failure
// without telling the caller, and readers must be told when freshness
// could not be confirmed.
interface JobsCacheEntry<T> {
  result: T;
  fetchedAt: number;
}
const jobsCache = new Map<string, JobsCacheEntry<unknown>>();
const jobsInFlight = new Map<string, Promise<unknown>>();
let cacheGeneration = 0;

export function invalidateJobsCache(): void {
  cacheGeneration += 1;
  jobsCache.clear();
  jobsInFlight.clear();
}

type FreshnessMarkable = { freshnessUnconfirmed?: boolean };

async function fetchFreshJobs<T extends FreshnessMarkable>(
  cacheKey: string,
  backendUrl: string,
  generation: number,
): Promise<T | null> {
  try {
    const res = await fetch(`${backendUrl}/api/jobs?${cacheKey}`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Jobs API responded ${res.status}`);
    const result = (await res.json()) as T;
    // A fetch started before publication must not refill the cleared cache.
    if (generation === cacheGeneration) {
      jobsCache.set(cacheKey, { result, fetchedAt: Date.now() });
    }
    return result;
  } catch {
    const cached = jobsCache.get(cacheKey);
    return cached
      ? { ...(cached.result as T), freshnessUnconfirmed: true }
      : null;
  }
}

export async function fetchPublicJobsCached<T extends FreshnessMarkable>(
  page: number,
  filters: JobFilters,
): Promise<T | null> {
  const backendUrl = env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:8081';
  const params = jobSearchParams(filters, page);
  params.set('pageSize', String(PAGE_SIZE));
  // Cache identity: normalized sort/filters, page, page size, India date.
  // The API ignores istDate; it exists so IST rollover keys fresh entries.
  params.set('istDate', indiaDateKey());
  const cacheKey = params.toString();
  const entry = jobsCache.get(cacheKey);
  if (entry && Date.now() - entry.fetchedAt < JOBS_REVALIDATE_SECONDS * 1000) {
    return entry.result as T;
  }
  // Coalesce concurrent refreshes of the same identity into one fetch.
  const inFlight = jobsInFlight.get(cacheKey);
  if (inFlight) return inFlight as Promise<T | null>;
  const request = fetchFreshJobs<T>(
    cacheKey,
    backendUrl,
    cacheGeneration,
  ).finally(() => {
    // An older request may finish after a new generation started fetching.
    if (jobsInFlight.get(cacheKey) === request) jobsInFlight.delete(cacheKey);
  });
  jobsInFlight.set(cacheKey, request);
  return request;
}
