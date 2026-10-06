import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { chromium, expect } from 'playwright/test';
import { prisma } from '../src/db.js';
import { server } from '../src/server.js';

test('public browsing, pagination, job navigation and no-JavaScript access', async () => {
  const jobs = Array.from({ length: 7 }, (_, index) => ({
    id: `job-${index}`,
    postName: `Public job ${index + 1}`,
    vacancies: index,
    applicationLastDate: null,
    ageAsOnDate: null,
    minAge: null,
    maxAge: null,
    payLevel: null,
    postGroup: null,
    educationRequired: 'Bachelor’s degree',
    minEducationLevel: 'BACHELORS',
    minMarksPercent: null,
    eligibilityRules: null,
    categoryRelaxationApplies: null,
    source: {
      name: 'Fixture notification',
      url: 'https://example.org/notice',
      notificationPdfUrl: null,
      officialSiteUrl: null,
      applyUrl: null,
      fetchedAt: new Date('2026-10-02'),
    },
  }));
  const originalTransaction = prisma.$transaction;
  const originalFind = prisma.post.findUnique;
  type Query = (db: {
    post: {
      count: () => Promise<number>;
      findMany: (args: { skip: number; take: number }) => Promise<unknown[]>;
    };
  }) => Promise<unknown>;
  Object.defineProperty(prisma, '$transaction', {
    configurable: true,
    value: async (run: Query) =>
      run({
        post: {
          count: async () => jobs.length,
          findMany: async ({ skip, take }) => jobs.slice(skip, skip + take),
        },
      }),
  });
  Object.defineProperty(prisma.post, 'findUnique', {
    configurable: true,
    value: async ({ where }: { where: { id: string } }) =>
      jobs.find((job) => job.id === where.id) ?? null,
  });
  const bundled = chromium.executablePath();
  const browser = await chromium.launch({
    executablePath:
      process.env.APTUS_TEST_BROWSER ??
      (existsSync(bundled)
        ? bundled
        : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    headless: true,
  });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const address = server.server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    await expect(page.locator('#jobs .job-card')).toHaveCount(6);
    await expect(page.locator('#jobs')).toContainText(
      'No login or profile needed',
    );
    await page.getByRole('link', { name: 'Next page' }).click();
    await expect(page).toHaveURL(`${origin}/?page=2#jobs`);
    await expect(page.locator('#jobs .job-card')).toHaveCount(1);
    await page.getByRole('link', { name: 'View job details' }).click();
    await expect(page).toHaveURL(`${origin}/jobs/job-6`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Public job 7',
    );
    await expect(page.locator('main')).toContainText('Bachelor’s degree');
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
    await page.getByRole('link', { name: 'Back to all jobs' }).click();
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.keyboard.press('Tab');
    assert.deepEqual(errors, []);
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const plain = await noJs.newPage();
    await plain.goto(origin);
    await expect(plain.locator('#jobs .job-card')).toHaveCount(6);
    await plain.getByRole('link', { name: 'View job details' }).first().click();
    await expect(plain.getByRole('heading', { level: 1 })).toHaveText(
      'Public job 1',
    );
    await noJs.close();
  } finally {
    await browser.close();
    await server.close();
    Object.defineProperty(prisma, '$transaction', {
      configurable: true,
      value: originalTransaction,
    });
    Object.defineProperty(prisma.post, 'findUnique', {
      configurable: true,
      value: originalFind,
    });
  }
});
