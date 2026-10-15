import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthBar } from '@/components/auth/auth-bar';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <section className="signin-panel panel" aria-labelledby="signin-title">
      <h1 id="signin-title">Sign in to Aptus</h1>
      <p className="muted">Get job recommendations based on your profile.</p>
      <AuthBar presentation="signin" />
      <p className="small muted">
        Already set up a passkey? Use your fingerprint, face or device PIN.
      </p>
      <Link className="signin-browse" href="/">
        Continue browsing jobs
      </Link>
      <div className="signin-note">
        <strong>New to Aptus?</strong>
        <p>Continue with Google. You can set up a passkey after signing in.</p>
      </div>
      <noscript>
        <p className="notice">
          Sign-in needs JavaScript. You can still browse jobs without signing
          in.
        </p>
      </noscript>
    </section>
  );
}
