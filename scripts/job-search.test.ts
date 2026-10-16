import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readJobFilters,
  jobSearchParams,
} from '../frontend/public-job-filters.js';

await test('public filters normalize text and preserve filter/sort across pages', () => {
  const filters = readJobFilters(
    new URLSearchParams('q=+Mechanical+&qualification=DIPLOMA&sort=furthest'),
  );
  assert.deepEqual(filters, {
    q: 'Mechanical',
    qualification: 'DIPLOMA',
    sort: 'furthest',
  });
  assert(filters);
  const params = jobSearchParams(filters, 2);
  assert.equal(params.get('q'), 'Mechanical');
  assert.equal(params.get('qualification'), 'DIPLOMA');
  assert.equal(params.get('sort'), 'furthest');
  assert.equal(params.get('page'), '2');
});

await test('public filters reject duplicates, long/control text and unknown options', () => {
  for (const raw of [
    'q=a&q=b',
    'sort=soonest&sort=furthest',
    'qualification=DIPLOMA&qualification=PHD',
    'qualification=ITI',
    'sort=salary',
    'q=%00',
    `q=${'x'.repeat(101)}`,
  ]) {
    assert.equal(readJobFilters(new URLSearchParams(raw)), null, raw);
  }
  assert.deepEqual(readJobFilters(new URLSearchParams()), {
    q: '',
    qualification: '',
    sort: 'soonest',
  });
});
