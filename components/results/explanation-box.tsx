'use client';

import { useState } from 'react';

interface ExplanationBoxProps {
  postId: string;
  userId: string;
}

export function ExplanationBox({ postId, userId }: ExplanationBoxProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (explanation) {
      setOpen(true);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ postId, userId }),
      });
      const data = (await response.json()) as { explanation?: string };
      if (!response.ok || !data.explanation) {
        throw new Error('Unavailable');
      }
      setExplanation(data.explanation);
      setOpen(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="explanation-container">
      <button
        type="button"
        className="button button-secondary explain-button"
        disabled={loading}
        onClick={toggle}
      >
        {loading
          ? 'Explaining criteria…'
          : error
            ? 'Retry explanation'
            : open
              ? 'Hide explanation'
              : 'Explain criteria'}
      </button>

      {open && explanation && (
        <div
          className="explanation"
          role="region"
          aria-label="Eligibility explanation"
        >
          {explanation}
        </div>
      )}
    </div>
  );
}
