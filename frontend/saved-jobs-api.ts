import type { PublicJobItem } from './types.js';

export interface SavedJobItem extends PublicJobItem {
  savedAt: string;
}

export interface SavedJobsResponse {
  data: SavedJobItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateSavedJobItem(raw: unknown): SavedJobItem {
  if (!isRecord(raw)) {
    throw new Error('Aptus returned an invalid saved job format.');
  }
  if (typeof raw.id !== 'string' || !raw.id) {
    throw new Error('Aptus returned an invalid job ID.');
  }
  if (typeof raw.postName !== 'string') {
    throw new Error('Aptus returned an invalid job title.');
  }
  if (
    raw.organization !== undefined &&
    raw.organization !== null &&
    typeof raw.organization !== 'string'
  ) {
    throw new Error('Aptus returned an invalid organization.');
  }
  if (
    raw.vacancies !== null &&
    (typeof raw.vacancies !== 'number' ||
      !Number.isInteger(raw.vacancies) ||
      raw.vacancies < 0)
  ) {
    throw new Error('Aptus returned an invalid vacancies count.');
  }
  if (
    raw.applicationLastDate !== null &&
    typeof raw.applicationLastDate !== 'string'
  ) {
    throw new Error('Aptus returned an invalid application deadline.');
  }
  if (
    !('educationRequired' in raw) ||
    (raw.educationRequired !== null &&
      typeof raw.educationRequired !== 'string')
  ) {
    throw new Error('Aptus returned an invalid education requirement.');
  }
  if (
    raw.payLevel !== undefined &&
    raw.payLevel !== null &&
    typeof raw.payLevel !== 'string'
  ) {
    throw new Error('Aptus returned an invalid pay level.');
  }
  if (!isRecord(raw.source) || typeof raw.source.name !== 'string') {
    throw new Error('Aptus returned an invalid job source.');
  }
  if (typeof raw.savedAt !== 'string') {
    throw new Error('Aptus returned an invalid saved timestamp.');
  }

  return {
    id: raw.id,
    postName: raw.postName,
    organization: raw.organization as string | null | undefined,
    vacancies: raw.vacancies,
    applicationLastDate: raw.applicationLastDate,
    educationRequired: raw.educationRequired,
    payLevel: raw.payLevel as string | null | undefined,
    source: {
      name: raw.source.name,
    },
    savedAt: raw.savedAt,
  };
}

function validateSavedJobsResponse(data: unknown): SavedJobsResponse {
  if (!isRecord(data)) {
    throw new Error('Aptus returned an unexpected saved jobs format.');
  }
  if (!('data' in data) || !Array.isArray(data.data)) {
    throw new Error('Aptus returned an invalid saved jobs list.');
  }
  if (!('pagination' in data) || !isRecord(data.pagination)) {
    throw new Error('Aptus returned invalid pagination details.');
  }
  const { page, pageSize, totalItems, totalPages } = data.pagination;
  if (
    typeof page !== 'number' ||
    !Number.isInteger(page) ||
    page < 1 ||
    typeof pageSize !== 'number' ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    typeof totalItems !== 'number' ||
    !Number.isInteger(totalItems) ||
    totalItems < 0 ||
    typeof totalPages !== 'number' ||
    !Number.isInteger(totalPages) ||
    totalPages < 0
  ) {
    throw new Error('Aptus returned invalid pagination details.');
  }

  return {
    data: data.data.map(validateSavedJobItem),
    pagination: { page, pageSize, totalItems, totalPages },
  };
}

export async function fetchSavedJobs(page = 1): Promise<SavedJobsResponse> {
  let response: Response;
  try {
    response = await fetch(`/api/saved-jobs?page=${page}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
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
      errorMsg || 'Couldn’t load saved jobs. Please try again.',
    );
  }

  return validateSavedJobsResponse(data);
}

export async function fetchSavedStatus(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  // Bounded to 50 IDs per request
  const slice = ids.slice(0, 50);
  let response: Response;
  try {
    response = await fetch(
      `/api/saved-jobs/status?ids=${encodeURIComponent(slice.join(','))}`,
      {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      },
    );
  } catch {
    throw new Error('Couldn’t check saved jobs. Please try again.');
  }

  if (!response.ok)
    throw new Error('Couldn’t check saved jobs. Please try again.');

  const data: unknown = await response.json().catch(() => null);

  if (
    !isRecord(data) ||
    !('savedIds' in data) ||
    !Array.isArray(data.savedIds) ||
    !data.savedIds.every((id: unknown) => typeof id === 'string')
  ) {
    throw new Error('Couldn’t check saved jobs. Please try again.');
  }
  return data.savedIds;
}

export async function saveJobApi(jobId: string): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(`/api/saved-jobs/${encodeURIComponent(jobId)}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
      },
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
    throw new Error(errorMsg || 'Couldn’t save job. Please try again.');
  }

  if (!isRecord(data) || data.saved !== true) {
    throw new Error('Aptus returned an unexpected response. Please try again.');
  }

  if (
    data.savedAt !== undefined &&
    (typeof data.savedAt !== 'string' || !data.savedAt)
  ) {
    throw new Error('Aptus returned an unexpected response. Please try again.');
  }

  return true;
}

export async function unsaveJobApi(jobId: string): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(`/api/saved-jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
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
    throw new Error(errorMsg || 'Couldn’t remove job. Please try again.');
  }

  if (!isRecord(data) || data.saved !== false) {
    throw new Error('Aptus returned an unexpected response. Please try again.');
  }

  return false;
}
