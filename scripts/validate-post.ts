interface ValidatablePost {
  minAge: number | null;
  maxAge: number | null;
  minMarksPercent: number | null;
  categoryRelaxationRules: Record<string, number | null>;
}

const MIN_REALISTIC_AGE = 15;
const MAX_REALISTIC_AGE = 65;
const MAX_REALISTIC_RELAXATION = 20;

// A fabricated number is still correctly-typed (passes the LLM's strict
// JSON schema), so schema validation alone can't catch it. These checks run
// AFTER extraction: range bounds catch impossible values on their own, and
// the grounding check catches plausible-but-invented ones by requiring the
// exact digits to appear somewhere in the source text the LLM actually saw.
// A failed check nulls the field — same as "not stated in the text" — never
// silently stores a value that might be fabricated.
export function validatePost<T extends ValidatablePost>(
  post: T,
  sourceText: string,
): T {
  const validated = { ...post, categoryRelaxationRules: { ...post.categoryRelaxationRules } };

  if (
    validated.minAge !== null &&
    (!inRange(validated.minAge, MIN_REALISTIC_AGE, MAX_REALISTIC_AGE) ||
      !isGrounded(validated.minAge, sourceText))
  ) {
    validated.minAge = null;
  }

  if (
    validated.maxAge !== null &&
    (!inRange(validated.maxAge, MIN_REALISTIC_AGE, MAX_REALISTIC_AGE) ||
      !isGrounded(validated.maxAge, sourceText))
  ) {
    validated.maxAge = null;
  }

  if (
    validated.minAge !== null &&
    validated.maxAge !== null &&
    validated.minAge > validated.maxAge
  ) {
    validated.minAge = null;
    validated.maxAge = null;
  }

  if (
    validated.minMarksPercent !== null &&
    (!inRange(validated.minMarksPercent, 0, 100) ||
      !isGrounded(validated.minMarksPercent, sourceText))
  ) {
    validated.minMarksPercent = null;
  }

  for (const category of Object.keys(validated.categoryRelaxationRules)) {
    const years = validated.categoryRelaxationRules[category];
    if (years !== null && !inRange(years, 0, MAX_REALISTIC_RELAXATION)) {
      validated.categoryRelaxationRules[category] = null;
    }
  }

  return validated;
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function isGrounded(value: number, sourceText: string): boolean {
  return sourceText.includes(String(Math.trunc(value)));
}
