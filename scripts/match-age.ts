import type { Post } from '../generated/prisma/index.js';
import { isEligibilityRules } from '../src/schemas/eligibility-rules.js';

export type AgePost = Pick<Post, 'maxAge' | 'categoryRelaxationRules'> &
  Partial<
    Pick<
      Post,
      | 'minAge'
      | 'ageAsOnDate'
      | 'categoryRelaxationApplies'
      | 'eligibilityRules'
    >
  >;

export function getAgeLimits(post: AgePost, category: string) {
  const reasons: string[] = [];
  let minimumUncertain = false;
  let maximumUncertain = false;
  let relaxation = 0;
  const rules = post.categoryRelaxationRules;
  if (post.categoryRelaxationApplies !== false) {
    const years =
      rules && typeof rules === 'object' && !Array.isArray(rules)
        ? rules[category]
        : undefined;
    if (
      post.categoryRelaxationApplies === true &&
      typeof years === 'number' &&
      Number.isInteger(years) &&
      years >= 0
    ) {
      relaxation = years;
    } else {
      maximumUncertain = true;
      reasons.push('Category age relaxation requires manual verification');
    }
  }
  if (post.eligibilityRules != null) {
    if (!isEligibilityRules(post.eligibilityRules)) {
      minimumUncertain = true;
      maximumUncertain = true;
      reasons.push('Detailed age rules require manual verification');
    } else {
      for (const rule of post.eligibilityRules.age_rules) {
        // Exact category labels only; unrecognized labels may describe a group.
        const knownCategories = ['General', 'OBC', 'SC', 'ST', 'EWS', 'PwBD'];
        if (
          rule.category &&
          knownCategories.includes(rule.category) &&
          knownCategories.includes(category) &&
          rule.category !== category
        )
          continue;
        const unspecifiedBounds =
          rule.min_age === null &&
          rule.max_age === null &&
          rule.relaxation_years === null;
        minimumUncertain ||=
          (rule.min_age !== null && rule.min_age !== post.minAge) ||
          (unspecifiedBounds && Boolean(rule.gender || rule.conditions));
        maximumUncertain ||=
          (rule.max_age !== null && rule.max_age !== post.maxAge) ||
          (rule.relaxation_years !== null &&
            (rule.relaxation_years !== relaxation ||
              Boolean(rule.gender || rule.conditions))) ||
          (unspecifiedBounds && Boolean(rule.gender || rule.conditions));
        reasons.push(
          'Verify the applicable detailed age rule against the notification',
        );
      }
      if (
        post.categoryRelaxationApplies !== false &&
        post.eligibilityRules.relaxation_combination_rule
      ) {
        maximumUncertain = true;
      }
    }
  }
  // An unverified allowance must never be represented as applied years.
  if (maximumUncertain) relaxation = 0;
  return {
    effectiveMaxAge:
      maximumUncertain || post.maxAge === null
        ? null
        : post.maxAge + relaxation,
    relaxation,
    minimumUncertain,
    maximumUncertain,
    reasons,
  };
}
