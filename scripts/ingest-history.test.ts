import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

await test('re-ingestion preserves history and reuses identical facts', async (t) => {
  const token = 'fictional-history-test-token-for-fixtures-only';
  const app = buildApp(undefined, {
    AUTH_ENABLED: 'false',
    INGEST_TOKEN: token,
  });
  const rows: Record<string, unknown>[] = [];
  let locked = false;
  const source = { id: 'fixture-source', rawHash: null };
  const replacements: [object, string, unknown][] = [
    [prisma.source, 'findUnique', () => Promise.resolve(source)],
    [prisma.source, 'upsert', () => Promise.resolve(source)],
    [
      prisma,
      '$transaction',
      async (callback: (...args: unknown[]) => unknown) => {
        locked = false;
        return await callback({
          $queryRaw: () => {
            locked = true;
            return Promise.resolve([]);
          },
          post: {
            findMany: () => {
              assert(locked);
              return Promise.resolve([...rows]);
            },
            create: ({ data }: { data: Record<string, unknown> }) => {
              assert(locked);
              const row = {
                ...data,
                eligibilityRules: null,
                id: `fixture-${rows.length}`,
              };
              rows.push(row);
              return Promise.resolve(row);
            },
            deleteMany: () => {
              assert.fail('ingestion must never delete earlier jobs');
            },
          },
        });
      },
    ],
  ];
  const originals = replacements.map(([target, key]): unknown => {
    const value: unknown = Reflect.get(target, key);
    return value;
  });
  replacements.forEach(([target, key, value]) =>
    Object.defineProperty(target, key, { configurable: true, value }),
  );
  t.after(async () => {
    replacements.forEach(([target, key], index) =>
      Object.defineProperty(target, key, {
        configurable: true,
        value: originals[index],
      }),
    );
    await app.close();
  });
  const post = (name: string, vacancies = 1) => ({
    post_name: name,
    vacancies,
    application_last_date: null,
    age_as_on_date: null,
    min_age: null,
    max_age: null,
    education_required: null,
    post_group: null,
    pay_level: null,
    min_education_level: null,
    min_marks_percent: null,
    category_relaxation_applies: null,
    category_relaxation_rules: {},
    eligibility_rules: undefined,
  });
  const ingest = async (posts: ReturnType<typeof post>[]) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/internal/ingest',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        source_url: 'https://example.invalid/notice',
        source_name: 'Fixture',
        posts,
      },
    });
    assert.equal(response.statusCode, 200);
    return response.json<{ created: number }>().created;
  };
  // Database JSON null is represented as null on readback.
  const normalize = () =>
    rows.forEach((row) => {
      row.eligibilityRules = null;
    });
  assert.equal(
    await ingest(Array.from({ length: 10 }, (_, i) => post(`Post ${i}`))),
    10,
  );
  normalize();
  const oldIds = rows.map((row) => row.id);
  assert.equal(await ingest([post('New post')]), 1);
  normalize();
  assert.equal(rows.length, 11);
  assert.deepEqual(
    rows.slice(0, 10).map((row) => row.id),
    oldIds,
  );
  assert.equal(await ingest([post('New post'), post('New post')]), 0);
  assert.equal(await ingest([post('New post', 2)]), 1);
  normalize();
  assert.equal(rows.length, 12);
  assert.equal(await ingest([]), 0);
  assert.equal(rows.length, 12);
});
