import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/index.js';
import { publishExtractionCandidate } from './publish-extraction-candidate.js';
import { storeExtractionCandidate } from './store-extraction-candidate.js';
import { renderReviewedDetails } from '../src/lib/render-reviewed-details.js';

await test('publication requires an explicit identified review before database access', async () => {
  for (const [id, hash, note] of [
    ['bad/id', 'a'.repeat(64), 'Reviewed'],
    ['draft', '', 'Reviewed'],
    ['draft', 'a'.repeat(64), ' '],
  ])
    await assert.rejects(
      publishExtractionCandidate(id, hash, note),
      /identified reviewed draft/,
    );
});

await test('published salary and application text stay escaped and unknown period stays unknown', () => {
  const html = renderReviewedDetails({
    pay: {
      minimum_amount: 18000,
      maximum_amount: 45000,
      currency: 'INR',
      period: null,
    },
    application_steps: ['<script>unsafe</script>'],
    documents_required: ['Resume'],
    other_requirements: ['Desirable: Python'],
    experience_rules: [{ minimum_years: 4, conditions: 'Diploma route' }],
  });
  assert.ok(html.includes('18000–45000'));
  assert.ok(html.includes('Period</dt><dd>Not specified'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('4 years — Diploma route'));
  assert.ok(html.includes('Desirable: Python'));
  assert.equal(renderReviewedDetails(null), '');
});

await test(
  'reviewed publication is atomic, preserves draft, reuses posts and rejects replacement',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const schema = `publication_test_${randomUUID().replaceAll('-', '')}`;
    const sql = new pg.Client({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    const db = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: process.env.TEST_DATABASE_URL },
        { schema },
      ),
    });
    await sql.connect();
    try {
      await sql.query(`CREATE SCHEMA "${schema}"`);
      for (const table of ['Source', 'ExtractionCandidate', 'Post'])
        await sql.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      const fixture: unknown = JSON.parse(
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
print(json.dumps(prepare_storage(r,s,source_name='Illustrative recruitment')))
`,
          ],
          {
            env: { ...process.env, PYTHONPATH: 'services/ai' },
            encoding: 'utf8',
          },
        ),
      );
      const saved = await storeExtractionCandidate(fixture, db);
      await assert.rejects(
        publishExtractionCandidate(
          saved.id,
          '0'.repeat(64),
          'Source-reviewed',
          db,
        ),
      );
      assert.equal(await db.post.count(), 0);
      const before = await db.extractionCandidate.findUniqueOrThrow({
        where: { id: saved.id },
      });
      await db.extractionCandidate.update({
        where: { id: saved.id },
        data: { sourceName: 'Changed after review' },
      });
      await assert.rejects(
        publishExtractionCandidate(
          saved.id,
          saved.contentHash,
          'Source-reviewed',
          db,
        ),
        /contents changed/,
      );
      assert.equal(await db.post.count(), 0);
      await db.extractionCandidate.update({
        where: { id: saved.id },
        data: { sourceName: before.sourceName },
      });
      // Model remote-database latency beyond the former ten-second deadline.
      await sql.query(`CREATE FUNCTION "${schema}".delay_publication() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(11); RETURN NEW; END $$`);
      await sql.query(`CREATE TRIGGER delayed_publication BEFORE INSERT ON "${schema}"."Post"
        FOR EACH ROW EXECUTE FUNCTION "${schema}".delay_publication()`);
      const first = await publishExtractionCandidate(
        saved.id,
        saved.contentHash,
        'Source-reviewed illustrative fixture',
        db,
      );
      await sql.query(`DROP TRIGGER delayed_publication ON "${schema}"."Post"`);
      const second = await publishExtractionCandidate(
        saved.id,
        saved.contentHash,
        'Repeat',
        db,
      );
      assert.deepEqual(first, second);
      assert.equal(await db.post.count(), 1);
      const post = await db.post.findUniqueOrThrow({
        where: { id: first[0].id },
      });
      assert.equal(post.extractionCandidateId, saved.id);
      assert.equal(post.candidatePostIndex, 0);
      assert.deepEqual(
        post.reviewedDetails,
        (before.facts as { posts: unknown[] }).posts[0],
      );
      assert.deepEqual(
        await db.extractionCandidate.findUniqueOrThrow({
          where: { id: saved.id },
        }),
        before,
      );
      assert.equal(post.reviewNote, 'Source-reviewed illustrative fixture');
      await db.post.create({
        data: { sourceId: post.sourceId, postName: 'Previously published' },
      });
      await assert.rejects(
        publishExtractionCandidate(saved.id, saved.contentHash, 'Repeat', db),
        /already published/,
      );
      assert.equal(await db.post.count(), 2);
    } finally {
      await db.$disconnect();
      await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.end();
    }
  },
);
