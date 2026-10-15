'use client';

import Form from 'next/form';
import Link from 'next/link';
import { type HomeView, homeSearchParams } from '@/frontend/home-view';
import { HomeViewFields } from './home-layout-controls';
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
  return (
    <>
      <Form
        action="/"
        scroll={false}
        className="job-search"
        key={`${filters.q}:${filters.qualification}`}
      >
        <input type="hidden" name="sort" value={filters.sort} />
        <HomeViewFields view={view} />
        <label>
          Search all jobs
          <input
            name="q"
            type="search"
            defaultValue={filters.q}
            maxLength={100}
            placeholder="Exam, role or organization"
          />
        </label>
        <label>
          Qualification
          <select
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
        <button className="button job-search-submit" type="submit">
          Search
        </button>
      </Form>
      {(filters.q || filters.qualification) && (
        <div className="home-search-feedback">
          <p>Searching all jobs. Clear your search to return to browsing.</p>
          <Link
            className="job-search-clear"
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
    <Form action="/" scroll={false} className="job-sort">
      <input type="hidden" name="q" value={filters.q} />
      <input type="hidden" name="qualification" value={filters.qualification} />
      <HomeViewFields view={view} />
      <label>
        Sort
        <select
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
