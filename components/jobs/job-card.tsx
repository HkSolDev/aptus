import Link from 'next/link';
import type { ReactNode } from 'react';

export interface PublicJobItem {
  id: string;
  postName: string;
  organization?: string | null;
  vacancies: number | null;
  applicationLastDate: string | null;
  educationRequired: string;
  payLevel?: string | null;
  source: {
    name: string;
  };
}

function formatDate(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function JobCard({
  job,
  recommended = false,
  matchSummary,
  actions,
}: {
  job: PublicJobItem;
  recommended?: boolean;
  matchSummary?: ReactNode;
  actions?: ReactNode;
}) {
  const applyBy = formatDate(job.applicationLastDate);
  const qualification = job.educationRequired?.trim();
  const hasQualification =
    qualification && !/^not specified$/i.test(qualification);

  return (
    <article
      className={`job-card catalogue-card${recommended ? ' home-recommended-card' : ''}`}
    >
      <div className="catalogue-identity">
        <h3 className="job-title">
          <Link href={`/jobs/${encodeURIComponent(job.id)}`}>
            {job.postName}
          </Link>
        </h3>
        {job.organization?.trim() && (
          <p className="muted">{job.organization}</p>
        )}
        {applyBy && <p className="catalogue-deadline">Apply by {applyBy}</p>}
        {matchSummary}
      </div>
      <div className="catalogue-facts">
        {hasQualification && (
          <div className="catalogue-qualification">
            <p className="small muted">Qualification</p>
            <p>{qualification}</p>
          </div>
        )}
        {(job.vacancies != null || job.payLevel) && (
          <p className="small catalogue-extra">
            {job.vacancies != null &&
              `${job.vacancies.toLocaleString('en-IN')} vacancies`}
            {job.vacancies != null && job.payLevel && ' · '}
            {job.payLevel && `Pay: ${job.payLevel}`}
          </p>
        )}
      </div>
      <div className="catalogue-actions">
        <Link
          className="catalogue-open"
          href={`/jobs/${encodeURIComponent(job.id)}`}
        >
          View details
        </Link>
        <div className="home-job-actions">
          {actions ?? (
            <Link className="home-save" href="/sign-in">
              Save
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
