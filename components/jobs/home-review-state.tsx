'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import Link from 'next/link';

const ReviewContext = createContext<{
  ready: boolean;
  saved: string[];
  hidden: string[];
  save: (id: string) => void;
  hide: (id: string) => void;
  restore: () => void;
} | null>(null);

export function HomeReviewState({
  profile,
  children,
}: {
  profile?: 'guest' | 'setup' | 'ready';
  children: ReactNode;
}) {
  const [saved, setSaved] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [undo, setUndo] = useState<(() => void) | null>(null);
  const value = profile
    ? {
        ready: profile === 'ready',
        saved,
        hidden,
        save: (id: string) => {
          setSaved((current) =>
            current.includes(id)
              ? current.filter((item) => item !== id)
              : [...current, id],
          );
          setMessage(
            saved.includes(id)
              ? 'Removed from this review’s shortlist.'
              : 'Saved in this review only. Real saving is not connected yet.',
          );
          setUndo(null);
        },
        hide: (id: string) => {
          setHidden((current) => [...current, id]);
          setMessage('Hidden from these example recommendations.');
          setUndo(
            () => () =>
              setHidden((current) => current.filter((item) => item !== id)),
          );
        },
        restore: () => {
          setHidden([]);
          setMessage('Example recommendations restored.');
          setUndo(null);
        },
      }
    : null;
  return (
    <ReviewContext.Provider value={value}>
      {children}
      {profile && message && (
        <div className="home-review-toast" role="status">
          <span>{message}</span>
          {undo && (
            <button
              type="button"
              onClick={() => {
                undo();
                setMessage('Recommendation restored.');
                setUndo(null);
              }}
            >
              Undo
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setMessage('')}
          >
            ×
          </button>
        </div>
      )}
    </ReviewContext.Provider>
  );
}

export function HomeSaveAction({ id }: { id: string }) {
  const review = useContext(ReviewContext);
  if (!review?.ready)
    return (
      <Link className="home-save" href="/sign-in">
        Save
      </Link>
    );
  const saved = review.saved.includes(id);
  return (
    <button
      type="button"
      className="home-save"
      aria-pressed={saved}
      onClick={() => review.save(id)}
    >
      {saved ? 'Saved ✓' : 'Save'}
    </button>
  );
}

export function useHomeReview() {
  return useContext(ReviewContext);
}
