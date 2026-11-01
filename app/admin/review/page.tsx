import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { ReviewQueueView } from '@/components/admin/review-queue-view';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Job Review Queue — Admin',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function AdminReviewPage() {
  const cookie = (await headers()).get('cookie');
  const backend = process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:8081';

  let isOperator = false;

  if (cookie) {
    try {
      const res = await fetch(
        `${backend}/api/admin/review-drafts/operator-status`,
        {
          headers: { cookie },
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.is_operator === true) {
          isOperator = true;
        }
      }
    } catch {
      // verification failure
    }
  }

  if (!isOperator) {
    return (
      <div
        style={{
          maxWidth: '600px',
          margin: '4rem auto',
          padding: '0 1rem',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: '1.75rem', marginBottom: '1rem' }}>
          Review Operator Access Required
        </h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
          This page is restricted to authorized operators with a verified email
          matching the deployment allowlist.
        </p>
        <Link href="/sign-in" className="button button-primary">
          Sign In
        </Link>
      </div>
    );
  }

  // Fetch queue items. A failed fetch is an outage, not an empty queue:
  // only a successful response may be shown as zero held candidates.
  let queueData = {
    items: [],
    total_items: 0,
    counts_as_of: new Date().toISOString(),
    next_cursor: null as string | null,
  };
  let queueError: string | null = null;
  try {
    const queueRes = await fetch(`${backend}/api/admin/review-drafts`, {
      headers: { cookie: cookie || '' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (queueRes.ok) {
      queueData = await queueRes.json();
    } else {
      queueError = `Queue request failed (${queueRes.status}).`;
    }
  } catch {
    queueError = 'Queue request timed out or could not reach the server.';
  }

  return (
    <ReviewQueueView
      initialItems={queueData.items}
      totalItems={queueData.total_items}
      countsAsOf={queueData.counts_as_of}
      initialNextCursor={queueData.next_cursor}
      initialError={queueError}
    />
  );
}
