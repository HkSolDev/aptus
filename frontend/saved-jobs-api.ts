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

  const data = (await response.json().catch(() => null)) as
    (SavedJobsResponse & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(
      data?.error || 'Couldn’t load saved jobs. Please try again.',
    );
  }

  return (
    data ?? {
      data: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    }
  );
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

  const data = (await response.json().catch(() => null)) as {
    savedIds?: string[];
  } | null;

  if (!Array.isArray(data?.savedIds))
    throw new Error('Couldn’t check saved jobs. Please try again.');
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
        'Content-Type': 'application/json',
      },
      body: '{}',
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
    saved?: boolean;
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(data?.error || 'Couldn’t save job. Please try again.');
  }

  return Boolean(data?.saved);
}

export async function unsaveJobApi(jobId: string): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(`/api/saved-jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: '{}',
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
    saved?: boolean;
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(data?.error || 'Couldn’t remove job. Please try again.');
  }

  return false;
}
