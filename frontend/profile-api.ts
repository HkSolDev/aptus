import type { EducationLevel, SavedProfile } from './types.js';

export interface PutProfilePayload {
  dob: string;
  category: string | null;
  educations: Array<{
    level: EducationLevel;
    marksPercent: number | null;
  }>;
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

  const data = (await response.json().catch(() => null)) as {
    profile?: SavedProfile | null;
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(
      data?.error || 'Couldn’t load your profile. Please try again.',
    );
  }

  return data?.profile ?? null;
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

  const data = (await response.json().catch(() => null)) as {
    profile?: SavedProfile;
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(
      data?.error || 'Couldn’t save your profile. Please try again.',
    );
  }

  if (!data?.profile) {
    throw new Error(
      'Aptus returned an unexpected response. Please refresh and try again.',
    );
  }

  return data.profile;
}
