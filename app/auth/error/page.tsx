import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Sign-in Error | Aptus',
  robots: {
    index: false,
    follow: false,
  },
};

export default function AuthErrorPage() {
  return (
    <section
      className="panel"
      style={{
        marginBlock: 'var(--space-7)',
        maxWidth: '560px',
        marginInline: 'auto',
      }}
    >
      <p className="eyebrow">SIGN-IN NOTICE</p>
      <h2>Sign-in could not be completed</h2>
      <div
        className="notice notice-error"
        style={{ marginBlock: 'var(--space-4)' }}
      >
        <p>
          The sign-in request was cancelled, timed out, or encountered an error
          with the provider.
        </p>
      </div>
      <p className="muted" style={{ marginBottom: 'var(--space-5)' }}>
        Nothing on your account was changed. You can return to the homepage and
        try again.
      </p>
      <Link className="button button-primary" href="/">
        Return to Aptus home →
      </Link>
    </section>
  );
}
