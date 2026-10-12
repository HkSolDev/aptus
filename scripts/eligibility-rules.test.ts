import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isEligibilityRules } from '../src/schemas/eligibility-rules.js';

const rules = {
  gender_requirement: null,
  category_requirement: [],
  education_options: [
    {
      minimum_level: 'BACHELORS',
      minimum_marks_percent: null,
      qualification: 'Degree',
      subject_requirement: null,
      conditions: null,
    },
  ],
  age_rules: [
    {
      category: null,
      gender: 'Male',
      min_age: 18,
      max_age: 37,
      relaxation_years: null,
      conditions: null,
    },
  ],
  relaxation_combination_rule: null,
};

await test('accepts conditional rules with nullable fields and empty rule lists', () => {
  assert.equal(isEligibilityRules(rules), true);
  assert.equal(
    isEligibilityRules({ ...rules, age_rules: [], education_options: [] }),
    true,
  );
});

await test('rejects malformed nested fields and invented keys', () => {
  for (const invalid of [
    null,
    'invalid shape',
    [],
    {},
    { ...rules, gender_requirement: true },
    { ...rules, category_requirement: ['SC', 5] },
    { ...rules, age_rules: [{ ...rules.age_rules[0], max_age: '37' }] },
    { ...rules, age_rules: [{ ...rules.age_rules[0], min_age: 18.5 }] },
    { ...rules, age_rules: [null] },
    {
      ...rules,
      education_options: [
        { ...rules.education_options[0], minimum_level: 'UNKNOWN' },
      ],
    },
    {
      ...rules,
      education_options: [
        { ...rules.education_options[0], minimum_marks_percent: '60' },
      ],
    },
    { ...rules, guessed_rule: 'anything' },
    { ...rules, age_rules: [{ ...rules.age_rules[0], guessed_rule: 5 }] },
  ]) {
    assert.equal(isEligibilityRules(invalid), false, JSON.stringify(invalid));
  }
});
