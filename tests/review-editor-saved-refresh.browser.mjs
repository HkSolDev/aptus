// Manual browser regression: a failed refresh after a successful save must
// not let "Check correction" validate the older displayed revision.
// Not part of the automated suites: needs a running local backend + Next
// server backed by an isolated test database, a seeded review item, and a
// signed test-operator session cookie. See
// docs/agent-progress/admin-review-review-fixes.md for the harness setup.
// Env: APTUS_BROWSER_BASE_URL, APTUS_TEST_ITEM_ID, APTUS_TEST_COOKIE_VALUE,
//      APTUS_API_URL (for reading the current revision id)
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.APTUS_BROWSER_BASE_URL || 'http://127.0.0.1:18080';
const api = process.env.APTUS_API_URL || 'http://127.0.0.1:8081';
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
    { name: 'aptus.session_token', value: cookieValue, domain: '127.0.0.1', path: '/' },
  ]);
  const page = await context.newPage();
  await page.goto(`${base}/admin/review/${item}`, { waitUntil: 'networkidle' });
  await page.locator('#post-name').waitFor({ timeout: 15000 });

  let failNextDetailGet = true;
  const validateBodies = [];
  await page.route('**/api/admin/review-drafts/**', async (route) => {
    const req = route.request();
    const url = req.url();
    if (failNextDetailGet && req.method() === 'GET' && url.endsWith(item)) {
      failNextDetailGet = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' });
      return;
    }
    if (req.method() === 'POST' && url.endsWith('/validate')) {
      validateBodies.push(req.postData() || '');
    }
    await route.continue();
  });

  // 1) Save a correction; the follow-up detail GET deliberately fails.
  await page.locator('#post-name').fill('Engineer Saved');
  await page.locator('#change-reason').fill('saved-refresh regression');
  await page.getByRole('button', { name: /Save correction/ }).click();
  await page.waitForFunction(
    () => /Saved correction as Revision R2/.test(document.body.innerText),
    { timeout: 20000 },
  );
  console.log('saved confirmation visible after failed refresh');

  // 2) Refresh-needed message appears and Check correction cannot submit.
  const body1 = await page.locator('body').innerText();
  assert.match(body1, /Correction saved\. Refresh the saved revision before checking it\./);
  const checkButton = page.getByRole('button', { name: /Check correction|Checking/ });
  assert.equal(await checkButton.isDisabled(), true, 'Check correction disabled until refresh');
  assert.equal(validateBodies.length, 0, 'no validation request sent');
  console.log('refresh-needed state blocks validation of the old revision');

  // 3) Retry refresh successfully: editor shows R2, validation submits R2.
  await page.getByRole('button', { name: 'Refresh result' }).click();
  await page.waitForFunction(
    () => /Revision R2/.test(document.body.innerText) && !/Refresh the saved revision/.test(document.body.innerText),
    { timeout: 20000 },
  );
  assert.equal(await page.locator('#post-name').inputValue(), 'Engineer Saved');
  const detailRes = await fetch(`${api}/api/admin/review-drafts/${item}`, {
    headers: { cookie: `aptus.session_token=${cookieValue}` },
  });
  const currentRevisionId = (await detailRes.json()).revision.id;
  await checkButton.click();
  await page.waitForTimeout(1500);
  assert.equal(validateBodies.length, 1, 'validation submitted after refresh');
  assert.match(validateBodies[0], new RegExp(currentRevisionId), 'validation submits the saved revision');
  console.log('successful retry reconciles editor; validation submits R2');

  // 4) A failed save retains unsaved facts and shows no successful-save state.
  await page.unrouteAll({ behavior: 'wait' });
  await page.route('**/api/admin/review-drafts/**/revisions', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
      return;
    }
    await route.continue();
  });
  await page.locator('#post-name').fill('Engineer Unsaved');
  await page.locator('#change-reason').fill('this save will fail');
  await page.getByRole('button', { name: /Save correction/ }).click();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#post-name').inputValue(), 'Engineer Unsaved');
  const body2 = await page.locator('body').innerText();
  assert.match(body2, /You have unsaved changes/);
  assert.doesNotMatch(body2, /Saved correction as Revision/);
  assert.doesNotMatch(body2, /Refresh the saved revision before checking it/);
  console.log('failed save retains unsaved facts without a saved state');

  // 5) Refresh after further edits preserves them (same-revision rules).
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByRole('button', { name: 'Refresh result' }).click();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#post-name').inputValue(), 'Engineer Unsaved');
  console.log('refresh after further edits preserved them');

  console.log('SAVED-REFRESH BROWSER REGRESSION: PASS');
} finally {
  await browser.close();
}
