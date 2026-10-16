'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  useDesignReview,
  defaultReviewView,
  type ReviewListView,
} from '@/components/jobs/design-review-state';
import { JobCard, type PublicJobItem } from '@/components/jobs/job-card';
import styles from './recommendations-preview.module.css';

type PreviewRecommendation = PublicJobItem & {
  level: 'TWELFTH' | 'DIPLOMA' | 'BACHELORS';
  matchReason: string;
  remainingChecks: string;
  matchDetails: string;
};

const previewRecommendations: PreviewRecommendation[] = [
  {
    id: 'review-assistant-engineer',
    postName:
      'Assistant Engineer — Mechanical Maintenance and Workshop Operations',
    organization: 'Example Infrastructure Corporation',
    applicationLastDate: '2026-12-18',
    educationRequired: 'BTech in Mechanical Engineering',
    vacancies: 36,
    payLevel: 'Level 8',
    level: 'BACHELORS',
    matchReason: 'Matches your BTech in Mechanical Engineering',
    remainingChecks: 'Other notice conditions need checking',
    matchDetails:
      'Example qualification match only. Check age, category and notice conditions before applying.',
    source: { name: 'Fictional design example' },
  },
  {
    id: 'review-technical-assistant',
    postName: 'Technical Assistant — Physics and Electronics',
    organization: 'Example Public Research Institute',
    applicationLastDate: '2026-11-30',
    educationRequired: 'BSc Physics or Diploma in Electronics',
    vacancies: 120,
    payLevel: 'Level 4',
    level: 'DIPLOMA',
    matchReason: 'Matches your Diploma in Electronics',
    remainingChecks: 'Marks and experience need checking',
    matchDetails:
      'This fictional notice has a Diploma route. Minimum marks and relevant experience still need checking.',
    source: { name: 'Fictional design example' },
  },
  {
    id: 'review-laboratory-assistant',
    postName: 'Laboratory Assistant',
    organization: 'Example Public Institute',
    applicationLastDate: null,
    educationRequired: 'Diploma in a relevant subject',
    vacancies: 12,
    payLevel: null,
    level: 'DIPLOMA',
    matchReason: 'Your diploma may be relevant',
    remainingChecks: 'Required subject needs checking',
    matchDetails:
      'The exact subject condition is unavailable in this fictional preview, so check the recruitment notice.',
    source: { name: 'Fictional design example' },
  },
];

const qualificationLabels = {
  '': 'All qualifications',
  TWELFTH: '12th pass',
  DIPLOMA: 'Diploma',
  BACHELORS: 'Bachelor’s degree',
};

export function RecommendationsPreview({
  savedJobs,
}: {
  savedJobs?: PublicJobItem[];
}) {
  const savedView = savedJobs !== undefined;
  const review = useDesignReview();
  const scope = savedView ? 'saved' : 'recommendations';
  const [localView, setLocalView] = useState(defaultReviewView);
  const { search, qualification, sort, layout, showingHidden } =
    review?.views[scope] ?? localView;
  function updateView(patch: Partial<ReviewListView>) {
    if (review)
      review.setViews((current) => ({
        ...current,
        [scope]: { ...current[scope], ...patch },
      }));
    else setLocalView((current) => ({ ...current, ...patch }));
  }
  const setSearch = (search: string) => updateView({ search });
  const setQualification = (qualification: ReviewListView['qualification']) =>
    updateView({ qualification });
  const setSort = (sort: ReviewListView['sort']) => updateView({ sort });
  const setLayout = (layout: ReviewListView['layout']) =>
    updateView({ layout });
  const [localHidden, setLocalHidden] = useState<string[]>([]);
  const [localSaved, setLocalSaved] = useState<string[]>([]);
  const { saved, setSaved, hidden, setHidden } = review ?? {
    saved: localSaved,
    setSaved: setLocalSaved,
    hidden: localHidden,
    setHidden: setLocalHidden,
  };
  const sourceJobs: (PublicJobItem & Partial<PreviewRecommendation>)[] =
    savedView
      ? savedJobs
          .filter((job) => saved.includes(job.id))
          .map((job) => ({
            ...job,
            educationRequired:
              previewRecommendations.find((example) => example.id === job.id)
                ?.educationRequired ?? job.educationRequired,
          }))
      : previewRecommendations;

  const visible = (() => {
    const query = search.trim().toLocaleLowerCase();
    return sourceJobs
      .filter(
        (job) =>
          savedView ||
          (showingHidden ? hidden.includes(job.id) : !hidden.includes(job.id)),
      )
      .filter(
        (job) =>
          !query ||
          `${job.postName} ${job.organization}`
            .toLocaleLowerCase()
            .includes(query),
      )
      .filter((job) => {
        if (!qualification) return true;
        // Discovery labels for fictional review jobs, never eligibility rules.
        const patterns = {
          TWELFTH: /12th/i,
          DIPLOMA: /diploma/i,
          BACHELORS: /btech|bsc|bachelor/i,
        };
        return patterns[qualification].test(job.educationRequired);
      })
      .sort((a, b) => {
        if (!a.applicationLastDate) return b.applicationLastDate ? 1 : 0;
        if (!b.applicationLastDate) return -1;
        const comparison = a.applicationLastDate.localeCompare(
          b.applicationLastDate,
        );
        return sort === 'soonest' ? comparison : -comparison;
      });
  })();

  const filtered = Boolean(search.trim() || qualification);

  function clearFilters() {
    setSearch('');
    setQualification('');
  }

  if (savedView && !sourceJobs.length)
    return (
      <section className={styles.page} aria-labelledby="saved-title">
        <header className={styles.intro}>
          <p className="eyebrow">YOUR SHORTLIST</p>
          <h1 id="saved-title">Saved jobs</h1>
          <p className="muted">
            Save interesting jobs to take a closer look later.
          </p>
        </header>
        <div className={`panel ${styles.empty}`}>
          <h2>Your shortlist starts here</h2>
          <p>Use Save on any job. You’ll find it here when you return.</p>
          <Link
            className="button button-primary"
            href="/?reviewProfile=ready#jobs"
          >
            Explore jobs
          </Link>
        </div>
      </section>
    );

  return (
    <section className={styles.page} aria-labelledby="recommendations-title">
      {!savedView && (
        <Link className={styles.back} href="/?reviewProfile=ready">
          ‹ Home
        </Link>
      )}
      <header className={styles.intro}>
        {savedView && <p className="eyebrow">YOUR SHORTLIST</p>}
        <h1 id="recommendations-title">
          {savedView
            ? 'Saved jobs'
            : showingHidden
              ? 'Hidden recommendations'
              : 'Recommended for you'}
        </h1>
        <p className="muted">
          {savedView
            ? 'Jobs you kept from recommendations and browsing. Saving doesn’t apply for a job.'
            : showingHidden
              ? 'Restore a job whenever you want. It stays available under All jobs.'
              : 'Search within your recommendations. Remaining requirements still need checking.'}
        </p>
      </header>

      {!showingHidden ? (
        <form
          className={styles.search}
          onSubmit={(event) => event.preventDefault()}
        >
          <label>
            {savedView ? 'Search saved jobs' : 'Search recommended jobs'}
            <input
              type="search"
              placeholder="Exam, role or organization"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            Qualification
            <select
              value={qualification}
              onChange={(event) =>
                setQualification(
                  event.target.value as keyof typeof qualificationLabels,
                )
              }
            >
              {Object.entries(qualificationLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="button button-primary" type="submit">
            Search
          </button>
        </form>
      ) : null}

      <div className={styles.toolbar}>
        <p className="small muted" aria-live="polite">
          {visible.length} fictional {visible.length === 1 ? 'job' : 'jobs'}
        </p>
        <div className={styles.controls}>
          {!showingHidden ? (
            <label className={styles.sort}>
              <span>Sort</span>
              <select
                aria-label={
                  savedView ? 'Sort saved jobs' : 'Sort recommendations'
                }
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as 'soonest' | 'furthest')
                }
              >
                <option value="soonest">Deadline: soonest first</option>
                <option value="furthest">Deadline: furthest first</option>
              </select>
            </label>
          ) : null}
          {!showingHidden ? (
            <div
              className={styles.layout}
              aria-label={
                savedView ? 'Saved jobs layout' : 'Recommendation layout'
              }
            >
              <button
                type="button"
                aria-pressed={layout === 'rows'}
                onClick={() => setLayout('rows')}
              >
                Rows
              </button>
              <button
                type="button"
                aria-pressed={layout === 'cards'}
                onClick={() => setLayout('cards')}
              >
                Cards
              </button>
            </div>
          ) : null}
          {!savedView && (
            <button
              className="text-button"
              type="button"
              onClick={() => updateView({ showingHidden: !showingHidden })}
            >
              {showingHidden
                ? 'Back to recommendations'
                : `Hidden jobs (${hidden.length})`}
            </button>
          )}
        </div>
      </div>

      {visible.length ? (
        <div className={`${styles.jobs} ${styles[layout]}`}>
          {visible.map((job) => {
            const isSaved = saved.includes(job.id);
            return (
              <JobCard
                key={job.id}
                job={job}
                recommended={!savedView}
                matchSummary={
                  !savedView && (
                    <div className={styles.matchSummary}>
                      <p>
                        <strong>{job.matchReason}</strong>
                      </p>
                      <p className="muted">{job.remainingChecks}</p>
                      <details>
                        <summary>See match details</summary>
                        <p>{job.matchDetails}</p>
                      </details>
                    </div>
                  )
                }
                actions={
                  savedView ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSaved((current) =>
                          current.filter((id) => id !== job.id),
                        )
                      }
                    >
                      Remove from saved
                    </button>
                  ) : showingHidden ? (
                    <button
                      type="button"
                      onClick={() =>
                        setHidden((current) =>
                          current.filter((id) => id !== job.id),
                        )
                      }
                    >
                      Restore
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-pressed={isSaved}
                        onClick={() =>
                          setSaved((current) =>
                            current.includes(job.id)
                              ? current.filter((id) => id !== job.id)
                              : [...current, job.id],
                          )
                        }
                      >
                        {isSaved ? 'Saved ✓' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setHidden((current) => [...current, job.id])
                        }
                      >
                        Not interested
                      </button>
                    </>
                  )
                }
              />
            );
          })}
        </div>
      ) : (
        <section className={`panel ${styles.empty}`}>
          <h2>
            {savedView
              ? 'No saved jobs match this search'
              : showingHidden
                ? 'No hidden jobs'
                : filtered
                  ? 'No recommendations match this search'
                  : 'You’re all caught up'}
          </h2>
          <p>
            {showingHidden
              ? 'Jobs you dismiss from recommendations will appear here.'
              : filtered
                ? 'Try another search or qualification.'
                : 'Explore all jobs or restore hidden recommendations.'}
          </p>
          {filtered ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={clearFilters}
            >
              Clear search and filter
            </button>
          ) : null}
        </section>
      )}
      <p className={styles.previewNote}>
        Fictional design preview · no account data is saved.
      </p>
    </section>
  );
}
