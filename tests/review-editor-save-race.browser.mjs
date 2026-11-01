// Manual browser regression for the save-in-flight (F1/F2) race.
// Not part of the automated suites: it needs a running local backend + Next
// server backed by an isolated test database, a seeded review item, and a
// signed test-operator session cookie. See
// docs/agent-progress/admin-review-review-fixes.md for the exact setup.
// Run: node tests/review-editor-save-race.browser.mjs
// Env: APTUS_BROWSER_BASE_URL, APTUS_TEST_ITEM_ID, APTUS_TEST_COOKIE_VALUE
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.APTUS_BROWSER_BASE_URL || 'http://127.0.0.1:18080';
const item = process.env.APTUS_TEST_ITEM_ID;
const cookieValue = process.env.APTUS_TEST_COOKIE_VALUE;
assert.ok(item, 'APTUS_TEST_ITEM_ID required');
assert.ok(cookieValue, 'APTUS_TEST_COOKIE_VALUE required');

const browser = await chromium.launch({
  executablePath:
    process.env.APTUS_CHROME_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: 'aptus.session_token',
      value: cookieValue,
      domain: '127.0.0.1',
      path: '/',
    },
  ]);
  const page = await context.newPage();
  await page.goto(`${base}/admin/review/${item}`, { waitUntil: 'networkidle' });
  await page.locator('#post-name').waitFor({ timeout: 15000 });

  // F1 edit
  await page.locator('#post-name').fill('Engineer F1');
  await page.locator('#change-reason').fill('save race regression');

  // Hold the save response so the pending state can be inspected.
  let release = () => {};
  const gate = new Promise((r) => (release = r));
  let armed = true;
  await page.route('**/api/admin/review-drafts/**/revisions', async (route) => {
    if (armed && route.request().method() === 'POST') {
      armed = false;
      await gate;
    }
    await route.continue();
  });

  await page.getByRole('button', { name: /Save correction|Saving/ }).click();
  await page.waitForTimeout(500);
  try {
    // While the save is pending, every editable control must be unavailable.
    for (const selector of [
      '#post-name',
      '#change-reason',
      '#min-age',
      '#education-req',
    ]) {
      assert.equal(
        await page.locator(selector).isDisabled(),
        true,
        `${selector} must be disabled while saving`,
      );
    }
    // A reviewer cannot create F2 through the UI in this period.
    await page
      .locator('#post-name')
      .fill('Engineer F2', { timeout: 1000 })
      .catch(() => {});
    assert.equal(await page.locator('#post-name').inputValue(), 'Engineer F1');
  } finally {
    release();
  }

  // After the response, the saved revision and its facts are correct.
  await page.waitForFunction(
    () => /Saved correction as Revision/.test(document.body.innerText),
    { timeout: 20000 },
  );
  assert.equal(await page.locator('#post-name').inputValue(), 'Engineer F1');
  console.log('SAVE-RACE BROWSER REGRESSION: PASS');
} finally {
  await browser.close();
}
