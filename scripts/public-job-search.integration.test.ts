import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

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
  },
);
