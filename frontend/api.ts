import type { MatchResponse, Profile } from './types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPost(value: unknown, manual: boolean): boolean {
  if (!isRecord(value)) return false;
  const stringFields = [
    'id',
    'postName',
    'sourceName',
    'sourceUrl',
    manual ? 'reason' : 'ageComparison',
  ];
  const nullableField = manual
    ? 'educationRequired'
    : 'categoryRelaxationApplied';
  return (
    stringFields.every((key) => typeof value[key] === 'string') &&
    (value.payLevel === null || typeof value.payLevel === 'string') &&
    (value[nullableField] === null || typeof value[nullableField] === 'string')
  );
}

function isMatchResponse(value: unknown): value is MatchResponse {
  return (
    isRecord(value) &&
    typeof value.userId === 'string' &&
    Array.isArray(value.matches) &&
    value.matches.every((post) => isPost(post, false)) &&
    Array.isArray(value.needsManualCheck) &&
    value.needsManualCheck.every((post) => isPost(post, true)) &&
    Array.isArray(value.sourcesChecked) &&
    value.sourcesChecked.every((source) => typeof source === 'string')
  );
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(
        'The request took too long. Your profile may have been saved. Check your connection before trying again.',
      );
    }
    throw new Error(
      'Couldn’t reach Aptus. Check your connection and try again.',
    );
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      response.status < 500 && isRecord(data) && typeof data.error === 'string'
        ? data.error
        : 'Aptus couldn’t complete the request. Please try again shortly.';
    throw new Error(message);
  }
  return data;
}

export async function matchProfile(profile?: Profile): Promise<MatchResponse> {
  const data = await postJson('/api/match', profile ?? {});
  // Types disappear at compilation; check the server response at this boundary.
  if (!isMatchResponse(data))
    throw new Error(
      'Aptus returned an unexpected result. Please refresh and try again.',
    );
  return data;
}

export async function explainPost(
  postId: string,
  userId: string,
): Promise<string> {
  const data = await postJson('/api/explain', { postId, userId });
  if (!isRecord(data) || typeof data.explanation !== 'string') {
    throw new Error('The explanation wasn’t available. Please try again.');
  }
  return data.explanation;
}
