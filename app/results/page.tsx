import type { Metadata } from 'next';
import { ResultsView } from '@/components/results/results-view';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Your Results',
  description: 'View matching government job notifications for your profile.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function ResultsPage() {
  return <ResultsView />;
}
