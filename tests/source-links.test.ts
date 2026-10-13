import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSourceLinks } from '../app/jobs/[id]/source-links';

await test('job source links include distinct public destinations only', () => {
  assert.deepEqual(
    getSourceLinks({
      url: 'https://jobs.example.org/listing',
      notificationPdfUrl: 'https://jobs.example.org/notice.pdf',
      officialSiteUrl: 'javascript:alert(1)',
      applyUrl: 'https://jobs.example.org/listing',
    }),
    [
      { label: 'View source page', url: 'https://jobs.example.org/listing' },
      {
        label: 'Official notification',
        url: 'https://jobs.example.org/notice.pdf',
      },
    ],
  );
});
