import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect, type Browser, type BrowserContext, type Page } from 'playwright/test';

interface FixtureJob {
  id: string;
  postName: string;
  educationRequired: string | null;
  applicationLastDate: string | null;
  vacancies: number;
  payLevel: string;
  source: { name: string };
}

// 6 jobs: distinct dates, equal dates, and null dates
const FIXTURE_JOBS: FixtureJob[] = [
  {
    id: 'job-a',
    postName: 'Technical Assistant Early Nov',
    educationRequired: 'Diploma',
    applicationLastDate: '2026-11-01',
    vacancies: 5,
    payLevel: 'Level 5',
    source: { name: 'SSC' },
  },
  {
    id: 'job-b1',
    postName: 'Junior Engineer Mid Nov 1',
    educationRequired: 'Diploma',
    applicationLastDate: '2026-11-15',
    vacancies: 10,
    payLevel: 'Level 6',
    source: { name: 'SSC' },
  },
  {
    id: 'job-b2',
    postName: 'Junior Engineer Mid Nov 2',
    educationRequired: 'Diploma',
    applicationLastDate: '2026-11-15',
    vacancies: 8,
    payLevel: 'Level 6',
    source: { name: 'UPSC' },
  },
  {
    id: 'job-d',
    postName: 'Assistant Director Late Dec',
    educationRequired: 'Degree',
    applicationLastDate: '2026-12-01',
    vacancies: 2,
    payLevel: 'Level 7',
    source: { name: 'UPSC' },
  },
  {
    id: 'job-n1',
    postName: 'Scientist No Deadline 1',
    educationRequired: 'Degree',
    applicationLastDate: null,
    vacancies: 1,
    payLevel: 'Level 10',
    source: { name: 'State PSC' },
  },
  {
    id: 'job-n2',
    postName: 'Scientist No Deadline 2',
    educationRequired: 'Degree',
    applicationLastDate: null,
    vacancies: 1,
    payLevel: 'Level 10',
    source: { name: 'State PSC' },
  },
];

function sortJobs(jobs: FixtureJob[], sortOrder: 'soonest' | 'furthest'): FixtureJob[] {
  return [...jobs].sort((a, b) => {
    if (a.applicationLastDate === null && b.applicationLastDate === null) {
      return a.id.localeCompare(b.id);
    }
    if (a.applicationLastDate === null) return 1;
    if (b.applicationLastDate === null) return -1;
    const cmp = a.applicationLastDate.localeCompare(b.applicationLastDate);
    if (cmp !== 0) {
      return sortOrder === 'soonest' ? cmp : -cmp;
    }
    return a.id.localeCompare(b.id);
  });
}

interface RequestGate {
  promise: Promise<void>;
  release: () => void;
  released: boolean;
}

function createGate(): RequestGate {
  let release!: () => void;
  let isReleased = false;
  const promise = new Promise<void>((resolve) => {
    release = () => {
      isReleased = true;
      resolve();
    };
  });
  return {
    promise,
    release,
    get released() {
      return isReleased;
    },
  };
}

test('JobSortControl: Latency Gating, Stale Retention, Adversarial Race Safety, and Non-JS Form', async (t) => {
  let activeGate: RequestGate | null = null;
  const gateMap = new Map<string, RequestGate>();

  const api: Server = createServer(async (request, response) => {
    const rawUrl = request.url ?? '/';
    if (rawUrl === '/api/auth/get-session') {
      response.setHeader('Content-Type', 'application/json');
      response.statusCode = 401;
      response.end(JSON.stringify({ error: 'Please sign in again.' }));
      return;
    }

    if (rawUrl.startsWith('/api/jobs')) {
      const parsed = new URL(rawUrl, 'http://localhost');
      const sortParam = (parsed.searchParams.get('sort') as 'soonest' | 'furthest') ?? 'soonest';

      const specificGate = gateMap.get(sortParam);
      if (specificGate && !specificGate.released) {
        await specificGate.promise;
      } else if (activeGate && !activeGate.released) {
        await activeGate.promise;
      }

      const sorted = sortJobs(FIXTURE_JOBS, sortParam);
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          data: sorted,
          pagination: {
            page: 1,
            pageSize: 6,
            totalItems: sorted.length,
            totalPages: 1,
          },
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found' }));
  });

  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  t.after(() => new Promise<void>((resolve) => api.close(() => resolve())));

  const address = api.address();
  assert(address && typeof address !== 'string');

  const testPort = '18888';
  const next: ChildProcess = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', testPort],
    {
      cwd: '/private/tmp/aptus-agent2-sort-verification',
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

  const origin = `http://127.0.0.1:${testPort}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
      if (ready) break;
    } catch {
      // Waiting for server start
    }
    await setTimeout(100);
  }
  assert(ready, 'Production Next.js server must start');

  const bundled = chromium.executablePath();
  const browser: Browser = await chromium.launch({
    executablePath:
      process.env.APTUS_TEST_BROWSER ??
      (existsSync(bundled)
        ? bundled
        : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  });
  t.after(() => browser.close());

  const getVisibleCardIds = async (p: Page): Promise<string[]> => {
    const cards = p.locator('article[data-job-card]');
    const count = await cards.count();
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const link = cards.nth(i).locator('h3[data-job-title] a');
      const href = await link.getAttribute('href');
      if (href) {
        ids.push(decodeURIComponent(href.replace('/jobs/', '')));
      }
    }
    return ids;
  };

  await t.test('1. Controlled slow response: immediate selection feedback and retained stale cards', async () => {
    const context: BrowserContext = await browser.newContext({
      recordHar: { path: '/private/tmp/aptus-agent2-sort-verification/outputs/traces/sort-controlled.har' },
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page: Page = await context.newPage();

    try {
      await page.goto(origin);
      await expect(page.locator('article[data-job-card]')).toHaveCount(6);

      // Verify baseline soonest order (different, equal, null dates)
      const initialCards = await getVisibleCardIds(page);
      assert.deepEqual(initialCards, ['job-a', 'job-b1', 'job-b2', 'job-d', 'job-n1', 'job-n2']);

      // Setup gate before triggering sort
      const gate = createGate();
      activeGate = gate;

      const sortSelect = page.getByRole('combobox', { name: 'Sort all jobs' });
      const startTime = Date.now();

      // Trigger selection
      await sortSelect.selectOption('furthest');

      // Assert 1: Synchronous / Prompt visual feedback while server response is held
      await expect(sortSelect).toHaveValue('furthest');
      await expect(sortSelect).toHaveAttribute('aria-busy', 'true');
      const updatingBadge = page.getByText('Updating…');
      await expect(updatingBadge).toBeVisible();

      const feedbackDuration = Date.now() - startTime;
      console.log(`[Metric] Input to visible feedback duration: ${feedbackDuration}ms`);

      // Assert 2: Stale cards remain completely visible while the response is held
      const cardsWhileWaiting = await getVisibleCardIds(page);
      assert.deepEqual(
        cardsWhileWaiting,
        ['job-a', 'job-b1', 'job-b2', 'job-d', 'job-n1', 'job-n2'],
        'Existing cards must remain mounted in original order during in-flight transition',
      );

      // Release gate
      gate.release();
      activeGate = null;

      // Assert 3: Destination URL and updated cards reconcile
      await expect(page).toHaveURL(/sort=furthest/);
      await expect(sortSelect).not.toHaveAttribute('aria-busy', 'true');
      await expect(updatingBadge).not.toBeVisible();

      const finalCards = await getVisibleCardIds(page);
      assert.deepEqual(
        finalCards,
        ['job-d', 'job-b1', 'job-b2', 'job-a', 'job-n1', 'job-n2'],
        'Final cards must strictly match furthest order with stable ties and null deadline sorted last',
      );

      const totalCompletionTime = Date.now() - startTime;
      console.log(`[Metric] Input to final reconciled cards duration: ${totalCompletionTime}ms`);
    } finally {
      await context.tracing.stop({
        path: '/private/tmp/aptus-agent2-sort-verification/outputs/traces/sort-controlled.zip',
      });
      await context.close();
    }
  });

  await t.test('2. Adversarial rapid toggle: soonest -> furthest -> soonest with response held', async () => {
    const page: Page = await browser.newPage();
    await page.goto(origin);
    const sortSelect = page.getByRole('combobox', { name: 'Sort all jobs' });

    // Step A: Setup gate for 'furthest' request
    const gateFurthest = createGate();
    gateMap.set('furthest', gateFurthest);

    // Change to furthest
    await sortSelect.selectOption('furthest');
    await expect(sortSelect).toHaveValue('furthest');
    await expect(sortSelect).toHaveAttribute('aria-busy', 'true');

    // Step B: Setup gate for 'soonest' request
    const gateSoonest = createGate();
    gateMap.set('soonest', gateSoonest);

    // Rapidly toggle back to soonest
    await sortSelect.selectOption('soonest');
    await expect(sortSelect).toHaveValue('soonest');
    await expect(sortSelect).toHaveAttribute('aria-busy', 'true');

    // Step C: Adversarial release: release the OUTDATED 'furthest' response first
    gateFurthest.release();
    await setTimeout(100);

    // Release the latest 'soonest' response
    gateSoonest.release();

    // Destination must settle on the latest user intent ('soonest')
    await expect(sortSelect).toHaveValue('soonest');
    await expect(sortSelect).not.toHaveAttribute('aria-busy', 'true');

    const finalCards = await getVisibleCardIds(page);
    assert.deepEqual(
      finalCards,
      ['job-a', 'job-b1', 'job-b2', 'job-d', 'job-n1', 'job-n2'],
      'Final cards must reflect the latest choice (soonest), ignoring superseded furthest response',
    );

    gateMap.clear();
    await page.close();
  });

  await t.test('3. Reload, Deep Links, and Back/Forward history', async () => {
    const page: Page = await browser.newPage();

    // Deep link directly to ?sort=furthest
    await page.goto(`${origin}/?sort=furthest#jobs`);
    const sortSelect = page.getByRole('combobox', { name: 'Sort all jobs' });
    await expect(sortSelect).toHaveValue('furthest');
    assert.deepEqual(
      await getVisibleCardIds(page),
      ['job-d', 'job-b1', 'job-b2', 'job-a', 'job-n1', 'job-n2'],
    );

    // Reload
    await page.reload();
    await expect(sortSelect).toHaveValue('furthest');
    assert.deepEqual(
      await getVisibleCardIds(page),
      ['job-d', 'job-b1', 'job-b2', 'job-a', 'job-n1', 'job-n2'],
    );

    // Change to soonest
    await sortSelect.selectOption('soonest');
    await expect(page).toHaveURL(/sort=soonest/);
    assert.deepEqual(
      await getVisibleCardIds(page),
      ['job-a', 'job-b1', 'job-b2', 'job-d', 'job-n1', 'job-n2'],
    );

    // Back button
    await page.goBack();
    await expect(page).toHaveURL(/sort=furthest/);
    await expect(sortSelect).toHaveValue('furthest');
    assert.deepEqual(
      await getVisibleCardIds(page),
      ['job-d', 'job-b1', 'job-b2', 'job-a', 'job-n1', 'job-n2'],
    );

    // Forward button
    await page.goForward();
    await expect(page).toHaveURL(/sort=soonest/);
    await expect(sortSelect).toHaveValue('soonest');
    assert.deepEqual(
      await getVisibleCardIds(page),
      ['job-a', 'job-b1', 'job-b2', 'job-d', 'job-n1', 'job-n2'],
    );

    await page.close();
  });

  await t.test('4. Progressive Enhancement: Native form submission with JavaScript disabled', async () => {
    const noJsContext: BrowserContext = await browser.newContext({ javaScriptEnabled: false });
    const noJsPage: Page = await noJsContext.newPage();

    await noJsPage.goto(origin);
    const sortSelect = noJsPage.getByRole('combobox', { name: 'Sort all jobs' });
    await expect(sortSelect).toHaveValue('soonest');
    assert.deepEqual(
      await getVisibleCardIds(noJsPage),
      ['job-a', 'job-b1', 'job-b2', 'job-d', 'job-n1', 'job-n2'],
    );

    // Select furthest and submit via noscript button
    await sortSelect.selectOption('furthest');
    const applyButton = noJsPage.getByRole('button', { name: 'Apply sort' });
    await expect(applyButton).toBeVisible();
    await applyButton.click();

    // Native form submission navigates to /?sort=furthest
    await expect(noJsPage).toHaveURL(/sort=furthest/);
    await expect(noJsPage.getByRole('combobox', { name: 'Sort all jobs' })).toHaveValue('furthest');
    assert.deepEqual(
      await getVisibleCardIds(noJsPage),
      ['job-d', 'job-b1', 'job-b2', 'job-a', 'job-n1', 'job-n2'],
    );

    await noJsContext.close();
  });
});
