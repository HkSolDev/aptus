import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';
import Fastify from 'fastify';

const connection = process.env.APTUS_SEARCH_TEST_DATABASE_URL;

await test(
  'PostgreSQL public search filters before pagination and orders unknown deadlines last',
  { skip: !connection },
  async (t) => {
    assert(connection);
    const target = new URL(connection);
    assert.equal(target.hostname, '127.0.0.1');
    assert.equal(target.pathname, '/aptus_search_fixture');
    // This test owns an empty disposable database, never the configured app database.
    const pool = new pg.Pool({ connectionString: connection });
    try {
      const migrations = new URL('../prisma/migrations/', import.meta.url);
      for (const directory of (
        await readdir(migrations, { withFileTypes: true })
      )
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))) {
        if (directory.name === '20261016000000_add_recruiting_organization') {
          await pool.query(`INSERT INTO "Source" (id, name, url, "fetchedAt")
            VALUES ('old-source', 'Old fixture portal', 'https://example.org/old', NOW());
            INSERT INTO "Post" (id, "sourceId", "postName")
            VALUES ('old-post', 'old-source', 'Old fixture post')`);
        }
        await pool.query(
          await readFile(
            new URL(`${directory.name}/migration.sql`, migrations),
            'utf8',
          ),
        );
      }
    } finally {
      await pool.end();
    }
    process.env.DATABASE_URL = connection;
    const { prisma } = await import('../src/db.js');
    const { listPublicJobs } = await import('../src/lib/public-jobs.js');
    t.after(() => prisma.$disconnect());
    const old = await prisma.post.findUniqueOrThrow({
      where: { id: 'old-post' },
    });
    assert.equal(old.organization, null);
    assert.equal(old.postName, 'Old fixture post');
    await prisma.post.delete({ where: { id: old.id } });
    await prisma.source.delete({ where: { id: 'old-source' } });
    const source = await prisma.source.create({
      data: {
        name: 'Fixture source',
        url: 'https://example.org/search-fixture',
        rawHash: 'search-fixture',
      },
    });
    for (let i = 0; i < 8; i++) {
      await prisma.post.create({
        data: {
          id: `fixture-${i}`,
          sourceId: source.id,
          postName: `Mechanical Assistant ${i}`,
          minEducationLevel: 'BACHELORS',
          educationRequired: 'Degree OR Diploma in Mechanical Engineering',
          applicationLastDate:
            i === 7
              ? null
              : new Date(`2026-11-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
          eligibilityRules: {
            education_options: [
              {
                minimum_level: 'DIPLOMA',
                qualification: 'Diploma in Mechanical Engineering',
                conditions: 'Three years of experience',
              },
            ],
          },
        },
      });
    }
    await prisma.post.create({
      data: {
        id: 'literal',
        sourceId: source.id,
        postName: '100%_literal',
        minEducationLevel: 'PHD',
      },
    });
    const filters = {
      q: 'mechanical',
      qualification: 'DIPLOMA',
      sort: 'soonest',
    } as const;
    const first = await listPublicJobs(1, 6, filters);
    assert.equal(first.pagination.totalItems, 8);
    assert.deepEqual(
      first.data.map((job) => job.id),
      [
        'fixture-0',
        'fixture-1',
        'fixture-2',
        'fixture-3',
        'fixture-4',
        'fixture-5',
      ],
    );
    const second = await listPublicJobs(2, 6, filters);
    assert.deepEqual(
      second.data.map((job) => job.id),
      ['fixture-6', 'fixture-7'],
    );
    const reverse = await listPublicJobs(1, 20, {
      ...filters,
      sort: 'furthest',
    });
    assert.equal(reverse.data[0].id, 'fixture-6');
    assert.equal(reverse.data.at(-1)?.id, 'fixture-7');
    assert.equal(
      (await listPublicJobs(1, 20, { ...filters, qualification: 'PHD' }))
        .pagination.totalItems,
      0,
    );
    assert.equal(
      (await listPublicJobs(1, 20, { ...filters, qualification: '', q: '%_' }))
        .data[0]?.id,
      'literal',
    );
    assert.equal(
      (
        await listPublicJobs(1, 20, {
          ...filters,
          qualification: '',
          q: "' OR 1=1 --",
        })
      ).pagination.totalItems,
      0,
    );
    const { handleIngest } = await import('../src/routes/ingest.js');
    const { registerPublicRoutes } = await import('../src/routes/public.js');
    const app = Fastify();
    app.post('/api/internal/ingest', handleIngest);
    registerPublicRoutes(app);
    t.after(() => app.close());
    const post = {
      post_name: 'Fictional Clerk',
      min_age: null,
      max_age: null,
      min_marks_percent: null,
      category_relaxation_rules: null,
    };
    const ingest = {
      source_url: 'https://example.org/organization-fixture',
      source_name: 'Fictional Listings Portal',
      source_text:
        'Example 100%_Research Council invites applications for Clerk.',
      posts: [
        { ...post, recruiting_body: 'Example 100%_Research Council' },
        { ...post, post_name: 'Fictional Assistant', recruiting_body: null },
        { ...post, post_name: 'Fictional Officer' },
      ],
    };
    for (let repeat = 0; repeat < 2; repeat++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/ingest',
        payload: ingest,
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json<{ created: number }>().created, 3);
    }
    const stored = await prisma.post.findMany({
      where: { source: { url: ingest.source_url } },
      orderBy: { postName: 'asc' },
    });
    assert.equal(stored.length, 3);
    assert.deepEqual(
      stored.map((job) => job.organization),
      [null, 'Example 100%_Research Council', null],
    );
    const response = await app.inject('/api/jobs?q=rEsEaRcH&pageSize=1');
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.json<{ pagination: { totalItems: number } }>().pagination
        .totalItems,
      1,
    );
    const job = response.json<{
      data: Array<{
        id: string;
        organization: string | null;
        source: { name: string };
      }>;
    }>().data[0];
    assert.equal(job.organization, 'Example 100%_Research Council');
    assert.equal(job.source.name, ingest.source_name);
    const detail = await app.inject(`/api/jobs/${job.id}`);
    assert.equal(
      detail.json<{ organization: string | null }>().organization,
      job.organization,
    );
    const unknown = await app.inject(`/api/jobs/${stored[0].id}`);
    assert.equal(
      unknown.json<{ organization: string | null }>().organization,
      null,
    );
    const literal = await listPublicJobs(1, 20, {
      q: '%_Research',
      qualification: '',
      sort: 'soonest',
    });
    assert.equal(literal.pagination.totalItems, 1);
    const portal = await listPublicJobs(1, 20, {
      q: ingest.source_name,
      qualification: '',
      sort: 'soonest',
    });
    assert.equal(portal.pagination.totalItems, 0);
  },
);
