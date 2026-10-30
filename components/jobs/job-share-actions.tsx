'use client';

import { useState } from 'react';
import { jobShareUrl } from './job-sharing';

export function JobShareActions({ id, title }: { id: string; title: string }) {
  const [message, setMessage] = useState('');
  const [fallbackUrl, setFallbackUrl] = useState('');
  function publicUrl() {
    return (
      document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ??
      jobShareUrl(id, window.location.origin)
    );
  }
  async function copyLink() {
    const url = publicUrl();
    setMessage('');
    setFallbackUrl('');
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Link copied.');
    } catch {
      setFallbackUrl(url);
      setMessage('Copy this link to share the job.');
    }
  }
  async function share() {
    setMessage('');
    setFallbackUrl('');
    if (!navigator.share) return copyLink();
    try {
      await navigator.share({ title, url: publicUrl() });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setFallbackUrl(publicUrl());
      setMessage('Sharing is unavailable. Copy this link instead.');
    }
  }
  return (
    <>
      <button type="button" className="button button-secondary" onClick={share}>
        Share
      </button>
      <button
        type="button"
        className="button button-secondary"
        onClick={copyLink}
      >
        Copy link
      </button>
      <span role="status">{message}</span>
      {fallbackUrl ? (
        <label>
          Job link{' '}
          <input
            aria-label="Job link"
            readOnly
            value={fallbackUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      ) : null}
    </>
  );
}
