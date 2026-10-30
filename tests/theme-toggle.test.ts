import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect } from 'playwright/test';

test('theme toggle follows device, overrides it, and persists', async (t) => {
  const job = {
    id: 'theme-fixture',
    postName: 'Example Technical Assistant',
    educationRequired: 'Diploma',
    applicationLastDate: null,
    vacancies: 10,
    payLevel: 'Level 6',
    source: { name: 'Example source' },
  };
  const api = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/auth/get-session') {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: 'Please sign in again.' }));
      return;
    }
    response.end(
      JSON.stringify(
        request.url?.startsWith('/api/jobs?')
          ? {
              data: [job],
              pagination: {
                page: 1,
                pageSize: 6,
                totalItems: 1,
                totalPages: 1,
              },
            }
          : job,
      ),
    );
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  t.after(() => new Promise<void>((resolve) => api.close(() => resolve())));
  const address = api.address();
  assert(address && typeof address !== 'string');

  const next = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', '18881'],
    {
      env: {
        ...process.env,
        BACKEND_INTERNAL_URL: `http://127.0.0.1:${address.port}`,
      },
      stdio: 'ignore',
    },
  );
  t.after(() => {
    next.kill();
  });
  const origin = 'http://127.0.0.1:18881';
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
      if (ready) break;
    } catch {
      /* Wait for the test server to listen. */
    }
    await setTimeout(100);
  }
  assert(ready, 'Built Next.js test server must start');

  const browser = await chromium
    .launch()
    .catch(() => chromium.launch({ channel: 'chrome' }));
  t.after(() => browser.close());

  async function bodyBackground(page: import('playwright/test').Page) {
    return page
      .locator('body')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  }

  // 1-2: first visit follows device preference in both directions.
  for (const colorScheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ colorScheme });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => {
      if (
        msg.type() === 'error' &&
        /hydration|content security policy/i.test(msg.text())
      )
        errors.push(msg.text());
    });
    await page.goto(origin);
    const toggle = page.getByRole('button', {
      name:
        colorScheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
    });
    await expect(toggle).toBeVisible();
    assert.equal(
      await bodyBackground(page),
      colorScheme === 'dark' ? 'rgb(22, 22, 24)' : 'rgb(245, 245, 247)',
      `first visit must follow ${colorScheme} device preference`,
    );
    assert.deepEqual(errors, [], 'no console or hydration errors');
    await context.close();
  }

  // 3-5 + 8: manual dark overrides light device, survives reload/navigation.
  {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(
      page.getByRole('button', { name: 'Switch to light mode' }),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'),
      ),
      'dark',
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem('aptus-theme')),
      'dark',
    );
    assert.equal(await bodyBackground(page), 'rgb(22, 22, 24)');
    await page.reload();
    assert.equal(await bodyBackground(page), 'rgb(22, 22, 24)');
    await page.getByRole('link', { name: 'Saved jobs' }).first().click();
    assert.equal(await bodyBackground(page), 'rgb(22, 22, 24)');
    await expect(
      page.getByRole('link', { name: /sign in/i }).first(),
    ).toBeVisible();
    // Manual light overrides (still light device here); dark-device case below.
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    assert.equal(await bodyBackground(page), 'rgb(245, 245, 247)');
    await context.close();
  }

  // 3 (reverse): manual light overrides a dark device preference.
  {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto(origin);
    assert.equal(await bodyBackground(page), 'rgb(22, 22, 24)');
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    assert.equal(await bodyBackground(page), 'rgb(245, 245, 247)');
    await page.reload();
    assert.equal(await bodyBackground(page), 'rgb(245, 245, 247)');
    await context.close();
  }

  // 6: keyboard operation and visible focus.
  {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();
    await page.goto(origin);
    const toggle = page.getByRole('button', { name: 'Switch to dark mode' });
    await toggle.focus();
    const outline = await toggle.evaluate(
      (el) => getComputedStyle(el).outlineStyle,
    );
    assert.notEqual(outline, 'none', 'toggle must show a focus outline');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: 'Switch to light mode' }),
    ).toBeVisible();
    assert.equal(await bodyBackground(page), 'rgb(22, 22, 24)');
    await context.close();
  }

  // Device changes without reload: button label/icon stay in sync while
  // there is no explicit choice; an explicit choice then wins over device.
  for (const [start, flipped] of [
    ['light', 'dark'],
    ['dark', 'light'],
  ] as const) {
    const context = await browser.newContext({ colorScheme: start });
    const page = await context.newPage();
    await page.goto(origin);
    const startBg = start === 'dark' ? 'rgb(22, 22, 24)' : 'rgb(245, 245, 247)';
    const flippedBg =
      flipped === 'dark' ? 'rgb(22, 22, 24)' : 'rgb(245, 245, 247)';
    assert.equal(await bodyBackground(page), startBg);
    await page.emulateMedia({ colorScheme: flipped });
    await expect(
      page.getByRole('button', {
        name:
          flipped === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
      }),
    ).toBeVisible();
    assert.equal(await bodyBackground(page), flippedBg);
    // Clicking switches away from the currently visible (device) theme.
    await page
      .getByRole('button', {
        name:
          flipped === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
      })
      .click();
    assert.equal(await bodyBackground(page), startBg);
    assert.equal(
      await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'),
      ),
      start,
    );
    // Later device changes must not override the explicit choice.
    await page.emulateMedia({ colorScheme: start });
    assert.equal(await bodyBackground(page), startBg);
    await page.emulateMedia({ colorScheme: flipped });
    assert.equal(await bodyBackground(page), startBg);
    await expect(
      page.getByRole('button', {
        name: start === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
      }),
    ).toBeVisible();
    await context.close();
  }

  // 10: storage failure does not break rendering or switching.
  {
    const context = await browser.newContext({ colorScheme: 'light' });
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('storage unavailable');
        },
      });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    assert.equal(await bodyBackground(page), 'rgb(22, 22, 24)');
    // Explicit data-theme choice still wins over device changes even
    // though nothing could be stored.
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await bodyBackground(page), 'rgb(22, 22, 24)');
    await expect(
      page.getByRole('button', { name: 'Switch to light mode' }),
    ).toBeVisible();
    assert.deepEqual(errors, [], 'storage failure must not crash the page');
    await context.close();
  }

  // Without JavaScript, device-based appearance is retained.
  {
    const context = await browser.newContext({
      colorScheme: 'dark',
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    await page.goto(origin);
    assert.equal(await bodyBackground(page), 'rgb(22, 22, 24)');
    await context.close();
  }
});
