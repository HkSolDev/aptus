import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { chromium, expect } from 'playwright/test';
import { server } from '../src/server.js';
import { prisma } from '../src/db.js';

// HTTP fixtures exercise the frontend contract without writing personal data to PostgreSQL.
const fixture = {
  userId: 'test-user',
  sourcesChecked: ['Fixture source'],
  matches: [
    {
      id: 'match-1',
      postName: 'Fixture assistant <script>alert(1)</script>',
      sourceName: 'Fixture source',
      sourceUrl: 'https://example.org/notice',
      payLevel: '6',
      ageComparison: 'Age 25 (Allowed: 18–35)',
      categoryRelaxationApplied: null,
    },
  ],
  needsManualCheck: [
    {
      id: 'manual-1',
      postName: 'Fixture teacher',
      sourceName: 'Fixture source',
      sourceUrl: 'javascript:alert(1)',
      payLevel: null,
      reason: 'Age limit needs verification.',
      educationRequired: 'A relevant degree',
    },
  ],
};

test('browser flow, response safety, recovery, profile storage and responsive layout', async (t) => {
  // This suite exercises matching; isolate the public catalogue from a live database.
  const originalTransaction = prisma.$transaction;
  Object.defineProperty(prisma, '$transaction', {
    configurable: true,
    value: async () => ({
      data: [],
      pagination: { page: 1, pageSize: 6, totalItems: 0, totalPages: 0 },
    }),
  });
  t.after(() => {
    Object.defineProperty(prisma, '$transaction', {
      configurable: true,
      value: originalTransaction,
    });
  });
  const bundled = chromium.executablePath();
  const localChrome =
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath =
    process.env.APTUS_TEST_BROWSER ??
    (existsSync(bundled)
      ? bundled
      : existsSync(localChrome)
        ? localChrome
        : bundled);
  const browser = await chromium.launch({ executablePath, headless: true });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const address = server.server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await t.test(
      'serves built modules and CSS, blocks private files and handles HEAD',
      async () => {
        for (const [path, mime] of [
          ['/js/app.js', 'text/javascript'],
          ['/css/tokens.css', 'text/css'],
        ]) {
          const response = await page.request.get(origin + path);
          assert.equal(response.status(), 200);
          assert.match(response.headers()['content-type'], new RegExp(mime));
        }
        for (const path of [
          '/.env',
          '/frontend/app.ts',
          '/js/missing.js',
          '/css/../../package.json',
        ]) {
          assert.equal((await page.request.get(origin + path)).status(), 404);
        }
        const head = await page.request.head(origin);
        assert.equal(head.status(), 200);
        assert.equal((await head.body()).length, 0);
      },
    );

    let payload: Record<string, unknown> = {};
    let attempts = 0;
    let mode: 'success' | 'failure' | 'empty' | 'malformed' = 'success';
    await page.route('**/api/match', async (route) => {
      attempts++;
      payload = route.request().postDataJSON();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: mode === 'failure' ? 503 : 200,
        json:
          mode === 'failure'
            ? { error: 'Fixture server error' }
            : mode === 'empty'
              ? { ...fixture, matches: [], needsManualCheck: [] }
              : mode === 'malformed'
                ? { userId: 'test-user', matches: 'invalid' }
                : fixture,
      });
    });

    await t.test(
      'native required fields and duplicate education prevent requests',
      async () => {
        await page.goto(origin);
        await expect(page.locator('#startup-status')).toBeHidden();
        await page.getByRole('button', { name: 'Find my matches' }).click();
        assert.equal(attempts, 0);
        await page
          .getByLabel('Date of birth', { exact: false })
          .fill('2000-01-01');
        await page
          .getByLabel('Qualification Required')
          .selectOption('BACHELORS');
        await page.getByRole('button', { name: '+ Add qualification' }).click();
        await page
          .getByLabel('Qualification Required')
          .last()
          .selectOption('BACHELORS');
        await page.getByRole('button', { name: 'Find my matches' }).click();
        assert.equal(attempts, 0);
        assert.match(
          await page
            .locator('select[name="eduLevel"]')
            .last()
            .evaluate((el) => (el as HTMLSelectElement).validationMessage),
          /already listed/,
        );
        await page
          .getByLabel('Qualification Required')
          .last()
          .selectOption('TENTH');
        await page.getByLabel('Marks (%)').first().fill('72');
      },
    );

    await t.test(
      'sends existing API payload, shows loading and safely renders both result groups',
      async () => {
        await page.getByRole('button', { name: 'Find my matches' }).click();
        await expect(page.locator('#results-loading')).toBeVisible();
        await expect(page.locator('#submit-profile')).toBeDisabled();
        await expect(page.locator('.job-card')).toHaveCount(2);
        assert.equal(payload.dob, '2000-01-01');
        assert.equal(payload.category, null);
        assert.deepEqual(payload.educations, [
          { level: 'BACHELORS', marksPercent: 72 },
          { level: 'TENTH', marksPercent: null },
        ]);
        await expect(page.locator('.job-title').first()).toContainText(
          '<script>alert(1)</script>',
        );
        assert.equal(await page.locator('.job-card script').count(), 0);
        assert.equal(
          await page.locator('#manual-list .source-link').getAttribute('href'),
          null,
        );
        await expect(page.locator('#results-title')).toBeFocused();
        assert.equal(
          await page.evaluate(() =>
            localStorage.getItem('aptus_saved_profile'),
          ),
          null,
        );
      },
    );

    await t.test(
      'explanation failure can retry, successful text can collapse',
      async () => {
        let fail = true;
        await page.route('**/api/explain', (route) => {
          assert.deepEqual(route.request().postDataJSON(), {
            postId: 'match-1',
            userId: 'test-user',
          });
          return route.fulfill({
            status: fail ? 503 : 200,
            json: fail
              ? {}
              : {
                  explanation: 'Fixture saved requirements. Verify the source.',
                },
          });
        });
        await page.locator('#matched-list .explain-button').click();
        await expect(page.locator('#matched-list .explain-button')).toHaveText(
          'Retry explanation',
        );
        fail = false;
        await page.locator('#matched-list .explain-button').click();
        await expect(page.locator('#matched-list .explanation')).toContainText(
          'Fixture saved requirements',
        );
        await page.locator('#matched-list .explain-button').click();
        await expect(page.locator('#matched-list .explanation')).toBeHidden();
      },
    );

    await t.test(
      'error preserves form and marks old results stale; empty and malformed responses are distinct',
      async () => {
        await page.getByLabel('Name Optional').fill('Fixture person');
        await expect(page.locator('#results-stale')).toBeVisible();
        mode = 'failure';
        await page.getByRole('button', { name: 'Find my matches' }).click();
        await expect(page.locator('#form-error')).toBeVisible();
        await expect(page.getByLabel('Name Optional')).toHaveValue(
          'Fixture person',
        );
        await expect(page.locator('.job-card')).toHaveCount(2);
        mode = 'malformed';
        await page.getByRole('button', { name: 'Find my matches' }).click();
        await expect(page.locator('#form-error')).toContainText(
          'unexpected result',
        );
        mode = 'empty';
        await page.getByRole('button', { name: 'Find my matches' }).click();
        await expect(page.locator('#empty-results')).toBeVisible();
      },
    );

    await t.test(
      'opt-in storage restores a profile and clearing it removes only the browser copy',
      async () => {
        await page.getByLabel('Remember this profile').check();
        await page.reload();
        await expect(page.getByLabel('Name Optional')).toHaveValue(
          'Fixture person',
        );
        await expect(page.locator('.education-row')).toHaveCount(2);
        await page.getByRole('button', { name: 'Clear this browser' }).click();
        assert.equal(
          await page.evaluate(() =>
            localStorage.getItem('aptus_saved_profile'),
          ),
          null,
        );
        await expect(page.getByLabel('Name Optional')).toHaveValue(
          'Fixture person',
        );
        await page.evaluate(() =>
          localStorage.setItem(
            'aptus_saved_profile',
            JSON.stringify({
              name: 'Legacy fixture',
              dobDay: '5',
              dobMonth: '3',
              dobYear: '1999',
              category: 'SC',
              educations: [{ level: 'MASTERS', marksPercent: 80 }],
            }),
          ),
        );
        await page.reload();
        await expect(
          page.getByLabel('Date of birth', { exact: false }),
        ).toHaveValue('1999-03-05');
      },
    );

    await t.test(
      'mobile, tablet, desktop, dark mode and reduced motion keep the page usable',
      async () => {
        mode = 'success';
        await page.getByRole('button', { name: 'Find my matches' }).click();
        await expect(page.locator('.job-card')).toHaveCount(2);
        for (const width of [375, 768, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth,
          );
          assert.equal(overflow, false, `No horizontal overflow at ${width}px`);
          await page.screenshot({
            path: `/tmp/aptus-frontend-${width}.png`,
            fullPage: false,
          });
        }
        await page.emulateMedia({
          colorScheme: 'dark',
          reducedMotion: 'reduce',
        });
        assert.equal(
          await page
            .locator('html')
            .evaluate((el) => getComputedStyle(el).scrollBehavior),
          'auto',
        );
        await page.screenshot({
          path: '/tmp/aptus-frontend-dark.png',
          fullPage: false,
        });
        await page.goto(origin);
        await page.keyboard.press('Tab');
        await expect(
          page.getByRole('link', { name: 'Skip to jobs' }),
        ).toBeFocused();
        assert.equal(
          await page
            .locator('.skip-link')
            .evaluate((el) => getComputedStyle(el).outlineStyle),
          'solid',
        );
        assert.deepEqual(errors, []);
      },
    );
  } finally {
    await browser.close();
    await server.close();
  }
});
