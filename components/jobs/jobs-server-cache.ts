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
// Default is two hours (7200 seconds), measured from a successful fetch.
export const JOBS_REVALIDATE_SECONDS = 7200;
const PAGE_SIZE = 6;

function getJobsRevalidateSeconds(): number {
  const raw = (
    (globalThis as { process?: { env: Record<string, string | undefined> } })
      .process?.env?.APTUS_JOBS_CACHE_SECONDS ?? env.APTUS_JOBS_CACHE_SECONDS
  )?.trim();
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return JOBS_REVALIDATE_SECONDS;
}

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

const GLOBAL_JOBS_CACHE = Symbol.for('aptus.jobsCache');
const GLOBAL_JOBS_IN_FLIGHT = Symbol.for('aptus.jobsInFlight');
const GLOBAL_JOBS_GENERATION = Symbol.for('aptus.jobsGeneration');

type GlobalState = {
  [GLOBAL_JOBS_CACHE]?: Map<string, JobsCacheEntry<unknown>>;
  [GLOBAL_JOBS_IN_FLIGHT]?: Map<string, Promise<unknown>>;
  [GLOBAL_JOBS_GENERATION]?: number;
};

const g = globalThis as unknown as GlobalState;
const jobsCache = (g[GLOBAL_JOBS_CACHE] ??= new Map<
  string,
  JobsCacheEntry<unknown>
>());
const jobsInFlight = (g[GLOBAL_JOBS_IN_FLIGHT] ??= new Map<
  string,
  Promise<unknown>
>());

function getCacheGeneration(): number {
  return g[GLOBAL_JOBS_GENERATION] ?? 0;
}

function incrementCacheGeneration(): number {
  g[GLOBAL_JOBS_GENERATION] = (g[GLOBAL_JOBS_GENERATION] ?? 0) + 1;
  return g[GLOBAL_JOBS_GENERATION];
}

export function invalidateJobsCache(): void {
  incrementCacheGeneration();
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
    if (generation === getCacheGeneration()) {
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
  const backendUrl =
    (globalThis as { process?: { env: Record<string, string | undefined> } })
      .process?.env?.BACKEND_INTERNAL_URL ||
    env.BACKEND_INTERNAL_URL ||
    'http://127.0.0.1:8081';
  const params = jobSearchParams(filters, page);
  params.set('pageSize', String(PAGE_SIZE));
  // Cache identity: normalized sort/filters, page, page size, India date.
  // The API ignores istDate; it exists so IST rollover keys fresh entries.
  params.set('istDate', indiaDateKey());
  const cacheKey = params.toString();
  const entry = jobsCache.get(cacheKey);
  const ttlSeconds = getJobsRevalidateSeconds();
  if (entry && Date.now() - entry.fetchedAt < ttlSeconds * 1000) {
    return entry.result as T;
  }
  // Coalesce concurrent refreshes of the same identity into one fetch.
  const inFlight = jobsInFlight.get(cacheKey);
  if (inFlight) return inFlight as Promise<T | null>;
  const request = fetchFreshJobs<T>(
    cacheKey,
    backendUrl,
    getCacheGeneration(),
  ).finally(() => {
    // An older request may finish after a new generation started fetching.
    if (jobsInFlight.get(cacheKey) === request) jobsInFlight.delete(cacheKey);
  });
  jobsInFlight.set(cacheKey, request);
  return request;
}
