import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { chromium, expect } from 'playwright/test';

const chromePath =
  process.env.APTUS_TEST_BROWSER ??
  (existsSync(chromium.executablePath())
    ? chromium.executablePath()
    : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

const fixtureJobs = [
  {
    id: 'post-full',
    postName:
      'Inspector (Central Excise) with Very Long Title Explaining Special Operational Requirements in Customs and Indirect Taxes Department',
    organization: 'Central Board of Indirect Taxes and Customs',
    appointmentType: 'Direct Recruitment',
    educationRequired: 'Bachelor Degree in Science or Commerce',
    applicationLastDate: '2026-11-20T00:00:00.000Z',
    vacancies: 1240,
    payLevel: 'Level 7',
    source: { name: 'Staff Selection Commission' },
  },
  {
    id: 'post-missing',
    postName:
      'Special Officer Grade II with Super Long Multi-Line Requirements Description Without Organization Stated',
    organization: null,
    appointmentType: null,
    educationRequired: 'Not specified',
    applicationLastDate: null,
    vacancies: null,
    payLevel: null,
    source: { name: 'General Administration' },
  },
];

test('Mobile discovery: compact layouts, accessible filters, truth in fields, and touch targets', async (t) => {
  const savedJobsSet = new Set<string>();

  const api = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/api/auth/get-session') {
      res.setHeader('Content-Type', 'application/json');
      const isAuth = req.headers.cookie?.includes('aptus-test-session=authed');
      if (isAuth) {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            user: { id: 'test-user-1', name: 'Verified Candidate' },
          }),
        );
      } else {
        res.statusCode = 401;
        res.end(JSON.stringify({ user: null, enabled: false }));
      }
      return;
    }

    if (url.pathname === '/api/saved-jobs/status') {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ savedIds: Array.from(savedJobsSet) }));
      return;
    }

    if (url.pathname.startsWith('/api/saved-jobs/')) {
      const jobId = decodeURIComponent(
        url.pathname.replace('/api/saved-jobs/', ''),
      );
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'PUT') {
        savedJobsSet.add(jobId);
        res.statusCode = 200;
        res.end(JSON.stringify({ saved: true }));
      } else if (req.method === 'DELETE') {
        savedJobsSet.delete(jobId);
        res.statusCode = 200;
        res.end(JSON.stringify({ saved: false }));
      }
      return;
    }

    if (url.pathname === '/api/jobs') {
      const q = url.searchParams.get('q');
      const qual = url.searchParams.get('qualification');
      let filtered = [...fixtureJobs];
      if (q === 'no-results') {
        filtered = [];
      } else if (qual === 'BACHELORS') {
        filtered = fixtureJobs.filter((j) => j.id === 'post-full');
      }
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          data: filtered,
          pagination: {
            page: 1,
            pageSize: 6,
            totalItems: filtered.length,
            totalPages: 1,
          },
        }),
      );
      return;
    }

    if (url.pathname.startsWith('/api/jobs/')) {
      const id = url.pathname.replace('/api/jobs/', '');
      const found = fixtureJobs.find((j) => j.id === id) || fixtureJobs[0];
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify(found));
      return;
    }

    res.statusCode = 404;
    res.end('Not found');
  });

  // Match the API rewrite embedded by the local test build; fail if occupied.
  api.listen(Number(process.env.APTUS_FIXTURE_API_PORT ?? 8081), '127.0.0.1');
  await once(api, 'listening');
  const address = api.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing fixture address');
  const apiOrigin = `http://127.0.0.1:${address.port}`;
  t.after(() => new Promise((resolve) => api.close(resolve)));

  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const nextAddress = reservation.address();
  if (!nextAddress || typeof nextAddress === 'string')
    throw new Error('Missing Next address');
  const nextPort = nextAddress.port;
  await new Promise((done) => reservation.close(done));
  const nextProcess = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', String(nextPort)],
    {
      cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      env: {
        ...process.env,
        PORT: String(nextPort),
        HOSTNAME: '127.0.0.1',
        BACKEND_INTERNAL_URL: apiOrigin,
        NODE_ENV: 'production',
      },
      stdio: 'ignore',
    },
  );
  t.after(() => nextProcess.kill());

  const origin = `http://127.0.0.1:${nextPort}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(origin, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
    await setTimeout(100);
  }
  assert(ready, 'Next server must be ready');

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(() => browser.close());

  await t.test(
    '360px, 390px, 430px, tablet and desktop viewports render with zero horizontal overflow',
    async () => {
      const page = await browser.newPage();
      try {
        for (const width of [360, 390, 430, 834, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(origin, { waitUntil: 'networkidle' });

          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth,
          );
          assert.equal(
            overflow,
            false,
            `Viewport ${width}px must not horizontally overflow`,
          );

          // Check cards count
          await expect(page.locator('[data-job-card]')).toHaveCount(2);

          // Check touch target heights on mobile
          if (width < 760) {
            const targets = await page.evaluate(() => {
              const elements = [
                ...document.querySelectorAll('input:not([type="hidden"])'),
                ...document.querySelectorAll('select'),
                ...document.querySelectorAll('button'),
                ...document.querySelectorAll('.primary-navigation a'),
              ];
              return elements
                .map((el) => {
                  const r = el.getBoundingClientRect();
                  return { tag: el.tagName, height: r.height, width: r.width };
                })
                .filter((t) => t.height > 0 && t.width > 0);
            });
            for (const t of targets) {
              assert(
                t.height >= 44,
                `Element ${t.tag} touch target height ${t.height}px must be >= 44px`,
              );
            }
          }
        }
      } finally {
        await page.close();
      }
    },
  );

  await t.test(
    'displays verified organization and appointment data, while unknown fields stay Not specified',
    async () => {
      const page = await browser.newPage();
      try {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(origin, { waitUntil: 'networkidle' });

        const card1 = page.locator('[data-job-card]').first();
        await expect(card1.locator('[data-job-org]')).toContainText(
          'Central Board of Indirect Taxes and Customs',
        );
        await expect(card1.locator('[data-job-appointment]')).toContainText(
          'Direct Recruitment',
        );
        await expect(card1.locator('[data-job-deadline]')).toContainText(
          'Apply by 20 Nov 2026',
        );

        const card2 = page.locator('[data-job-card]').nth(1);
        await expect(card2.locator('[data-job-org]')).toContainText(
          'Not specified',
        );
        await expect(card2.locator('[data-job-appointment]')).toContainText(
          'Not specified',
        );
        await expect(card2.locator('[data-job-deadline]')).toContainText(
          'Deadline not specified',
        );
      } finally {
        await page.close();
      }
    },
  );

  await t.test(
    'collapsible secondary filter toggles accessibly with active count and keyboard',
    async () => {
      const page = await browser.newPage();
      try {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(origin, { waitUntil: 'networkidle' });

        const toggle = page.getByRole('button', { name: /Filters/i });
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');

        // Expand via keyboard Enter
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');

        const qualSelect = page.getByRole('combobox', {
          name: 'Qualification',
        });
        await expect(qualSelect).toBeVisible();

        // Select qualification
        await qualSelect.selectOption('BACHELORS');
        await expect(page).toHaveURL(/qualification=BACHELORS/);

        // After navigation with active qualification, filter count is 1 and expanded
        const toggleAfter = page.getByRole('button', { name: /Filters/i });
        await expect(toggleAfter).toContainText('Filters (1)');
        await expect(page.locator('[data-job-card]')).toHaveCount(1);
        await toggleAfter.click();
        await expect(toggleAfter).toHaveAttribute('aria-expanded', 'false');
        await expect(qualSelect).toBeHidden();
      } finally {
        await page.close();
      }
    },
  );

  await t.test(
    'guest user sees Sign in link on save button, authenticated user can save and remove',
    async () => {
      const guestPage = await browser.newPage();
      try {
        await guestPage.setViewportSize({ width: 390, height: 844 });
        await guestPage.goto(origin, { waitUntil: 'networkidle' });

        // Guest: clicking Save navigates to sign-in
        const saveLink = guestPage
          .locator('[data-job-card]')
          .first()
          .getByRole('link', { name: 'Save', exact: true });
        await expect(saveLink).toHaveAttribute('href', '/sign-in');
      } finally {
        await guestPage.close();
      }

      // Authenticated context
      const authedContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
        extraHTTPHeaders: { cookie: 'aptus-test-session=authed' },
      });
      const authedPage = await authedContext.newPage();
      try {
        await authedPage.goto(origin, { waitUntil: 'networkidle' });

        const saveBtn = authedPage
          .locator('[data-job-card]')
          .first()
          .getByRole('button', { name: 'Save job' });
        await expect(saveBtn).toBeVisible();

        // Click save
        await saveBtn.click();
        await expect(
          authedPage
            .locator('[data-job-card]')
            .first()
            .getByRole('button', { name: 'Remove from saved' }),
        ).toBeVisible();
        assert(savedJobsSet.has('post-full'), 'Job must be in saved set');

        // Click remove
        const removeBtn = authedPage
          .locator('[data-job-card]')
          .first()
          .getByRole('button', { name: 'Remove from saved' });
        await removeBtn.click();
        await expect(
          authedPage
            .locator('[data-job-card]')
            .first()
            .getByRole('button', { name: 'Save job' }),
        ).toBeVisible();
        assert(
          !savedJobsSet.has('post-full'),
          'Job must be removed from saved set',
        );
      } finally {
        await authedContext.close();
      }
    },
  );

  await t.test(
    'refresh persistence and back navigation retain search and filter parameters',
    async () => {
      const page = await browser.newPage();
      try {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${origin}/?q=Inspector&qualification=BACHELORS`, {
          waitUntil: 'networkidle',
        });

        await expect(
          page.getByRole('searchbox', { name: 'Search all jobs' }),
        ).toHaveValue('Inspector');
        await expect(page.locator('[data-job-card]')).toHaveCount(1);

        // Refresh
        await page.reload({ waitUntil: 'networkidle' });
        await expect(
          page.getByRole('searchbox', { name: 'Search all jobs' }),
        ).toHaveValue('Inspector');
        await expect(page.locator('[data-job-card]')).toHaveCount(1);

        // Navigate to detail
        await page
          .locator('[data-job-card]')
          .first()
          .getByRole('link', { name: 'View details' })
          .click();
        await expect(page).toHaveURL(/jobs\/post-full/);

        // Back navigation
        await page.goBack({ waitUntil: 'networkidle' });
        await expect(page).toHaveURL(/q=Inspector/);
        await expect(
          page.getByRole('searchbox', { name: 'Search all jobs' }),
        ).toHaveValue('Inspector');
        await expect(page.locator('[data-job-card]')).toHaveCount(1);
      } finally {
        await page.close();
      }
    },
  );

  await t.test('qualification remains usable without JavaScript', async () => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    try {
      const page = await context.newPage();
      await page.goto(origin);
      const select = page.locator('select[name="qualification"]');
      await expect(select).toBeVisible();
      await select.selectOption('BACHELORS');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page).toHaveURL(/qualification=BACHELORS/);
    } finally {
      await context.close();
    }
  });

  await t.test(
    'empty results state provides clear message and reset action',
    async () => {
      const page = await browser.newPage();
      try {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${origin}/?q=no-results`, {
          waitUntil: 'networkidle',
        });

        await expect(page.locator('[data-job-card]')).toHaveCount(0);
        await expect(
          page.getByRole('heading', { name: 'No jobs match your search' }),
        ).toBeVisible();
        await expect(
          page.getByRole('link', { name: 'Clear search and filter' }).first(),
        ).toBeVisible();
      } finally {
        await page.close();
      }
    },
  );
});
