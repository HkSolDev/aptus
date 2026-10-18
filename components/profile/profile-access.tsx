'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useWorkspace } from '@/components/providers/workspace-provider';

export function SignedOutProfile() {
  return (
    <section className="panel intro" aria-labelledby="profile-signin-title">
      <h1 id="profile-signin-title">Sign in to view your profile</h1>
      <p>
        You’re not signed in. Sign in to add your details and check matching
        jobs.
      </p>
      <Link className="button button-primary" href="/sign-in">
        Sign in
      </Link>
    </section>
  );
}

export function ProfileAccess({ children }: { children: ReactNode }) {
  const { accountName, sessionChecked } = useWorkspace();
  if (!sessionChecked) return <p role="status">Checking your sign-in…</p>;
  if (accountName === null) return <SignedOutProfile />;
  return children;
}
