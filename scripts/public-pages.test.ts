import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from 'cheerio';
import { prisma } from '../src/db.js';
import { server } from '../src/server.js';

const job = {
  id: 'job-test',
  postName: 'Assistant <script>alert(1)</script>',
  postGroup: null,
  payLevel: null,
  vacancies: 23,
  applicationLastDate: new Date('2026-11-04T00:00:00Z'),
  ageAsOnDate: null,
  minAge: null,
  maxAge: null,
  educationRequired: 'Graduate with typing speed of 40 words per minute.',
  minEducationLevel: 'BACHELORS',
  minMarksPercent: null,
  source: {
    name: 'Fixture source',
    url: 'https://example.org/notice',
    notificationPdfUrl: 'javascript:alert(1)',
    officialSiteUrl: null,
    applyUrl: 'https://example.org/apply',
    fetchedAt: new Date('2026-10-02'),
  },
  eligibilityRules: {
    gender_requirement: null,
    category_requirement: ['SC'],
    relaxation_combination_rule: 'Do not combine relaxations.',
    education_options: [
      {
        minimum_level: 'BACHELORS',
        minimum_marks_percent: 60,
        qualification: 'Graduate',
        subject_requirement: 'Library science',
        conditions: null,
      },
    ],
    age_rules: [
      {
        gender: 'female',
        category: 'SC',
        min_age: 18,
        max_age: 37,
        relaxation_years: 5,
        conditions: 'Verify the reference date.',
      },
    ],
  },
  categoryRelaxationApplies: null,
  categoryRelaxationRules: null,
};

await test('anonymous public HTML pages', async (t) => {
  const originalTransaction: unknown = Reflect.get(prisma, '$transaction');
  const originalFind: unknown = Reflect.get(prisma.post, 'findUnique');
  let mode: 'success' | 'empty' | 'failure' = 'success';
  let missing = false;
  Object.defineProperty(prisma, '$transaction', {
    configurable: true,
    value: () => {
      if (mode === 'failure')
        return Promise.reject(new Error('private database credentials'));
      return Promise.resolve({
        data: mode === 'empty' ? [] : [job],
        pagination: {
          page: 1,
          pageSize: 6,
          totalItems: mode === 'empty' ? 0 : 7,
          totalPages: mode === 'empty' ? 0 : 2,
        },
      });
    },
  });
  Object.defineProperty(prisma.post, 'findUnique', {
    configurable: true,
    value: () => {
      if (mode === 'failure')
        return Promise.reject(new Error('private database credentials'));
      return Promise.resolve(missing ? null : job);
    },
  });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const address = server.server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    Object.defineProperty(prisma, '$transaction', {
      configurable: true,
      value: originalTransaction,
    });
    Object.defineProperty(prisma.post, 'findUnique', {
      configurable: true,
      value: originalFind,
    });
    await server.close();
  });

  await t.test(
    'homepage includes public job cards and real pagination links in initial HTML',
    async () => {
      const response = await fetch(origin);
      assert.equal(response.status, 200);
      const $ = load(await response.text());
      assert.equal($('#jobs .job-title').text(), job.postName);
      assert.equal($('#jobs .job-title a').attr('href'), '/jobs/job-test');
      assert.equal($('#jobs script').length, 0);
      assert.equal($('#jobs a[rel="next"]').attr('href'), '/?page=2#jobs');
      assert($('#jobs').text().includes('No login or profile needed'));
      assert($('#match-form').length > 0);
    },
  );

  await t.test(
    'job page shows stored facts and safe document links without JavaScript',
    async () => {
      const response = await fetch(`${origin}/jobs/job-test`);
      assert.equal(response.status, 200);
      const $ = load(await response.text());
      assert.equal($('h1').text(), job.postName);
      assert.equal($('script').length, 0);
      assert($('main').text().includes(job.educationRequired));
      assert($('main').text().includes('4 Nov 2026'));
      assert($('main').text().includes('Not specified'));
      assert($('main').text().includes('Library science'));
      assert($('main').text().includes('female'));
      assert($('main').text().includes('Do not combine relaxations.'));
      assert.equal($('a[href^="javascript:"]').length, 0);
      assert.equal($('a[href="https://example.org/apply"]').length, 1);
    },
  );

  await t.test(
    'empty catalogue and database failures offer recovery without fake data',
    async () => {
      mode = 'empty';
      assert(
        (await (await fetch(origin)).text()).includes('No jobs saved yet'),
      );
      mode = 'failure';
      const home = await (await fetch(origin)).text();
      assert(home.includes('Jobs are temporarily unavailable'));
      assert(!home.includes('private database credentials'));
      assert.equal((await fetch(`${origin}/jobs/job-test`)).status, 503);
      mode = 'success';
    },
  );

  await t.test(
    'missing jobs return an HTML 404 with a route back to browsing',
    async () => {
      missing = true;
      const response = await fetch(`${origin}/jobs/job-missing`);
      assert.equal(response.status, 404);
      const $ = load(await response.text());
      assert($('main').text().includes('Job not found'));
      assert($('a[href="/#jobs"]').length > 0);
    },
  );
});
