import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const token = 'fictional-ingest-credential-for-tests-only';

await test('ingestion rejects malformed rules before accessing the database', async (t) => {
  const server = buildApp(undefined, {
    AUTH_ENABLED: 'false',
    INGEST_TOKEN: token,
  });
  t.after(() => server.close());
  for (const post of [
    null,
    { post_name: 'Example', eligibility_rules: 'invalid shape' },
    { post_name: 'Example', eligibility_rules: { age_rules: [] } },
  ]) {
    const result = await server.inject({
      method: 'POST',
      url: '/api/internal/ingest',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        source_url: 'https://example.invalid/notice',
        source_name: 'Fixture',
        posts: [post],
      },
    });
    const response = {
      status: result.statusCode,
      body: result.json<{ error: string }>(),
    };
    assert.equal(response.status, 400);
    assert.match(response.body.error, /posts\[0\]/);
  }
});

await test('ingestion rejects malformed post_name types without writes', async (t) => {
  const server = buildApp(undefined, {
    AUTH_ENABLED: 'false',
    INGEST_TOKEN: token,
  });
  t.after(() => server.close());

  let writeCalls = 0;
  let readCalls = 0;
  const patches: Array<() => void> = [];
  function replace(target: object, key: string, value: unknown) {
    const original: unknown = Reflect.get(target, key);
    Object.defineProperty(target, key, { configurable: true, value });
    patches.push(() =>
      Object.defineProperty(target, key, {
        configurable: true,
        value: original,
      }),
    );
  }
  replace(prisma.source, 'findUnique', async () => {
    readCalls++;
    return null;
  });
  replace(prisma.source, 'upsert', async () => {
    writeCalls++;
    return { id: 'source-id' };
  });
  replace(prisma.post, 'deleteMany', async () => {
    writeCalls++;
    return { count: 0 };
  });
  replace(prisma.post, 'createMany', async () => {
    writeCalls++;
    return { count: 0 };
  });
  replace(prisma, '$transaction', async () => {
    writeCalls++;
    return [];
  });
  t.after(() => patches.reverse().forEach((r) => r()));

  for (const post_name of [123, true, {}, ['Engineer']]) {
    const result = await server.inject({
      method: 'POST',
      url: '/api/internal/ingest',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        source_url: 'https://example.invalid/notice',
        source_name: 'Fixture',
        posts: [{ post_name }],
      },
    });
    const response = {
      status: result.statusCode,
      body: result.json<{ error: string }>(),
    };
    assert.equal(
      response.status,
      400,
      `Expected 400 for malformed post_name type, got ${response.status}`,
    );
    assert.match(
      response.body.error,
      /posts\[0\]\.post_name must be a string or null/i,
    );
  }

  assert.equal(
    writeCalls,
    0,
    'No write calls must occur on malformed post_name',
  );
  assert.equal(readCalls, 0, 'No read calls must occur on malformed post_name');
});

await test('ingestion rejects nonempty batch with zero usable names without writes', async (t) => {
  const server = buildApp(undefined, {
    AUTH_ENABLED: 'false',
    INGEST_TOKEN: token,
  });
  t.after(() => server.close());

  let writeCalls = 0;
  let readCalls = 0;
  const patches: Array<() => void> = [];
  function replace(target: object, key: string, value: unknown) {
    const original: unknown = Reflect.get(target, key);
    Object.defineProperty(target, key, { configurable: true, value });
    patches.push(() =>
      Object.defineProperty(target, key, {
        configurable: true,
        value: original,
      }),
    );
  }
  replace(prisma.source, 'findUnique', async () => {
    readCalls++;
    return null;
  });
  replace(prisma.source, 'upsert', async () => {
    writeCalls++;
    return { id: 'source-id' };
  });
  replace(prisma.post, 'deleteMany', async () => {
    writeCalls++;
    return { count: 0 };
  });
  replace(prisma.post, 'createMany', async () => {
    writeCalls++;
    return { count: 0 };
  });
  replace(prisma, '$transaction', async () => {
    writeCalls++;
    return [];
  });
  t.after(() => patches.reverse().forEach((r) => r()));

  for (const posts of [
    [{ post_name: null }],
    [{ post_name: '' }],
    [{ post_name: '   \t  ' }],
    [{}],
    [{ post_name: null }, { post_name: '   ' }, { post_name: '' }],
  ]) {
    const result = await server.inject({
      method: 'POST',
      url: '/api/internal/ingest',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        source_url: 'https://example.invalid/notice',
        source_name: 'Fixture',
        posts,
      },
    });
    const response = {
      status: result.statusCode,
      body: result.json<{ error: string }>(),
    };
    assert.equal(
      response.status,
      400,
      `Expected 400 for unusable batch, got ${response.status}`,
    );
    assert.match(
      response.body.error,
      /at least one nonblank post_name is required/i,
    );
  }

  assert.equal(writeCalls, 0, 'No write calls must occur on unusable batch');
  assert.equal(readCalls, 0, 'No read calls must occur on unusable batch');
});
