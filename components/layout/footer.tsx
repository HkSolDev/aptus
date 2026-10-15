import Link from 'next/link';

export function Footer() {
  return (
    <footer className="page-width site-footer">
      <span className="brand">Aptus</span>
      <p>Check the recruitment notice before applying.</p>
      <Link href="/how-it-works">How Aptus works</Link>
    </footer>
  );
}
