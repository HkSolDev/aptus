import type http from 'node:http';
import { prisma } from '../db.js';
import { sendJson } from '../lib/http.js';

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
  res: http.ServerResponse,
  params: URLSearchParams,
): Promise<void> {
  const page = readPageNumber(params, 'page', 1, 10_000);
  const pageSize = readPageNumber(params, 'pageSize', 20, 100);
  if (page === null || pageSize === null) {
    sendJson(res, 400, {
      error:
        'page must be 1–10000 and pageSize must be 1–100 (whole numbers, supplied once).',
    });
    return;
  }
  try {
    // Pagination happens in PostgreSQL; never fetch all jobs and slice in JavaScript.
    const result = await prisma.$transaction(
      async (db) => {
        const totalItems = await db.post.count();
        const data = await db.post.findMany({
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: [{ postName: 'asc' }, { id: 'asc' }],
          // Explicit public fields: no user/profile data or internal source hashes.
          select: {
            id: true,
            postName: true,
            postGroup: true,
            payLevel: true,
            vacancies: true,
            applicationLastDate: true,
            ageAsOnDate: true,
            minAge: true,
            maxAge: true,
            educationRequired: true,
            minEducationLevel: true,
            minMarksPercent: true,
            source: {
              select: {
                name: true,
                url: true,
                notificationPdfUrl: true,
                officialSiteUrl: true,
                applyUrl: true,
                fetchedAt: true,
              },
            },
          },
        });
        return {
          data,
          pagination: {
            page,
            pageSize,
            totalItems,
            totalPages: Math.ceil(totalItems / pageSize),
          },
        };
      },
      { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 5000 },
    );
    // Count and page share a snapshot, even while the extraction pipeline updates jobs.
    sendJson(res, 200, result);
  } catch {
    sendJson(res, 503, {
      error: 'Jobs are temporarily unavailable. Please try again.',
    });
  }
}
