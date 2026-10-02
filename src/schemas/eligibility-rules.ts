import { EducationLevel, type Prisma } from '../../generated/prisma/index.js';

interface AgeRule extends Prisma.InputJsonObject {
  category: string | null;
  gender: string | null;
  min_age: number | null;
  max_age: number | null;
  relaxation_years: number | null;
  conditions: string | null;
}

interface EducationOption extends Prisma.InputJsonObject {
  minimum_level: EducationLevel | null;
  minimum_marks_percent: number | null;
  qualification: string | null;
  subject_requirement: string | null;
  conditions: string | null;
}

export interface EligibilityRules extends Prisma.InputJsonObject {
  gender_requirement: string | null;
  category_requirement: string[];
  education_options: EducationOption[];
  age_rules: AgeRule[];
  relaxation_combination_rule: string | null;
}

type FieldCheck = (value: unknown) => boolean;
const nullableString: FieldCheck = (value) =>
  value === null || typeof value === 'string';
const nullableNumber: FieldCheck = (value) =>
  value === null || (typeof value === 'number' && Number.isFinite(value));
const nullableInteger: FieldCheck = (value) =>
  value === null || (typeof value === 'number' && Number.isInteger(value));

function matchesFields(
  value: unknown,
  fields: Record<string, FieldCheck>,
): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  // Like Pydantic extra="forbid": require every field and reject unexpected keys.
  return (
    Object.keys(record).length === Object.keys(fields).length &&
    Object.entries(fields).every(
      ([key, check]) => Object.hasOwn(record, key) && check(record[key]),
    )
  );
}

const isAgeRule: FieldCheck = (value) =>
  matchesFields(value, {
    category: nullableString,
    gender: nullableString,
    min_age: nullableInteger,
    max_age: nullableInteger,
    relaxation_years: nullableInteger,
    conditions: nullableString,
  });

const isEducationOption: FieldCheck = (value) =>
  matchesFields(value, {
    minimum_level: (level) =>
      level === null ||
      (typeof level === 'string' &&
        Object.values(EducationLevel).includes(level as EducationLevel)),
    minimum_marks_percent: nullableNumber,
    qualification: nullableString,
    subject_requirement: nullableString,
    conditions: nullableString,
  });

export function isEligibilityRules(value: unknown): value is EligibilityRules {
  return matchesFields(value, {
    gender_requirement: nullableString,
    category_requirement: (categories) =>
      Array.isArray(categories) &&
      categories.every((category) => typeof category === 'string'),
    education_options: (options) =>
      Array.isArray(options) && options.every(isEducationOption),
    age_rules: (rules) => Array.isArray(rules) && rules.every(isAgeRule),
    relaxation_combination_rule: nullableString,
  });
}
