import type { Metadata } from 'next';
import { fetchPublicJobs } from '@/components/jobs/catalogue-grid';
import { RecommendationsPreview } from '@/components/results/recommendations-preview';
import { SavedJobsView } from '@/components/results/saved-jobs-view';

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
  return <SavedJobsView />;
}
