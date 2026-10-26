import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import { chromium } from 'playwright';

const chromePath =
  process.env.APTUS_TEST_BROWSER ??
  (existsSync(chromium.executablePath())
    ? chromium.executablePath()
    : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

const fixtureJobs = [
  {
    id: 'ssc-cgl-inspector',
    postName: 'Inspector (Central Excise) in Central Board of Indirect Taxes & Customs',
    organization: 'Central Board of Indirect Taxes and Customs',
    educationRequired: 'Bachelor Degree in any discipline from a recognized University',
    applicationLastDate: '2026-11-20T00:00:00.000Z',
    vacancies: 1240,
    payLevel: 'Pay Level-7 (Rs 44,900 to 1,42,400)',
    source: {
      name: 'Staff Selection Commission (SSC CGL)',
      url: 'https://ssc.gov.in',
      fetchedAt: '2026-10-25T10:00:00.000Z',
    },
  },
  {
    id: 'rpsc-assistant-prof',
    postName: 'Assistant Professor (Mathematics) in Department of College Education',
    organization: 'Department of College Education, Rajasthan',
    educationRequired: 'Master Degree in Mathematics with 55% marks and NET/SLET qualified',
    applicationLastDate: '2026-11-05T00:00:00.000Z',
    vacancies: 48,
    payLevel: 'Academic Level 10 (AGP 6000)',
    source: {
      name: 'Rajasthan Public Service Commission (RPSC)',
      url: 'https://rpsc.rajasthan.gov.in',
      fetchedAt: '2026-10-25T10:00:00.000Z',
    },
  },
  {
    id: 'unknown-org-job',
    postName: 'Research Officer (Planning) with Extended Long Title Requirements and Multi-Line Description Text',
    organization: null,
    educationRequired: 'Post Graduate Degree in Economics or Statistics',
    applicationLastDate: null,
    vacancies: null,
    payLevel: null,
    source: {
      name: 'Planning Department',
      url: 'https://example.gov.in',
      fetchedAt: '2026-10-25T10:00:00.000Z',
    },
  },
];

const api = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/auth/get-session') {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 401;
    res.end(JSON.stringify({ user: null, enabled: false }));
    return;
  }
  if (url.pathname === '/api/jobs') {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({
      data: fixtureJobs,
      pagination: { page: 1, pageSize: 6, totalItems: 3, totalPages: 1 }
    }));
    return;
  }
  res.statusCode = 404;
  res.end('Not found');
});

api.listen(8081, '127.0.0.1');
await once(api, 'listening');

const nextPort = 19125;
const nextProcess = spawn(
  process.execPath,
  ['.next/standalone/server.js'],
  {
    cwd: '/Users/mrblackghost/Work/Projects/aptus-frontend-discovery',
    env: {
      ...process.env,
      PORT: String(nextPort),
      HOSTNAME: '127.0.0.1',
      BACKEND_INTERNAL_URL: 'http://127.0.0.1:8081',
      NODE_ENV: 'production',
    },
    stdio: 'pipe',
  }
);

const nextUrl = `http://127.0.0.1:${nextPort}`;
let ready = false;
for (let i = 0; i < 50; i++) {
  try {
    const res = await fetch(nextUrl, { signal: AbortSignal.timeout(1000) });
    if (res.ok) { ready = true; break; }
  } catch {}
  await setTimeout(100);
}
if (!ready) { process.exit(1); }

mkdirSync('docs/screenshots', { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const prefix = process.argv[2] || 'before';

try {
  const viewports = [
    { name: 'mobile-360', width: 360, height: 740 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-430', width: 430, height: 932 },
    { name: 'tablet-834', width: 834, height: 1112 },
    { name: 'desktop-1440', width: 1440, height: 900 },
  ];

  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    await page.goto(nextUrl, { waitUntil: 'networkidle' });
    
    // Measure first-job position
    const firstJob = page.locator('[data-job-card]').first();
    const box = await firstJob.boundingBox();
    console.log(`[${prefix}] ${vp.name}: First job top = ${box?.y.toFixed(1)}px (viewport height = ${vp.height}px) -> ${box && box.y < vp.height ? 'VISIBLE ABOVE FOLD' : 'BELOW FOLD'}`);

    await page.screenshot({ path: `docs/screenshots/${prefix}-${vp.name}.png`, fullPage: false });
    await context.close();
  }
} finally {
  await browser.close();
  nextProcess.kill();
  api.close();
}
