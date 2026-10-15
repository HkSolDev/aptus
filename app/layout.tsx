import type { Metadata } from 'next';
import { WorkspaceProvider } from '@/components/providers/workspace-provider';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { SkipLink } from '@/components/layout/skip-link';

import '@/public/css/tokens.css';
import '@/public/css/base.css';
import '@/public/css/layout.css';
import '@/public/css/navigation.css';
import '@/public/css/components.css';
import '@/public/css/catalogue.css';
import '@/public/css/sign-in.css';
import '@/public/css/home.css';

export const metadata: Metadata = {
  title: {
    default: 'Aptus — Find your next possibility',
    template: '%s | Aptus',
  },
  description:
    'Compare your education and age with government job notifications, understand the saved requirements, and verify the source.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-IN">
      <body>
        <SkipLink />
        <WorkspaceProvider>
          <Header />
          <main id="main" tabIndex={-1} className="page-width">
            {children}
          </main>
          <Footer />
        </WorkspaceProvider>
      </body>
    </html>
  );
}
