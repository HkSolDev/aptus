'use client';

import { useState, useId, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '@/components/providers/workspace-provider';
import { EducationRow } from './education-row';
import type { EducationEntry, Profile, MatchResponse } from '@/frontend/types';

export function ProfileForm() {
  const router = useRouter();
  const { profile, setProfile, setResults, markStale } = useWorkspace();
  const formId = useId();

  const [dob, setDob] = useState(profile?.dob ?? '');
  const [category, setCategory] = useState(profile?.category ?? '');
  const [educations, setEducations] = useState<EducationEntry[]>(
    profile?.educations && profile.educations.length > 0
      ? profile.educations
      : [{ level: '', marksPercent: null }],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set today's date as maximum for DOB
  const today = new Date();
  const maxDob = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Keep workspace profile synced in memory
  useEffect(() => {
    setProfile({
      userId: profile?.userId,
      name: profile?.name,
      dob,
      category: category || null,
      educations,
    });
  }, [dob, category, educations, profile?.name, profile?.userId, setProfile]);

  const addEducation = () => {
    setEducations((prev) => [...prev, { level: '', marksPercent: null }]);
    markStale();
  };

  const updateEducation = (index: number, updated: EducationEntry) => {
    setEducations((prev) =>
      prev.map((item, i) => (i === index ? updated : item)),
    );
    markStale();
  };

  const removeEducation = (index: number) => {
    setEducations((prev) => prev.filter((_, i) => i !== index));
    markStale();
  };

  const validateDuplicates = (): boolean => {
    const levels = educations.map((e) => e.level).filter(Boolean);
    const set = new Set(levels);
    return set.size === levels.length;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateDuplicates()) {
      setError('Each qualification level can only be listed once.');
      return;
    }

    if (!educations.some((e) => e.level !== '')) {
      setError('Please add at least one qualification level.');
      return;
    }

    setSubmitting(true);
    const payload: Profile = {
      userId: profile?.userId,
      name: profile?.name,
      dob,
      category: category || null,
      educations: educations.filter((e) => e.level !== ''),
    };

    try {
      const response = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as MatchResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          data.error || 'Couldn’t check your profile. Please try again.',
        );
      }

      setResults(data);
      router.push('/results');
    } catch (err) {
      setError(
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

      <form id="match-form" onSubmit={handleSubmit}>
        <fieldset id="profile-fields" disabled={submitting}>
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

          {error && (
            <div id="form-error" className="notice notice-error" role="alert">
              {error}
            </div>
          )}

          <button
            id="submit-profile"
            className="button button-primary"
            type="submit"
            disabled={submitting}
          >
            {submitting ? 'Checking your matches…' : 'Find my matches ↗'}
          </button>
          <p className="small muted form-footnote">
            A useful first check. The source notification has the final word.
          </p>
        </fieldset>
      </form>
    </section>
  );
}
