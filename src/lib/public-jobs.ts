import { prisma } from '../db.js';
import type { Prisma } from '../../generated/prisma/index.js';

// Shared by the JSON API and HTML catalogue; never select user/profile data.
const publicFields = {
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
} satisfies Prisma.PostSelect;

export type PublicJob = Prisma.PostGetPayload<{ select: typeof publicFields }>;

export function listPublicJobs(page: number, pageSize: number) {
  // Count and rows share a snapshot while the extraction pipeline updates jobs.
  return prisma.$transaction(
    async (db) => {
      const totalItems = await db.post.count();
      const data = await db.post.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ postName: 'asc' }, { id: 'asc' }],
        select: publicFields,
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
}

export function getPublicJob(id: string) {
  return prisma.post.findUnique({
    where: { id },
    select: {
      ...publicFields,
      reviewedDetails: true,
      eligibilityRules: true,
      categoryRelaxationApplies: true,
      categoryRelaxationRules: true,
    },
  });
}
