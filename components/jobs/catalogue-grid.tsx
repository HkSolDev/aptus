import Link from 'next/link';
import { JobCard, type PublicJobItem } from './job-card';
import {
  jobSearchParams,
  type JobFilters,
} from '@/frontend/public-job-filters';
import { JobSortControl } from './job-search-controls';
import { HomeLayoutControls } from './home-layout-controls';
import { homeSearchParams, type HomeView } from '@/frontend/home-view';
import type { ReviewRecommendation } from './home-recommendations';
import { HomeSaveAction } from './home-review-state';

export interface JobsApiResponse {
  designReview?: boolean;
  reviewRecommendations?: ReviewRecommendation[];
  data: PublicJobItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export async function fetchPublicJobs(
  page: number,
  filters: JobFilters,
): Promise<JobsApiResponse | null> {
  const backendUrl =
    process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:8081';
  try {
    const params = jobSearchParams(filters, page);
    params.set('pageSize', '6');
    const res = await fetch(`${backendUrl}/api/jobs?${params}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as JobsApiResponse;
  } catch {
    return null;
  }
}

export function CatalogueGrid({
  page,
  filters,
  view,
  result,
}: {
  page: number;
  filters: JobFilters;
  view: HomeView;
  result: JobsApiResponse | null;
}) {
  const hasFilters = Boolean(filters.q || filters.qualification);
  const firstPage = `/?${homeSearchParams(filters, 1, view)}#jobs`;

  return (
    <section
      id="jobs"
      className={`catalogue${view.reviewProfile === 'ready' && !hasFilters ? ' home-all-after-recommendations' : ''}`}
      aria-labelledby="jobs-title"
    >
      <div className="results-heading catalogue-header">
        <div>
          <h2 id="jobs-title">{hasFilters ? 'Search results' : 'All jobs'}</h2>
          {result && (
            <p className="catalogue-count muted">
              {result.pagination.totalItems}{' '}
              {result.designReview ? 'example jobs' : 'jobs'}
            </p>
          )}
        </div>
        <div className="home-result-controls">
          <JobSortControl filters={filters} view={view} />
          <HomeLayoutControls filters={filters} view={view} page={page} />
        </div>
      </div>
      {!result || !result.data ? (
        <div className="notice notice-error">
          <p>Jobs are temporarily unavailable. Please try again shortly.</p>
          <a href={`/?${homeSearchParams(filters, page, view)}#jobs`}>
            Try again
          </a>
        </div>
      ) : result.data.length === 0 ? (
        <div className="panel">
          <h3>
            {result.pagination.totalItems
              ? 'No jobs on this page'
              : hasFilters
                ? 'No jobs match your search'
                : 'No jobs available yet'}
          </h3>
          <p className="muted">
            {result.pagination.totalItems ? (
              <Link href={firstPage}>Return to the first page.</Link>
            ) : hasFilters ? (
              <Link
                href={`/?${homeSearchParams({ ...filters, q: '', qualification: '' }, 1, view)}`}
              >
                Clear search and filter
              </Link>
            ) : (
              'New notifications will appear here after the next successful collection.'
            )}
          </p>
        </div>
      ) : (
        <>
          <div
            className={`catalogue-grid home-job-list home-layout-${view.layout}`}
          >
            {result.data.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                actions={
                  view.reviewProfile ? (
                    <HomeSaveAction id={job.id} />
                  ) : undefined
                }
              />
            ))}
          </div>
          {result.pagination.totalPages > 1 && (
            <nav className="catalogue-pagination" aria-label="Job pages">
              {result.pagination.page > 1 && (
                <Link
                  className="button button-secondary"
                  rel="prev"
                  href={`/?${homeSearchParams(filters, result.pagination.page - 1, view)}#jobs`}
                >
                  ← Previous page
                </Link>
              )}
              <span className="small">
                Page {result.pagination.page} of {result.pagination.totalPages}
              </span>
              {result.pagination.page < result.pagination.totalPages && (
                <Link
                  className="button button-secondary"
                  rel="next"
                  href={`/?${homeSearchParams(filters, result.pagination.page + 1, view)}#jobs`}
                >
                  Next page →
                </Link>
              )}
            </nav>
          )}
        </>
      )}
      <details className="home-browsing-help">
        <summary>About search and deadlines</summary>
        <p>
          Search checks job titles and qualification text. Organization names
          are found only when included in that text. Some deadlines may have
          passed or be unavailable. Check the recruitment notice for current
          dates.
        </p>
      </details>
    </section>
  );
}
