import type { Metadata } from 'next';
import { WorkspaceProvider } from '@/components/providers/workspace-provider';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';

import '@/public/css/tokens.css';
import '@/public/css/base.css';
import '@/public/css/layout.css';
import '@/public/css/components.css';
import '@/public/css/catalogue.css';

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
        <a className="skip-link" href="#jobs">
          Skip to jobs
        </a>
        <WorkspaceProvider>
          <Header />
          <main className="page-width">{children}</main>
          <Footer />
        </WorkspaceProvider>
      </body>
    </html>
  );
}
