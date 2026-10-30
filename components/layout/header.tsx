import Link from 'next/link';
import { AuthBar } from '@/components/auth/auth-bar';
import { PrimaryNavigation } from './primary-navigation';
import { ThemeToggle } from './theme-toggle';

export function Header() {
  return (
    <header className="app-header">
      <div className="site-header page-width">
        <Link href="/" className="brand" aria-label="Aptus home">
          Aptus
        </Link>
        <div className="header-actions">
          <PrimaryNavigation />
          <ThemeToggle />
          <AuthBar />
        </div>
      </div>
    </header>
  );
}
