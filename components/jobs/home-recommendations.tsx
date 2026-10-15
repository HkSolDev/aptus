'use client';

import Link from 'next/link';
import Form from 'next/form';
import { JobCard, type PublicJobItem } from './job-card';
import { HomeLayoutControls, HomeViewFields } from './home-layout-controls';
import { HomeSaveAction, useHomeReview } from './home-review-state';
import type { HomeView } from '@/frontend/home-view';
import type { JobFilters } from '@/frontend/public-job-filters';

export interface ReviewRecommendation extends PublicJobItem {
  matchReason: string;
  remainingChecks: string;
  matchDetails: string;
}

export function HomeRecommendations({
  jobs,
  filters,
  view,
}: {
  jobs: ReviewRecommendation[];
  filters: JobFilters;
  view: HomeView;
}) {
  const review = useHomeReview();
  if (!review?.ready || filters.q || filters.qualification) return null;
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
  const visible = jobs
    .filter(
      (job) =>
        !review.hidden.includes(job.id) &&
        (!job.applicationLastDate || job.applicationLastDate >= today),
    )
    .sort((a, b) => {
      if (!a.applicationLastDate) return b.applicationLastDate ? 1 : 0;
      if (!b.applicationLastDate) return -1;
      return (
        a.applicationLastDate.localeCompare(b.applicationLastDate) *
        (view.recSort === 'soonest' ? 1 : -1)
      );
    })
    .slice(0, 3);
  return (
    <section
      className="home-recommendations"
      aria-labelledby="recommendations-title"
    >
      <div className="home-section-heading">
        <div>
          <h2 id="recommendations-title">Recommended for you</h2>
          <p className="muted">Based on your recorded qualifications.</p>
        </div>
        <div className="home-result-controls">
          <Form action="/" scroll={false} className="job-sort">
            <HomeViewFields view={view} omit="recSort" />
            <input type="hidden" name="sort" value={filters.sort} />
            <label>
              Sort
              <select
                name="recSort"
                aria-label="Sort recommendations"
                defaultValue={view.recSort}
                key={view.recSort}
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
              >
                <option value="soonest">Deadline: soonest first</option>
                <option value="furthest">Deadline: furthest first</option>
              </select>
            </label>
            <noscript>
              <button type="submit">Apply recommendation sort</button>
            </noscript>
          </Form>
          <HomeLayoutControls filters={filters} view={view} scope="rec" />
          <Link href="/results">See all recommendations →</Link>
        </div>
      </div>
      {visible.length ? (
        <div
          className={`home-job-list home-recommended-list home-layout-${view.recLayout}`}
        >
          {visible.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              recommended
              matchSummary={
                <div className="home-match-summary">
                  <p>
                    <strong>{job.matchReason}</strong>
                  </p>
                  <p className="muted">{job.remainingChecks}</p>
                  <details>
                    <summary>See match details</summary>
                    <p>{job.matchDetails}</p>
                  </details>
                </div>
              }
              actions={
                <>
                  <HomeSaveAction id={job.id} />
                  <button type="button" onClick={() => review.hide(job.id)}>
                    Not interested
                  </button>
                </>
              }
            />
          ))}
        </div>
      ) : (
        <div className="panel">
          <h3>You’ve reviewed these recommendations</h3>
          <p>Browse all jobs or restore the example recommendations.</p>
          <button type="button" onClick={review.restore}>
            Restore hidden recommendations
          </button>
        </div>
      )}
    </section>
  );
}
