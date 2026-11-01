process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://aptus:aptus@127.0.0.1:5432/aptus';

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { authDatabase } from './helpers/auth-database.js';

const connectionString =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://aptus:aptus@127.0.0.1:5432/aptus';

async function fixture() {
  const raw = await readFile(
    join(process.cwd(), 'tests/fixtures/review_candidate_fixture.json'),
    'utf8',
  );
  return JSON.parse(raw) as Record<string, unknown>;
}

function editedFacts(detail: { revision: { facts: unknown } }) {
  const facts = JSON.parse(JSON.stringify(detail.revision.facts));
  facts.posts[0].min_age = 21;
  facts.posts[0].max_age = 30;
  facts.evidence.push(
    {
      field_path: 'posts.0.min_age',
      evidence_id: 'main:unit-0',
      quote: 'Age limit: 21–30 years',
    },
    {
      field_path: 'posts.0.max_age',
      evidence_id: 'main:unit-0',
      quote: 'Age limit: 21–30 years',
    },
  );
  facts.missing_fields = facts.missing_fields.filter(
    (m: { field_path: string }) =>
      m.field_path !== 'posts.0.min_age' && m.field_path !== 'posts.0.max_age',
  );
  return facts;
}

await test('correction survives a database write taking longer than five seconds', async (t) => {
  const { database, client } = await authDatabase(t, connectionString);
  const { importReviewDraft, getReviewItemDetail, saveReviewCorrection } =
    await import('../src/lib/review-drafts.js');
  const imported = await importReviewDraft(
    JSON.stringify(await fixture()),
    database,
  );
  const detail = await getReviewItemDetail(imported.itemId, database);
  await client.query(`
    CREATE FUNCTION delay_review_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_sleep(5.2);
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER delay_review_write BEFORE INSERT ON "ReviewRevision"
      FOR EACH ROW EXECUTE FUNCTION delay_review_write();
  `);
  const saved = await saveReviewCorrection(
    imported.itemId,
    {
      baseRevisionId: imported.revisionId,
      facts: editedFacts(detail!),
      changeReason: 'Source-backed correction over a slow database connection',
      operatorEmail: 'operator@example.gov.in',
    },
    database,
  );
  const refreshed = await getReviewItemDetail(imported.itemId, database);
  assert.equal(saved.revisionNumber, 2);
  assert.equal(refreshed?.revision.id, saved.revisionId);
  assert.equal(
    await database.reviewRevision.count({
      where: { reviewItemId: imported.itemId },
    }),
    2,
  );
});

await test('A: correction after a newer worker observation uses max revision + 1', async (t) => {
  const { database } = await authDatabase(t, connectionString);
  const { importReviewDraft, getReviewItemDetail, saveReviewCorrection } =
    await import('../src/lib/review-drafts.js');
  const base = await fixture();

  const r1 = await importReviewDraft(JSON.stringify(base), database);
  assert.equal(r1.revisionNumber, 1);
  const detail1 = await getReviewItemDetail(r1.itemId, database);
  const r2 = await saveReviewCorrection(
    r1.itemId,
    {
      baseRevisionId: r1.revisionId,
      facts: editedFacts(detail1!),
      changeReason: 'Fix age',
      operatorEmail: 'operator@example.gov.in',
    },
    database,
  );
  assert.equal(r2.revisionNumber, 2);

  // Changed worker facts become a non-current observation when a human correction exists.
  const changed = JSON.parse(JSON.stringify(base));
  changed.facts.posts[0].vacancies = 7;
  const r3 = await importReviewDraft(JSON.stringify(changed), database);
  assert.equal(r3.revisionNumber, 3);
  const afterImport = await getReviewItemDetail(r1.itemId, database);
  assert.equal(
    afterImport?.revision.id,
    r2.revisionId,
    'human revision stays current',
  );

  const r4 = await saveReviewCorrection(
    r1.itemId,
    {
      baseRevisionId: r2.revisionId,
      facts: editedFacts(afterImport),
      changeReason: 'Second fix',
      operatorEmail: 'operator@example.gov.in',
    },
    database,
  );
  assert.equal(r4.revisionNumber, 4);
  assert.equal(
    await database.reviewRevision.count({ where: { reviewItemId: r1.itemId } }),
    4,
  );
});

await test('A: concurrent saves against same base - one wins, one is stale', async (t) => {
  const { database } = await authDatabase(t, connectionString);
  const {
    importReviewDraft,
    getReviewItemDetail,
    saveReviewCorrection,
    StaleRevisionError,
  } = await import('../src/lib/review-drafts.js');
  const base = await fixture();
  const r1 = await importReviewDraft(JSON.stringify(base), database);
  const detail = await getReviewItemDetail(r1.itemId, database);
  const facts = editedFacts(detail!);
  const attempt = (email: string) =>
    saveReviewCorrection(
      r1.itemId,
      {
        baseRevisionId: r1.revisionId,
        facts,
        changeReason: 'Concurrent fix',
        operatorEmail: email,
      },
      database,
    ).then(
      () => 'saved' as const,
      (e: unknown) =>
        e instanceof StaleRevisionError
          ? ('stale' as const)
          : Promise.reject(e),
    );
  const results = await Promise.all([
    attempt('a@example.gov.in'),
    attempt('b@example.gov.in'),
  ]);
  assert.deepEqual([...results].sort(), ['saved', 'stale']);
});

await test('D: queue pagination returns every candidate exactly once (equal timestamps)', async (t) => {
  const { database } = await authDatabase(t, connectionString);
  const { importReviewDraft, listReviewQueue } =
    await import('../src/lib/review-drafts.js');
  const base = await fixture();
  const ids: string[] = [];
  const stamp = new Date('2026-10-29T00:00:00.000Z');
  for (let i = 0; i < 5; i++) {
    const copy = JSON.parse(JSON.stringify(base));
    copy.bundle_id = `${base.bundle_id}-page-${i}`;
    const imported = await importReviewDraft(JSON.stringify(copy), database);
    ids.push(imported.itemId);
    await database.reviewItem.update({
      where: { id: imported.itemId },
      data: { updatedAt: stamp },
    });
  }
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const q = await listReviewQueue(
      { status: 'all', limit: 2, cursor },
      database,
    );
    seen.push(...q.items.map((i) => i.id));
    if (!q.next_cursor) break;
    cursor = q.next_cursor;
  }
  assert.deepEqual([...seen].sort(), [...ids].sort());
  assert.equal(new Set(seen).size, ids.length);
});

await test('E: concurrent claims have one owner; expired lease reclaimable; old owner cannot submit', async (t) => {
  const { database } = await authDatabase(t, connectionString);
  const lib = await import('../src/lib/review-drafts.js');
  const base = await fixture();
  const r1 = await lib.importReviewDraft(JSON.stringify(base), database);
  await lib.requestValidation(
    r1.itemId,
    r1.revisionId,
    'aptus-val-v1',
    database,
  );

  const claims = await Promise.all([
    lib.claimValidationTask({ workerId: 'w1', leaseSeconds: 60 }, database),
    lib.claimValidationTask({ workerId: 'w2', leaseSeconds: 60 }, database),
  ]);
  const winners = claims.filter(Boolean);
  assert.equal(winners.length, 1, `expected one claim, got ${winners.length}`);

  // Expired lease can be reclaimed and the old token no longer submits.
  const short = await lib.requestValidation(
    r1.itemId,
    r1.revisionId,
    'aptus-val-v2',
    database,
  );
  const first = await lib.claimValidationTask(
    { workerId: 'old', leaseSeconds: 1 },
    database,
  );
  assert.equal(first?.taskId, short.taskId);
  await new Promise((r) => setTimeout(r, 1100));
  const second = await lib.claimValidationTask(
    { workerId: 'new', leaseSeconds: 60 },
    database,
  );
  assert.equal(second?.taskId, short.taskId);
  assert.notEqual(second?.claimToken, first?.claimToken);
  await assert.rejects(
    () =>
      lib.submitValidationResult(
        short.taskId,
        {
          claimToken: first!.claimToken,
          revisionHash: first!.revisionHash,
          result: { errors: [] },
        },
        database,
      ),
    /claim token/i,
  );
});
