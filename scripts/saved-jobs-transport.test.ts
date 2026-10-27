import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import Fastify from 'fastify';
import { saveJobApi, unsaveJobApi } from '../frontend/saved-jobs-api.js';

test('save and remove survive a proxy that forwards a chunked request body', async () => {
  const app = Fastify();
  let saved = false;
  app.put('/api/saved-jobs/job', async () => ({
    saved: (saved = true),
    savedAt: '2026-10-27T00:00:00.000Z',
  }));
  app.delete('/api/saved-jobs/job', async () => ({ saved: (saved = false) }));
  await app.listen({ host: '127.0.0.1', port: 0 });
  const upstream = app.server.address();
  assert(upstream && typeof upstream === 'object');
  // Match a streaming reverse proxy that removes content-length and uses chunked framing.
  const proxy = createServer((req, res) => {
    const headers = { ...req.headers };
    delete headers['content-length'];
    headers['transfer-encoding'] = 'chunked';
    const forwarded = request(
      {
        host: '127.0.0.1',
        port: upstream.port,
        path: req.url,
        method: req.method,
        headers,
      },
      (response) => {
        res.writeHead(response.statusCode!, response.headers);
        response.pipe(res);
      },
    );
    forwarded.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(forwarded);
  });
  const realFetch = globalThis.fetch;
  try {
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    const address = proxy.address();
    assert(address && typeof address === 'object');
    globalThis.fetch = (input, options) =>
      realFetch(
        new URL(String(input), `http://127.0.0.1:${address.port}`),
        options,
      );
    assert.equal(await saveJobApi('job'), true);
    assert.equal(saved, true);
    assert.equal(await unsaveJobApi('job'), false);
    assert.equal(saved, false);
  } finally {
    globalThis.fetch = realFetch;
    proxy.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      proxy.close((error) => (error ? reject(error) : resolve())),
    );
    await app.close();
  }
});
