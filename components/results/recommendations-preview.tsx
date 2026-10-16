'use client';

import { useMemo, useState } from 'react';
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
    educationRequired: 'BSc in Physics or Diploma in Electronics',
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

export function RecommendationsPreview() {
  const [search, setSearch] = useState('');
  const [qualification, setQualification] =
    useState<keyof typeof qualificationLabels>('');
  const [sort, setSort] = useState<'soonest' | 'furthest'>('soonest');
  const [layout, setLayout] = useState<'rows' | 'cards'>('rows');
  const [hidden, setHidden] = useState<string[]>([]);
  const [showingHidden, setShowingHidden] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return previewRecommendations
      .filter((job) =>
        showingHidden ? hidden.includes(job.id) : !hidden.includes(job.id),
      )
      .filter(
        (job) =>
          !query ||
          `${job.postName} ${job.organization}`
            .toLocaleLowerCase()
            .includes(query),
      )
      .filter((job) => !qualification || job.level === qualification)
      .sort((a, b) => {
        if (!a.applicationLastDate) return b.applicationLastDate ? 1 : 0;
        if (!b.applicationLastDate) return -1;
        const comparison = a.applicationLastDate.localeCompare(
          b.applicationLastDate,
        );
        return sort === 'soonest' ? comparison : -comparison;
      });
  }, [hidden, qualification, search, showingHidden, sort]);

  const filtered = Boolean(search.trim() || qualification);

  function clearFilters() {
    setSearch('');
    setQualification('');
  }

  return (
    <section className={styles.page} aria-labelledby="recommendations-title">
      <header className={styles.intro}>
        <h1 id="recommendations-title">
          {showingHidden ? 'Hidden recommendations' : 'Recommended for you'}
        </h1>
        <p className="muted">
          {showingHidden
            ? 'Restore a job whenever you want. It stays available under All jobs.'
            : 'Search within your recommendations. Remaining requirements still need checking.'}
        </p>
        <p className={styles.previewNote}>
          Fictional design preview · no account data is saved.
        </p>
      </header>

      {!showingHidden ? (
        <form
          className={styles.search}
          onSubmit={(event) => event.preventDefault()}
        >
          <label>
            Search recommended jobs
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
                aria-label="Sort recommendations"
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
            <div className={styles.layout} aria-label="Recommendation layout">
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
          <button
            className="text-button"
            type="button"
            onClick={() => setShowingHidden((value) => !value)}
          >
            {showingHidden
              ? 'Back to recommendations'
              : `Hidden jobs (${hidden.length})`}
          </button>
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
                recommended
                matchSummary={
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
                }
                actions={
                  showingHidden ? (
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
                        {isSaved ? 'Saved for preview' : 'Save'}
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
            {showingHidden
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
    </section>
  );
}
