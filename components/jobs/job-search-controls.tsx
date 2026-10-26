'use client';

import { useState } from 'react';
import Form from 'next/form';
import Link from 'next/link';
import { type HomeView, homeSearchParams } from '@/frontend/home-view';
import { HomeViewFields } from './home-layout-controls';
import styles from './job-search-controls.module.css';
import {
  JOB_QUALIFICATIONS,
  type JobFilters,
} from '@/frontend/public-job-filters';

export function JobSearchControls({
  filters,
  view,
}: {
  filters: JobFilters;
  view: HomeView;
}) {
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const hasQualification = Boolean(filters.qualification);
  const activeCount = hasQualification ? 1 : 0;
  const isExpanded = mobileExpanded || hasQualification;

  return (
    <>
      <Form
        action="/"
        scroll={false}
        className={styles.search}
        key={`${filters.q}:${filters.qualification}`}
      >
        <input type="hidden" name="sort" value={filters.sort} />
        <HomeViewFields view={view} />
        <label className={styles.searchLabel}>
          Search all jobs
          <input
            className={styles.input}
            name="q"
            type="search"
            defaultValue={filters.q}
            maxLength={100}
            placeholder="Exam, role or organization"
          />
        </label>

        <div className={styles.mobileFilterToggle}>
          <button
            type="button"
            className={styles.filterButton}
            aria-expanded={isExpanded}
            aria-controls="secondary-filters"
            onClick={() => setMobileExpanded((prev) => !prev)}
          >
            <span>Filters{activeCount > 0 ? ` (${activeCount})` : ''}</span>
            <span className={styles.filterChevron} aria-hidden="true">
              {isExpanded ? '▴' : '▾'}
            </span>
          </button>
        </div>

        <div
          id="secondary-filters"
          className={`${styles.secondaryFilters}${isExpanded ? ` ${styles.isExpanded}` : ''}`}
        >
          <label className={styles.qualificationLabel}>
            Qualification
            <select
              className={styles.select}
              name="qualification"
              defaultValue={filters.qualification}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            >
              <option value="">All qualifications</option>
              {JOB_QUALIFICATIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value="ITI" disabled>
                ITI — not available yet
              </option>
            </select>
          </label>
        </div>

        <button className={`button ${styles.submit}`} type="submit">
          Search
        </button>
      </Form>
      {(filters.q || filters.qualification) && (
        <div className={styles.feedback}>
          <p>Searching all jobs. Clear your search to return to browsing.</p>
          <Link
            className={styles.clear}
            href={`/?${homeSearchParams({ ...filters, q: '', qualification: '' }, 1, view)}`}
          >
            Clear search and filter
          </Link>
        </div>
      )}
    </>
  );
}

export function JobSortControl({
  filters,
  view,
}: {
  filters: JobFilters;
  view: HomeView;
}) {
  return (
    <Form action="/" scroll={false} className={styles.sort}>
      <input type="hidden" name="q" value={filters.q} />
      <input type="hidden" name="qualification" value={filters.qualification} />
      <HomeViewFields view={view} />
      <label>
        Sort
        <select
          className={styles.sortSelect}
          name="sort"
          aria-label="Sort all jobs"
          value={filters.sort}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          <option value="soonest">Deadline: soonest first</option>
          <option value="furthest">Deadline: furthest first</option>
        </select>
      </label>
      <noscript>
        <button className="button button-secondary" type="submit">
          Apply sort
        </button>
      </noscript>
    </Form>
  );
}
