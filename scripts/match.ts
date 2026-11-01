import 'dotenv/config';
import { prisma } from '../src/db.js';
import type { Post, User, Education } from '../generated/prisma/index.js';
import { activeApplicationWhere } from '../src/lib/application-deadline.js';
import { isEligibilityRules } from '../src/schemas/eligibility-rules.js';
import { getAgeLimits, type AgePost } from './match-age.js';

const EDUCATION_ORDER = [
  'TENTH',
  'TWELFTH',
  'DIPLOMA',
  'BACHELORS',
  'MASTERS',
  'PHD',
];

export function ageOn(dob: Date, asOf = new Date()): number {
  let age = asOf.getUTCFullYear() - dob.getUTCFullYear();
  const hadBirthdayThisYear =
    asOf.getUTCMonth() > dob.getUTCMonth() ||
    (asOf.getUTCMonth() === dob.getUTCMonth() &&
      asOf.getUTCDate() >= dob.getUTCDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

export function getEffectiveMaxAge(
  post: AgePost,
  userCategory: string,
): { effectiveMaxAge: number | null; relaxation: number } {
  const { effectiveMaxAge, relaxation } = getAgeLimits(post, userCategory);
  return { effectiveMaxAge, relaxation };
}

export type MatchCandidate = Pick<User, 'dob' | 'category'> & {
  educations: Pick<Education, 'level' | 'marksPercent'>[];
};

export function getUnverifiedRequirements(
  post: Partial<Pick<Post, 'eligibilityRules' | 'reviewedDetails'>>,
): string[] {
  const reasons: string[] = [];
  if (post.eligibilityRules != null) {
    if (!isEligibilityRules(post.eligibilityRules)) {
      reasons.push('Detailed qualification rules require manual verification');
    } else {
      const rules = post.eligibilityRules;
      if (rules.gender_requirement)
        reasons.push(`Verify gender requirement: ${rules.gender_requirement}`);
      if (rules.category_requirement.length)
        reasons.push(
          `Verify category requirement: ${rules.category_requirement.join(', ')}`,
        );
      if (rules.relaxation_combination_rule)
        reasons.push(
          `Verify relaxation combination rule: ${rules.relaxation_combination_rule}`,
        );
      if (rules.age_rules.length)
        reasons.push('Detailed age conditions require manual verification');
      if (rules.education_options.length) {
        const routes = post.eligibilityRules.education_options.map((option) =>
          [
            option.qualification ?? option.minimum_level,
            option.subject_requirement,
            option.conditions,
            option.minimum_marks_percent == null
              ? null
              : `${option.minimum_marks_percent}% marks`,
          ]
            .filter(Boolean)
            .join('; '),
        );
        // Profiles record education levels, not exact qualifications or route conditions.
        reasons.push(
          `Verify the applicable qualification route: ${routes.join(' OR ')}`,
        );
      }
    }
  }
  const details = post.reviewedDetails;
  if (
    details &&
    typeof details === 'object' &&
    !Array.isArray(details) &&
    typeof details.nationality_requirement === 'string' &&
    details.nationality_requirement.trim()
  ) {
    reasons.push(
      `Verify nationality requirement: ${details.nationality_requirement}`,
    );
  }
  if (
    details &&
    typeof details === 'object' &&
    !Array.isArray(details) &&
    Array.isArray(details.experience_rules)
  ) {
    for (const row of details.experience_rules as unknown[]) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const rule = row as Record<string, unknown>;
      const years =
        typeof rule.minimum_years === 'number'
          ? `${rule.minimum_years} years`
          : null;
      const condition =
        typeof rule.conditions === 'string' ? rule.conditions : null;
      if (years || condition)
        reasons.push(
          `Verify experience for the applicable route: ${[years, condition].filter(Boolean).join(' — ')}`,
        );
    }
  }
  return reasons;
}

export function getPostChecks(
  post: Pick<
    Post,
    | 'minAge'
    | 'maxAge'
    | 'minEducationLevel'
    | 'minMarksPercent'
    | 'categoryRelaxationRules'
  > &
    Partial<
      Pick<
        Post,
        | 'eligibilityRules'
        | 'reviewedDetails'
        | 'ageAsOnDate'
        | 'categoryRelaxationApplies'
      >
    >,
  user: MatchCandidate,
) {
  const reference = post.ageAsOnDate;
  const userAge =
    reference instanceof Date && Number.isFinite(reference.getTime())
      ? ageOn(user.dob, reference)
      : null;
  const highestLevelRank = Math.max(
    ...user.educations.map((e) => EDUCATION_ORDER.indexOf(e.level)),
  );
  const marksByLevel = new Map(
    user.educations.map((e) => [e.level, e.marksPercent]),
  );

  const {
    effectiveMaxAge,
    relaxation,
    minimumUncertain,
    reasons: ageReasons,
  } = getAgeLimits(post, user.category);

  const ageOk =
    userAge === null ||
    ((minimumUncertain || post.minAge === null || userAge >= post.minAge) &&
      (effectiveMaxAge === null || userAge <= effectiveMaxAge));
  if (userAge === null)
    ageReasons.unshift(
      'Notification age reference date requires manual verification',
    );

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
    ageNeedsManualCheck:
      userAge === null ||
      minimumUncertain ||
      effectiveMaxAge === null ||
      post.minAge === null ||
      ageReasons.length > 0,
    unverifiedRequirements: [
      ...new Set([...ageReasons, ...getUnverifiedRequirements(post)]),
    ],
  };
}

export async function getMatchesForUser(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { educations: true },
  });
  const posts = await prisma.post.findMany({
    where: activeApplicationWhere(),
    include: { source: true },
  });
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
  console.log(
    `Potential matches requiring verification: ${matches.length} posts:\n`,
  );
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
