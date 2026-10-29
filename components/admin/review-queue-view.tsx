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
}

export function ReviewQueueView({
  initialItems,
  totalItems,
  countsAsOf,
}: ReviewQueueViewProps) {
  const [items] = useState<QueueItem[]>(initialItems);

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
          <strong>{totalItems}</strong> notices imported ({totalRoles} roles) as of{' '}
          {new Date(countsAsOf).toLocaleTimeString()}
        </div>
        <div className="small muted">
          Review queue shows imported candidates only, not the full offline crawler backlog.
        </div>
      </div>

      {items.length === 0 ? (
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
    </div>
  );
}
