import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { validateStorageEnvelope } from '../store-extraction-candidate.js';
import { isEligibilityRules } from '../../src/schemas/eligibility-rules.js';
import { buildApp } from '../../src/app.js';
import { contractChecker, fixture, worker } from './support.js';

test('real Python draft agrees with frozen fixture and the backend storage schema', async () => {
  const produced = worker('produce');
  assert.deepEqual(produced.draft, fixture('fixtures/reviewed-draft.json'));
  assert.deepEqual(
    produced.storage_schema,
    JSON.parse(
      await readFile('services/ai/candidate-storage.schema.json', 'utf8'),
    ),
  );
  const accepted = await validateStorageEnvelope(produced.draft);
  assert.deepEqual(accepted, produced.draft);
  assert.equal(
    isEligibilityRules(produced.legacy_post.eligibility_rules),
    true,
  );
  const legacySchema = fixture('legacy-post.schema.json');
  delete legacySchema.$id;
  delete legacySchema.$schema;
  assert.deepEqual(produced.legacy_schema, legacySchema);
});

test('backend rejects missing, mistyped and invented worker facts without coercion', async () => {
  for (const mutation of [
    'missing',
    'string',
    'negative',
    'marks',
    'array',
    'extra',
  ]) {
    const draft = fixture('fixtures/reviewed-draft.json');
    const post = draft.facts.posts[0];
    if (mutation === 'missing') delete post.min_age;
    if (mutation === 'string') post.min_age = '18';
    if (mutation === 'negative') post.min_age = -1;
    if (mutation === 'marks') post.min_marks_percent = 101;
    if (mutation === 'array') post.locations = [null];
    if (mutation === 'extra') post.invented_field = true;
    await assert.rejects(validateStorageEnvelope(draft), Error, mutation);
  }
});

test('reviewed HTTP branch rejects stale approval and missing credentials before DB', async (t) => {
  const token = 'fictional-contract-token-not-for-real-use';
  const app = buildApp(undefined, {
    AUTH_ENABLED: 'false',
    INGEST_TOKEN: token,
  });
  t.after(() => app.close());
  const candidate = fixture('fixtures/reviewed-draft.json');
  const draft = JSON.stringify(candidate);
  const payload = {
    reviewed_candidate_json: draft + ' ',
    approval: {
      draft_sha256: createHash('sha256').update(draft).digest('hex'),
      reviewed_by: 'Illustrative reviewer',
      note: 'Illustrative approval',
      bundle_id: candidate.bundle_id,
    },
  };
  const request = {
    method: 'POST' as const,
    url: '/api/internal/ingest',
    payload,
  };
  assert.equal((await app.inject(request)).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        ...request,
        headers: { authorization: `Bearer ${token}` },
      })
    ).statusCode,
    400,
  );
});

test('publication receipt schema and actual Python receiver reject false success', async (t) => {
  const check = await contractChecker();
  t.after(() => check.close());
  const digest = 'a'.repeat(64);
  const receipt = {
    candidate_id: 'fixture',
    content_hash: 'b'.repeat(64),
    draft_sha256: digest,
    post_ids: ['fixture-post'],
  };
  await check.assert('PublicationReceipt', receipt);
  assert.equal(worker('receipt', { receipt, digest, count: 1 }).accepted, true);
  for (const bad of [
    { ...receipt, post_ids: [] },
    { ...receipt, draft_sha256: 'c'.repeat(64) },
    { ...receipt, post_ids: ['same', 'same'] },
    { ...receipt, content_hash: 'bad' },
  ]) {
    assert.equal(
      worker('receipt', { receipt: bad, digest, count: 1 }).accepted,
      false,
    );
  }
});
