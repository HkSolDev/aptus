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

test('saved workspace browser regressions: batching, retry, session isolation and pagination', async (t) => {
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
  let fail = true;
  let savedIds = ['job-0'];
  const batches = [];
  let releaseStatus;
  let holdStatus = false;
  let releaseSave;
  let holdSave = false;
  await page.route('**/api/saved-jobs/status?*', async (route) => {
    const snapshotSavedIds = [...savedIds];
    const ids = new URL(route.request().url()).searchParams
      .get('ids')
      .split(',');
    batches.push(ids);
    if (holdStatus) {
      await new Promise((resolve) => {
        releaseStatus = resolve;
      });
    }
    await route.fulfill({
      status: fail ? 503 : 200,
      json: fail
        ? { error: 'offline fixture' }
        : { savedIds: snapshotSavedIds },
    });
  });
  await page.route('**/api/saved-jobs/job-*', async (route) => {
    if (holdSave)
      await new Promise((resolve) => {
        releaseSave = resolve;
      });
    await route.fulfill({
      json: { saved: route.request().method() === 'PUT' },
    });
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Account A', exact: true }).click();
  await expect(page.locator('[data-job="0"] button')).toHaveText(
    'Retry saved status',
  );
  assert.equal(batches.flat().length, 60);
  assert(batches.every((ids) => ids.length <= 50));
  fail = false;
  await page.locator('[data-job="0"] button').click();
  await expect(page.locator('[data-job="0"] button')).toHaveText('Saved ✓');
  await expect(page.locator('[data-job] button:disabled')).toHaveCount(0);
  // A successful unsave must win over an older status response.
  await page.getByRole('button', { name: 'Account B', exact: true }).click();
  await expect(page.locator('[data-job="0"] button')).toHaveText('Saved ✓');
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  holdStatus = true;
  await page.getByRole('button', { name: 'Account A', exact: true }).click();
  await expect.poll(() => Boolean(releaseStatus)).toBe(true);
  await page.getByRole('button', { name: 'Unsave first', exact: true }).click();
  releaseStatus();
  holdStatus = false;
  await expect(page.locator('[data-job="0"] button')).toHaveText('Save');
  // A response from account A cannot repopulate account B, even with equal display names.
  holdSave = true;
  await page.locator('[data-job="0"] button').click();
  await expect.poll(() => Boolean(releaseSave)).toBe(true);
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  releaseSave();
  holdSave = false;
  await expect(page.locator('#saved-state')).toHaveText('');
  await page.getByRole('button', { name: 'Account B', exact: true }).click();
  await expect(page.locator('[data-job="0"] button')).toHaveText('Saved ✓');
  // An old account's delayed status must not leak into a new account's empty status.
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  holdStatus = true;
  releaseStatus = undefined;
  await page.getByRole('button', { name: 'Account A', exact: true }).click();
  await expect.poll(() => Boolean(releaseStatus)).toBe(true);
  const releaseOldStatus = releaseStatus;
  holdStatus = false;
  savedIds = [];
  await page.getByRole('button', { name: 'Account B', exact: true }).click();
  await expect(page.locator('[data-job="0"] button')).toHaveText('Save');
  releaseOldStatus();
  await expect(page.locator('#saved-state')).toHaveText('');
  // Last-page removal fetches the preceding page, not the global empty state.
  let total = 21;
  let holdList = false;
  let releaseList;
  await page.route('**/api/saved-jobs?page=*', async (route) => {
    const current = Number(
      new URL(route.request().url()).searchParams.get('page'),
    );
    const all = Array.from({ length: total }, (_, i) => ({
      id: `job-${i}`,
      postName: `Fixture job ${i}`,
      educationRequired: 'Diploma',
      applicationLastDate: null,
      vacancies: 1,
      source: { name: 'Fixture' },
      savedAt: '2026-10-25T00:00:00Z',
    }));
    if (holdList)
      await new Promise((resolve) => {
        releaseList = resolve;
      });
    await route.fulfill({
      json: {
        data: all.slice((current - 1) * 20, current * 20),
        pagination: {
          page: current,
          pageSize: 20,
          totalItems: total,
          totalPages: Math.ceil(total / 20),
        },
      },
    });
  });
  await page.route('**/api/saved-jobs/job-20', async (route) => {
    total = 20;
    await route.fulfill({ json: { saved: false } });
  });
  await page.goto(origin + '/?view=saved');
  await page.getByRole('button', { name: 'Account A', exact: true }).click();
  await page.getByRole('button', { name: 'Next page →' }).click();
  await expect(page.locator('[data-job-card]')).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Remove from saved', exact: true })
    .click();
  await expect(page.locator('[data-job-card]')).toHaveCount(20);
  await expect(page.getByText('Your shortlist starts here')).toHaveCount(0);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole('heading', { name: 'Saved jobs', exact: true }),
    ).toBeVisible();
  }
  // A late saved-list response from the previous account cannot replace the new account's list.
  await page.reload();
  holdList = true;
  await page.getByRole('button', { name: 'Account A', exact: true }).click();
  await expect.poll(() => Boolean(releaseList)).toBe(true);
  const releaseOldList = releaseList;
  holdList = false;
  total = 0;
  await page.getByRole('button', { name: 'Account B', exact: true }).click();
  await expect(page.getByText('Your shortlist starts here')).toBeVisible();
  releaseOldList();
  await expect(page.locator('[data-job-card]')).toHaveCount(0);
  // Real ProfileForm against a fictional HTTP boundary: save, update, refresh, match and late responses.
  let storedProfile = null;
  let profileFailure = true;
  let releaseProfile;
  let delayProfile = false;
  let matchCalls = 0;
  await page.route('**/api/profile', async (route) => {
    if (route.request().method() === 'PUT')
      storedProfile = route.request().postDataJSON();
    const snapshot = structuredClone(storedProfile);
    if (delayProfile)
      await new Promise((resolve) => {
        releaseProfile = resolve;
      });
    await route.fulfill({
      status: profileFailure ? 503 : 200,
      json: profileFailure
        ? { error: 'Profile unavailable fixture' }
        : { profile: snapshot },
    });
  });
  await page.route('**/api/match', async (route) => {
    assert.deepEqual(route.request().postDataJSON(), {});
    matchCalls += 1;
    await route.fulfill({
      json: { matches: [], needsManualCheck: [], sourcesChecked: [] },
    });
  });
  await page.goto(origin + '/?view=profile');
  await page.getByRole('button', { name: 'Account A', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Profile unavailable fixture',
  );
  await expect(page.locator('input[name="dob"]')).toBeDisabled();
  profileFailure = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('input[name="dob"]').fill('1995-01-02');
  await page.locator('select[name="eduLevel"]').selectOption('DIPLOMA');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible();
  await page.locator('input[name="dob"]').fill('1996-02-03');
  await expect(page.locator('#submit-profile')).toBeDisabled();
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.locator('#submit-profile')).toBeEnabled();
  await page.reload();
  await page.getByRole('button', { name: 'Account A', exact: true }).click();
  await expect(page.locator('input[name="dob"]')).toHaveValue('1996-02-03');
  await page.locator('#submit-profile').click();
  await expect.poll(() => matchCalls).toBe(1);
  // Restart profile view; resolve A's old profile after switching to B.
  await page.goto(origin + '/?view=profile');
  delayProfile = true;
  await page.getByRole('button', { name: 'Account A', exact: true }).click();
  await expect.poll(() => Boolean(releaseProfile)).toBe(true);
  const releaseOldProfile = releaseProfile;
  delayProfile = false;
  storedProfile = null;
  await page.getByRole('button', { name: 'Account B', exact: true }).click();
  await expect(page.locator('input[name="dob"]')).toBeEnabled();
  releaseOldProfile();
  await expect(page.locator('input[name="dob"]')).toHaveValue('');
  assert.deepEqual(errors, []);
});
