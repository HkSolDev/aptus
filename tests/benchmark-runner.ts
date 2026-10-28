import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type CDPSession,
} from 'playwright/test';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
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

interface BenchmarkMeasurement {
  mode: string;
  profile: string;
  feedbackDelayMs: number | null; // Playwright observation latency (test-runner wall clock), NOT paint timing
  prefetchAndInitialRequestCount: number;
  sortTriggeredRequestCount: number;
  rscRequestCount: number;
  rscPayloadBytes: number;
  totalTimeMs: number;
  initialCardIds: string[];
  finalCardIds: string[];
  cardsPreservedWhileHeld: boolean;
  finalUrl: string;
}

async function runBenchmark(
  mode: 'baseline' | 'candidate',
): Promise<BenchmarkMeasurement[]> {
  const measurements: BenchmarkMeasurement[] = [];
  let gateRelease: (() => void) | null = null;
  let gatePromise: Promise<void> | null = null;

  const createGate = () => {
    gatePromise = new Promise<void>((resolve) => {
      gateRelease = resolve;
    });
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

      if (gatePromise) {
        await gatePromise;
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

  const origin = `http://127.0.0.1:${testPort}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok;
      if (ready) break;
    } catch {
      // Waiting
    }
    await setTimeout(100);
  }
  assert(
    ready,
    `Production Next.js server must start on allocated port ${testPort}`,
  );

  const bundled = chromium.executablePath();
  const browser: Browser = await chromium.launch({
    executablePath:
      process.env.APTUS_TEST_BROWSER ??
      (existsSync(bundled)
        ? bundled
        : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  });

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

  const profiles = [
    {
      name: 'desktop',
      viewport: { width: 1280, height: 800 },
      isMobile: false,
      throttle: false,
    },
    {
      name: 'mobile-throttled',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      throttle: true,
    },
  ];

  for (const prof of profiles) {
    const tracePath = path.join(
      ROOT_DIR,
      'outputs',
      'traces',
      `${mode}-${prof.name}.zip`,
    );
    const harPath = path.join(
      ROOT_DIR,
      'outputs',
      'traces',
      `${mode}-${prof.name}.har`,
    );

    const context: BrowserContext = await browser.newContext({
      viewport: prof.viewport,
      isMobile: prof.isMobile,
      recordHar: { path: harPath },
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page: Page = await context.newPage();

    let client: CDPSession | null = null;
    if (prof.throttle) {
      client = await context.newCDPSession(page);
      // 4x CPU slowdown
      await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      // Fast 3G network conditions: 562.5 kb/s down, 500 ms latency
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 100,
        downloadThroughput: (1.5 * 1024 * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
      });
    }

    let rscCount = 0;
    let rscBytes = 0;
    page.on('response', async (res) => {
      const url = res.url();
      if (
        url.includes('_rsc=') ||
        res.headers()['content-type']?.includes('text/x-component')
      ) {
        rscCount++;
        try {
          const body = await res.body();
          rscBytes += body.length;
        } catch {
          // ignore
        }
      }
    });

    await page.goto(origin);
    const initialCardIds = await getVisibleCardIds(page);
    const prefetchAndInitialRequestCount = rscCount;
    rscCount = 0;
    rscBytes = 0; // reset counters immediately before sorting; initial/prefetch reported separately

    // Setup gate to hold the response until explicitly released below (no fixed hold duration).
    createGate();

    const sortSelect = page.getByRole('combobox', { name: 'Sort all jobs' });
    const startTime = Date.now();

    // Trigger sort
    await sortSelect.selectOption('furthest');

    // Measure prompt visual feedback (within 200ms while gate is held)
    let feedbackDelayMs: number | null = null;
    let cardsPreservedWhileHeld = false;

    // Check if aria-busy or value changed immediately
    const checkStart = Date.now();
    while (Date.now() - checkStart < 250) {
      const currentVal = await sortSelect.inputValue();
      const isBusy = (await sortSelect.getAttribute('aria-busy')) === 'true';
      if (currentVal === 'furthest' && isBusy) {
        feedbackDelayMs = Date.now() - startTime;
        break;
      }
      await setTimeout(10);
    }

    // Inspect cards while held
    const heldCards = await getVisibleCardIds(page);
    cardsPreservedWhileHeld =
      heldCards.length === initialCardIds.length &&
      heldCards.every((id, idx) => id === initialCardIds[idx]);

    // Release gate
    if (gateRelease) {
      gateRelease();
      gatePromise = null;
      gateRelease = null;
    }

    // Wait for URL and reconciliation
    await page.waitForURL(/sort=furthest/, { timeout: 5000 });
    const finalCardIds = await getVisibleCardIds(page);
    const totalTimeMs = Date.now() - startTime;

    measurements.push({
      mode,
      profile: prof.name,
      feedbackDelayMs,
      prefetchAndInitialRequestCount,
      sortTriggeredRequestCount: rscCount,
      rscRequestCount: rscCount,
      rscPayloadBytes: rscBytes,
      totalTimeMs,
      initialCardIds,
      finalCardIds,
      cardsPreservedWhileHeld,
      finalUrl: page.url(),
    });

    await context.tracing.stop({ path: tracePath });
    await context.close();
  }

  await browser.close();
  next.kill();
  api.close();

  return measurements;
}

const targetMode = (process.argv[2] as 'baseline' | 'candidate') || 'baseline';
runBenchmark(targetMode)
  .then((res) => {
    console.log(JSON.stringify(res, null, 2));
    writeFileSync(
      path.join(ROOT_DIR, 'outputs', `benchmark-${targetMode}.json`),
      JSON.stringify(res, null, 2),
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
