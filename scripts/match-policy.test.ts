import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageOn, getPostChecks, getUnverifiedRequirements } from './match.js';
import { explainStoredPost } from '../src/routes/explain.js';

const candidate = {
  dob: new Date('2000-06-15T00:00:00Z'),
  category: 'OBC',
  educations: [{ level: 'BACHELORS' as const, marksPercent: 70 }],
};
const post = {
  postName: 'Illustrative officer',
  educationRequired: 'Bachelor degree',
  payLevel: null,
  minAge: 18,
  maxAge: 30,
  ageAsOnDate: new Date('2030-06-15T00:00:00Z'),
  minEducationLevel: 'BACHELORS' as const,
  minMarksPercent: 60,
  categoryRelaxationApplies: false,
  categoryRelaxationRules: { OBC: 3 },
  eligibilityRules: null,
  reviewedDetails: null,
};
const rules = {
  gender_requirement: null,
  category_requirement: [],
  education_options: [],
  age_rules: [],
  relaxation_combination_rule: null,
};

test('notice reference date drives inclusive birthday and age boundaries', () => {
  for (const [date, age, passes] of [
    ['2018-06-14', 17, false],
    ['2018-06-15', 18, true],
    ['2030-06-15', 30, true],
    ['2031-06-15', 31, false],
  ] as const) {
    const checks = getPostChecks(
      { ...post, ageAsOnDate: new Date(date) },
      candidate,
    );
    assert.equal(checks.userAge, age);
    assert.equal(checks.ageOk, passes);
  }
});

test('leap-day arithmetic retains March 1 birthday in non-leap years', () => {
  const dob = new Date('2004-02-29T00:00:00Z');
  assert.equal(ageOn(dob, new Date('2023-02-28T00:00:00Z')), 18);
  assert.equal(ageOn(dob, new Date('2023-03-01T00:00:00Z')), 19);
  assert.equal(ageOn(dob, new Date('2024-02-29T00:00:00Z')), 20);
});

test('missing/invalid reference dates remain manual without erasing other checks', () => {
  for (const ageAsOnDate of [null, new Date('invalid')]) {
    const checks = getPostChecks({ ...post, ageAsOnDate }, candidate);
    assert.equal(checks.userAge, null);
    assert.equal(checks.ageOk, true);
    assert.match(checks.unverifiedRequirements.join('; '), /age.*reference/i);
    assert.equal(
      getPostChecks(
        { ...post, ageAsOnDate },
        {
          ...candidate,
          educations: [{ level: 'TENTH', marksPercent: 20 }],
        },
      ).educationOk,
      false,
    );
    assert.equal(
      getPostChecks(
        { ...post, ageAsOnDate },
        {
          ...candidate,
          educations: [{ level: 'BACHELORS', marksPercent: 20 }],
        },
      ).marksOk,
      false,
    );
  }
});

test('false ignores extra years; true uses only the candidate category', () => {
  const older = { ...candidate, dob: new Date('1998-06-15') };
  const no = getPostChecks(post, older);
  assert.equal(no.effectiveMaxAge, 30);
  assert.equal(no.relaxation, 0);
  assert.equal(no.ageOk, false);
  const yes = getPostChecks(
    { ...post, categoryRelaxationApplies: true },
    older,
  );
  assert.equal(yes.effectiveMaxAge, 33);
  assert.equal(yes.ageOk, true);
  const sc = getPostChecks(
    {
      ...post,
      categoryRelaxationApplies: true,
      categoryRelaxationRules: { OBC: 3, SC: 5 },
    },
    { ...older, category: 'SC' },
  );
  assert.equal(sc.effectiveMaxAge, 35);
  assert.equal(
    getPostChecks(
      {
        ...post,
        categoryRelaxationApplies: true,
        categoryRelaxationRules: { OBC: 0 },
      },
      older,
    ).ageOk,
    false,
  );
});

test('null flag and incomplete/invalid applicable relaxation stay manual', () => {
  const older = { ...candidate, dob: new Date('1998-06-15') };
  for (const uncertain of [
    { categoryRelaxationApplies: null, categoryRelaxationRules: { OBC: 3 } },
    { categoryRelaxationApplies: true, categoryRelaxationRules: null },
    { categoryRelaxationApplies: true, categoryRelaxationRules: { SC: 5 } },
    { categoryRelaxationApplies: true, categoryRelaxationRules: { OBC: null } },
    { categoryRelaxationApplies: true, categoryRelaxationRules: { OBC: -3 } },
  ]) {
    const checks = getPostChecks({ ...post, ...uncertain }, older);
    assert.equal(checks.ageOk, true);
    assert.equal(checks.relaxation, 0);
    assert.match(checks.unverifiedRequirements.join('; '), /relaxation/i);
    assert.equal(
      getPostChecks({ ...post, ...uncertain, minAge: 40 }, older).ageOk,
      false,
    );
  }
});

test('conflicting or conditional age rules do not become assumed allowances', () => {
  const ageRule = {
    category: 'OBC',
    gender: null,
    min_age: null,
    max_age: null,
    relaxation_years: 5,
    conditions: null,
  };
  for (const age_rules of [
    [ageRule],
    [{ ...ageRule, conditions: 'special service' }],
  ]) {
    const checks = getPostChecks(
      {
        ...post,
        categoryRelaxationApplies: true,
        eligibilityRules: { ...rules, age_rules },
      },
      {
        ...candidate,
        dob: new Date('1996-06-15'),
      },
    );
    assert.equal(checks.ageOk, true);
    assert.equal(checks.relaxation, 0);
    assert.match(checks.unverifiedRequirements.join('; '), /age|relaxation/i);
  }
});

test('gender, nationality and unsupported category/combination conditions remain manual', () => {
  const reasons = getUnverifiedRequirements({
    eligibilityRules: {
      ...rules,
      gender_requirement: 'Male',
      category_requirement: ['SC'],
      relaxation_combination_rule: 'not cumulative',
    },
    reviewedDetails: { nationality_requirement: 'Indian citizens' },
  }).join('; ');
  assert.match(reasons, /gender.*Male/i);
  assert.match(reasons, /nationality.*Indian citizens/i);
  assert.match(reasons, /category.*SC/i);
  assert.match(reasons, /relaxation.*not cumulative/i);
});

test('conditional maximum relaxation cannot erase a known minimum-age failure', () => {
  const checks = getPostChecks(
    {
      ...post,
      categoryRelaxationApplies: true,
      eligibilityRules: {
        ...rules,
        age_rules: [
          {
            category: 'OBC',
            gender: null,
            min_age: null,
            max_age: null,
            relaxation_years: 5,
            conditions: 'special service',
          },
        ],
      },
    },
    { ...candidate, dob: new Date('2013-06-15') },
  );
  assert.equal(checks.ageOk, false);
  assert.ok(checks.unverifiedRequirements.length > 0);
});

test('a known other-category exception cannot erase this candidate maximum-age failure', () => {
  const checks = getPostChecks(
    {
      ...post,
      eligibilityRules: {
        ...rules,
        age_rules: [
          {
            category: 'SC',
            gender: null,
            min_age: null,
            max_age: 40,
            relaxation_years: 10,
            conditions: null,
          },
        ],
      },
    },
    { ...candidate, dob: new Date('1990-06-15') },
  );
  assert.equal(checks.ageOk, false);
  assert.equal(checks.effectiveMaxAge, 30);
});

test('combination uncertainty cannot add an allowance when relaxation is explicitly disabled', () => {
  const checks = getPostChecks(
    {
      ...post,
      eligibilityRules: {
        ...rules,
        relaxation_combination_rule: 'not cumulative',
      },
    },
    { ...candidate, dob: new Date('1998-06-15') },
  );
  assert.equal(checks.effectiveMaxAge, 30);
  assert.equal(checks.relaxation, 0);
  assert.equal(checks.ageOk, false);
});

test('explanation uses notice age and exposes uncertainty instead of passing it', () => {
  assert.match(explainStoredPost(post, candidate), /Candidate age: 30/);
  const unknown = explainStoredPost({ ...post, ageAsOnDate: null }, candidate);
  assert.match(unknown, /Age check: needs manual verification/);
  assert.doesNotMatch(unknown, /Candidate age: \d/);
  assert.match(
    explainStoredPost(
      {
        ...post,
        reviewedDetails: { nationality_requirement: 'Indian citizens' },
      },
      candidate,
    ),
    /nationality/i,
  );
});
