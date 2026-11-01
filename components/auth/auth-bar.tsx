'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWorkspace } from '@/components/providers/workspace-provider';
import { Passkeys } from './passkeys';
import { GoogleIcon } from './auth-icons';
import { AccountMenu } from './account-menu';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const failedSignIn = 'Sign-in could not be completed. Please try again.';

async function authRequest(
  path: string,
  method: 'GET' | 'POST',
  fallback: string,
): Promise<{ status: number; data: unknown }> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      ...(method === 'POST'
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }
        : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      'Couldn’t reach Aptus. Check your connection and try again.',
    );
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok && response.status !== 401) {
    throw new Error(
      isRecord(data) && typeof data.error === 'string' ? data.error : fallback,
    );
  }
  return { status: response.status, data };
}

interface SessionView {
  id: string;
  name: string;
  needsRefresh: boolean;
}

function readSession(status: number, data: unknown): SessionView | null {
  if (
    status !== 200 ||
    !isRecord(data) ||
    !isRecord(data.user) ||
    typeof data.user.id !== 'string'
  )
    return null;
  return {
    id: data.user.id,
    name: typeof data.user.name === 'string' ? data.user.name : '',
    needsRefresh: data.needsRefresh === true,
  };
}

export function AuthBar({
  presentation = 'header',
}: {
  presentation?: 'header' | 'signin';
}) {
  const pathname = usePathname();
  const hiddenHeader = pathname === '/sign-in' && presentation === 'header';
  const errorId = `${presentation}-auth-error`;
  const {
    setAccountId,
    accountName: userName,
    setAccountName: setUserName,
    setSessionChecked,
  } = useWorkspace();
  const sessionRequestRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOperator, setIsOperator] = useState(false);

  const checkSession = useCallback(async () => {
    const request = ++sessionRequestRef.current;
    try {
      const checked = await authRequest('/api/auth/get-session', 'GET', '');
      let session = readSession(checked.status, checked.data);
      if (session?.needsRefresh) {
        const renewed = await authRequest('/api/auth/get-session', 'POST', '');
        session = readSession(renewed.status, renewed.data);
      }
      if (request !== sessionRequestRef.current) return;
      if (session) {
        setAccountId(session.id);
        setUserName(session.name);
        try {
          const opRes = await fetch(
            '/api/admin/review-drafts/operator-status',
            {
              credentials: 'same-origin',
              signal: AbortSignal.timeout(5000),
            },
          );
          if (request === sessionRequestRef.current) setIsOperator(opRes.ok);
        } catch {
          if (request === sessionRequestRef.current) setIsOperator(false);
        }
      } else {
        setUserName(null);
        setIsOperator(false);
        setAccountId(null);
      }
    } catch {
      if (request !== sessionRequestRef.current) return;
      setUserName(null);
      setIsOperator(false);
      setAccountId(null);
    } finally {
      if (request === sessionRequestRef.current) setSessionChecked(true);
    }
  }, [setAccountId, setUserName, setSessionChecked]);

  useEffect(() => {
    if (hiddenHeader) return;
    void checkSession();
    return () => {
      sessionRequestRef.current += 1;
    };
  }, [checkSession, hiddenHeader, pathname]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      let response: Response;
      try {
        response = await fetch('/api/auth/sign-in/social', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'google' }),
          credentials: 'same-origin',
          signal: AbortSignal.timeout(15000),
        });
      } catch (networkError) {
        if (
          networkError instanceof DOMException &&
          networkError.name === 'TimeoutError'
        ) {
          throw new Error(
            'The sign-in request took too long. Check your connection and try again.',
          );
        }
        throw new Error(
          'Couldn’t reach Aptus. Check your connection and try again.',
        );
      }

      const data: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          isRecord(data) && typeof data.error === 'string'
            ? data.error
            : failedSignIn;
        throw new Error(message);
      }

      if (!isRecord(data) || typeof data.url !== 'string') {
        throw new Error(failedSignIn);
      }

      let target: URL;
      try {
        target = new URL(data.url);
      } catch {
        throw new Error(failedSignIn);
      }

      if (target.protocol !== 'https:' && target.protocol !== 'http:') {
        throw new Error(failedSignIn);
      }

      window.location.assign(target.href);
    } catch (err) {
      setLoading(false);
      setError(
        err instanceof Error && err.message ? err.message : failedSignIn,
      );
    }
  };

  const handleSignOut = async () => {
    sessionRequestRef.current += 1;
    setError(null);
    setLoading(true);
    try {
      const { status } = await authRequest(
        '/api/auth/sign-out',
        'POST',
        'Couldn’t sign out. Please try again.',
      );
      if (status === 200 || status === 401) {
        sessionRequestRef.current += 1;
        setUserName(null);
        setAccountId(null);
        if (presentation === 'header') {
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLAnchorElement>('.header-signin')
              ?.focus(),
          );
        }
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Couldn’t sign out. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  if (hiddenHeader) return null;
  if (presentation === 'header' && userName === null) {
    return (
      <Link className="header-signin" href="/sign-in">
        Sign in
      </Link>
    );
  }

  return (
    <div className={presentation === 'signin' ? 'signin-actions' : 'auth-bar'}>
      {userName !== null && presentation === 'header' ? (
        <AccountMenu
          name={userName}
          loading={loading}
          onSignOut={handleSignOut}
          errorId={error ? errorId : undefined}
          isOperator={isOperator}
        />
      ) : userName !== null ? (
        <div id="auth-user">
          <span id="auth-user-name" className="small">
            {userName ? `Signed in as ${userName}` : 'Signed in'}
          </span>{' '}
          <button
            id={presentation === 'header' ? 'sign-out' : 'account-sign-out'}
            type="button"
            className="button button-secondary"
            disabled={loading}
            onClick={handleSignOut}
            aria-describedby={error ? errorId : undefined}
          >
            Sign out
          </button>
        </div>
      ) : (
        <button
          id="google-sign-in"
          type="button"
          className="button button-secondary"
          disabled={loading}
          onClick={handleGoogleSignIn}
          aria-describedby={error ? errorId : undefined}
          aria-busy={loading}
        >
          <GoogleIcon />
          {loading ? 'Connecting…' : 'Continue with Google'}
        </button>
      )}

      {presentation === 'signin' && (
        <Passkeys
          signedIn={userName !== null}
          showUnavailable
          onVerifyGoogle={handleGoogleSignIn}
          onError={(msg) => setError(msg || null)}
          onSuccess={() => void checkSession()}
        />
      )}

      {error && (
        <div id={errorId} className="notice notice-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
