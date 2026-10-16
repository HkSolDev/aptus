'use client';

import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './job-detail-section.module.css';

export function JobDetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const [showBottomToggle, setShowBottomToggle] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const details = detailsRef.current;
    if (!details || !open) {
      setShowBottomToggle(false);
      return;
    }

    const updateBottomToggle = () => {
      const minimumHeight =
        window.innerWidth >= 1050 ? 680 : window.innerWidth >= 641 ? 560 : 460;
      setShowBottomToggle(
        details.getBoundingClientRect().height > minimumHeight,
      );
    };
    const observer = new ResizeObserver(updateBottomToggle);
    observer.observe(details);
    window.addEventListener('resize', updateBottomToggle);
    updateBottomToggle();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateBottomToggle);
    };
  }, [open]);

  function hideDetails() {
    setOpen(false);
    requestAnimationFrame(() => {
      summaryRef.current?.focus({ preventScroll: true });
      summaryRef.current?.scrollIntoView({ block: 'start' });
    });
  }

  return (
    <details
      ref={detailsRef}
      className={styles.section}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary ref={summaryRef}>
        <span>{title}</span>
        <span className={styles.toggleText} aria-hidden="true">
          {open ? 'Hide details' : 'Show details'}
        </span>
      </summary>
      <div className={styles.content}>{children}</div>
      {open && showBottomToggle ? (
        <button
          type="button"
          className={styles.bottomToggle}
          onClick={hideDetails}
        >
          Hide {title.toLowerCase()} details ↑
        </button>
      ) : null}
    </details>
  );
}

export function JobPreviewSaveButton() {
  const [saved, setSaved] = useState(false);

  return (
    <button
      type="button"
      className={styles.saveButton}
      aria-pressed={saved}
      title="Preview-only save; this does not persist to an account."
      onClick={() => setSaved((value) => !value)}
    >
      {saved ? 'Saved for this preview' : 'Save job'}
    </button>
  );
}
