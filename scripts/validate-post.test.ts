import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validatePost } from './validate-post.js';

function post(overrides: Partial<Parameters<typeof validatePost>[0]> = {}) {
  return {
    minAge: 18,
    maxAge: 27,
    minMarksPercent: 60,
    categoryRelaxationRules: { SC: 5, ST: 5, OBC: 3, EWS: null, PwBD: 10 },
    ...overrides,
  };
}

describe('validatePost', () => {
  test('keeps values that are in range and present in the source text', () => {
    const result = validatePost(post(), 'Age limit 18 to 27 years, min 60% marks. SC relaxation 5 years.');
    assert.strictEqual(result.minAge, 18);
    assert.strictEqual(result.maxAge, 27);
    assert.strictEqual(result.minMarksPercent, 60);
    assert.strictEqual(result.categoryRelaxationRules.SC, 5);
  });

  test('nulls a value never mentioned in the source text', () => {
    const result = validatePost(post({ minMarksPercent: 60 }), 'No marks requirement mentioned anywhere.');
    assert.strictEqual(result.minMarksPercent, null);
  });

  test('nulls an out-of-range percentage even if the digits appear in the text', () => {
    const result = validatePost(post({ minMarksPercent: 500 }), 'Some unrelated number 500 appears here.');
    assert.strictEqual(result.minMarksPercent, null);
  });

  test('nulls both ages when minAge is greater than maxAge', () => {
    const result = validatePost(
      post({ minAge: 30, maxAge: 25 }),
      'Age limit 30 to 25 years.',
    );
    assert.strictEqual(result.minAge, null);
    assert.strictEqual(result.maxAge, null);
  });

  test('nulls an out-of-range relaxation value without touching others', () => {
    const result = validatePost(
      post({ categoryRelaxationRules: { SC: 5, ST: 99, OBC: null, EWS: null, PwBD: null } }),
      'SC relaxation 5 years, ST relaxation 99 years.',
    );
    assert.strictEqual(result.categoryRelaxationRules.SC, 5);
    assert.strictEqual(result.categoryRelaxationRules.ST, null);
  });

  test('leaves already-null fields untouched', () => {
    const result = validatePost(
      post({ minAge: null, maxAge: null, minMarksPercent: null }),
      '',
    );
    assert.strictEqual(result.minAge, null);
    assert.strictEqual(result.maxAge, null);
    assert.strictEqual(result.minMarksPercent, null);
  });
});
