'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import styles from './review.module.css';
import { resolveCandidateRefresh } from './candidate-refresh';

interface EvidenceUnit {
  evidence_id: string;
  document_id: string;
  source_url: string;
  role?: string | null;
  authority?: string | null;
  locations?: unknown[];
}

interface SourceDocumentSection {
  evidence_id: string;
  text: string;
  locations?: unknown[];
}

interface SourceDocument {
  document_id: string;
  format: string;
  source_url: string;
  role?: string;
  authority?: string;
  sections?: SourceDocumentSection[];
}

interface PostFact {
  post_name: string;
  recruiting_body?: string | null;
  vacancies: number | null;
  application_last_date: string | null;
  age_as_on_date: string | null;
  min_age: number | null;
  max_age: number | null;
  min_marks_percent: number | null;
  education_required: string | null;
  category_relaxation_applies: boolean | null;
  [key: string]: unknown;
}

interface FactsPayload {
  purpose: string;
  posts: PostFact[];
  evidence: Array<{ field_path: string; evidence_id: string; quote: string }>;
  missing_fields: Array<{ field_path: string; reason: string }>;
  purpose_evidence: Array<{ evidence_id: string; quote: string }>;
  document_purposes: Array<{ document_id: string; purpose: string; evidence: unknown[] }>;
  [key: string]: unknown;
}

interface DetailData {
  item: {
    id: string;
    bundle_id: string;
    source_name: string;
    source_url: string;
    status: string;
    hold_reason: string | null;
    updated_at: string;
  };
  revision: {
    id: string;
    revision_number: number;
    canonical_hash: string;
    change_reason: string | null;
    created_by: string;
    created_at: string;
    validation_state: string;
    facts: FactsPayload;
    evidence_units: EvidenceUnit[];
    source_evidence: SourceDocument[];
  };
  latest_validation: {
    task_id: string;
    status: string;
    validator_version: string;
    result: {
      status: string;
      disposition: string;
      errors: Array<{ field_path: string; reason: string }>;
      warnings: Array<{ field_path: string; reason: string }>;
      semantic_support_verified: boolean;
    } | null;
    error_details?: string | null;
    created_at: string;
    updated_at: string;
  } | null;
}

export function CandidateDetailView({ initialData }: { initialData: DetailData }) {
  const [data, setData] = useState<DetailData>(initialData);
  const [selectedRoleIndex, setSelectedRoleIndex] = useState(0);

  // Editable state
  const [facts, setFacts] = useState<FactsPayload>(initialData.revision.facts);
  const [changeReason, setChangeReason] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [editingRevisionId, setEditingRevisionId] = useState(initialData.revision.id);
  const [conflictFresh, setConflictFresh] = useState<DetailData | null>(null);

  // Actions & UI state
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [holding, setHolding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [pollingTaskId, setPollingTaskId] = useState<string | null>(
    initialData.latest_validation?.status === 'running' ||
      initialData.latest_validation?.status === 'pending'
      ? initialData.latest_validation.task_id
      : null,
  );

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const refreshCandidate = useCallback(
    async (forceApply = false) => {
      try {
        const res = await fetch(`/api/admin/review-drafts/${data.item.id}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (res.ok) {
          const fresh: DetailData = await res.json();
          const decision = forceApply
            ? { action: 'apply-fresh' as const, editingRevisionId: fresh.revision.id }
            : resolveCandidateRefresh({
                hasUnsavedChanges,
                editingRevisionId,
                freshRevisionId: fresh.revision.id,
              });
          if (decision.action === 'keep-editing') {
            // Preserve unsaved facts and their base; surface the conflict instead.
            setConflictFresh(fresh);
            return;
          }
          setData(fresh);
          setFacts(fresh.revision.facts);
          setEditingRevisionId(decision.editingRevisionId);
          setConflictFresh(null);
        }
      } catch {
        // ignore transient refresh failure
      }
    },
    [data.item.id, hasUnsavedChanges, editingRevisionId],
  );

  const reloadConflictRevision = () => {
    if (!conflictFresh) return;
    setData(conflictFresh);
    setFacts(conflictFresh.revision.facts);
    setEditingRevisionId(conflictFresh.revision.id);
    setHasUnsavedChanges(false);
    setChangeReason('');
    setConflictFresh(null);
  };

  // Handle polling for active validation task
  useEffect(() => {
    if (!pollingTaskId) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      return;
    }

    const pollTask = async () => {
      try {
        const res = await fetch(
          `/api/admin/review-drafts/${data.item.id}/validation/${pollingTaskId}`,
          { credentials: 'same-origin', cache: 'no-store' },
        );
        if (res.ok) {
          const taskRes = await res.json();
          if (taskRes.status === 'completed' || taskRes.status === 'failed') {
            setPollingTaskId(null);
            setValidating(false);
            void refreshCandidate();
          }
        }
      } catch {
        // retry next tick
      }
    };

    pollIntervalRef.current = setInterval(pollTask, 2000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [data.item.id, pollingTaskId, refreshCandidate]);

  const handlePostFieldChange = (field: keyof PostFact, value: unknown) => {
    setFacts((prev) => {
      const updatedPosts = [...prev.posts];
      updatedPosts[selectedRoleIndex] = {
        ...updatedPosts[selectedRoleIndex],
        [field]: value,
      };
      return { ...prev, posts: updatedPosts };
    });
    setHasUnsavedChanges(true);
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  const handleSaveCorrection = async () => {
    if (!changeReason.trim()) {
      setErrorMsg('Please specify a reason for this correction before saving.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/admin/review-drafts/${data.item.id}/revisions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': editingRevisionId,
        },
        body: JSON.stringify({
          base_revision_id: editingRevisionId,
          facts,
          change_reason: changeReason.trim(),
        }),
        credentials: 'same-origin',
      });

      if (res.status === 412) {
        throw new Error('Revision is stale! Another update was saved. Please reload this page.');
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || 'Failed to save correction.');
      }

      const savedRev = await res.json();
      setHasUnsavedChanges(false);
      setChangeReason('');
      setEditingRevisionId(savedRev.revision_id);
      setSuccessMsg(`Saved correction as Revision R${savedRev.revision_number}.`);
      await refreshCandidate(true);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestValidation = async () => {
    if (hasUnsavedChanges) {
      setErrorMsg('You have unsaved changes. Save your correction first before requesting validation.');
      return;
    }

    setValidating(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/admin/review-drafts/${data.item.id}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision_id: data.revision.id }),
        credentials: 'same-origin',
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || 'Failed to request validation.');
      }

      const task = await res.json();
      if (task.status === 'completed') {
        setSuccessMsg('Reused existing completed validation result.');
        setValidating(false);
        await refreshCandidate();
      } else {
        setSuccessMsg('Validation task queued for Python worker.');
        setPollingTaskId(task.task_id);
      }
    } catch (err: unknown) {
      setValidating(false);
      setErrorMsg(err instanceof Error ? err.message : 'Validation request failed');
    }
  };

  const handleKeepHeld = async () => {
    const note = prompt('Enter or update hold reason:', data.item.hold_reason || '');
    if (note === null) return;

    setHolding(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/admin/review-drafts/${data.item.id}/keep-held`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hold_reason: note }),
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error('Failed to update hold status');
      setSuccessMsg('Candidate hold status updated.');
      await refreshCandidate();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Hold update failed');
    } finally {
      setHolding(false);
    }
  };

  const currentPost = facts.posts[selectedRoleIndex] || facts.posts[0];
  const rev = data.revision;
  const validation = data.latest_validation;

  return (
    <div className={styles.page}>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <Link href="/admin/review" className="small muted">
          ← Back to review queue
        </Link>
      </div>

      <header className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <h1>{currentPost?.post_name || data.item.source_name}</h1>
          <span className={`${styles.badge} ${styles.badgeHeld}`}>{data.item.status}</span>
          <span className={`${styles.badge} ${styles.badgeReview}`}>Revision R{rev.revision_number}</span>
        </div>
        <p className={styles.subtitle}>
          Source: {data.item.source_name} •{' '}
          <a href={data.item.source_url} target="_blank" rel="noopener noreferrer">
            Official Source Link
          </a>
        </p>
      </header>

      {errorMsg && <div className={styles.dangerAlert}>{errorMsg}</div>}
      {successMsg && <div className={styles.successAlert}>{successMsg}</div>}

      {hasUnsavedChanges && (
        <div className={styles.infoAlert}>
          <span className={styles.unsavedNotice}>● You have unsaved changes.</span> Remember to save
          your correction before requesting validation.
        </div>
      )}

      {conflictFresh && (
        <div className={styles.dangerAlert} role="alert">
          <strong>A newer revision (R{conflictFresh.revision.revision_number}) was saved.</strong>{' '}
          Your unsaved edits are still based on the older revision and have not been changed.
          Saving them will be rejected as stale. To continue, reload the newer revision — this
          discards your unsaved edits — or keep editing here and copy your changes first.
          <div style={{ marginTop: '8px' }}>
            <button type="button" className={styles.buttonSecondary} onClick={reloadConflictRevision}>
              Reload newer revision (discard my edits)
            </button>
          </div>
        </div>
      )}

      <div className={styles.detailLayout}>
        {/* Left Column: Facts Editor */}
        <div>
          <div className={styles.card}>
            <h2>Candidate Facts Editor</h2>

            {facts.posts.length > 1 && (
              <div className={styles.formGroup}>
                <label htmlFor="role-selector">Select Role ({facts.posts.length} roles total):</label>
                <select
                  id="role-selector"
                  value={selectedRoleIndex}
                  onChange={(e) => setSelectedRoleIndex(parseInt(e.target.value, 10))}
                >
                  {facts.posts.map((p, idx) => (
                    <option key={idx} value={idx}>
                      {p.post_name || `Role #${idx + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className={styles.formGroup}>
              <label htmlFor="post-name">Post Name</label>
              <input
                id="post-name"
                type="text"
                value={currentPost?.post_name || ''}
                onChange={(e) => handlePostFieldChange('post_name', e.target.value)}
              />
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="vacancies">
                  Vacancies {currentPost?.vacancies === null && <span className="small muted">(null/unstated)</span>}
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    id="vacancies"
                    type="number"
                    min="0"
                    disabled={currentPost?.vacancies === null}
                    value={currentPost?.vacancies ?? ''}
                    placeholder="Unstated in source"
                    onChange={(e) =>
                      handlePostFieldChange(
                        'vacancies',
                        e.target.value === '' ? null : parseInt(e.target.value, 10),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="button button-secondary small"
                    onClick={() =>
                      handlePostFieldChange(
                        'vacancies',
                        currentPost?.vacancies === null ? 0 : null,
                      )
                    }
                  >
                    {currentPost?.vacancies === null ? 'Set' : 'Null'}
                  </button>
                </div>
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="last-date">Application Deadline (ISO Date)</label>
                <input
                  id="last-date"
                  type="date"
                  value={currentPost?.application_last_date || ''}
                  onChange={(e) =>
                    handlePostFieldChange(
                      'application_last_date',
                      e.target.value ? e.target.value : null,
                    )
                  }
                />
              </div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="min-age">Minimum Age</label>
                <input
                  id="min-age"
                  type="number"
                  min="0"
                  max="100"
                  value={currentPost?.min_age ?? ''}
                  placeholder="Null (unstated)"
                  onChange={(e) =>
                    handlePostFieldChange(
                      'min_age',
                      e.target.value === '' ? null : parseInt(e.target.value, 10),
                    )
                  }
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="max-age">Maximum Age</label>
                <input
                  id="max-age"
                  type="number"
                  min="0"
                  max="100"
                  value={currentPost?.max_age ?? ''}
                  placeholder="Null (unstated)"
                  onChange={(e) =>
                    handlePostFieldChange(
                      'max_age',
                      e.target.value === '' ? null : parseInt(e.target.value, 10),
                    )
                  }
                />
              </div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="cutoff-date">Age Cutoff Date (as on)</label>
                <input
                  id="cutoff-date"
                  type="date"
                  value={currentPost?.age_as_on_date || ''}
                  onChange={(e) =>
                    handlePostFieldChange(
                      'age_as_on_date',
                      e.target.value ? e.target.value : null,
                    )
                  }
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="min-marks">Minimum Marks (%)</label>
                <input
                  id="min-marks"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={currentPost?.min_marks_percent ?? ''}
                  placeholder="Null (unstated)"
                  onChange={(e) =>
                    handlePostFieldChange(
                      'min_marks_percent',
                      e.target.value === '' ? null : parseFloat(e.target.value),
                    )
                  }
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="education-req">Education Requirement Summary</label>
              <textarea
                id="education-req"
                value={currentPost?.education_required || ''}
                onChange={(e) => handlePostFieldChange('education_required', e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="change-reason">
                Reason for Changes <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <textarea
                id="change-reason"
                placeholder="Explain what was corrected and cited evidence from the source..."
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
              />
              <span className="small muted">
                Human corrections require a recorded reason and immutable revision tracking.
              </span>
            </div>

            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.buttonPrimary}
                disabled={saving || !hasUnsavedChanges}
                onClick={handleSaveCorrection}
              >
                {saving ? 'Saving…' : 'Save correction'}
              </button>

              <button
                type="button"
                className={styles.buttonSecondary}
                disabled={validating || hasUnsavedChanges || pollingTaskId !== null}
                onClick={handleRequestValidation}
              >
                {validating || pollingTaskId ? 'Checking…' : 'Check correction'}
              </button>

              <button
                type="button"
                className={styles.buttonSecondary}
                disabled={holding}
                onClick={handleKeepHeld}
              >
                Keep held
              </button>

              <button
                type="button"
                className={styles.buttonSecondary}
                onClick={() => void refreshCandidate()}
              >
                Refresh result
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Evidence & Validation Results */}
        <div>
          {/* Validation Status Panel */}
          <div className={styles.card}>
            <h3>Revision R{rev.revision_number} Automated Validation</h3>
            <div className="small muted" style={{ marginBottom: 'var(--space-3)' }}>
              Validator: {validation?.validator_version || 'aptus-val-v1'} • Canonical Hash:{' '}
              <code>{rev.canonical_hash.substring(0, 16)}…</code>
            </div>

            {pollingTaskId ? (
              <div className={styles.infoAlert}>
                <strong>Checking…</strong> Task claimed or queued for Python validation worker.
              </div>
            ) : !validation ? (
              <div className="small muted">No validation task has been run for this revision yet.</div>
            ) : validation.status === 'failed' ? (
              <div className={styles.dangerAlert}>
                <strong>Worker/check infrastructure failed</strong>
                <p style={{ margin: '4px 0 0' }}>{validation.error_details || 'Execution failure.'}</p>
              </div>
            ) : validation.result ? (
              <div>
                {validation.result.errors && validation.result.errors.length > 0 ? (
                  <div className={styles.dangerAlert}>
                    <strong>Check completed with issues ({validation.result.errors.length})</strong>
                    <ul className={styles.issuesList}>
                      {validation.result.errors.map((err, i) => (
                        <li key={i}>
                          <code>{err.field_path}</code>: {err.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className={styles.successAlert}>
                    <strong>Automated checks passed</strong>
                    <p style={{ margin: '4px 0 0', fontSize: '0.8125rem' }}>
                      Automated validation confirmed schema shape and quoted citations exist in source.
                      Automated checks do NOT prove factual truth or replace human judgment.
                    </p>
                  </div>
                )}

                {validation.result.warnings && validation.result.warnings.length > 0 && (
                  <div className="small muted" style={{ marginTop: 'var(--space-3)' }}>
                    <strong>Warnings ({validation.result.warnings.length}):</strong>
                    <ul className={styles.issuesList}>
                      {validation.result.warnings.map((warn, i) => (
                        <li key={i}>
                          <code>{warn.field_path}</code>: {warn.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="small muted">Status: {validation.status}</div>
            )}
          </div>

          {/* Saved Official Evidence */}
          <div className={styles.card}>
            <h3>Saved Official Evidence</h3>
            <p className="small muted" style={{ marginTop: 0 }}>
              Evidence text safely rendered from immutable offline capture. Internal paths and HTML are not rendered.
            </p>

            {rev.source_evidence && rev.source_evidence.length > 0 ? (
              rev.source_evidence.map((doc, docIdx) => (
                <div key={docIdx} className={styles.evidenceSection}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '4px' }}>
                    Document: {doc.document_id} ({doc.format})
                  </div>
                  {doc.sections && doc.sections.length > 0 ? (
                    doc.sections.map((sec, secIdx) => (
                      <div key={secIdx} style={{ marginBottom: '8px' }}>
                        <span className="small muted">Evidence ID: {sec.evidence_id}</span>
                        <div className={styles.evidenceBox}>{sec.text}</div>
                      </div>
                    ))
                  ) : (
                    <div className="small muted">No text sections in this document.</div>
                  )}
                </div>
              ))
            ) : (
              <div className="small muted">No source documents preserved in this revision.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
