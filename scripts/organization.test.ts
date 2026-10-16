import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../src/db.js';
import { handleIngest } from '../src/routes/ingest.js';
import { registerPublicRoutes } from '../src/routes/public.js';

await test('organization crosses ingestion and public API without source fallback', async (t) => {
  const app = Fastify();
  app.post('/api/internal/ingest', handleIngest);
  registerPublicRoutes(app);
  const source = { id: 'fixture-source', name: 'Example Jobs Portal' };
  let rows: Record<string, unknown>[] = [];
  let reads = 0;
  let search: unknown;
  let selection: unknown;
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
  replace(prisma.source, 'findUnique', () => {
    reads++;
    return Promise.resolve(null);
  });
  replace(prisma.source, 'upsert', () => Promise.resolve(source));
  replace(prisma.post, 'deleteMany', () => {
    rows = [];
    return Promise.resolve();
  });
  replace(
    prisma.post,
    'createMany',
    ({ data }: { data: Record<string, unknown>[] }) => {
      rows = data.map((row, index) => ({
        id: `fixture-${index}`,
        ...row,
        source,
      }));
      return Promise.resolve();
    },
  );
  replace(prisma.post, 'findUnique', ({ select }: { select: unknown }) => {
    selection = select;
    return Promise.resolve(rows[0]);
  });
  replace(prisma, '$transaction', async (run: unknown) => {
    if (Array.isArray(run)) return Promise.all(run);
    assert(typeof run === 'function');
    const result: unknown = Reflect.apply(run, undefined, [
      {
        post: {
          count: ({ where }: { where: unknown }) => {
            search = where;
            return Promise.resolve(rows.length);
          },
          findMany: ({ select }: { select: unknown }) => {
            selection = select;
            return Promise.resolve(rows);
          },
        },
      },
    ]);
    return result;
  });
  t.after(async () => {
    patches.reverse().forEach((restore) => restore());
    await app.close();
  });
  const post = {
    post_name: 'Assistant',
    min_age: null,
    max_age: null,
    min_marks_percent: null,
    category_relaxation_rules: null,
  };
  const payload = {
    source_url: 'https://example.org/notice',
    source_name: source.name,
    source_text: 'Example Research Council invites applications for Assistant.',
    posts: [post],
  };

  for (const value of [true, 12, {}, 'x'.repeat(201), 'bad\u0000name']) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/internal/ingest',
      payload: { ...payload, posts: [{ ...post, recruiting_body: value }] },
    });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(reads, 0);
  for (const name of [
    'Example Research Council',
    null,
    undefined,
    '   ',
    'Invented Recruiter',
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/internal/ingest',
      payload: { ...payload, posts: [{ ...post, recruiting_body: name }] },
    });
    assert.equal(response.statusCode, 200);
    const expected = name === 'Example Research Council' ? name : null;
    assert.equal(rows[0].organization, expected);
    const detail = await app.inject('/api/jobs/fixture-0');
    assert.equal(
      detail.json<{ organization: string | null }>().organization,
      expected,
    );
    assert.equal(
      detail.json<{ source: { name: string } }>().source.name,
      source.name,
    );
    const list = await app.inject('/api/jobs?q=Research');
    assert.equal(list.statusCode, 200);
    assert.equal(
      list.json<{ data: Array<{ organization: string | null }> }>().data[0]
        .organization,
      expected,
    );
    assert.equal(Reflect.get(Object(selection), 'organization'), true);
    assert.deepEqual(search, {
      AND: [
        {
          OR: [
            { postName: { contains: 'Research', mode: 'insensitive' } },
            {
              educationRequired: { contains: 'Research', mode: 'insensitive' },
            },
            { organization: { contains: 'Research', mode: 'insensitive' } },
          ],
        },
      ],
    });
  }
});
