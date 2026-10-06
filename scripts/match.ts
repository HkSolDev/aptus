import 'dotenv/config';
import { prisma } from '../src/db.js';
import type { Post, User, Education } from '../generated/prisma/index.js';

const EDUCATION_ORDER = [
  'TENTH',
  'TWELFTH',
  'DIPLOMA',
  'BACHELORS',
  'MASTERS',
  'PHD',
];

export function ageOn(dob: Date, asOf = new Date()): number {
  let age = asOf.getFullYear() - dob.getFullYear();
  const hadBirthdayThisYear =
    asOf.getMonth() > dob.getMonth() ||
    (asOf.getMonth() === dob.getMonth() && asOf.getDate() >= dob.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

export function getEffectiveMaxAge(
  post: { maxAge: number | null; categoryRelaxationRules: unknown },
  userCategory: string,
): { effectiveMaxAge: number | null; relaxation: number } {
  const relaxation =
    (post.categoryRelaxationRules as Record<string, number | null> | null)?.[
      userCategory
    ] ?? 0;
  const effectiveMaxAge =
    post.maxAge !== null ? post.maxAge + relaxation : null;
  return { effectiveMaxAge, relaxation };
}

export type MatchCandidate = Pick<User, 'dob' | 'category'> & {
  educations: Pick<Education, 'level' | 'marksPercent'>[];
};

export function getPostChecks(
  post: Pick<
    Post,
    | 'minAge'
    | 'maxAge'
    | 'minEducationLevel'
    | 'minMarksPercent'
    | 'categoryRelaxationRules'
  >,
  user: MatchCandidate,
) {
  const userAge = ageOn(user.dob);
  const highestLevelRank = Math.max(
    ...user.educations.map((e) => EDUCATION_ORDER.indexOf(e.level)),
  );
  const marksByLevel = new Map(
    user.educations.map((e) => [e.level, e.marksPercent]),
  );

  const { effectiveMaxAge, relaxation } = getEffectiveMaxAge(post, user.category);

  const ageOk =
    (post.minAge === null || userAge >= post.minAge) &&
    (effectiveMaxAge === null || userAge <= effectiveMaxAge);

  const educationOk =
    post.minEducationLevel === null ||
    highestLevelRank >= EDUCATION_ORDER.indexOf(post.minEducationLevel);

  // Marks are checked at the SPECIFIC level the post requires, not the
  // user's highest level — a post asking for "60% in 10th" cares about
  // the 10th-grade percentage even if the user went on to a Master's.
  // Missing data (post's requirement unknown, or user never entered that
  // level's marks) is NOT a hard fail — it's a "verify manually" case,
  // so the post stays in the results rather than being silently hidden.
  const requiredMarks = post.minMarksPercent;
  const marksAtRequiredLevel = post.minEducationLevel
    ? marksByLevel.get(post.minEducationLevel)
    : undefined;
  const marksOk =
    requiredMarks == null ||
    marksAtRequiredLevel == null ||
    marksAtRequiredLevel >= requiredMarks;

  return {
    userAge,
    effectiveMaxAge,
    relaxation,
    ageOk,
    educationOk,
    marksOk,
    marksAtRequiredLevel,
  };
}

export async function getMatchesForUser(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { educations: true },
  });
  const posts = await prisma.post.findMany({ include: { source: true } });
  return posts.filter((post) => {
    const { ageOk, educationOk, marksOk } = getPostChecks(post, user);
    return ageOk && educationOk && marksOk;
  });
}

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error('Usage: tsx scripts/match.ts <userId>');
    process.exit(1);
  }

  const matches = await getMatchesForUser(userId);
  console.log(`Eligible for ${matches.length} posts:\n`);
  for (const post of matches) {
    console.log(
      `- ${post.postName} (${post.source.name}) -> ${post.source.url}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error('[Error]', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
