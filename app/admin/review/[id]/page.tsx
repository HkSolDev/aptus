import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CandidateDetailView } from '@/components/admin/candidate-detail-view';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Review Candidate — Admin',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function AdminReviewDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const cookie = (await headers()).get('cookie');
  const backend = process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:8081';

  let isOperator = false;

  if (cookie) {
    try {
      const res = await fetch(`${backend}/api/admin/review-drafts/operator-status`, {
        headers: { cookie },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.is_operator === true) {
          isOperator = true;
        }
      }
    } catch {
      // access check failure
    }
  }

  if (!isOperator) {
    return (
      <div style={{ maxWidth: '600px', margin: '4rem auto', padding: '0 1rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '1rem' }}>Review Operator Access Required</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
          This page is restricted to authorized operators with a verified email matching the deployment allowlist.
        </p>
        <Link href="/sign-in" className="button button-primary">
          Sign In
        </Link>
      </div>
    );
  }

  // Fetch candidate detail
  let detailData = null;
  try {
    const detailRes = await fetch(
      `${backend}/api/admin/review-drafts/${encodeURIComponent(id)}`,
      {
        headers: { cookie: cookie || '' },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      },
    );
    if (detailRes.status === 404) {
      notFound();
    }
    if (detailRes.ok) {
      detailData = await detailRes.json();
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'digest' in err && err.digest === 'NEXT_NOT_FOUND') {
      throw err;
    }
  }

  if (!detailData) {
    notFound();
  }

  return <CandidateDetailView initialData={detailData} />;
}
