'use client';

import Link from 'next/link';
import { useWorkspace } from '@/components/providers/workspace-provider';
import { ResultCard } from './result-card';

export function ResultsView() {
  const { results, isStale } = useWorkspace();

  if (!results) {
    return (
      <section
        id="results"
        className="results-panel"
        aria-labelledby="results-title"
      >
        <div className="results-heading">
          <div>
            <p className="eyebrow">02 / YOUR POSSIBILITIES</p>
            <h2 id="results-title">Your next steps, clearer.</h2>
          </div>
          <span id="result-count" className="count-label">
            Ready when you are
          </span>
        </div>

        <p id="results-status" className="small muted" role="status">
          No matches currently in memory. Complete your profile to check the
          saved notifications.
        </p>

        <div id="results-initial" className="welcome-panel">
          <span className="welcome-symbol" aria-hidden="true">
            ↗
          </span>
          <p className="eyebrow">A GOOD PLACE TO BEGIN</p>
          <h3>
            Make room for
            <br />
            what comes next.
          </h3>
          <p>
            Start with your education and date of birth. We’ll compare the saved
            age, qualification, and marks requirements.
          </p>
          <div className="welcome-steps">
            <p>
              <span>01</span>Build a small profile
            </p>
            <p>
              <span>02</span>Read your matching results
            </p>
            <p>
              <span>03</span>Verify the source before applying
            </p>
          </div>
          <p style={{ marginTop: 'var(--space-5)' }}>
            <Link className="button button-primary" href="/profile">
              Go to profile form →
            </Link>
          </p>
        </div>
      </section>
    );
  }

  const { matches, needsManualCheck, sourcesChecked, userId } = results;
  const totalCount = matches.length + needsManualCheck.length;

  return (
    <section
      id="results"
      className="results-panel"
      aria-labelledby="results-title"
    >
      <div className="results-heading">
        <div>
          <p className="eyebrow">02 / YOUR POSSIBILITIES</p>
          <h2 id="results-title" tabIndex={-1}>
            Your next steps, clearer.
          </h2>
        </div>
        <span id="result-count" className="count-label">
          {totalCount} {totalCount === 1 ? 'post' : 'posts'} to review
        </span>
      </div>

      {isStale && (
        <p id="results-stale" className="notice" role="status">
          Your profile details have changed in memory. Check again to update
          these results.
        </p>
      )}

      <div id="results-content">
        {sourcesChecked.length > 0 && (
          <details className="source-summary">
            <summary>
              Sources included in this check ({sourcesChecked.length})
            </summary>
            <ul id="sources-list">
              {sourcesChecked.map((src, i) => (
                <li key={i}>{src}</li>
              ))}
            </ul>
          </details>
        )}

        <p className="notice">
          These are preliminary checks of saved fields. Subject, gender,
          category conditions, age reference dates, and other rules may still
          need verification.
        </p>

        {matches.length > 0 && (
          <section id="matched-section" className="result-group">
            <div className="group-heading">
              <h3>Matches on saved fields</h3>
              <span id="matched-count" className="badge">
                {matches.length}
              </span>
            </div>
            <div id="matched-list" className="job-list">
              {matches.map((post) => (
                <ResultCard
                  key={post.id}
                  post={post}
                  userId={userId}
                  isManualCheck={false}
                />
              ))}
            </div>
          </section>
        )}

        {needsManualCheck.length > 0 && (
          <section id="manual-section" className="result-group">
            <div className="group-heading">
              <h3>Worth a closer look</h3>
              <span id="manual-count" className="badge badge-warning">
                {needsManualCheck.length}
              </span>
            </div>
            <p className="small muted">
              Missing details need a manual check at the source.
            </p>
            <div id="manual-list" className="job-list">
              {needsManualCheck.map((post) => (
                <ResultCard
                  key={post.id}
                  post={post}
                  userId={userId}
                  isManualCheck={true}
                />
              ))}
            </div>
          </section>
        )}

        {matches.length === 0 && needsManualCheck.length === 0 && (
          <div id="empty-results" className="empty-panel">
            <h3>No posts returned for this profile</h3>
            <p>
              This only covers the notifications currently in Aptus. Review your
              details or check back after more notices are added.
            </p>
            <Link className="button button-secondary" href="/profile">
              Review my profile
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
