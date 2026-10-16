import { prisma } from '../db.js';
import type { Prisma } from '../../generated/prisma/index.js';
import type { JobFilters } from '../../frontend/public-job-filters.js';

// Shared by the JSON API and HTML catalogue; never select user/profile data.
const publicFields = {
  id: true,
  postName: true,
  organization: true,
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

export function listPublicJobs(
  page: number,
  pageSize: number,
  filters?: JobFilters,
) {
  const conditions: Prisma.PostWhereInput[] = [];
  if (filters?.q) {
    const keyword = filters.q.replace(/[\\%_]/g, '\\$&');
    conditions.push({
      OR: [
        { postName: { contains: keyword, mode: 'insensitive' } },
        { educationRequired: { contains: keyword, mode: 'insensitive' } },
        { organization: { contains: keyword, mode: 'insensitive' } },
      ],
    });
  }
  if (filters?.qualification) {
    conditions.push({
      OR: [
        { minEducationLevel: filters.qualification },
        {
          eligibilityRules: {
            path: ['education_options'],
            array_contains: [{ minimum_level: filters.qualification }],
          },
        },
      ],
    });
  }
  const where: Prisma.PostWhereInput = { AND: conditions };
  // The legacy HTML caller keeps its existing alphabetic order.
  const orderBy: Prisma.PostOrderByWithRelationInput[] = filters
    ? [
        {
          applicationLastDate: {
            sort: filters.sort === 'soonest' ? 'asc' : 'desc',
            nulls: 'last',
          },
        },
        { id: 'asc' },
      ]
    : [{ postName: 'asc' }, { id: 'asc' }];
  // Count and rows share a snapshot while the extraction pipeline updates jobs.
  return prisma.$transaction(
    async (db) => {
      const totalItems = await db.post.count({ where });
      const data = await db.post.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        where,
        orderBy,
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
      eligibilityRules: true,
      categoryRelaxationApplies: true,
      categoryRelaxationRules: true,
    },
  });
}
