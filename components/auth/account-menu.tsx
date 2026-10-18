'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';

export function AccountMenu({
  name,
  loading,
  onSignOut,
  errorId,
}: {
  name: string;
  loading: boolean;
  onSignOut: () => void;
  errorId?: string;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join('')
    .toLocaleUpperCase();
  const avatar = initials || (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </svg>
  );

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !disclosure.current?.contains(event.target)
      ) {
        disclosure.current?.removeAttribute('open');
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);

  return (
    <details
      className="account-menu"
      ref={disclosure}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          disclosure.current?.removeAttribute('open');
          disclosure.current?.querySelector('summary')?.focus();
        }
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          disclosure.current?.removeAttribute('open');
        }
      }}
    >
      <summary className="account-avatar" aria-label="Your account">
        <span aria-hidden="true">{avatar}</span>
      </summary>
      <div className="account-popover">
        <div className="account-identity">
          <div>
            <span className="small muted">User name</span>
            <p className="account-name">{name || 'Your account'}</p>
          </div>
        </div>
        <Link
          href="/profile"
          onClick={() => disclosure.current?.removeAttribute('open')}
        >
          Your profile
        </Link>
        <Link
          href="/sign-in"
          onClick={() => disclosure.current?.removeAttribute('open')}
        >
          Sign-in &amp; security
        </Link>
        <button
          id="sign-out"
          type="button"
          disabled={loading}
          onClick={onSignOut}
          aria-describedby={errorId}
          aria-busy={loading}
        >
          {loading ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </details>
  );
}
