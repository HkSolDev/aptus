import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';

const STANDALONE_DIR = path.resolve(
  import.meta.dirname,
  '../.next/standalone',
);
const INGEST_TOKEN = 'test-ingest-token-1234567890abcdef1234567890';

interface FixtureJob {
  id: string;
  postName: string;
  source: { name: string };
  vacancies: number;
  payLevel: string;
  applicationLastDate: string | null;
  educationRequired: string | null;
  publishedAt?: string;
}

function makeJob(id: string, postName: string): FixtureJob {
  return {
    id,
    postName,
    source: { name: 'Staff Selection Commission' },
    vacancies: 5,
    payLevel: 'Level 5',
    applicationLastDate: '2026-12-31',
    educationRequired: 'Diploma',
  };
}

class BackendController {
  public server: http.Server;
  public port = 0;
  public jobsCalls = 0;
  public recordedQueries: string[] = [];
  public mode: 'ok' | 'fail' = 'ok';
  public currentVersion = 'v1';

  constructor() {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/api/jobs') {
        this.jobsCalls++;
        this.recordedQueries.push(url.search);

        if (this.mode === 'fail') {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Service Unavailable' }));
          return;
        }

        const sort = url.searchParams.get('sort') ?? 'newest';
        const page = Number(url.searchParams.get('page') ?? '1');
        const q = url.searchParams.get('q') ?? '';

        const jobs = [
          makeJob(
            `job-${this.currentVersion}-${sort}-p${page}${q ? `-${q}` : ''}`,
            `Technical Assistant ${this.currentVersion} ${sort} Page ${page}${q ? ` (${q})` : ''}`,
          ),
        ];

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: jobs,
            pagination: { page, pageSize: 6, totalItems: 12, totalPages: 2 },
          }),
        );
        return;
      }

      res.writeHead(404).end();
    });
  }

  async listen(): Promise<number> {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const addr = this.server.address();
    assert(addr && typeof addr !== 'string');
    this.port = addr.port;
    return this.port;
  }

  async close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

async function startStandaloneServer(envOverrides: Record<string, string> = {}) {
  // Find a free port
  const tmpSrv = http.createServer();
  tmpSrv.listen(0, '127.0.0.1');
  await once(tmpSrv, 'listening');
  const port = (tmpSrv.address() as { port: number }).port;
  await new Promise<void>((r) => tmpSrv.close(() => r()));

  const serverProc: ChildProcess = spawn(
    process.execPath,
    ['server.js'],
    {
      cwd: STANDALONE_DIR,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        INGEST_TOKEN,
        ...envOverrides,
      },
      stdio: 'pipe',
    },
  );

  let output = '';
  serverProc.stdout?.on('data', (d) => {
    output += String(d);
  });
  serverProc.stderr?.on('data', (d) => {
    output += String(d);
  });

  // Wait for server ready
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${origin}/how-it-works`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // wait
    }
    await setTimeout(100);
  }

  if (!ready) {
    serverProc.kill();
    throw new Error(`Standalone server failed to start on ${origin}. Output:\n${output}`);
  }

  return {
    origin,
    port,
    proc: serverProc,
    async stop() {
      serverProc.kill();
      await new Promise<void>((r) => {
        if (serverProc.exitCode !== null) return r();
        serverProc.once('exit', () => r());
      });
    },
  };
}

test('production standalone execution path cache regression', async (t) => {
  const backend = new BackendController();
  await backend.listen();
  t.after(() => backend.close());

  // 1. Start standalone server with default 2-hour cache (no APTUS_JOBS_CACHE_SECONDS override)
  const standalone = await startStandaloneServer({
    BACKEND_INTERNAL_URL: `http://127.0.0.1:${backend.port}`,
  });
  t.after(() => standalone.stop());

  await t.test(
    'two identical sequential Home requests cause exactly one backend call',
    async () => {
      backend.jobsCalls = 0;
      backend.recordedQueries = [];
      backend.currentVersion = 'v1';

      // Request 1: GET /?sort=soonest
      const res1 = await fetch(`${standalone.origin}/?sort=soonest`);
      assert.equal(res1.status, 200);
      const text1 = await res1.text();
      assert.ok(text1.includes('Technical Assistant v1 soonest Page 1'));
      assert.equal(backend.jobsCalls, 1, 'First request must query backend');

      // Request 2: GET /?sort=soonest
      const res2 = await fetch(`${standalone.origin}/?sort=soonest`);
      assert.equal(res2.status, 200);
      const text2 = await res2.text();
      assert.ok(text2.includes('Technical Assistant v1 soonest Page 1'));
      assert.equal(backend.jobsCalls, 1, 'Second identical request must be served from cache');
    },
  );

  await t.test(
    'a different sort/filter/page receives the correct distinct result',
    async () => {
      backend.jobsCalls = 0;

      // Different sort: furthest
      const resFurthest = await fetch(`${standalone.origin}/?sort=furthest`);
      assert.equal(resFurthest.status, 200);
      const textFurthest = await resFurthest.text();
      assert.ok(textFurthest.includes('Technical Assistant v1 furthest Page 1'));
      assert.equal(backend.jobsCalls, 1, 'Different sort must query backend');

      // Different page: page 2
      const resPage2 = await fetch(`${standalone.origin}/?sort=soonest&page=2`);
      assert.equal(resPage2.status, 200);
      const textPage2 = await resPage2.text();
      assert.ok(textPage2.includes('Technical Assistant v1 soonest Page 2'));
      assert.equal(backend.jobsCalls, 2, 'Different page must query backend');

      // Different query: q=Assistant
      const resFilter = await fetch(`${standalone.origin}/?sort=soonest&q=Assistant`);
      assert.equal(resFilter.status, 200);
      const textFilter = await resFilter.text();
      assert.ok(textFilter.includes('Technical Assistant v1 soonest Page 1 (Assistant)'));
      assert.equal(backend.jobsCalls, 3, 'Different query filter must query backend');
    },
  );

  await t.test(
    'publication invalidation makes changed data visible before expiry',
    async () => {
      backend.jobsCalls = 0;
      backend.currentVersion = 'v2';

      // Before invalidation, /?sort=soonest still returns cached v1
      const cachedRes = await fetch(`${standalone.origin}/?sort=soonest`);
      const cachedText = await cachedRes.text();
      assert.ok(cachedText.includes('Technical Assistant v1 soonest Page 1'));
      assert.equal(backend.jobsCalls, 0, 'Must still serve cached v1 before invalidation');

      // Publish notification: POST /api/revalidate-jobs
      const revalRes = await fetch(`${standalone.origin}/api/revalidate-jobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${INGEST_TOKEN}`,
        },
      });
      assert.equal(revalRes.status, 200);
      const revalJson = (await revalRes.json()) as { revalidated: string; warmed: Record<string, boolean> };
      assert.equal(revalJson.revalidated, 'jobs');
      assert.equal(revalJson.warmed.soonest, true);

      // Now GET /?sort=soonest immediately reflects the new v2 data
      const freshRes = await fetch(`${standalone.origin}/?sort=soonest`);
      assert.equal(freshRes.status, 200);
      const freshText = await freshRes.text();
      assert.ok(freshText.includes('Technical Assistant v2 soonest Page 1'));
    },
  );

  // 2. Short-interval server to test expiry, stale-on-failure, and recovery
  const shortTtlServer = await startStandaloneServer({
    BACKEND_INTERNAL_URL: `http://127.0.0.1:${backend.port}`,
    APTUS_JOBS_CACHE_SECONDS: '1',
  });
  t.after(() => shortTtlServer.stop());

  await t.test(
    'expiry triggers a fresh backend read with short configurable interval',
    async () => {
      backend.jobsCalls = 0;
      backend.currentVersion = 'v3';

      // Populate cache
      const res1 = await fetch(`${shortTtlServer.origin}/?sort=soonest`);
      assert.equal(res1.status, 200);
      assert.ok((await res1.text()).includes('Technical Assistant v3 soonest Page 1'));
      assert.equal(backend.jobsCalls, 1);

      // Within 1s, cached
      const resFast = await fetch(`${shortTtlServer.origin}/?sort=soonest`);
      assert.equal(resFast.status, 200);
      assert.equal(backend.jobsCalls, 1, 'Within 1s interval must not call backend');

      // Wait for 1s TTL to expire
      await setTimeout(1100);

      // Expiry triggers a fresh backend read
      backend.currentVersion = 'v4';
      const resExpired = await fetch(`${shortTtlServer.origin}/?sort=soonest`);
      assert.equal(resExpired.status, 200);
      const textExpired = await resExpired.text();
      assert.ok(textExpired.includes('Technical Assistant v4 soonest Page 1'));
      assert.equal(backend.jobsCalls, 2, 'Expired read must trigger fresh backend read');
    },
  );

  await t.test(
    'after expiry, backend failure returns saved jobs with freshness warning, and recovery removes warning',
    async () => {
      // Step A: Wait for 1s TTL to expire
      await setTimeout(1100);

      // Simulate backend failure (503)
      backend.mode = 'fail';

      // Read after expiry during outage -> returns saved jobs with freshnessUnconfirmed notice
      const staleRes = await fetch(`${shortTtlServer.origin}/?sort=soonest`);
      assert.equal(staleRes.status, 200);
      const staleText = await staleRes.text();
      assert.ok(
        staleText.includes('Technical Assistant v4 soonest Page 1'),
        'Saved jobs must still be returned',
      );
      assert.ok(
        staleText.includes('Showing the last confirmed results'),
        'Freshness warning notice must be displayed',
      );

      // Step B: Backend failure without saved data produces error notice
      const uncachedRes = await fetch(`${shortTtlServer.origin}/?sort=soonest&q=never-cached-query`);
      assert.equal(uncachedRes.status, 200);
      const uncachedText = await uncachedRes.text();
      assert.ok(
        uncachedText.includes('Jobs are temporarily unavailable'),
        'Failure without cached data must render unavailable notice',
      );

      // Step C: Upstream recovers
      backend.mode = 'ok';
      backend.currentVersion = 'v5';

      // Next read refreshes data and removes warning
      const recoveredRes = await fetch(`${shortTtlServer.origin}/?sort=soonest`);
      assert.equal(recoveredRes.status, 200);
      const recoveredText = await recoveredRes.text();
      assert.ok(
        recoveredText.includes('Technical Assistant v5 soonest Page 1'),
        'Fresh recovered data must be displayed',
      );
      assert.ok(
        !recoveredText.includes('Showing the last confirmed results'),
        'Freshness warning notice must be removed',
      );
    },
  );
});
