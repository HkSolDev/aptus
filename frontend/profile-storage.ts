import { isRecord } from './api.js';
import { EDUCATION_LEVELS, type EducationEntry, type EducationLevel, type Profile } from './types.js';

const STORAGE_KEY = 'aptus_saved_profile';

export function loadProfile(): Profile | null {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!isRecord(data) || !Array.isArray(data.educations)) return null;
    const educations: EducationEntry[] = data.educations.filter((entry) => isRecord(entry) &&
      (entry.level === '' || EDUCATION_LEVELS.includes(entry.level as EducationLevel)) &&
      (entry.marksPercent === null || (typeof entry.marksPercent === 'number' && Number.isFinite(entry.marksPercent)))
    ) as EducationEntry[];
    // Restore the previous frontend's separate day/month/year fields as one date.
    const legacyDob = [data.dobYear, data.dobMonth, data.dobDay].every((part) => typeof part === 'string' || typeof part === 'number')
      ? `${data.dobYear}-${String(data.dobMonth).padStart(2, '0')}-${String(data.dobDay).padStart(2, '0')}` : '';
    return {
      userId: typeof data.userId === 'string' ? data.userId : undefined,
      name: typeof data.name === 'string' ? data.name : '',
      dob: typeof data.dob === 'string' ? data.dob : legacyDob,
      category: typeof data.category === 'string' ? data.category : null,
      educations,
    };
  } catch {
    return null;
  }
}

export function saveProfile(profile: Profile | null): boolean {
  try {
    if (profile) localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
