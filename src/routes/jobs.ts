import type { FastifyReply } from 'fastify';
import { listPublicJobs } from '../lib/public-jobs.js';
import { sendJson } from '../lib/http.js';
import { readJobFilters } from '../../frontend/public-job-filters.js';

function readPageNumber(
  params: URLSearchParams,
  key: string,
  fallback: number,
  max: number,
): number | null {
  const values = params.getAll(key);
  if (values.length === 0) return fallback;
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) return null;
  const value = Number(values[0]);
  return Number.isSafeInteger(value) && value <= max ? value : null;
}

export async function handleJobs(
  res: FastifyReply,
  params: URLSearchParams,
): Promise<void> {
  const page = readPageNumber(params, 'page', 1, 10_000);
  const pageSize = readPageNumber(params, 'pageSize', 20, 100);
  const filters = readJobFilters(params);
  if (!filters) {
    sendJson(res, 400, {
      error:
        'Use one search of at most 100 characters, a supported qualification and newest, soonest or furthest sorting.',
    });
    return;
  }
  if (page === null || pageSize === null) {
    sendJson(res, 400, {
      error:
        'page must be 1–10000 and pageSize must be 1–100 (whole numbers, supplied once).',
    });
    return;
  }
  try {
    const result = await listPublicJobs(page, pageSize, filters);
    sendJson(res, 200, result);
  } catch {
    sendJson(res, 503, {
      error: 'Jobs are temporarily unavailable. Please try again.',
    });
  }
}
