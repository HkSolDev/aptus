import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './job-card.module.css';
import { SaveJobButton } from './save-job-button';

export interface PublicJobItem {
  id: string;
  postName: string;
  organization?: string | null;
  vacancies: number | null;
  applicationLastDate: string | null;
  educationRequired: string | null;
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
      className={`${styles.card}${recommended ? ` ${styles.recommended}` : ''}`}
      data-job-card
    >
      <div>
        <h3 className={styles.title} data-job-title>
          <Link href={`/jobs/${encodeURIComponent(job.id)}`}>
            {job.postName}
          </Link>
        </h3>
        {job.organization?.trim() && (
          <p className={`muted ${styles.organization}`}>{job.organization}</p>
        )}
        {applyBy && <p className={styles.deadline}>Apply by {applyBy}</p>}
        {matchSummary}
      </div>
      <div className={styles.facts}>
        {hasQualification && (
          <div className={styles.qualification}>
            <p className="small muted">Qualification</p>
            <p>{qualification}</p>
          </div>
        )}
        {(job.vacancies != null || job.payLevel) && (
          <p className={`small ${styles.extra}`} data-job-extra>
            {job.vacancies != null &&
              `${job.vacancies.toLocaleString('en-IN')} vacancies`}
            {job.vacancies != null && job.payLevel && ' · '}
            {job.payLevel && `Pay: ${job.payLevel}`}
          </p>
        )}
      </div>
      <div className={styles.actions}>
        <Link
          className={styles.open}
          href={`/jobs/${encodeURIComponent(job.id)}`}
        >
          View details
        </Link>
        <div className={styles.secondaryActions}>
          {actions ?? <SaveJobButton id={job.id} />}
        </div>
      </div>
    </article>
  );
}
