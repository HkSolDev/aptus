import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect } from 'playwright/test';

test('Next.js keyboard skip, detail navigation and Back preserve the public list', async (t) => {
  const job = {
    id: 'navigation-fixture',
    postName: 'Example Technical Assistant',
    educationRequired: 'Diploma',
    applicationLastDate: null,
    vacancies: null,
    source: { name: 'Example source' },
  };
  const api = createServer((request, response) => {
    const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
    const matching =
      params.get('q') === 'Technical'
        ? Array.from({ length: 7 }, (_, index) => ({
            ...job,
            id: `navigation-fixture-${index}`,
            postName: `${job.postName} ${index + 1}`,
          }))
        : params.get('q') === 'no-such-job'
          ? []
          : [job];
    const currentPage = Number(params.get('page') ?? '1');
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify(
        request.url?.startsWith('/api/jobs?')
          ? {
              data: matching.slice((currentPage - 1) * 6, currentPage * 6),
              pagination: {
                page: currentPage,
                pageSize: 6,
                totalItems: matching.length,
                totalPages: Math.ceil(matching.length / 6),
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

  // test:web builds Next first; this server reads only the isolated fixture API.
  const next = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', '18880'],
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
  const origin = 'http://127.0.0.1:18880';
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
  await page.goto(origin);
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Skip to content');
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('searchbox', { name: 'Search all jobs' }),
  ).toBeFocused();
  await page.getByRole('link', { name: 'View details' }).click();
  await expect(page.locator('.job-detail h1')).toHaveText(job.postName);
  await page.goBack();
  await expect(page.locator('[data-job-card]')).toHaveCount(1);
  await expect(page.locator('[data-job-card] h3')).toHaveText(job.postName);

  await t.test(
    'shared navigation follows the reference at mobile, tablet and desktop sizes',
    async () => {
      const navigation = page.getByRole('navigation', {
        name: 'Main navigation',
        exact: true,
      });
      for (const width of [390, 834, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(origin);
        await expect(navigation.getByRole('link')).toHaveCount(3);
        await expect(
          navigation.getByRole('link', { name: 'Home', exact: true }),
        ).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('header a[href="/sign-in"]')).toHaveCount(1);
        const metrics = await navigation.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            position: getComputedStyle(element).position,
            bottom: bounds.bottom,
            headerHeight: document
              .querySelector('header')
              ?.getBoundingClientRect().height,
            overflow: document.documentElement.scrollWidth > innerWidth,
            targets: Array.from(element.querySelectorAll('a'), (link) => ({
              width: link.getBoundingClientRect().width,
              height: link.getBoundingClientRect().height,
            })),
          };
        });
        assert.equal(metrics.overflow, false);
        assert.equal(metrics.position === 'fixed', width < 760);
        assert.equal(metrics.headerHeight, width < 760 ? 68 : 76);
        if (width < 760) {
          assert.equal(metrics.bottom, 900);
          assert(
            metrics.targets.every(
              ({ width: targetWidth, height }) =>
                targetWidth >= 44 && height >= 54,
            ),
          );
        }
        await navigation.locator('a[href="/saved"]').focus();
        assert.equal(
          await page
            .locator(':focus')
            .evaluate((element) => getComputedStyle(element).outlineStyle),
          'solid',
        );
        await page.keyboard.press('Enter');
        await expect(
          page.getByRole('heading', { name: 'Saved jobs', exact: true }),
        ).toBeVisible();
        await expect(navigation.locator('a[href="/saved"]')).toHaveAttribute(
          'aria-current',
          'page',
        );
        await navigation
          .getByRole('link', { name: 'Profile', exact: true })
          .click();
        await expect(page).toHaveURL(`${origin}/profile`);
        await expect(navigation.locator('a[href="/profile"]')).toHaveAttribute(
          'aria-current',
          'page',
        );
        await navigation
          .getByRole('link', { name: 'Home', exact: true })
          .click();
        await expect(page.locator('[data-job-card]')).toHaveCount(1);
      }
      const plain = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: 390, height: 900 },
      });
      try {
        const noJs = await plain.newPage();
        await noJs.goto(origin);
        await noJs.locator('.primary-navigation a[href="/saved"]').click();
        await expect(
          noJs.getByRole('heading', { name: 'Saved jobs', exact: true }),
        ).toBeVisible();
        await expect(
          noJs.locator('.primary-navigation a[href="/saved"]'),
        ).toHaveAttribute('aria-current', 'page');
        await noJs.locator('.primary-navigation a[href="/"]').click();
        await expect(noJs.locator('[data-job-card]')).toHaveCount(1);
        const footerLink = noJs.getByRole('link', {
          name: 'How Aptus works',
          exact: true,
        });
        await footerLink.scrollIntoViewIfNeeded();
        const footerBounds = await footerLink.boundingBox();
        const navBounds = await noJs
          .locator('.primary-navigation')
          .boundingBox();
        assert(
          footerBounds &&
            navBounds &&
            footerBounds.y + footerBounds.height <= navBounds.y,
        );
      } finally {
        await plain.close();
      }
    },
  );

  await t.test(
    'sign-in uses its own responsive page and keeps provider errors out of the header',
    async () => {
      await expect(page.locator('header #google-sign-in')).toHaveCount(0);
      await page.getByRole('link', { name: 'Sign in', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Sign in to Aptus' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Continue with Google' }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Continue browsing jobs' }),
      ).toBeVisible();
      for (const width of [390, 834, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        const bounds = await page.locator('.signin-panel').boundingBox();
        assert(bounds && bounds.width <= 440);
      }
      await page.route('**/api/auth/sign-in/social', async (route) => {
        assert.deepEqual(route.request().postDataJSON(), {
          provider: 'google',
        });
        await setTimeout(100);
        await route.fulfill({
          status: 503,
          json: {
            error:
              'Sign-in is temporarily unavailable. Please try again shortly.',
          },
        });
      });
      const google = page.locator('main #google-sign-in');
      await google.click();
      await expect(google).toBeDisabled();
      await expect(page.locator('main [role="alert"]')).toContainText(
        'Sign-in is temporarily unavailable',
      );
      await expect(google).toBeEnabled();
      await expect(page.locator('header [role="alert"]')).toHaveCount(0);
      await google.click();
      await expect(google).toBeDisabled();
      await expect(google).toBeEnabled();
      await expect(page.locator('main [role="alert"]')).toContainText(
        'Sign-in is temporarily unavailable',
      );
      const passkey = page.getByRole('button', {
        name: 'Sign in with a passkey',
      });
      await expect(passkey).toBeDisabled();
      await page.route('**/api/auth/passkey/status', (route) =>
        route.fulfill({ json: { enabled: true, recent: false } }),
      );
      await page.reload();
      await expect(passkey).toBeEnabled();
      await page.route(
        '**/api/auth/passkey/generate-authenticate-options',
        (route) =>
          route.fulfill({
            status: 503,
            json: { error: 'Passkey service is temporarily unavailable.' },
          }),
      );
      await passkey.click();
      await expect(page.locator('main [role="alert"]')).toHaveText(
        'Passkey service is temporarily unavailable.',
      );
      await expect(passkey).toBeEnabled();
      await page.getByRole('link', { name: 'Continue browsing jobs' }).click();
      await expect(page.locator('[data-job-card]')).toHaveCount(1);
    },
  );

  await t.test(
    'signed-in people can still reach passkey management and sign out',
    async () => {
      await page.route('**/api/auth/get-session', (route) =>
        route.fulfill({ json: { user: { name: 'Example User' } } }),
      );
      await page.route('**/api/auth/passkey/status', (route) =>
        route.fulfill({ json: { enabled: true, recent: true } }),
      );
      await page.route('**/api/auth/passkey/list-user-passkeys', (route) =>
        route.fulfill({ json: [] }),
      );
      await page.route('**/api/auth/sign-out', (route) =>
        route.fulfill({ json: { ok: true } }),
      );
      await page.goto(origin);
      await page.getByRole('link', { name: 'Manage sign-in' }).click();
      await expect(
        page.getByRole('button', { name: 'Add a passkey' }),
      ).toBeVisible();
      await page.locator('#account-sign-out').click();
      await expect(
        page.getByRole('button', { name: 'Continue with Google' }),
      ).toBeVisible();
    },
  );

  await t.test(
    'Home controls preserve filters through sorting, pagination and Back',
    async () => {
      await page.goto(origin);
      await page
        .getByRole('searchbox', { name: 'Search all jobs' })
        .fill('Technical');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.locator('[data-job-card]')).toHaveCount(6);
      const layouts = page.getByRole('form', { name: 'All jobs layout' });
      await layouts.getByRole('button', { name: 'Cards', exact: true }).click();
      await expect(page).toHaveURL(/layout=cards/);
      await page
        .getByRole('combobox', { name: 'Qualification', exact: true })
        .selectOption('DIPLOMA');
      await expect(page).toHaveURL(/qualification=DIPLOMA/);
      await page
        .getByRole('combobox', { name: 'Sort all jobs' })
        .selectOption('furthest');
      await expect(page).toHaveURL(/sort=furthest/);
      await page.getByRole('link', { name: 'Next page' }).click();
      await expect(page).toHaveURL(/page=2/);
      await expect(page.locator('[data-job-card]')).toHaveCount(1);
      const params = new URL(page.url()).searchParams;
      assert.equal(params.get('q'), 'Technical');
      assert.equal(params.get('qualification'), 'DIPLOMA');
      assert.equal(params.get('sort'), 'furthest');
      assert.equal(params.get('layout'), 'cards');
      await page.getByRole('link', { name: 'View details' }).click();
      await expect(page.locator('.job-detail h1')).toBeVisible();
      await page.goBack();
      await expect(page.getByRole('searchbox')).toHaveValue('Technical');
      await expect(
        page.getByRole('combobox', { name: 'Qualification', exact: true }),
      ).toHaveValue('DIPLOMA');
      await expect(
        page.getByRole('combobox', { name: 'Sort all jobs' }),
      ).toHaveValue('furthest');
      await page.getByRole('searchbox').fill('no-such-job');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'No jobs match your search' }),
      ).toBeVisible();
      await page
        .getByRole('link', { name: 'Clear search and filter' })
        .first()
        .click();
      await expect(page.locator('[data-job-card]')).toHaveCount(1);
      for (const width of [390, 834, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
      }
      const plain = await browser.newContext({ javaScriptEnabled: false });
      try {
        const noJs = await plain.newPage();
        await noJs.goto(origin);
        await noJs.getByRole('searchbox').fill('Technical');
        await noJs
          .getByRole('combobox', { name: 'Qualification', exact: true })
          .selectOption('DIPLOMA');
        await noJs.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(noJs.locator('[data-job-card]')).toHaveCount(6);
        await noJs
          .getByRole('combobox', { name: 'Sort all jobs' })
          .selectOption('furthest');
        await noJs.getByRole('button', { name: 'Apply sort' }).click();
        await expect(noJs).toHaveURL(/sort=furthest/);
        await expect(noJs.getByRole('searchbox')).toHaveValue('Technical');
        await noJs
          .getByRole('form', { name: 'All jobs layout', exact: true })
          .getByRole('button', { name: 'Cards', exact: true })
          .click();
        await expect(noJs).toHaveURL(/layout=cards/);
        await expect(noJs.locator('[data-job-card]')).toHaveCount(6);
      } finally {
        await plain.close();
      }
    },
  );
});
