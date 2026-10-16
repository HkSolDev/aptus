import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect } from 'playwright/test';

test('review-only recommendation, saved, and profile pages fit mobile, tablet and desktop', async (t) => {
  const next = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', '-p', '18882'],
    {
      env: {
        ...process.env,
        APTUS_LOCAL_REVIEW: '1',
      },
      stdio: 'ignore',
    },
  );
  t.after(() => next.kill());

  const origin = 'http://127.0.0.1:18882';
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
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
      page.getByRole('heading', { name: 'Find jobs for you' }),
    ).toBeVisible();
    await expect(page.getByLabel('Date of birth Required')).toBeVisible();
    await expect(page.getByLabel('Category')).toBeVisible();
    await expect(page.getByLabel(/^Name/)).toHaveCount(0);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
});
