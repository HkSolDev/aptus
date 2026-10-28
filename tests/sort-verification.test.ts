import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright/test';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const TRACE_DIR = path.join(ROOT_DIR, 'outputs', 'traces');
async function getFreePort(): Promise<number> {
  const srv = createServer();
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const a = srv.address();
  assert(a && typeof a !== 'string');
  const port = a.port;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

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

function sortJobs(
  jobs: FixtureJob[],
  sortOrder: 'soonest' | 'furthest',
): FixtureJob[] {
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
  const gateArrivals = new Map<string, number>();
  const waitForGateArrival = async (sort: string, count: number) => {
    for (let i = 0; i < 100; i++) {
      if ((gateArrivals.get(sort) ?? 0) >= count) return;
      await setTimeout(25);
    }
    throw new Error(
      `Gate arrival timeout: ${sort} reached ${gateArrivals.get(sort) ?? 0}/${count}`,
    );
  };

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
      const sortParam =
        (parsed.searchParams.get('sort') as 'soonest' | 'furthest') ??
        'soonest';

      gateArrivals.set(sortParam, (gateArrivals.get(sortParam) ?? 0) + 1);
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

  const testPort = String(await getFreePort());
  const next: ChildProcess = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', testPort],
    {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        BACKEND_INTERNAL_URL: `http://127.0.0.1:${address.port}`,
      },
      stdio: 'pipe',
    },
  );
  let nextOutput = '';
  let nextExit: { code: number | null; signal: string | null } | null = null;
  next.stdout?.on('data', (d) => {
    nextOutput += String(d);
  });
  next.stderr?.on('data', (d) => {
    nextOutput += String(d);
  });
  next.on('exit', (code, signal) => {
    nextExit = { code, signal };
  });
  t.after(() => {
    for (const g of gateMap.values()) g.release();
    activeGate?.release();
    next.kill();
  });

  const origin = `http://127.0.0.1:${testPort}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
      if (ready) break;
    } catch {
      if (nextExit)
        throw new Error(
          `Next exited early: ${JSON.stringify(nextExit)}\n${nextOutput.slice(-2000)}`,
        );
    }
    await setTimeout(100);
  }
  assert(
    ready,
    `Production Next.js server must start on allocated port ${testPort}; exit=${JSON.stringify(nextExit)} output=${nextOutput.slice(-1000)}`,
  );

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

  const installCardObserver = async (page: Page) => {
    // Plain string script: a serialized TS function could reference transpiler helpers absent in the page.
    await page.addInitScript(`
      window.__cardStates = [];
      window.__recordCards = function () {
        var nodes = document.querySelectorAll('article[data-job-card]');
        var ids = [];
        for (var i = 0; i < nodes.length; i++) {
          var a = nodes[i].querySelector('h3[data-job-title] a');
          if (a) ids.push(decodeURIComponent((a.getAttribute('href') || '').replace('/jobs/', '')));
        }
        if (!ids.length) return;
        var last = window.__cardStates[window.__cardStates.length - 1];
        if (!last || last.ids.join(',') !== ids.join(',')) window.__cardStates.push({ at: performance.now(), ids: ids });
      };
      var __startCards = function () {
        window.setInterval(window.__recordCards, 25);
        window.__recordCards();
        try { new MutationObserver(window.__recordCards).observe(document.documentElement, { subtree: true, childList: true }); } catch (e) {}
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __startCards); else __startCards();
    `);
  };
  const getCardStates = async (
    page: Page,
  ): Promise<{ at: number; ids: string[] }[]> =>
    page.evaluate(
      () =>
        (window as unknown as { __cardStates: { at: number; ids: string[] }[] })
          .__cardStates || [],
    );
  const twoFrames = async (page: Page) =>
    page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
  const SOONEST = ['job-a', 'job-b1', 'job-b2', 'job-d', 'job-n1', 'job-n2'];
  const FURTHEST = ['job-d', 'job-b1', 'job-b2', 'job-a', 'job-n1', 'job-n2'];

  await t.test(
    '1. Controlled slow response: immediate selection feedback and retained stale cards',
    async () => {
      const context: BrowserContext = await browser.newContext({
        recordHar: { path: path.join(TRACE_DIR, 'sort-controlled.har') },
      });
      await context.tracing.start({ screenshots: true, snapshots: true });
      const page: Page = await context.newPage();

      try {
        await page.goto(origin);
        await expect(page.locator('article[data-job-card]')).toHaveCount(6);

        // Verify baseline soonest order (different, equal, null dates)
        const initialCards = await getVisibleCardIds(page);
        assert.deepEqual(initialCards, [
          'job-a',
          'job-b1',
          'job-b2',
          'job-d',
          'job-n1',
          'job-n2',
        ]);

        // Setup gate before triggering sort
        const gate = createGate();
        activeGate = gate;

        const sortSelect = page.getByRole('combobox', {
          name: 'Sort all jobs',
        });
        const startTime = Date.now();

        // Trigger selection
        await sortSelect.selectOption('furthest');

        // Assert 1: Synchronous / Prompt visual feedback while server response is held
        await expect(sortSelect).toHaveValue('furthest');
        await expect(sortSelect).toHaveAttribute('aria-busy', 'true');
        const updatingBadge = page.getByText('Updating…');
        await expect(updatingBadge).toBeVisible();

        const feedbackDuration = Date.now() - startTime;
        console.log(
          `[Metric] Input to visible feedback duration: ${feedbackDuration}ms`,
        );

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
        console.log(
          `[Metric] Input to final reconciled cards duration: ${totalCompletionTime}ms`,
        );
      } finally {
        activeGate?.release();
        activeGate = null;
        await context.tracing.stop({
          path: path.join(TRACE_DIR, 'sort-controlled.zip'),
        });
        await context.close();
      }
    },
  );

  await t.test(
    '2. Adversarial rapid toggle: outdated response released first',
    async () => {
      const page: Page = await browser.newPage();
      const requestLog: string[] = [];
      const bodyReads: Promise<unknown>[] = [];
      page.on('request', (r) => requestLog.push(r.url()));
      page.on('response', (r) => {
        bodyReads.push(r.body().catch(() => null));
      });
      try {
        await installCardObserver(page);
        await page.goto(origin);
        await expect(page.locator('article[data-job-card]')).toHaveCount(6);
        const prefetchAndInitial = [...requestLog]; // initial + any prefetch, reported separately
        requestLog.length = 0; // reset counters immediately before sorting
        const sortSelect = page.getByRole('combobox', {
          name: 'Sort all jobs',
        });
        const gateFurthest = createGate();
        gateMap.set('furthest', gateFurthest);
        const baseF = gateArrivals.get('furthest') ?? 0;
        await sortSelect.selectOption('furthest');
        await waitForGateArrival('furthest', baseF + 1); // intended request reached its gate
        const gateSoonest = createGate();
        gateMap.set('soonest', gateSoonest);
        const baseS = gateArrivals.get('soonest') ?? 0;
        await sortSelect.selectOption('soonest');
        // The second navigation may supersede the first before a second backend fetch; if it does reach backend, it must arrive at its gate.
        await setTimeout(0);
        gateFurthest.release(); // outdated first
        await twoFrames(page);
        gateSoonest.release();
        await expect(page).toHaveURL(/sort=soonest/);
        await expect(sortSelect).toHaveValue('soonest');
        await expect(sortSelect).not.toHaveAttribute('aria-busy', 'true');
        await Promise.all(bodyReads); // await payload reads
        assert.ok(
          (gateArrivals.get('soonest') ?? 0) > baseS,
          `Newest request must reach its gate (soonest arrivals=${gateArrivals.get('soonest')}, base=${baseS})`,
        );
        assert.deepEqual(await getVisibleCardIds(page), SOONEST);
        const states = await getCardStates(page);
        assert.ok(
          states.length >= 1,
          'MutationObserver must record card states',
        );
        for (const st of states)
          assert.notDeepEqual(
            st.ids,
            FURTHEST,
            `Transient stale commit observed: ${JSON.stringify(states)}`,
          );
        console.log(
          `[Network] initial/prefetch before reset: ${prefetchAndInitial.length} requests; sort-triggered after reset: ${requestLog.length} requests; gateArrivals=${JSON.stringify([...gateArrivals])}`,
        );
      } finally {
        for (const g of gateMap.values()) g.release();
        gateMap.clear();
        await page.close();
      }
    },
  );

  await t.test(
    '2b. Reverse race: newest response released first, older response last',
    async () => {
      const page: Page = await browser.newPage();
      const requestLog: string[] = [];
      const bodyReads: Promise<unknown>[] = [];
      page.on('request', (r) => requestLog.push(r.url()));
      page.on('response', (r) => {
        bodyReads.push(r.body().catch(() => null));
      });
      try {
        await installCardObserver(page);
        await page.goto(origin);
        await expect(page.locator('article[data-job-card]')).toHaveCount(6);
        const prefetchAndInitial = [...requestLog];
        requestLog.length = 0; // reset immediately before sorting
        const sortSelect = page.getByRole('combobox', {
          name: 'Sort all jobs',
        });
        const gateFurthest = createGate();
        gateMap.set('furthest', gateFurthest);
        const baseF = gateArrivals.get('furthest') ?? 0;
        await sortSelect.selectOption('furthest');
        await waitForGateArrival('furthest', baseF + 1);
        const gateSoonest = createGate();
        gateMap.set('soonest', gateSoonest);
        await sortSelect.selectOption('soonest');
        await setTimeout(0);
        gateSoonest.release(); // newest first
        await twoFrames(page);
        gateFurthest.release(); // older last -- must not commit, even transiently
        await expect(page).toHaveURL(/sort=soonest/);
        await expect(sortSelect).toHaveValue('soonest');
        await expect(sortSelect).not.toHaveAttribute('aria-busy', 'true');
        await Promise.all(bodyReads);
        assert.ok(
          (gateArrivals.get('furthest') ?? 0) > baseF,
          'Older request must have reached its gate in reverse race',
        );
        assert.deepEqual(
          await getVisibleCardIds(page),
          SOONEST,
          'Final cards must be exact soonest order after reverse race',
        );
        const states = await getCardStates(page);
        assert.ok(
          states.length >= 1,
          'MutationObserver must record card states',
        );
        for (const st of states)
          assert.notDeepEqual(
            st.ids,
            FURTHEST,
            `Transient stale commit observed in reverse race: ${JSON.stringify(states)}`,
          );
        console.log(
          `[Network] reverse-race initial/prefetch before reset: ${prefetchAndInitial.length}; sort-triggered after reset: ${requestLog.length}; recorded card states: ${JSON.stringify(states)}`,
        );
      } finally {
        for (const g of gateMap.values()) g.release();
        gateMap.clear();
        await page.close();
      }
    },
  );

  await t.test('3. Reload, Deep Links, and Back/Forward history', async () => {
    const page: Page = await browser.newPage();

    // Deep link directly to ?sort=furthest
    await page.goto(`${origin}/?sort=furthest#jobs`);
    const sortSelect = page.getByRole('combobox', { name: 'Sort all jobs' });
    await expect(sortSelect).toHaveValue('furthest');
    assert.deepEqual(await getVisibleCardIds(page), [
      'job-d',
      'job-b1',
      'job-b2',
      'job-a',
      'job-n1',
      'job-n2',
    ]);

    // Reload
    await page.reload();
    await expect(sortSelect).toHaveValue('furthest');
    assert.deepEqual(await getVisibleCardIds(page), [
      'job-d',
      'job-b1',
      'job-b2',
      'job-a',
      'job-n1',
      'job-n2',
    ]);

    // Change to soonest
    await sortSelect.selectOption('soonest');
    await expect(page).toHaveURL(/sort=soonest/);
    assert.deepEqual(await getVisibleCardIds(page), [
      'job-a',
      'job-b1',
      'job-b2',
      'job-d',
      'job-n1',
      'job-n2',
    ]);

    // Back button
    await page.goBack();
    await expect(page).toHaveURL(/sort=furthest/);
    await expect(sortSelect).toHaveValue('furthest');
    assert.deepEqual(await getVisibleCardIds(page), [
      'job-d',
      'job-b1',
      'job-b2',
      'job-a',
      'job-n1',
      'job-n2',
    ]);

    // Forward button
    await page.goForward();
    await expect(page).toHaveURL(/sort=soonest/);
    await expect(sortSelect).toHaveValue('soonest');
    assert.deepEqual(await getVisibleCardIds(page), [
      'job-a',
      'job-b1',
      'job-b2',
      'job-d',
      'job-n1',
      'job-n2',
    ]);

    await page.close();
  });

  await t.test(
    '4. Progressive Enhancement: Native form submission with JavaScript disabled',
    async () => {
      const noJsContext: BrowserContext = await browser.newContext({
        javaScriptEnabled: false,
      });
      const noJsPage: Page = await noJsContext.newPage();

      await noJsPage.goto(origin);
      const sortSelect = noJsPage.getByRole('combobox', {
        name: 'Sort all jobs',
      });
      await expect(sortSelect).toHaveValue('soonest');
      assert.deepEqual(await getVisibleCardIds(noJsPage), [
        'job-a',
        'job-b1',
        'job-b2',
        'job-d',
        'job-n1',
        'job-n2',
      ]);

      // Select furthest and submit via noscript button
      await sortSelect.selectOption('furthest');
      const applyButton = noJsPage.getByRole('button', { name: 'Apply sort' });
      await expect(applyButton).toBeVisible();
      await applyButton.click();

      // Native form submission navigates to /?sort=furthest
      await expect(noJsPage).toHaveURL(/sort=furthest/);
      await expect(
        noJsPage.getByRole('combobox', { name: 'Sort all jobs' }),
      ).toHaveValue('furthest');
      assert.deepEqual(await getVisibleCardIds(noJsPage), [
        'job-d',
        'job-b1',
        'job-b2',
        'job-a',
        'job-n1',
        'job-n2',
      ]);

      await noJsContext.close();
    },
  );
});
