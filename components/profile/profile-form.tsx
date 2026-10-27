'use client';

import { useState, useId, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/components/providers/workspace-provider';
import { EducationRow } from './education-row';
import { fetchProfile, saveProfileApi } from '@/frontend/profile-api';
import type {
  EducationEntry,
  EducationLevel,
  MatchResponse,
  SavedProfile,
} from '@/frontend/types';

function isFormDirty(
  saved: SavedProfile | null,
  currentDob: string,
  currentCat: string,
  currentEdu: EducationEntry[],
): boolean {
  if (!saved) {
    return Boolean(
      currentDob ||
        currentCat ||
        currentEdu.some((e) => e.level !== '' || e.marksPercent !== null),
    );
  }
  if (currentDob !== saved.dob) return true;
  if ((currentCat || null) !== saved.category) return true;
  const validCurrent = currentEdu.filter((e) => e.level !== '');
  if (validCurrent.length !== saved.educations.length) return true;
  for (let i = 0; i < validCurrent.length; i++) {
    if (validCurrent[i].level !== saved.educations[i].level) return true;
    if (validCurrent[i].marksPercent !== saved.educations[i].marksPercent)
      return true;
  }
  return false;
}

export function ProfileForm() {
  const router = useRouter();
  const {
    savedProfile,
    setSavedProfile,
    setResults,
    markStale,
  } = useWorkspace();
  const formId = useId();

  const [loadStatus, setLoadStatus] = useState<'loading' | 'error' | 'ready'>(
    savedProfile ? 'ready' : 'loading',
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dob, setDob] = useState(savedProfile?.dob ?? '');
  const [category, setCategory] = useState(savedProfile?.category ?? '');
  const [educations, setEducations] = useState<EducationEntry[]>(
    savedProfile?.educations && savedProfile.educations.length > 0
      ? savedProfile.educations
      : [{ level: '', marksPercent: null }],
  );

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);

  // Set today's date as maximum for DOB in Asia/Kolkata
  const today = new Date();
  const maxDob = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const loadData = useCallback(async () => {
    setLoadStatus('loading');
    setLoadError(null);
    try {
      const data = await fetchProfile();
      setSavedProfile(data);
      if (data) {
        setDob(data.dob);
        setCategory(data.category ?? '');
        setEducations(
          data.educations.length > 0
            ? data.educations
            : [{ level: '', marksPercent: null }],
        );
      } else {
        setDob('');
        setCategory('');
        setEducations([{ level: '', marksPercent: null }]);
      }
      setLoadStatus('ready');
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Couldn’t load your profile. Please try again.',
      );
      setLoadStatus('error');
    }
  }, [setSavedProfile]);

  useEffect(() => {
    if (!savedProfile) {
      let active = true;
      async function run() {
        setLoadStatus('loading');
        setLoadError(null);
        try {
          const data = await fetchProfile();
          if (!active) return;
          setSavedProfile(data);
          if (data) {
            setDob(data.dob);
            setCategory(data.category ?? '');
            setEducations(
              data.educations.length > 0
                ? data.educations
                : [{ level: '', marksPercent: null }],
            );
          } else {
            setDob('');
            setCategory('');
            setEducations([{ level: '', marksPercent: null }]);
          }
          setLoadStatus('ready');
        } catch (err) {
          if (!active) return;
          setLoadError(
            err instanceof Error
              ? err.message
              : 'Couldn’t load your profile. Please try again.',
          );
          setLoadStatus('error');
        }
      }
      void run();
      return () => {
        active = false;
      };
    }
  }, [savedProfile, setSavedProfile]);

  const addEducation = () => {
    setEducations((prev) => [...prev, { level: '', marksPercent: null }]);
    setSaveSuccess(false);
    markStale();
  };

  const updateEducation = (index: number, updated: EducationEntry) => {
    setEducations((prev) =>
      prev.map((item, i) => (i === index ? updated : item)),
    );
    setSaveSuccess(false);
    markStale();
  };

  const removeEducation = (index: number) => {
    setEducations((prev) => prev.filter((_, i) => i !== index));
    setSaveSuccess(false);
    markStale();
  };

  const validateDuplicates = (): boolean => {
    const levels = educations.map((e) => e.level).filter(Boolean);
    const set = new Set(levels);
    return set.size === levels.length;
  };

  const hasUnsavedEdits = isFormDirty(
    savedProfile,
    dob,
    category,
    educations,
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);
    setMatchError(null);

    if (!dob) {
      setSaveError('A valid Date of Birth (dob) is required');
      return;
    }

    if (dob > maxDob) {
      setSaveError('Date of birth cannot be in the future');
      return;
    }

    if (!validateDuplicates()) {
      setSaveError('Each qualification level can only be listed once.');
      return;
    }

    const validEducations = educations.filter((e) => e.level !== '');
    if (validEducations.length === 0) {
      setSaveError('Please add at least one qualification level.');
      return;
    }

    if (saving) return;
    setSaving(true);

    try {
      const saved = await saveProfileApi({
        dob,
        category: category || null,
        educations: validEducations as Array<{
          level: EducationLevel;
          marksPercent: number | null;
        }>,
      });

      setSavedProfile(saved);
      setDob(saved.dob);
      setCategory(saved.category ?? '');
      setEducations(
        saved.educations.length > 0
          ? saved.educations
          : [{ level: '', marksPercent: null }],
      );
      setSaveSuccess(true);
      markStale();
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : 'Couldn’t save your profile. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleFindMatches = async () => {
    setMatchError(null);

    if (!savedProfile) {
      setMatchError('Please save your profile before checking matches.');
      return;
    }

    if (hasUnsavedEdits) {
      setMatchError(
        'You have unsaved changes. Save your profile before finding matches.',
      );
      return;
    }

    if (submitting) return;
    setSubmitting(true);

    try {
      const response = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: '{}',
      });

      const data = (await response.json().catch(() => null)) as
        | (MatchResponse & { error?: string })
        | null;

      if (!response.ok) {
        throw new Error(
          data?.error || 'Couldn’t check your profile. Please try again.',
        );
      }

      if (!data || !Array.isArray(data.matches)) {
        throw new Error('Aptus returned an unexpected response.');
      }

      setResults(data);
      router.push('/results');
    } catch (err) {
      setMatchError(
        err instanceof Error
          ? err.message
          : 'Couldn’t check your profile. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      id="profile"
      className="panel profile-panel"
      aria-labelledby="profile-title"
    >
      <div className="section-heading">
        <p className="eyebrow">YOUR PROFILE</p>
        <h2 id="profile-title">Find jobs for you</h2>
        <p className="muted">
          Add your date of birth, category, and completed qualifications. We’ll
          compare them with the recorded notification requirements.
        </p>
      </div>

      {loadStatus === 'loading' && (
        <p role="status" className="notice">
          Loading your profile…
        </p>
      )}

      {loadStatus === 'error' && (
        <div style={{ marginBottom: '1rem' }}>
          <div className="notice notice-error" role="alert">
            {loadError}
          </div>
          <button
            type="button"
            className="button button-secondary"
            style={{ marginTop: '0.5rem' }}
            onClick={() => void loadData()}
          >
            Try again
          </button>
        </div>
      )}

      <form id="match-form" onSubmit={handleSave}>
        <fieldset
          id="profile-fields"
          disabled={loadStatus !== 'ready' || saving || submitting}
        >
          <legend className="sr-only">Your profile details</legend>

          <div className="field-pair">
            <label className="field" htmlFor={`${formId}-dob`}>
              Date of birth <span className="optional">Required</span>
              <input
                id={`${formId}-dob`}
                name="dob"
                type="date"
                autoComplete="bday"
                required
                max={maxDob}
                value={dob}
                onChange={(e) => {
                  setDob(e.target.value);
                  setSaveSuccess(false);
                  markStale();
                }}
              />
            </label>

            <label className="field" htmlFor={`${formId}-cat`}>
              Category
              <select
                id={`${formId}-cat`}
                name="category"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setSaveSuccess(false);
                  markStale();
                }}
              >
                <option value="">Not specified</option>
                <option value="General">General / Unreserved</option>
                <option value="OBC">OBC</option>
                <option value="SC">SC</option>
                <option value="ST">ST</option>
                <option value="EWS">EWS</option>
                <option value="PwBD">PwBD</option>
              </select>
            </label>
          </div>

          <fieldset className="education-group">
            <legend>
              Education <span className="optional">At least one level</span>
            </legend>
            <p className="small muted">
              Marks are optional. Leave them blank if unknown.
            </p>

            <div id="education-list">
              {educations.map((entry, index) => {
                const isDuplicate =
                  entry.level !== '' &&
                  educations.filter((e) => e.level === entry.level).length > 1;

                return (
                  <EducationRow
                    key={index}
                    index={index}
                    entry={entry}
                    canRemove={educations.length > 1}
                    duplicateError={
                      isDuplicate
                        ? `"${entry.level}" is already listed. Choose a different level.`
                        : undefined
                    }
                    onChange={(updated) => updateEducation(index, updated)}
                    onRemove={() => removeEducation(index)}
                  />
                );
              })}
            </div>

            <button
              id="add-education"
              type="button"
              className="button button-secondary"
              onClick={addEducation}
            >
              + Add qualification
            </button>
          </fieldset>

          {saveError && (
            <div id="save-error" className="notice notice-error" role="alert">
              {saveError}
            </div>
          )}

          {saveSuccess && (
            <p id="save-success" className="notice" role="status">
              Profile saved.
            </p>
          )}

          {matchError && (
            <div id="match-error" className="notice notice-error" role="alert">
              {matchError}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              flexWrap: 'wrap',
              alignItems: 'center',
              marginTop: 'var(--space-4)',
            }}
          >
            <button
              id="save-profile"
              className="button button-secondary"
              type="submit"
              disabled={saving || submitting || !hasUnsavedEdits}
            >
              {saving ? 'Saving profile…' : 'Save profile'}
            </button>

            <button
              id="submit-profile"
              className="button button-primary"
              type="button"
              disabled={submitting || saving || hasUnsavedEdits || !savedProfile}
              onClick={() => void handleFindMatches()}
            >
              {submitting ? 'Checking your matches…' : 'Find my matches ↗'}
            </button>
          </div>

          {hasUnsavedEdits && (
            <p className="small muted form-footnote">
              {savedProfile
                ? 'Save your changes to update your profile and check matches.'
                : 'Save your profile to check which jobs you are eligible for.'}
            </p>
          )}

          {!hasUnsavedEdits && savedProfile && (
            <p className="small muted form-footnote">
              A useful first check. The source notification has the final word.
            </p>
          )}
        </fieldset>
      </form>
    </section>
  );
}
