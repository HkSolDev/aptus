import type { Metadata } from 'next';
import Link from 'next/link';

interface JobDetailData {
  id: string;
  postName: string;
  postGroup?: string | null;
  payLevel?: string | null;
  vacancies?: number | null;
  applicationLastDate?: string | null;
  ageAsOnDate?: string | null;
  minAge?: number | null;
  maxAge?: number | null;
  educationRequired?: string;
  minEducationLevel?: string | null;
  minMarksPercent?: number | null;
  categoryRelaxationApplies?: boolean | null;
  source: {
    name: string;
    url?: string;
    notificationPdfUrl?: string | null;
    officialSiteUrl?: string | null;
    applyUrl?: string | null;
    fetchedAt?: string;
  };
}

async function fetchJobDetail(id: string): Promise<JobDetailData | null> {
  const backendUrl =
    process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:8081';
  try {
    const res = await fetch(
      `${backendUrl}/api/jobs/${encodeURIComponent(id)}`,
      {
        next: { revalidate: 60 },
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as JobDetailData;
  } catch {
    return null;
  }
}

export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const job = await fetchJobDetail(params.id);
  if (!job) {
    return {
      title: 'Job Details | Aptus',
      description: 'View government job eligibility details on Aptus.',
    };
  }
  return {
    title: `${job.postName} | Aptus`,
    description: `${job.postName} notification from ${job.source.name}. Education: ${job.educationRequired ?? 'Not specified'}.`,
  };
}

export default async function JobDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = await props.params;
  const job = await fetchJobDetail(params.id);

  if (!job) {
    return (
      <section className="job-detail">
        <nav aria-label="Breadcrumb">
          <Link href="/#jobs" className="button button-secondary">
            ← Back to all jobs
          </Link>
        </nav>
        <h1>Job details</h1>
        <div className="notice">
          <p>
            Detailed job facts are being connected via the backend JSON API (
            <code>GET /api/jobs/:id</code>).
          </p>
          <p>
            You can browse all current notifications on the{' '}
            <Link href="/#jobs">all jobs page</Link>.
          </p>
        </div>
      </section>
    );
  }

  return (
    <article className="job-detail">
      <nav aria-label="Breadcrumb">
        <Link href="/#jobs" className="button button-secondary">
          ← Back to all jobs
        </Link>
      </nav>
      <h1>{job.postName}</h1>
      <p className="small muted">
        {job.source.name}
        {job.source.fetchedAt && ` · Collected ${job.source.fetchedAt}`}
      </p>
      <p className="notice">
        Stored notification details, not an eligibility guarantee. Missing
        fields need manual verification. Check the official source for updates.
      </p>

      <div className="job-detail-grid">
        <section className="panel">
          <h2>At a glance</h2>
          <dl className="job-facts">
            <div>
              <dt>Application deadline</dt>
              <dd>{job.applicationLastDate ?? 'Not specified'}</dd>
            </div>
            <div>
              <dt>Vacancies</dt>
              <dd>{job.vacancies ?? 'Not specified'}</dd>
            </div>
            <div>
              <dt>Pay level</dt>
              <dd>{job.payLevel ?? 'Not specified'}</dd>
            </div>
            <div>
              <dt>Post group</dt>
              <dd>{job.postGroup ?? 'Not specified'}</dd>
            </div>
            <div>
              <dt>Age criteria</dt>
              <dd>
                {job.minAge && job.maxAge
                  ? `${job.minAge}–${job.maxAge} years`
                  : 'Not specified'}
              </dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2>Qualification</h2>
          <p className="qualification-text">
            {job.educationRequired ?? 'Not specified'}
          </p>
          <dl className="job-facts">
            <div>
              <dt>Minimum level</dt>
              <dd>{job.minEducationLevel ?? 'Not specified'}</dd>
            </div>
            <div>
              <dt>Minimum marks</dt>
              <dd>
                {job.minMarksPercent !== null &&
                job.minMarksPercent !== undefined
                  ? `${job.minMarksPercent}%`
                  : 'Not specified'}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <p className="job-detail-section">
        <Link className="button button-primary" href="/profile">
          Check matches with my profile →
        </Link>
      </p>
    </article>
  );
}
