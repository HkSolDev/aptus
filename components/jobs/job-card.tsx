import Link from 'next/link';

export interface PublicJobItem {
  id: string;
  postName: string;
  vacancies: number | null;
  applicationLastDate: string | null;
  educationRequired: string;
  source: {
    name: string;
  };
}

function formatDate(raw: string | null): string {
  if (!raw) return 'Not specified';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function JobCard({ job }: { job: PublicJobItem }) {
  const applyBy = formatDate(job.applicationLastDate);
  const vacancies =
    job.vacancies === null || job.vacancies === undefined
      ? 'Not specified'
      : String(job.vacancies);

  return (
    <article className="job-card catalogue-card">
      <p className="small muted job-source">{job.source.name}</p>
      <h3 className="job-title">
        <Link href={`/jobs/${encodeURIComponent(job.id)}`}>{job.postName}</Link>
      </h3>
      <dl className="job-facts">
        <div>
          <dt>Apply by</dt>
          <dd>{applyBy}</dd>
        </div>
        <div>
          <dt>Vacancies</dt>
          <dd>{vacancies}</dd>
        </div>
      </dl>
      <p className="small catalogue-qualification">{job.educationRequired}</p>
      <Link
        className="catalogue-open"
        href={`/jobs/${encodeURIComponent(job.id)}`}
      >
        View job details <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}
