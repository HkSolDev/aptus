import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect } from 'playwright/test';
import { createDesignReviewApi } from '../scripts/design-review-api';

test('review-only recommendation, saved, and profile pages fit mobile, tablet and desktop', async (t) => {
  const api = createDesignReviewApi();
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  t.after(() => api.close());
  const address = api.address();
  assert(address && typeof address !== 'string');
  const next = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--webpack',
      '-H',
      '127.0.0.1',
      '-p',
      '18882',
    ],
    {
      env: {
        ...process.env,
        APTUS_LOCAL_REVIEW: '1',
        BACKEND_INTERNAL_URL: `http://127.0.0.1:${address.port}`,
      },
      stdio: 'ignore',
    },
  );
  t.after(() => next.kill());

  const origin = 'http://127.0.0.1:18882';
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (
        await fetch(`${origin}/results`, { signal: AbortSignal.timeout(1000) })
      ).ok;
      if (ready) break;
    } catch {
      // Wait for the local review server to start.
    }
    await setTimeout(100);
  }
  assert(ready, 'Next.js review server must start');

  const bundled = chromium.executablePath();
  const browser = await chromium.launch({
    executablePath:
      process.env.APTUS_TEST_BROWSER ??
      (existsSync(bundled)
        ? bundled
        : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/api/auth/**', (route) =>
    route.fulfill({ json: { user: null, enabled: false } }),
  );

  for (const width of [390, 834, 1440]) {
    await page.setViewportSize({ width, height: 900 });

    await page.goto(`${origin}/results`);
    await expect(
      page.getByRole('heading', { name: 'Recommended for you' }),
    ).toBeVisible();
    await expect(
      page.getByRole('searchbox', { name: 'Search recommended jobs' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Hidden jobs (0)' }),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const layout = page.locator('[aria-label="Recommendation layout"]');
    if (width < 641) {
      await expect(layout).toBeHidden();
    } else {
      await expect(layout).toBeVisible();
    }

    const cards = page.locator('[data-job-card]');
    await expect(cards).toHaveCount(3);
    const search = page.getByRole('searchbox', {
      name: 'Search recommended jobs',
    });
    await search.focus();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('combobox', { name: 'Qualification', exact: true }),
    ).toBeFocused();
    await search.fill('Technical');
    await expect(cards).toHaveCount(1);
    await cards
      .first()
      .getByRole('link', { name: 'View details', exact: true })
      .click();
    await expect(page.locator('.job-detail h1')).toContainText(
      'Technical Assistant',
    );
    await page.goBack();
    await expect(search).toHaveValue('Technical');
    await search.fill('');
    await page
      .getByRole('combobox', { name: 'Sort recommendations' })
      .selectOption('furthest');
    await expect(cards.first()).toContainText('Assistant Engineer');
    await page
      .getByRole('combobox', { name: 'Sort recommendations' })
      .selectOption('soonest');
    await expect(cards.first()).toContainText('Technical Assistant');
    await cards
      .first()
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    await page
      .getByRole('link', {
        name: width < 760 ? 'Saved' : 'Saved jobs',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('searchbox', { name: 'Search saved jobs' }),
    ).toBeVisible();
    await expect(cards).toHaveCount(1);
    await page
      .getByRole('searchbox', { name: 'Search saved jobs' })
      .fill('no-such-example');
    await expect(
      page.getByRole('heading', { name: 'No saved jobs match this search' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Clear search and filter' }).click();
    await expect(cards).toHaveCount(1);
    await page.getByRole('button', { name: 'Remove from saved' }).click();
    await expect(
      page.getByRole('heading', { name: 'Your shortlist starts here' }),
    ).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveCount(0);

    await page.getByRole('link', { name: 'Explore jobs' }).click();
    await page.getByRole('link', { name: /See all recommendations/ }).click();
    await cards.first().getByRole('button', { name: 'Not interested' }).click();
    await expect(cards).toHaveCount(2);
    await page.getByRole('button', { name: 'Hidden jobs (1)' }).click();
    await expect(cards).toHaveCount(1);
    await cards
      .first()
      .getByRole('button', { name: 'Restore', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'No hidden jobs' }),
    ).toBeVisible();

    await page.goto(`${origin}/saved`);
    await expect(
      page.getByRole('heading', { name: 'Your shortlist starts here' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Explore jobs' }),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );

    await page.goto(`${origin}/profile`);
    await expect(
      page.getByRole('heading', { name: 'Your profile' }),
    ).toBeVisible();
    await expect(
      page.getByLabel('Date of birth', { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Category')).toBeVisible();
    await expect(page.getByLabel(/^Name/)).toHaveCount(0);
    await expect(page.getByLabel(/Marks/)).toHaveCount(0);
    await page
      .getByLabel('Qualification', { exact: true })
      .selectOption('Graduation');
    await page.getByLabel('Degree', { exact: true }).fill('b.tech');
    await page.getByLabel('Degree', { exact: true }).press('Tab');
    await expect(page.getByLabel('Degree', { exact: true })).toHaveValue(
      'BTech',
    );
    await page
      .getByLabel('Branch or subject', { exact: true })
      .fill('Civil Engineering');
    await page
      .getByRole('button', { name: 'Add qualification', exact: true })
      .click();
    await expect(
      page.getByText('BTech · Civil Engineering', { exact: true }),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
});
