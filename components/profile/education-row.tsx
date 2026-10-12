'use client';

import {
  EDUCATION_LEVELS,
  type EducationEntry,
  type EducationLevel,
} from '@/frontend/types';

const LEVEL_LABELS: Record<EducationLevel, string> = {
  TENTH: '10th / Secondary',
  TWELFTH: '12th / Higher Secondary',
  DIPLOMA: 'Diploma',
  BACHELORS: 'Bachelor’s Degree',
  MASTERS: 'Master’s Degree',
  PHD: 'Doctorate / Ph.D.',
};

interface EducationRowProps {
  index: number;
  entry: EducationEntry;
  canRemove: boolean;
  duplicateError?: string;
  onChange: (entry: EducationEntry) => void;
  onRemove: () => void;
}

export function EducationRow({
  index,
  entry,
  canRemove,
  duplicateError,
  onChange,
  onRemove,
}: EducationRowProps) {
  return (
    <div className="education-row" data-index={index}>
      <label className="field">
        Qualification Required
        <select
          name="eduLevel"
          required
          value={entry.level}
          aria-invalid={duplicateError ? 'true' : undefined}
          onChange={(e) =>
            onChange({ ...entry, level: e.target.value as EducationLevel | '' })
          }
        >
          <option value="">Select qualification</option>
          {EDUCATION_LEVELS.map((level) => (
            <option key={level} value={level}>
              {LEVEL_LABELS[level]}
            </option>
          ))}
        </select>
      </label>

      {duplicateError && (
        <p className="notice notice-error small" role="alert">
          {duplicateError}
        </p>
      )}

      <label className="field">
        Marks (%) <span className="optional">Optional</span>
        <input
          name="marks"
          type="number"
          min="0"
          max="100"
          step="0.01"
          placeholder="e.g. 75.5"
          value={entry.marksPercent !== null ? entry.marksPercent : ''}
          onChange={(e) =>
            onChange({
              ...entry,
              marksPercent: e.target.value ? parseFloat(e.target.value) : null,
            })
          }
        />
      </label>

      {canRemove && (
        <button
          type="button"
          className="text-button remove-education"
          onClick={onRemove}
        >
          Remove this qualification
        </button>
      )}
    </div>
  );
}
