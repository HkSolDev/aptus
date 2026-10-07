import type { Metadata } from 'next';
import { ProfileForm } from '@/components/profile/profile-form';

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

export default function ProfilePage() {
  return <ProfileForm />;
}
