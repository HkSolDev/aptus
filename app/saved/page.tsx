import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Saved jobs',
  robots: { index: false, follow: false },
};

export default function SavedPage() {
  return (
    <section className="intro" aria-labelledby="saved-title">
      <h1 id="saved-title">Saved jobs</h1>
      <div className="panel">
        <p>Saving jobs is not available yet.</p>
        <p className="muted">
          This section will keep the jobs you choose to read later.
        </p>
        <Link className="button button-secondary" href="/">
          Explore jobs
        </Link>
      </div>
    </section>
  );
}
