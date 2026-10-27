'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useWorkspace } from '../providers/workspace-provider';

export function SaveJobButton(props: { id: string; className?: string }) {
  const { sessionVersion } = useWorkspace();
  return <SaveJobAction key={`${sessionVersion}:${props.id}`} {...props} />;
}

function SaveJobAction({ id, className }: { id: string; className?: string }) {
  const {
    accountName,
    sessionVersion,
    sessionChecked,
    isJobSaved,
    savedStatusError,
    isJobStatusChecked,
    checkSavedStatus,
    saveJob,
    unsaveJob,
  } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionChecked && accountName !== null && id) {
      checkSavedStatus([id]);
    }
  }, [id, sessionChecked, accountName, sessionVersion, checkSavedStatus]);

  // If signed out, lead user to sign in
  if (sessionChecked && accountName === null) {
    return (
      <Link href="/sign-in" className={className}>
        Save
      </Link>
    );
  }

  const saved = isJobSaved(id);
  const checked = isJobStatusChecked(id);

  const handleClick = async () => {
    if (!checked) {
      checkSavedStatus([id]);
      return;
    }
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      if (saved) {
        await unsaveJob(id);
      } else {
        await saveJob(id);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Couldn’t update saved job.',
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className}
        aria-pressed={saved}
        aria-label={saved ? 'Remove from saved' : 'Save job'}
        disabled={pending || !sessionChecked || (!checked && !savedStatusError)}
        onClick={() => void handleClick()}
        title={error ?? undefined}
      >
        {pending
          ? 'Saving…'
          : !checked
            ? savedStatusError
              ? 'Retry saved status'
              : 'Checking…'
            : saved
              ? 'Saved ✓'
              : 'Save'}
      </button>
      {(error || (!checked && savedStatusError)) && (
        <span role="alert">{error || savedStatusError}</span>
      )}
    </>
  );
}
