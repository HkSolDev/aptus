import type { Metadata } from 'next';
import Link from 'next/link';
import { JobCard, type PublicJobItem } from '@/components/jobs/job-card';

export const metadata: Metadata = {
  title: 'Saved jobs',
  robots: { index: false, follow: false },
};

// Preview saves are intentionally empty until a local review flow provides them.
// Keeping this rendering path lets the existing JobCard presentation turn on
// without introducing account persistence or a backend dependency.
const savedPreviewJobs: PublicJobItem[] = [];

export default function SavedPage() {
  return (
    <section className="intro" aria-labelledby="saved-title">
      <p className="eyebrow">YOUR SHORTLIST</p>
      <h1 id="saved-title">Saved jobs</h1>
      <p className="intro-copy">
        Jobs you keep from browsing will appear here for a closer look later.
      </p>
      {savedPreviewJobs.length ? (
        <div className="job-list">
          {savedPreviewJobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      ) : (
        <div className="panel empty-panel">
          <h2>Your shortlist starts here</h2>
          <p>
            Use Save on any job you want to revisit. You’ll find it here when
            you return.
          </p>
          <Link className="button button-primary" href="/#jobs">
            Explore jobs
          </Link>
        </div>
      )}
    </section>
  );
}
