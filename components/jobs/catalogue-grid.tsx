import Link from 'next/link';
import { JobCard, type PublicJobItem } from './job-card';

interface JobsApiResponse {
  data: PublicJobItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

async function fetchPublicJobs(page: number): Promise<JobsApiResponse | null> {
  const backendUrl =
    process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:8081';
  try {
    const res = await fetch(`${backendUrl}/api/jobs?page=${page}&pageSize=6`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as JobsApiResponse;
  } catch {
    return null;
  }
}

export async function CatalogueGrid({ page }: { page: number }) {
  const result = await fetchPublicJobs(page);

  return (
    <section id="jobs" className="catalogue" aria-labelledby="jobs-title">
      <div className="results-heading catalogue-header">
        <div>
          <p className="eyebrow">EXPLORE · PUBLIC JOB CATALOGUE</p>
          <h2 id="jobs-title">Browse first. Decide with context.</h2>
        </div>
        <Link className="button button-secondary" href="/profile">
          Check my matches →
        </Link>
      </div>
      <p className="muted">
        No login or profile needed. Explore saved posts, open the details, and
        verify the source before applying.
      </p>
      <p className="small muted">
        Includes posts with expired or unknown deadlines; listing here does not
        mean applications are open. Always confirm requirements at the official
        source.
      </p>

      {!result || !result.data ? (
        <div className="notice notice-error">
          <p>Jobs are temporarily unavailable. Please try again shortly.</p>
        </div>
      ) : result.data.length === 0 ? (
        <div className="panel">
          <h3>
            {result.pagination.totalItems
              ? 'No jobs on this page'
              : 'No jobs saved yet'}
          </h3>
          <p className="muted">
            {result.pagination.totalItems ? (
              <Link href="/#jobs">Return to the first page.</Link>
            ) : (
              'New notifications will appear here after the next successful collection.'
            )}
          </p>
        </div>
      ) : (
        <>
          <p className="small muted catalogue-count">
            {result.pagination.totalItems} saved posts · Page{' '}
            {result.pagination.page} of {result.pagination.totalPages} · A–Z
          </p>
          <div className="catalogue-grid">
            {result.data.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
          <nav className="catalogue-pagination" aria-label="Job pages">
            {result.pagination.page > 1 && (
              <Link
                className="button button-secondary"
                rel="prev"
                href={`/?page=${result.pagination.page - 1}#jobs`}
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
                href={`/?page=${result.pagination.page + 1}#jobs`}
              >
                Next page →
              </Link>
            )}
          </nav>
        </>
      )}
    </section>
  );
}
