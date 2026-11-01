import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import test from 'node:test';

test(
  'admin queue renders a successful backend response taking over five seconds',
  { timeout: 45000 },
  async (t) => {
    const backend = http.createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.headers.cookie !== 'fixture=operator') {
        response.writeHead(401).end('{}');
        return;
      }
      if (request.url?.endsWith('/operator-status')) {
        response.end(JSON.stringify({ is_operator: true }));
        return;
      }
      await setTimeout(6000);
      response.end(
        JSON.stringify({
          items: [
            {
              id: 'fixture-item',
              bundle_id: 'fixture-bundle',
              title: 'Delayed fixture engineer',
              source_name: 'Example notice',
              source_url: 'https://example.gov.in',
              role_count: 1,
              status: 'held',
              hold_reason: null,
              current_revision: null,
              updated_at: '2026-11-01T00:00:00Z',
            },
          ],
          total_items: 1,
          counts_as_of: '2026-11-01T00:00:00Z',
          next_cursor: null,
        }),
      );
    });
    backend.listen(0, '127.0.0.1');
    await once(backend, 'listening');
    t.after(() => {
      backend.closeAllConnections();
      backend.close();
    });
    const backendPort = (backend.address() as { port: number }).port;
    const reservation = http.createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.resolve(import.meta.dirname, '../.next/standalone'),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
        PORT: String(port),
        BACKEND_INTERNAL_URL: `http://127.0.0.1:${backendPort}`,
      },
      stdio: 'ignore',
    });
    t.after(async () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
    });
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await fetch(`${origin}/how-it-works`)).ok) {
          ready = true;
          break;
        }
      } catch {
        /* Wait for standalone startup. */
      }
      await setTimeout(100);
    }
    assert.ok(ready, 'production server started');
    const response = await fetch(`${origin}/admin/review`, {
      headers: { cookie: 'fixture=operator' },
      signal: AbortSignal.timeout(20000),
    });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Delayed fixture engineer/);
    assert.doesNotMatch(html, /Review queue temporarily unavailable/);
  },
);
