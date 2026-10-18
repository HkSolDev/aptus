import type { Prisma } from '../../generated/prisma/index.js';

export function activeApplicationWhere(
  now = new Date(),
): Prisma.PostWhereInput {
  // Stored deadlines are calendar dates. Keep today's jobs until midnight IST.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return {
    OR: [
      { applicationLastDate: null },
      { applicationLastDate: { gte: new Date(`${today}T00:00:00Z`) } },
    ],
  };
}
