import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeSearchParams, readHomeView } from '../frontend/home-view.js';

void test('Home view validates layout and keeps fictional profile states out of production', () => {
  const params = new URLSearchParams(
    'layout=cards&recSort=furthest&reviewProfile=ready',
  );
  assert.equal(readHomeView(params)?.reviewProfile, undefined);
  const review = readHomeView(params, true);
  assert.equal(review?.reviewProfile, 'ready');
  assert.equal(readHomeView(new URLSearchParams('layout=unknown')), null);
  assert.equal(
    readHomeView(new URLSearchParams('layout=rows&layout=cards')),
    null,
  );
  assert.equal(
    readHomeView(new URLSearchParams('reviewProfile=admin'), true),
    null,
  );
  assert(review);
  const retained = homeSearchParams(
    { q: 'Mechanical', qualification: 'DIPLOMA', sort: 'furthest' },
    2,
    review,
  );
  assert.equal(retained.get('q'), 'Mechanical');
  assert.equal(retained.get('page'), '2');
  assert.equal(retained.get('layout'), 'cards');
  assert.equal(retained.get('reviewProfile'), 'ready');
  assert.equal(retained.get('recSort'), 'furthest');
});
