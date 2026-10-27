import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { chromium, expect } from 'playwright/test';

const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve('esbuild', { paths: [require.resolve('tsx')] }),
);

test('browser handles malformed success envelopes: visible errors, accessible alerts and retry recovery', async (t) => {
  const result = await build({
    entryPoints: ['tests/fixtures/saved-workspace.tsx'],
    bundle: true,
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    tsconfig: 'tsconfig.next.json',
    plugins: [
      {
        name: 'browser-test-boundaries',
        setup(b) {
          b.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: 'navigation',
            namespace: 'navigation-fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'navigation-fixture' }, () => ({
            contents:
              'export function useRouter() { return { push(url) { history.pushState({}, "", url) } } }',
          }));
          b.onResolve({ filter: /^next\/link$/ }, () => ({
            path: 'link',
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents:
              'import React from "react"; export default function Link({children,...props}) { return React.createElement("a",props,children) }',
            resolveDir: process.cwd(),
          }));
          b.onLoad({ filter: /\.css$/ }, () => ({
            contents: 'export default {}',
            loader: 'js',
          }));
        },
      },
    ],
    define: { 'process.env.NODE_ENV': '"development"' },
  });

  const server = createServer((req, res) => {
    if (req.url === '/bundle.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(result.outputFiles[0].text);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<div id="root"></div><script src="/bundle.js"></script>');
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const browser = await chromium.launch({
    executablePath: existsSync(chromium.executablePath())
      ? chromium.executablePath()
      : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  t.after(() => browser.close());

  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // --- Scenario 1: SaveJobButton on malformed HTTP 200 {} ---
  let malformedSave = true;
  await page.route('**/api/saved-jobs/status?*', async (route) => {
    await route.fulfill({
      status: 200,
      json: { savedIds: [] },
    });
  });

  await page.route('**/api/saved-jobs/job-0', async (route) => {
    if (route.request().method() === 'PUT') {
      if (malformedSave) {
        // Malformed HTTP 200 {}: missing `saved` boolean and `savedAt`
        await route.fulfill({ status: 200, json: {} });
      } else {
        await route.fulfill({
          status: 200,
          json: { saved: true, savedAt: '2026-10-27T00:00:00Z' },
        });
      }
    }
  });

  await page.goto(origin);
  await page.getByRole('button', { name: 'Account A', exact: true }).click();
  await expect(page.locator('[data-job="0"] button')).toHaveText('Save');

  // Click Save when API returns malformed {}
  await page.locator('[data-job="0"] button').click();

  // Button must NOT become "Saved ✓", and must show error alert and allow retry
  await expect(page.locator('[data-job="0"] [role="alert"]')).toHaveText(
    'Aptus returned an unexpected response. Please try again.',
  );
  await expect(page.locator('[data-job="0"] button')).toHaveText(
    'Retry saved status',
  );
  // Must NOT add to saved-state output
  await expect(page.locator('#saved-state')).toHaveText('');

  // Clicking "Retry saved status" rechecks the server status
  await page.locator('[data-job="0"] button').click();
  await expect(page.locator('[data-job="0"] button')).toHaveText('Save');

  // Retry save when API returns valid response
  malformedSave = false;
  await page.locator('[data-job="0"] button').click();
  await expect(page.locator('[data-job="0"] button')).toHaveText('Saved ✓');
  await expect(page.locator('#saved-state')).toHaveText('job-0');

  // --- Scenario 2: SavedJobsView on malformed HTTP 200 {} ---
  let malformedList = true;
  await page.route('**/api/saved-jobs?page=*', async (route) => {
    if (malformedList) {
      // Malformed HTTP 200 {}: missing data and pagination
      await route.fulfill({ status: 200, json: {} });
    } else {
      await route.fulfill({
        status: 200,
        json: {
          data: [
            {
              id: 'job-0',
              postName: 'Junior Engineer',
              educationRequired: null,
              applicationLastDate: null,
              vacancies: 5,
              source: { name: 'SSC' },
              savedAt: '2026-10-27T00:00:00Z',
            },
          ],
          pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
        },
      });
    }
  });

  await page.goto(origin + '/?view=saved');
  await page.getByRole('button', { name: 'Account A', exact: true }).click();

  // Must show error alert, NOT empty state ("Your shortlist starts here")
  await expect(page.getByRole('alert')).toHaveText(
    'Aptus returned an invalid saved jobs list.',
  );
  await expect(page.getByText('Your shortlist starts here')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

  // Click "Try again" when API returns valid data
  malformedList = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('[data-job-card]')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);

  // --- Scenario 3: ProfileForm on malformed HTTP 200 {} ---
  let malformedProfile = true;
  await page.route('**/api/profile', async (route) => {
    if (route.request().method() === 'GET') {
      if (malformedProfile) {
        // Malformed HTTP 200 {}: missing `profile` key
        await route.fulfill({ status: 200, json: {} });
      } else {
        await route.fulfill({ status: 200, json: { profile: null } });
      }
    }
  });

  await page.goto(origin + '/?view=profile');
  await page.getByRole('button', { name: 'Account A', exact: true }).click();

  // Must show error alert and disable inputs, NOT silently claim profile loaded
  await expect(page.getByRole('alert')).toHaveText(
    'Aptus returned an unexpected response. Please refresh and try again.',
  );
  await expect(page.locator('input[name="dob"]')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

  // Click "Try again" when API returns valid { profile: null }
  malformedProfile = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('input[name="dob"]')).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);

  assert.deepEqual(errors, []);
});
