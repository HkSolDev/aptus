import type { Metadata } from 'next';
import Link from 'next/link';
import { fetchPublicJobs } from '@/components/jobs/catalogue-grid';
import { RecommendationsPreview } from '@/components/results/recommendations-preview';

export const metadata: Metadata = {
  title: 'Saved jobs',
  robots: { index: false, follow: false },
};

export default async function SavedPage() {
  if (
    process.env.APTUS_LOCAL_REVIEW === '1' &&
    process.env.NODE_ENV === 'development'
  ) {
    const result = await fetchPublicJobs(1, {
      q: '',
      qualification: '',
      sort: 'soonest',
    });
    if (result?.designReview)
      return <RecommendationsPreview savedJobs={result.data} />;
  }
  return (
    <section className="intro" aria-labelledby="saved-title">
      <h1 id="saved-title">Saved jobs</h1>
      <div className="panel">
        <p>Saving jobs is not available yet.</p>
        <p className="muted">
          This section will keep the jobs you choose to read later.
        </p>
        <Link className="button button-secondary" href="/#jobs">
          Explore jobs
        </Link>
      </div>
    </section>
  );
}
