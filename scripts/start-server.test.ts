import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPort, startServer } from '../src/server.js';

await test('startup accepts only a valid configured port', () => {
  assert.equal(readPort(undefined), 8080);
  assert.equal(readPort('8092'), 8092);
  assert.equal(readPort('65535'), 65535);
  for (const value of [
    '',
    '0',
    '-1',
    '1.5',
    '65536',
    'abc',
    ' 8081',
    '08081',
  ]) {
    assert.throws(() => readPort(value), /PORT must be/);
  }
});

await test('Fastify serves public health over a real local socket and closes', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  const response = await fetch(`${app.listeningOrigin}/health`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"status":"ok"}');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(app.server.listening, true);
  await app.close();
  assert.equal(app.server.listening, false);
});

await test('an occupied port fails instead of silently choosing another', async (t) => {
  const app = await startServer(0);
  t.after(() => app.close());
  const address = app.server.address();
  assert(address && typeof address !== 'string');
  await assert.rejects(startServer(address.port), { code: 'EADDRINUSE' });
  assert.equal(app.server.listening, true);
});
