import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/index.js';
import {
  storeExtractionCandidate,
  validateStorageEnvelope,
} from './store-extraction-candidate.js';

// Illustrative evidence only; no credentials, fetched jobs or LLM calls.
const raw: unknown = JSON.parse(
  execFileSync(
    'services/ai/.venv/bin/python',
    [
      '-c',
      `
import json
from store_candidate import prepare_storage
from services.ai.tests.test_validate_candidate import CandidateValidationTests
r,s=CandidateValidationTests().candidate()
r['bundle_id']=s['bundle_id']
print(json.dumps(prepare_storage(r,s,source_name='Fictional example')))
`,
    ],
    { env: { ...process.env, PYTHONPATH: 'services/ai' }, encoding: 'utf8' },
  ),
);
const fixture = await validateStorageEnvelope(raw);

await test('storage boundary rejects publication flags, unknown properties and invalid facts', async () => {
  const posts = fixture.facts.posts;
  assert.ok(Array.isArray(posts));
  const post: unknown = posts[0];
  assert.ok(post !== null && typeof post === 'object' && !Array.isArray(post));
  for (const input of [
    { ...fixture, review: { ...fixture.review, publication_allowed: true } },
    { ...fixture, arbitrary_extra: 'unexpected' },
    { ...fixture, facts: { ...fixture.facts, posts: [] } },
    { ...fixture, source_url: 'https://user:password@example.invalid/' },
    ...[
      { vacancies: '50' },
      { vacancies: -1 },
      { vacancies: Infinity },
      { min_marks_percent: 101 },
      { application_start_date: '2026-02-30' },
    ].map((values) => ({
      ...fixture,
      facts: { ...fixture.facts, posts: [{ ...post, ...values }] },
    })),
  ])
    await assert.rejects(validateStorageEnvelope(input));
});

await test(
  'PostgreSQL keeps complete drafts, reuses duplicates and leaves published posts intact',
  {
    skip:
      !process.env.TEST_DATABASE_URL &&
      'Requires an isolated TEST_DATABASE_URL',
  },
  async () => {
    const schema = `candidate_test_${randomUUID().replaceAll('-', '')}`;
    const connectionString = process.env.TEST_DATABASE_URL;
    const sql = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 3000,
    });
    const database = new PrismaClient({
      adapter: new PrismaPg({ connectionString }, { schema }),
    });
    await sql.connect();
    try {
      await sql.query(`CREATE SCHEMA "${schema}"`);
      await sql.query(`SET search_path TO "${schema}"`);
      await sql.query(
        await readFile(
          new URL(
            '../prisma/migrations/20261008190000_add_extraction_candidates/migration.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      await sql.query('CREATE TABLE "Post" (id TEXT PRIMARY KEY)');
      await sql.query('INSERT INTO "Post" (id) VALUES ($1)', [
        'existing-fixture',
      ]);
      const first = await storeExtractionCandidate(fixture, database);
      // Object key order must not produce a new candidate.
      const reordered = Object.fromEntries(Object.entries(fixture).reverse());
      const same = await storeExtractionCandidate(reordered, database);
      assert.equal(first.id, same.id);
      const concurrent = await Promise.all([
        storeExtractionCandidate(fixture, database),
        storeExtractionCandidate(fixture, database),
        storeExtractionCandidate(reordered, database),
      ]);
      assert.ok(concurrent.every((saved) => saved.id === first.id));
      const stored = await database.extractionCandidate.findUniqueOrThrow({
        where: { id: first.id },
      });
      assert.deepEqual(stored.facts, fixture.facts);
      assert.deepEqual(stored.review, fixture.review);
      assert.deepEqual(stored.evidenceUnits, fixture.evidence_units);
      assert.equal(stored.status, 'needs_review');
      assert.equal(await database.extractionCandidate.count(), 1);
      const changed = await storeExtractionCandidate(
        { ...fixture, source_name: 'Updated fictional title' },
        database,
      );
      assert.notEqual(changed.id, first.id);
      assert.equal(await database.extractionCandidate.count(), 2);
      await assert.rejects(
        sql.query('UPDATE "ExtractionCandidate" SET status = $1', [
          'published',
        ]),
      );
      assert.deepEqual((await sql.query('SELECT id FROM "Post"')).rows, [
        { id: 'existing-fixture' },
      ]);
    } finally {
      await database.$disconnect();
      await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end();
    }
  },
);
