import {
  CatalogueGrid,
  fetchPublicJobs,
} from '@/components/jobs/catalogue-grid';
import Link from 'next/link';
import { readJobFilters } from '@/frontend/public-job-filters';
import { JobSearchControls } from '@/components/jobs/job-search-controls';
import { readHomeView } from '@/frontend/home-view';
import { HomeReviewControls } from '@/components/jobs/home-layout-controls';
import { HomeReviewState } from '@/components/jobs/home-review-state';
import { HomeRecommendations } from '@/components/jobs/home-recommendations';

export default async function HomePage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    for (const entry of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value])
      params.append(key, entry);
  }
  const filters = readJobFilters(params);
  const localReview =
    process.env.APTUS_LOCAL_REVIEW === '1' &&
    process.env.NODE_ENV === 'development';
  const view = readHomeView(params, localReview);
  const rawPage = params.get('page') ?? '1';
  const page = Number(rawPage);
  if (
    !filters ||
    !view ||
    params.getAll('page').length > 1 ||
    !/^[1-9]\d*$/.test(rawPage) ||
    !Number.isSafeInteger(page) ||
    page > 10000
  ) {
    return (
      <div className="notice notice-error">
        <h1>Check your search</h1>
        <p>
          Choose a supported qualification and sort order, and keep your search
          under 100 characters.
        </p>
        <Link href="/">Reset search</Link>
      </div>
    );
  }

  const result = await fetchPublicJobs(page, filters);
  const review = localReview && result?.designReview === true;
  if (!review) delete view.reviewProfile;
  const ready = view.reviewProfile === 'ready';
  const searching = Boolean(filters.q || filters.qualification);

  const content = (
    <div className="home-page">
      <section className="intro home-intro" aria-labelledby="page-title">
        <div>
          <h1 id="page-title">
            {ready
              ? 'Find a job that fits you.'
              : 'Find your next opportunity.'}
          </h1>
          <p className="intro-copy">
            Search all jobs, or explore opportunities below.
          </p>
        </div>
      </section>

      <JobSearchControls filters={filters} view={view} />
      {view.reviewProfile === 'setup' && !searching && (
        <section className="panel home-profile-gate">
          <h2>Find jobs for your qualifications</h2>
          <p>Complete your profile to see recommendations here.</p>
          <Link className="button button-secondary" href="/profile">
            Complete profile
          </Link>
        </section>
      )}
      {ready && result?.reviewRecommendations && (
        <HomeRecommendations
          jobs={result.reviewRecommendations}
          filters={filters}
          view={view}
        />
      )}
      <CatalogueGrid
        page={page}
        filters={filters}
        view={view}
        result={result}
      />
      {view.reviewProfile === 'guest' && (
        <div className="home-guest-note">
          <strong>Want suggestions based on your profile?</strong>{' '}
          <Link href="/sign-in">Sign in to get started</Link>
        </div>
      )}
    </div>
  );
  return review ? (
    <HomeReviewState key={view.reviewProfile} profile={view.reviewProfile}>
      <HomeReviewControls view={view} />
      {content}
    </HomeReviewState>
  ) : (
    content
  );
}
