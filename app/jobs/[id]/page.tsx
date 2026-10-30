import type { Metadata } from 'next';
import Link from 'next/link';
import { jobMetadata } from '../../../components/jobs/job-sharing';
import {
  JobDetailContent,
  type JobDetailData,
} from '../../../components/jobs/job-detail-content';

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
  return jobMetadata(job, process.env.SITE_URL);
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

  return <JobDetailContent job={job} />;
}
