import type {
  EducationLevel,
  SavedProfile,
  SavedProfileEducation,
} from './types.js';

export interface PutProfilePayload {
  dob: string;
  category: string | null;
  educations: Array<{
    level: EducationLevel;
    marksPercent: number | null;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ALLOWED_CATEGORIES: ReadonlySet<string | null> = new Set([
  null,
  'General',
  'OBC',
  'SC',
  'ST',
  'EWS',
  'PwBD',
]);

const EDUCATION_LEVEL_MAP = {
  TENTH: true,
  TWELFTH: true,
  DIPLOMA: true,
  BACHELORS: true,
  MASTERS: true,
  PHD: true,
} satisfies Record<EducationLevel, true>;

const ALLOWED_LEVELS: ReadonlySet<string> = new Set(
  Object.keys(EDUCATION_LEVEL_MAP),
);

function validateSavedProfile(raw: unknown): SavedProfile {
  if (!isRecord(raw)) {
    throw new Error('Aptus returned an unexpected profile format.');
  }
  if (typeof raw.dob !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.dob)) {
    throw new Error('Aptus returned an invalid date of birth.');
  }
  const [y, m, d] = raw.dob.split('-').map(Number);
  const parsedDob = new Date(Date.UTC(y, m - 1, d));
  if (
    parsedDob.getUTCFullYear() !== y ||
    parsedDob.getUTCMonth() !== m - 1 ||
    parsedDob.getUTCDate() !== d
  ) {
    throw new Error('Aptus returned an invalid date of birth.');
  }
  if (!ALLOWED_CATEGORIES.has(raw.category as string | null)) {
    throw new Error('Aptus returned an invalid category.');
  }
  if (!Array.isArray(raw.educations)) {
    throw new Error('Aptus returned an invalid education list.');
  }
  const educations: SavedProfileEducation[] = [];
  for (const item of raw.educations) {
    if (!isRecord(item)) {
      throw new Error('Aptus returned an invalid education entry.');
    }
    if (typeof item.level !== 'string' || !ALLOWED_LEVELS.has(item.level)) {
      throw new Error('Aptus returned an invalid education level.');
    }
    if (
      item.marksPercent !== null &&
      (typeof item.marksPercent !== 'number' ||
        !Number.isFinite(item.marksPercent) ||
        item.marksPercent < 0 ||
        item.marksPercent > 100)
    ) {
      throw new Error('Aptus returned an invalid marks percentage.');
    }
    educations.push({
      level: item.level as EducationLevel,
      marksPercent: item.marksPercent,
    });
  }
  return {
    dob: raw.dob,
    category: raw.category as string | null,
    educations,
  };
}
export async function fetchProfile(): Promise<SavedProfile | null> {
  let response: Response;
  try {
    response = await fetch('/api/profile', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error(
      'Couldn’t reach Aptus. Check your connection and try again.',
    );
  }

  if (response.status === 401) {
    throw new Error('Please sign in again.');
  }

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg =
      isRecord(data) && typeof data.error === 'string' ? data.error : null;
    throw new Error(
      errorMsg || 'Couldn’t load your profile. Please try again.',
    );
  }

  if (!isRecord(data) || !('profile' in data)) {
    throw new Error(
      'Aptus returned an unexpected response. Please refresh and try again.',
    );
  }

  if (data.profile === null) {
    return null;
  }

  return validateSavedProfile(data.profile);
}

export async function saveProfileApi(
  payload: PutProfilePayload,
): Promise<SavedProfile> {
  let response: Response;
  try {
    response = await fetch('/api/profile', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error(
      'Couldn’t reach Aptus. Check your connection and try again.',
    );
  }

  if (response.status === 401) {
    throw new Error('Please sign in again.');
  }

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg =
      isRecord(data) && typeof data.error === 'string' ? data.error : null;
    throw new Error(
      errorMsg || 'Couldn’t save your profile. Please try again.',
    );
  }

  if (!isRecord(data) || !('profile' in data) || data.profile === null) {
    throw new Error(
      'Aptus returned an unexpected response. Please refresh and try again.',
    );
  }

  return validateSavedProfile(data.profile);
}
