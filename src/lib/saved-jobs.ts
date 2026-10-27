import { prisma } from '../db.js';
import { publicFields, type PublicJob } from './public-jobs.js';

export interface SavedJobItem extends PublicJob {
  savedAt: string;
}

export interface SavedJobsResult {
  data: SavedJobItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export const JOB_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export async function listSavedJobs(
  authUserId: string,
  page: number,
  pageSize = 20,
): Promise<SavedJobsResult> {
  const boundedPage = Math.max(1, Math.min(page, 10_000));
  const boundedPageSize = Math.max(1, Math.min(pageSize, 100));

  return prisma.$transaction(
    async (db) => {
      const totalItems = await db.savedJob.count({
        where: { authUserId },
      });

      const rows = await db.savedJob.findMany({
        where: { authUserId },
        skip: (boundedPage - 1) * boundedPageSize,
        take: boundedPageSize,
        orderBy: [{ savedAt: 'desc' }, { id: 'desc' }],
        include: {
          post: {
            select: publicFields,
          },
        },
      });

      const data: SavedJobItem[] = rows.map((row) => ({
        ...row.post,
        savedAt: row.savedAt.toISOString(),
      }));

      return {
        data,
        pagination: {
          page: boundedPage,
          pageSize: boundedPageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / boundedPageSize),
        },
      };
    },
    { isolationLevel: 'RepeatableRead', maxWait: 10_000, timeout: 5000 },
  );
}

export async function saveJobForUser(
  authUserId: string,
  jobId: string,
): Promise<
  { ok: true; savedAt: string } | { ok: false; error: string; status: number }
> {
  if (!JOB_ID_REGEX.test(jobId)) {
    return { ok: false, error: 'Invalid job ID', status: 400 };
  }

  const post = await prisma.post.findUnique({
    where: { id: jobId },
    select: { id: true },
  });

  if (!post) {
    return { ok: false, error: 'Job not found', status: 404 };
  }

  // A database conflict is a successful repeat save, including simultaneous first saves.
  await prisma.savedJob.createMany({
    data: [{ authUserId, postId: jobId }],
    skipDuplicates: true,
  });
  const saved = await prisma.savedJob.findUniqueOrThrow({
    where: { authUserId_postId: { authUserId, postId: jobId } },
  });

  return { ok: true, savedAt: saved.savedAt.toISOString() };
}

export async function deleteSavedJobForUser(
  authUserId: string,
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!JOB_ID_REGEX.test(jobId)) {
    return { ok: false, error: 'Invalid job ID', status: 400 };
  }

  await prisma.savedJob.deleteMany({
    where: {
      authUserId,
      postId: jobId,
    },
  });

  return { ok: true };
}

export async function getSavedJobStatus(
  authUserId: string,
  jobIds: string[],
): Promise<
  | { ok: true; savedIds: string[] }
  | { ok: false; error: string; status: number }
> {
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    return { ok: true, savedIds: [] };
  }

  if (jobIds.length > 50) {
    return {
      ok: false,
      error: 'A maximum of 50 job IDs can be queried at once',
      status: 400,
    };
  }

  const validIds: string[] = [];
  for (const id of jobIds) {
    if (typeof id !== 'string' || !JOB_ID_REGEX.test(id)) {
      return { ok: false, error: `Invalid job ID: ${String(id)}`, status: 400 };
    }
    validIds.push(id);
  }

  const found = await prisma.savedJob.findMany({
    where: {
      authUserId,
      postId: { in: validIds },
    },
    select: { postId: true },
  });

  return { ok: true, savedIds: found.map((f) => f.postId) };
}
