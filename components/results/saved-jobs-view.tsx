'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/components/providers/workspace-provider';
import { JobCard } from '@/components/jobs/job-card';
import {
  fetchSavedJobs,
  type SavedJobItem,
  type SavedJobsResponse,
} from '@/frontend/saved-jobs-api';
import styles from './saved-jobs-view.module.css';

function isDeadlinePassed(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return dateStr < today;
}

export function SavedJobsView() {
  const { sessionVersion } = useWorkspace();
  return <SavedJobsContent key={sessionVersion} />;
}

function SavedJobsContent() {
  const { accountName, sessionChecked, unsaveJob } = useWorkspace();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedData, setSavedData] = useState<SavedJobsResponse | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  const loadJobs = useCallback(async (targetPage: number) => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSavedJobs(targetPage);
      if (!mountedRef.current || request !== requestRef.current) return;
      const lastPage = Math.max(1, result.pagination.totalPages);
      if (targetPage > lastPage) {
        setPage(lastPage);
        return;
      }
      setSavedData(result);
    } catch (err) {
      if (!mountedRef.current || request !== requestRef.current) return;
      setError(
        err instanceof Error ? err.message : 'Couldn’t load saved jobs.',
      );
    } finally {
      if (mountedRef.current && request === requestRef.current)
        setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionChecked && accountName !== null) {
      void loadJobs(page);
    } else if (sessionChecked && accountName === null) {
      setLoading(false);
    }
  }, [page, sessionChecked, accountName, loadJobs]);

  const handleRemove = async (jobId: string) => {
    if (removingId) return;
    setRemovingId(jobId);
    try {
      await unsaveJob(jobId);
      if (!mountedRef.current) return;
      const total = Math.max(0, (savedData?.pagination.totalItems ?? 1) - 1);
      const lastPage = Math.max(
        1,
        Math.ceil(total / (savedData?.pagination.pageSize ?? 20)),
      );
      if (page > lastPage) setPage(lastPage);
      else await loadJobs(page);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : 'Couldn’t remove job from saved.',
      );
    } finally {
      setRemovingId(null);
    }
  };

  // Signed out state
  if (sessionChecked && accountName === null) {
    return (
      <section className="intro" aria-labelledby="saved-title">
        <h1 id="saved-title">Saved jobs</h1>
        <div className="panel">
          <p>
            You’re not signed in. Sign in to view and manage your saved jobs.
          </p>
          <Link className="button button-primary" href="/sign-in">
            Sign in
          </Link>
        </div>
      </section>
    );
  }

  // Loading state
  if (!sessionChecked || loading) {
    return (
      <section className={styles.page} aria-labelledby="saved-title">
        <header className={styles.intro}>
          <p className="eyebrow">YOUR SHORTLIST</p>
          <h1 id="saved-title">Saved jobs</h1>
        </header>
        <div className="panel">
          <p role="status">Loading your saved jobs…</p>
        </div>
      </section>
    );
  }

  // Error state
  if (error && !savedData) {
    return (
      <section className={styles.page} aria-labelledby="saved-title">
        <header className={styles.intro}>
          <p className="eyebrow">YOUR SHORTLIST</p>
          <h1 id="saved-title">Saved jobs</h1>
        </header>
        <div className="notice notice-error" role="alert">
          {error}
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void loadJobs(page)}
        >
          Try again
        </button>
      </section>
    );
  }

  const jobs = savedData?.data ?? [];
  const pagination = savedData?.pagination ?? {
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
  };

  // Empty state
  if (!jobs.length) {
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
          <Link className="button button-primary" href="/#jobs">
            Explore jobs
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.page} aria-labelledby="saved-title">
      <header className={styles.intro}>
        <p className="eyebrow">YOUR SHORTLIST</p>
        <h1 id="saved-title">Saved jobs</h1>
        <p className="muted">
          Jobs you saved from browsing. Saving a job keeps it here so you can
          review requirements and deadlines.
        </p>
      </header>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      <div className={styles.grid}>
        {jobs.map((job: SavedJobItem) => {
          const expired = isDeadlinePassed(job.applicationLastDate);
          return (
            <JobCard
              key={job.id}
              job={job}
              matchSummary={
                expired ? (
                  <span className={styles.deadlineClosed}>
                    Application deadline closed
                  </span>
                ) : undefined
              }
              actions={
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={removingId !== null}
                  onClick={() => void handleRemove(job.id)}
                >
                  {removingId === job.id ? 'Removing…' : 'Remove from saved'}
                </button>
              }
            />
          );
        })}
      </div>

      {pagination.totalPages > 1 && (
        <nav className={styles.pagination} aria-label="Saved job pages">
          {page > 1 && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Previous page
            </button>
          )}
          <span className="small muted">
            Page {page} of {pagination.totalPages}
          </span>
          {page < pagination.totalPages && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setPage((p) => p + 1)}
            >
              Next page →
            </button>
          )}
        </nav>
      )}
    </section>
  );
}
