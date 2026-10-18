'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWorkspace } from '@/components/providers/workspace-provider';

const destinations = [
  {
    href: '/',
    label: 'Home',
    icon: (
      <>
        <path d="m3 10 9-7 9 7v10H3z" />
        <path d="M9 20v-7h6v7" />
      </>
    ),
  },
  { href: '/saved', label: 'Saved', icon: <path d="M6 3h12v18l-6-4-6 4z" /> },
  {
    href: '/profile',
    label: 'Profile',
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
  },
];

export function PrimaryNavigation() {
  const pathname = usePathname();
  const { accountName } = useWorkspace();
  const signedIn = accountName !== null;
  const active =
    pathname === '/sign-in'
      ? '/sign-in'
      : pathname === '/' ||
          pathname.startsWith('/jobs/') ||
          pathname === '/results'
        ? '/'
        : destinations.find(
            ({ href }) =>
              href !== '/' &&
              (pathname === href || pathname.startsWith(`${href}/`)),
          )?.href;

  return (
    <nav className="primary-navigation" aria-label="Main navigation">
      {destinations.map(({ href: destination, label: title, icon }) => {
        const href =
          destination === '/profile' && !signedIn ? '/sign-in' : destination;
        const label =
          destination === '/profile' && !signedIn ? 'Sign in' : title;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active === href ? 'page' : undefined}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {icon}
            </svg>
            <span>
              {label}
              {href === '/saved' && (
                <span className="navigation-wide-label"> jobs</span>
              )}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
