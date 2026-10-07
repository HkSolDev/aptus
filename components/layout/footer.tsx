import Link from 'next/link';

export function Footer() {
  return (
    <footer className="page-width site-footer">
      <span className="brand">aptus</span>
      <p>A clearer way to approach your next opportunity.</p>
      <Link href="/profile">Back to your profile ↑</Link>
    </footer>
  );
}
