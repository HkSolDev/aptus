import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobMetadata, jobShareUrl } from '../components/jobs/job-sharing';

test('public previews use individual facts and an absolute shared image', () => {
  const first = jobMetadata(
    {
      id: 'one',
      postName: 'Research Associate',
      organization: 'Example Institute',
      vacancies: 1,
      applicationLastDate: '2026-11-05',
    },
    'https://jobs.example',
  );
  const second = jobMetadata(
    { id: 'two', postName: 'Typist' },
    'https://jobs.example',
  );
  assert.equal(first.title, 'Research Associate — Example Institute');
  assert.match(first.description!, /1 vacancy/);
  assert.match(first.description!, /2026-11-05/);
  assert.equal(first.alternates?.canonical, 'https://jobs.example/jobs/one');
  assert.notEqual(first.title, second.title);
  assert.doesNotMatch(second.description!, /null|undefined|deadline|vacancies/);
  assert.match(
    JSON.stringify(first.openGraph),
    /https:\/\/jobs.example\/share-image/,
  );
  assert.equal(
    jobShareUrl('one', 'https://jobs.example/path?private=value'),
    'https://jobs.example/jobs/one',
  );
});

test('missing origin does not invent public URLs; invalid configured origin fails', () => {
  assert.equal(
    jobMetadata({ id: 'one', postName: 'Typist' }).openGraph,
    undefined,
  );
  assert.throws(() =>
    jobMetadata(
      { id: 'one', postName: 'Typist' },
      'https://jobs.example/private',
    ),
  );
});
