import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const token = 'fictional-ingest-credential-for-tests-only';

await test('ingestion rejects weak configuration without exposing its value', () => {
  assert.throws(
    () => buildApp(undefined, { AUTH_ENABLED: 'false', INGEST_TOKEN: 'weak' }),
    /^Error: INGEST_TOKEN must contain/,
  );
});

await test('ingestion accepts a mounted credential and rejects unreadable or conflicting sources', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aptus-ingest-fixture-'));
  t.after(() => rmSync(directory, { recursive: true }));
  const path = join(directory, 'credential');
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  const app = buildApp(undefined, {
    AUTH_ENABLED: 'false',
    INGEST_TOKEN_FILE: path,
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/internal/ingest',
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  assert.equal(response.statusCode, 400);
  assert.throws(
    () => buildApp(undefined, { INGEST_TOKEN_FILE: `${path}-missing` }),
    /^Error: Could not load the ingestion credential file\./,
  );
  assert.throws(
    () => buildApp(undefined, { INGEST_TOKEN_FILE: path, INGEST_TOKEN: token }),
    /^Error: Configure only one ingestion credential source\./,
  );
});

await test('ingestion stays disabled when no credential is configured', async (t) => {
  const app = buildApp(undefined, { AUTH_ENABLED: 'false' });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/internal/ingest',
    payload: {},
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['cache-control'], 'no-store');
  const empty = buildApp(undefined, {
    AUTH_ENABLED: 'false',
    INGEST_TOKEN: '',
  });
  t.after(() => empty.close());
  assert.equal(
    (
      await empty.inject({
        method: 'POST',
        url: '/api/internal/ingest',
        payload: {},
      })
    ).statusCode,
    503,
  );
});

await test('ingestion rejects missing and incorrect credentials before parsing', async (t) => {
  const app = buildApp(undefined, {
    AUTH_ENABLED: 'false',
    INGEST_TOKEN: token,
  });
  t.after(() => app.close());
  for (const authorization of [
    undefined,
    'Bearer wrong',
    `Basic ${token}`,
    `Bearer ${token}x`,
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/internal/ingest',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
      },
      payload: '{',
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(!response.body.includes(token));
  }
});

await test('authorized ingestion still validates its payload and health stays public', async (t) => {
  const app = buildApp(undefined, {
    AUTH_ENABLED: 'false',
    INGEST_TOKEN: token,
  });
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST',
    url: '/api/internal/ingest',
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /source_url and source_name/);
  assert.equal((await app.inject('/health')).statusCode, 200);
});
