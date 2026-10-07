import Link from 'next/link';
import { AuthBar } from '@/components/auth/auth-bar';

export function Header() {
  return (
    <header className="site-header page-width">
      <Link href="/" className="brand" aria-label="Aptus home">
        <span className="brand-mark" aria-hidden="true">
          a
        </span>
        aptus
        <span className="brand-note">A little clarity. A new possibility.</span>
      </Link>
      <div className="header-actions">
        <nav aria-label="Main navigation">
          <Link href="/">All jobs</Link>
          <Link href="/profile">Your profile</Link>
          <Link href="/results">Your results</Link>
          <Link href="/how-it-works">How it works</Link>
        </nav>
        <AuthBar />
      </div>
    </header>
  );
}
