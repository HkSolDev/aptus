'use client';

import { useState } from 'react';
import Link from 'next/link';
import styles from './review.module.css';

interface QueueItem {
  id: string;
  bundle_id: string;
  title: string;
  source_name: string;
  source_url: string;
  role_count: number;
  status: string;
  hold_reason: string | null;
  current_revision: {
    id: string;
    revision_number: number;
    canonical_hash: string;
    validation_state: string;
    created_by: string;
    created_at: string;
  } | null;
  updated_at: string;
}

interface ReviewQueueViewProps {
  initialItems: QueueItem[];
  totalItems: number;
  countsAsOf: string;
  initialNextCursor: string | null;
  initialError: string | null;
}

export function ReviewQueueView({
  initialItems,
  totalItems,
  countsAsOf,
  initialNextCursor,
  initialError,
}: ReviewQueueViewProps) {
  const [items, setItems] = useState<QueueItem[]>(initialItems);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/admin/review-drafts?limit=20&cursor=${encodeURIComponent(nextCursor)}`,
        { credentials: 'same-origin', cache: 'no-store' },
      );
      if (!res.ok) throw new Error('queue page failed');
      const data = await res.json();
      setItems((prev) => {
        const known = new Set(prev.map((i) => i.id));
        return [...prev, ...(data.items as QueueItem[]).filter((i) => !known.has(i.id))];
      });
      setNextCursor(data.next_cursor ?? null);
    } catch {
      setLoadError('Could not load the next page. Please retry.');
    } finally {
      setLoadingMore(false);
    }
  };

  const getValidationBadge = (state?: string) => {
    switch (state) {
      case 'checks_passed':
        return <span className={`${styles.badge} ${styles.badgeSuccess}`}>Checks passed</span>;
      case 'completed_with_issues':
        return <span className={`${styles.badge} ${styles.badgeWarning}`}>Issues found</span>;
      case 'checking':
        return <span className={`${styles.badge} ${styles.badgeReview}`}>Checking…</span>;
      case 'waiting_for_worker':
        return <span className={`${styles.badge} ${styles.badgePending}`}>Waiting for worker</span>;
      case 'failed':
        return <span className={`${styles.badge} ${styles.badgeFailed}`}>Check failed</span>;
      default:
        return <span className={`${styles.badge} ${styles.badgePending}`}>Unchecked</span>;
    }
  };

  const totalRoles = items.reduce((acc, item) => acc + item.role_count, 0);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Held Job Review Queue</h1>
        <p className={styles.subtitle}>
          Inspect held candidates, verify quotations against source evidence, save corrections, and request validation.
        </p>
      </header>

      <div className={styles.noticeBar}>
        <div>
          <strong>{totalItems}</strong> notices imported ({totalRoles} roles on this page) as of{' '}
          {new Date(countsAsOf).toLocaleTimeString()}
        </div>
        <div className="small muted">
          Review queue shows imported candidates only, not the full offline crawler backlog.
        </div>
      </div>

      {initialError ? (
        <div className={styles.card} role="alert">
          <p>Review queue temporarily unavailable. Held candidates could not be loaded.</p>
          <p className="muted">{initialError}</p>
          <Link href="/admin/review" className="button button-secondary">
            Retry
          </Link>
        </div>
      ) : items.length === 0 ? (
        <div className={styles.card}>
          <p className="muted">No candidates are currently held in the review queue.</p>
        </div>
      ) : (
        <div className={styles.card} style={{ padding: 0, overflowX: 'auto' }}>
          <table className={styles.queueTable}>
            <thead>
              <tr>
                <th>Candidate / Source</th>
                <th>Roles</th>
                <th>Status</th>
                <th>Revision</th>
                <th>Validation</th>
                <th>Last Update</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={styles.queueRow}>
                  <td>
                    <Link href={`/admin/review/${item.id}`} className={styles.itemTitle}>
                      {item.title}
                    </Link>
                    <div className="small muted" style={{ marginTop: '2px' }}>
                      {item.source_name}
                      {item.hold_reason && ` • ${item.hold_reason}`}
                    </div>
                  </td>
                  <td>{item.role_count}</td>
                  <td>
                    <span
                      className={`${styles.badge} ${
                        item.status === 'held' ? styles.badgeHeld : styles.badgeReview
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td>
                    {item.current_revision ? `R${item.current_revision.revision_number}` : '—'}
                  </td>
                  <td>{getValidationBadge(item.current_revision?.validation_state)}</td>
                  <td className="small muted">
                    {new Date(item.updated_at).toLocaleDateString()}
                  </td>
                  <td>
                    <Link
                      href={`/admin/review/${item.id}`}
                      className="button button-secondary small"
                    >
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!initialError && nextCursor && (
        <div style={{ marginTop: '1rem' }}>
          <button
            type="button"
            className="button button-secondary"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? 'Loading…' : 'Load more candidates'}
          </button>
          {loadError && (
            <p className="muted" role="alert">
              {loadError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
