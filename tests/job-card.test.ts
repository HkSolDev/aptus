import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { tsImport } from 'tsx/esm/api';
import type { PublicJobItem } from '../components/jobs/job-card';

const { JobCard }: typeof import('../components/jobs/job-card') =
  await tsImport('../components/jobs/job-card.tsx', {
    parentURL: import.meta.url,
    tsconfig: 'tsconfig.next.json',
  });

const job: PublicJobItem = {
  id: 'example-job',
  postName: 'Technical Assistant',
  vacancies: 0,
  applicationLastDate: '2026-11-30',
  educationRequired: 'Diploma in Electronics',
  source: { name: 'Example aggregator' },
};

test('public card shows recorded facts without presenting the scraper as employer', () => {
  const html = renderToStaticMarkup(createElement(JobCard, { job }));
  assert.match(html, /Technical Assistant/);
  assert.match(html, /30 Nov 2026/);
  assert.match(html, /Diploma in Electronics/);
  assert.match(html, /0 vacancies/);
  assert.doesNotMatch(html, /Example aggregator/);
  assert.match(html, /href="\/jobs\/example-job"/);
});

test('missing optional facts leave no placeholder rows or unsupported open status', () => {
  const html = renderToStaticMarkup(
    createElement(JobCard, {
      job: {
        ...job,
        applicationLastDate: null,
        vacancies: null,
        educationRequired: 'Not specified',
      },
    }),
  );
  assert.doesNotMatch(
    html,
    /Not specified|Apply by|Qualification|vacancies|Open/,
  );
  assert.match(html, /View details/);
});

test('pay level stays as recorded and untrusted title text stays escaped', () => {
  const html = renderToStaticMarkup(
    createElement(JobCard, {
      job: {
        ...job,
        postName: '<script>alert(1)</script>',
        applicationLastDate: 'invalid',
        payLevel: 'Level 8',
      },
    }),
  );
  assert.match(html, /Pay: Level 8/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|Apply by|₹/);
});
