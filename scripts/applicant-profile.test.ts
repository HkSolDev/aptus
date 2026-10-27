import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateProfilePayload,
  serializeProfile,
} from '../src/lib/applicant-profile.js';
const profile = {
  dob: '2000-02-29',
  category: null,
  educations: [{ level: 'BACHELORS', marksPercent: 75 }],
};
test('profile save rejects invalid dates, qualifications, marks and client ownership fields', () => {
  const invalid: Array<[string, unknown]> = [
    ['null', null],
    ['array', []],
    ['missing DOB', { educations: profile.educations }],
    ['invalid DOB', { ...profile, dob: 'invalid-date' }],
    ['non-leap day', { ...profile, dob: '1900-02-29' }],
    ['nonexistent day', { ...profile, dob: '2000-02-30' }],
    ['future date', { ...profile, dob: '9999-01-01' }],
    ['empty education', { ...profile, educations: [] }],
    ['invalid level', { ...profile, educations: [{ level: 'INVALID_LEVEL' }] }],
    [
      'duplicate education',
      {
        ...profile,
        educations: [...profile.educations, ...profile.educations],
      },
    ],
    [
      'string marks',
      { ...profile, educations: [{ level: 'BACHELORS', marksPercent: '75' }] },
    ],
    [
      'negative marks',
      { ...profile, educations: [{ level: 'BACHELORS', marksPercent: -1 }] },
    ],
    [
      'marks over 100',
      { ...profile, educations: [{ level: 'BACHELORS', marksPercent: 101 }] },
    ],
    [
      'nonfinite marks',
      {
        ...profile,
        educations: [{ level: 'BACHELORS', marksPercent: Infinity }],
      },
    ],
    ['unknown category', { ...profile, category: 'unknown' }],
    ['submitted owner', { ...profile, authUserId: 'someone-else' }],
    ['submitted profile', { ...profile, userId: 'someone-else' }],
    ['submitted name', { ...profile, name: 'someone-else' }],
    [
      'unknown education field',
      {
        ...profile,
        educations: [{ level: 'BACHELORS', userId: 'someone-else' }],
      },
    ],
  ];
  for (const [name, input] of invalid)
    assert.equal(validateProfilePayload(input).ok, false, name);
});
test('saved profile round-trips leap dates and unknown category without exposing internal IDs', () => {
  const valid = validateProfilePayload(profile);
  assert(valid.ok);
  const user = {
    dob: valid.data.dobDate,
    category: 'UNSPECIFIED',
    educations: valid.data.educations,
    id: 'internal-id',
    authUserId: 'private-account',
  };
  assert.deepEqual(serializeProfile(user), profile);
});
