import type { Metadata } from 'next';
import { ProfileForm } from '@/components/profile/profile-form';
import { ProfileReview } from '@/components/profile/profile-review';
import { headers } from 'next/headers';
import {
  ProfileAccess,
  SignedOutProfile,
} from '@/components/profile/profile-access';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Your Profile',
  description:
    'Enter your qualifications and details to check eligibility matches.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function ProfilePage() {
  if (
    process.env.APTUS_LOCAL_REVIEW === '1' &&
    process.env.NODE_ENV === 'development'
  )
    return <ProfileReview />;
  const cookie = (await headers()).get('cookie');
  let signedIn = false;
  if (cookie) {
    try {
      const backend =
        process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:8081';
      const response = await fetch(`${backend}/api/auth/get-session`, {
        headers: { cookie },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      const session: unknown = response.ok ? await response.json() : null;
      signedIn =
        !!session &&
        typeof session === 'object' &&
        'user' in session &&
        !!session.user &&
        typeof session.user === 'object' &&
        'id' in session.user &&
        typeof session.user.id === 'string';
    } catch {
      // A failed verification must never reveal the private form.
    }
  }
  if (!signedIn) return <SignedOutProfile />;
  return (
    <ProfileAccess>
      <ProfileForm />
    </ProfileAccess>
  );
}
