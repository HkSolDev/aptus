const connectionString =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://aptus:aptus@127.0.0.1:5432/aptus';

process.env.DATABASE_URL = connectionString;
process.env.TEST_DATABASE_URL = connectionString;

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import type { AppAuth } from '../src/auth/auth.js';
import { authDatabase } from './helpers/auth-database.js';

const execute = promisify(execFile);
const testIngestToken = 'test-internal-worker-secret-token-123';
const operatorAllowlist = 'operator@example.gov.in,hemantkumar4213@gmail.com,mrdevghost@gmail.com';

function createMockAuth(sessionUser: {
  id: string;
  email: string;
  emailVerified: boolean;
  name?: string;
} | null) {
  return {
    options: { baseURL: 'https://aptus.example' },
    api: {
      getSession: async () => {
        if (!sessionUser) return null;
        return {
          session: {
            id: 'sess-123',
            userId: sessionUser.id,
            expiresAt: new Date(Date.now() + 3600 * 1000),
          },
          user: {
            id: sessionUser.id,
            email: sessionUser.email,
            emailVerified: sessionUser.emailVerified,
            name: sessionUser.name || 'Test User',
          },
        };
      },
    },
  } as unknown as AppAuth;
}

await test('Review workflow: Access control (guest, non-operator, unverified email, missing allowlist)', async (t) => {
  const envBase = {
    AUTH_ENABLED: 'true',
    INGEST_TOKEN: testIngestToken,
    APTUS_REVIEW_OPERATOR_EMAILS: operatorAllowlist,
  };

  // 1. Guest direct request -> 401
  const guestApp = buildApp(createMockAuth(null), envBase);
  t.after(() => guestApp.close());
  const guestRes = await guestApp.inject({
    method: 'GET',
    url: '/api/admin/review-drafts',
  });
  assert.equal(guestRes.statusCode, 401);
  assert.equal(guestRes.headers['cache-control'], 'no-store, private');

  // 2. Missing allowlist configuration -> 403
  const missingAllowlistApp = buildApp(
    createMockAuth({
      id: 'op1',
      email: 'operator@example.gov.in',
      emailVerified: true,
    }),
    { ...envBase, APTUS_REVIEW_OPERATOR_EMAILS: '' },
  );
  t.after(() => missingAllowlistApp.close());
  const missingRes = await missingAllowlistApp.inject({
    method: 'GET',
    url: '/api/admin/review-drafts',
  });
  assert.equal(missingRes.statusCode, 403);
  assert.match(missingRes.json().error, /not configured/i);

  // 3. Unverified email -> 403
  const unverifiedApp = buildApp(
    createMockAuth({
      id: 'op2',
      email: 'operator@example.gov.in',
      emailVerified: false,
    }),
    envBase,
  );
  t.after(() => unverifiedApp.close());
  const unverifiedRes = await unverifiedApp.inject({
    method: 'GET',
    url: '/api/admin/review-drafts',
  });
  assert.equal(unverifiedRes.statusCode, 403);
  assert.match(unverifiedRes.json().error, /verified/i);

  // 4. Non-operator email -> 403
  const nonOperatorApp = buildApp(
    createMockAuth({
      id: 'visitor1',
      email: 'random.visitor@example.com',
      emailVerified: true,
    }),
    envBase,
  );
  t.after(() => nonOperatorApp.close());
  const nonOpRes = await nonOperatorApp.inject({
    method: 'GET',
    url: '/api/admin/review-drafts',
  });
  assert.equal(nonOpRes.statusCode, 403);
  assert.match(nonOpRes.json().error, /not authorized/i);

  // 5. Authorized operator -> 200
  const operatorApp = buildApp(
    createMockAuth({
      id: 'op3',
      email: 'operator@example.gov.in',
      emailVerified: true,
      name: 'Authorized Operator',
    }),
    envBase,
  );
  t.after(() => operatorApp.close());
  const opStatusRes = await operatorApp.inject({
    method: 'GET',
    url: '/api/admin/review-drafts/operator-status',
  });
  assert.equal(opStatusRes.statusCode, 200);
  assert.equal(opStatusRes.json().is_operator, true);
  assert.equal(opStatusRes.json().email, 'operator@example.gov.in');
});

await test('Review workflow: CSRF and Origin checks on mutating operator routes', async (t) => {
  const env = {
    AUTH_ENABLED: 'true',
    INGEST_TOKEN: testIngestToken,
    APTUS_REVIEW_OPERATOR_EMAILS: operatorAllowlist,
  };
  const app = buildApp(
    createMockAuth({
      id: 'op1',
      email: 'operator@example.gov.in',
      emailVerified: true,
    }),
    env,
  );
  t.after(() => app.close());

  // Wrong origin mutation -> 403
  const wrongOriginRes = await app.inject({
    method: 'POST',
    url: '/api/admin/review-drafts/item_123/revisions',
    headers: {
      origin: 'https://malicious.evil.example',
    },
    payload: { change_reason: 'Test', facts: {} },
  });
  assert.equal(wrongOriginRes.statusCode, 403);
  assert.match(wrongOriginRes.json().error, /could not be verified/i);

  // Correct origin -> passes origin check
  const correctOriginRes = await app.inject({
    method: 'POST',
    url: '/api/admin/review-drafts/item_123/revisions',
    headers: {
      origin: 'https://aptus.example',
    },
    payload: { change_reason: 'Test', facts: {} },
  });
  // Does not fail with 403 origin error (fails with 400 because If-Match is missing)
  assert.equal(correctOriginRes.statusCode, 400);
  assert.match(correctOriginRes.json().error, /If-Match/i);
});

await test('Review workflow: Database lifecycle, import replay, corrections, stale edits, and Python validation', async (t) => {
  const { database } = await authDatabase(t, connectionString);

  // Load the test candidate fixture
  const fixturePath = join(
    process.cwd(),
    'tests/fixtures/review_candidate_fixture.json',
  );
  const fixtureRaw = await readFile(fixturePath, 'utf8');

  const {
    importReviewDraft,
    listReviewQueue,
    getReviewItemDetail,
    saveReviewCorrection,
    requestValidation,
    claimValidationTask,
    submitValidationResult,
    StaleRevisionError,
    keepReviewItemHeld,
  } = await import('../src/lib/review-drafts.js');

  // Verify Post table is initially empty
  assert.equal(await database.post.count(), 0);

  // 1. Initial Import
  const import1 = await importReviewDraft(fixtureRaw, database);
  assert.equal(import1.duplicate, false);
  assert.equal(import1.revisionNumber, 1);
  assert.ok(import1.itemId);
  assert.ok(import1.revisionId);

  // Verify no posts were created
  assert.equal(await database.post.count(), 0);

  // 2. Import Replay: repeated identical import produces same item and revision without duplication
  const import2 = await importReviewDraft(fixtureRaw, database);
  assert.equal(import2.duplicate, true);
  assert.equal(import2.itemId, import1.itemId);
  assert.equal(import2.revisionId, import1.revisionId);
  assert.equal(import2.canonicalHash, import1.canonicalHash);

  // Verify item and revision counts in database
  assert.equal(await database.reviewItem.count(), 1);
  assert.equal(await database.reviewRevision.count(), 1);
  assert.equal(await database.post.count(), 0);

  // 3. Queue Query
  const queue = await listReviewQueue({ status: 'all' }, database);
  assert.equal(queue.total_items, 1);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].id, import1.itemId);
  assert.equal(queue.items[0].current_revision?.revision_number, 1);
  assert.equal(queue.items[0].current_revision?.validation_state, 'none');

  // 4. Candidate Detail & Evidence Preservation
  const detail = await getReviewItemDetail(import1.itemId, database);
  assert.ok(detail);
  assert.equal(detail.item.id, import1.itemId);
  assert.equal(detail.revision.revision_number, 1);
  assert.equal(detail.revision.validation_state, 'none');
  assert.ok(Array.isArray(detail.revision.source_evidence));
  assert.ok(detail.revision.source_evidence.length > 0);
  assert.equal(detail.latest_validation, null);

  // 5. Save Correction (R2) with grounded citations
  const factsToEdit = JSON.parse(JSON.stringify(detail.revision.facts));
  // Modify min_age: 21, max_age: 30 supported by cited quote, preserve vacancies as null
  factsToEdit.posts[0].min_age = 21;
  factsToEdit.posts[0].max_age = 30;
  factsToEdit.posts[0].vacancies = null;

  factsToEdit.evidence.push({
    field_path: 'posts.0.min_age',
    evidence_id: 'main:unit-0',
    quote: 'Age limit: 21–30 years',
  });
  factsToEdit.evidence.push({
    field_path: 'posts.0.max_age',
    evidence_id: 'main:unit-0',
    quote: 'Age limit: 21–30 years',
  });
  factsToEdit.missing_fields = factsToEdit.missing_fields.filter(
    (m: { field_path: string }) =>
      m.field_path !== 'posts.0.min_age' && m.field_path !== 'posts.0.max_age',
  );

  const saveResult = await saveReviewCorrection(
    import1.itemId,
    {
      baseRevisionId: import1.revisionId,
      facts: factsToEdit,
      changeReason: 'Corrected age range to 21-30 cited from section unit-0; preserved null vacancies',
      operatorEmail: 'operator@example.gov.in',
    },
    database,
  );

  assert.equal(saveResult.revisionNumber, 2);
  assert.notEqual(saveResult.revisionId, import1.revisionId);
  assert.equal(saveResult.validationState, 'none');

  // Verify Post count remains 0
  assert.equal(await database.post.count(), 0);

  // 6. Stale Edits: saving again against R1 must throw StaleRevisionError
  await assert.rejects(
    async () => {
      await saveReviewCorrection(
        import1.itemId,
        {
          baseRevisionId: import1.revisionId, // stale base revision!
          facts: factsToEdit,
          changeReason: 'Conflicting concurrent edit',
          operatorEmail: 'another.operator@example.gov.in',
        },
        database,
      );
    },
    (err: Error) => {
      assert.ok(err instanceof StaleRevisionError);
      return true;
    },
  );

  // Verify current revision is still R2
  const detailAfterStale = await getReviewItemDetail(import1.itemId, database);
  assert.ok(detailAfterStale);
  assert.equal(detailAfterStale.revision.revision_number, 2);
  assert.equal(detailAfterStale.revision.id, saveResult.revisionId);
  const staleFacts = detailAfterStale.revision.facts as Record<string, unknown>;
  const stalePosts = staleFacts.posts as Array<Record<string, unknown>>;
  assert.equal(stalePosts[0].min_age, 21);
  assert.equal(stalePosts[0].max_age, 30);
  assert.equal(stalePosts[0].vacancies, null);

  // 7. Request Validation for R2
  const valRequest = await requestValidation(
    import1.itemId,
    saveResult.revisionId,
    'aptus-val-v1',
    database,
  );
  assert.equal(valRequest.status, 'pending');
  assert.equal(valRequest.reused, false);

  // Re-requesting validation for same revision reuses pending task
  const valReused = await requestValidation(
    import1.itemId,
    saveResult.revisionId,
    'aptus-val-v1',
    database,
  );
  assert.equal(valReused.reused, true);
  assert.equal(valReused.taskId, valRequest.taskId);

  // 8. Worker Claims Task
  const claimed = await claimValidationTask(
    { workerId: 'test-worker-1', leaseSeconds: 60 },
    database,
  );
  assert.ok(claimed);
  assert.equal(claimed.taskId, valRequest.taskId);
  assert.equal(claimed.revisionId, saveResult.revisionId);
  assert.ok(claimed.claimToken);

  // 9. Run Real Python Validator on Claimed Task Payload
  const pythonScript = `
import json, sys
from review_validation_worker import validate_revision_payload
task = json.loads(sys.argv[1])
result = validate_revision_payload(task)
print(json.dumps(result))
`;

  const { stdout: pyStdout } = await execute(
    'services/ai/.venv/bin/python',
    ['-c', pythonScript, JSON.stringify(claimed)],
    {
      env: {
        ...process.env,
        PYTHONPATH: 'services/ai:services/ai/tests',
        OPENAI_API_KEY: '',
        GEMINI_API_KEY: '',
      },
    },
  );

  const pythonResult = JSON.parse(pyStdout.trim());
  assert.equal(pythonResult.status, 'needs_review');
  assert.equal(pythonResult.disposition, 'valid_recruitment_review_draft');
  assert.equal(pythonResult.errors.length, 0);
  assert.equal(pythonResult.semantic_support_verified, false);

  // 10. Worker Submits Validation Result
  const submitRes = await submitValidationResult(
    claimed.taskId,
    {
      claimToken: claimed.claimToken,
      revisionHash: claimed.revisionHash,
      validatorVersion: 'aptus-val-v1',
      result: pythonResult,
    },
    database,
  );
  assert.equal(submitRes.status, 'completed');
  assert.equal(submitRes.validationState, 'checks_passed');

  // Verify R2 detail shows validation results
  const detailAfterVal = await getReviewItemDetail(import1.itemId, database);
  assert.ok(detailAfterVal);
  assert.equal(detailAfterVal.revision.validation_state, 'checks_passed');
  assert.ok(detailAfterVal.latest_validation);
  assert.equal(detailAfterVal.latest_validation.status, 'completed');
  const valResult = detailAfterVal.latest_validation.result as Record<string, unknown> | null;
  const valErrors = Array.isArray(valResult?.errors) ? valResult.errors : [];
  assert.equal(valErrors.length, 0);

  // 11. Stale Results Protection:
  // Create an older task for R1. When that older task completes, it must NOT overwrite R2!
  const r1Task = await requestValidation(
    import1.itemId,
    import1.revisionId,
    'aptus-val-v1',
    database,
  );
  const r1Claim = await claimValidationTask(
    { workerId: 'test-worker-legacy', leaseSeconds: 60 },
    database,
  );
  assert.ok(r1Claim);
  assert.equal(r1Claim.taskId, r1Task.taskId);

  // Submit R1 result
  await submitValidationResult(
    r1Claim.taskId,
    {
      claimToken: r1Claim.claimToken,
      revisionHash: r1Claim.revisionHash,
      validatorVersion: 'aptus-val-v1',
      result: {
        status: 'needs_review',
        errors: [],
        warnings: [],
      },
    },
    database,
  );

  // Verify R2 remains the current revision and its validation state is untouched
  const detailAfterLegacy = await getReviewItemDetail(import1.itemId, database);
  assert.ok(detailAfterLegacy);
  assert.equal(detailAfterLegacy.revision.id, saveResult.revisionId);
  assert.equal(detailAfterLegacy.revision.validation_state, 'checks_passed');

  // 12. Keep Held action
  const holdRes = await keepReviewItemHeld(
    import1.itemId,
    { holdReason: 'Manual verification of Council registration required' },
    database,
  );
  assert.equal(holdRes.status, 'held');
  assert.equal(
    holdRes.holdReason,
    'Manual verification of Council registration required',
  );

  // 13. Lease Recovery: Interrupted worker claim can be recovered after lease expires
  const leaseTask = await requestValidation(
    import1.itemId,
    saveResult.revisionId,
    'aptus-val-v2', // separate validator version so it creates a fresh task
    database,
  );
  assert.equal(leaseTask.status, 'pending');

  // Claim with 1 second lease
  const shortClaim = await claimValidationTask(
    { workerId: 'crashing-worker', leaseSeconds: 1 },
    database,
  );
  assert.ok(shortClaim);
  assert.equal(shortClaim.taskId, leaseTask.taskId);

  // Immediate second claim finds no task (already running and lease active)
  const immediateClaim = await claimValidationTask(
    { workerId: 'second-worker', leaseSeconds: 60 },
    database,
  );
  assert.equal(immediateClaim, null);

  // Wait for lease to expire
  await new Promise((r) => setTimeout(r, 1100));

  // Now recovery worker can claim the expired task!
  const recoveredClaim = await claimValidationTask(
    { workerId: 'recovery-worker', leaseSeconds: 60 },
    database,
  );
  assert.ok(recoveredClaim);
  assert.equal(recoveredClaim.taskId, leaseTask.taskId);
  assert.notEqual(recoveredClaim.claimToken, shortClaim.claimToken);

  // 14. Validation with Issues: Invented quotation triggers citation errors
  const invalidTaskPayload = {
    ...recoveredClaim,
    facts: {
      ...factsToEdit,
      evidence: [
        {
          field_path: 'posts.0.post_name',
          evidence_id: 'main:unit-0',
          quote: 'This sentence was completely hallucinated and does not exist',
        },
      ],
    },
  };

  const { stdout: pyErrStdout } = await execute(
    'services/ai/.venv/bin/python',
    ['-c', pythonScript, JSON.stringify(invalidTaskPayload)],
    {
      env: {
        ...process.env,
        PYTHONPATH: 'services/ai:services/ai/tests',
      },
    },
  );
  const pyErrResult = JSON.parse(pyErrStdout.trim());
  assert.equal(pyErrResult.status, 'blocked');
  assert.ok(pyErrResult.errors.length > 0);
  assert.ok(
    pyErrResult.errors.some(
      (e: { reason: string }) => e.reason === 'quote_not_in_cited_evidence',
    ),
  );

  // Submitting this result updates validationState to 'completed_with_issues'
  const issueSubmit = await submitValidationResult(
    recoveredClaim.taskId,
    {
      claimToken: recoveredClaim.claimToken,
      revisionHash: recoveredClaim.revisionHash,
      validatorVersion: 'aptus-val-v2',
      result: pyErrResult,
    },
    database,
  );
  assert.equal(issueSubmit.status, 'completed');
  assert.equal(issueSubmit.validationState, 'completed_with_issues');

  // 15. Final Check: Post count must STILL be 0 (no public leakage)!
  assert.equal(await database.post.count(), 0);
});

await test('Review workflow: Public catalogue isolation (private drafts and evidence do not leak)', async (t) => {
  const { database } = await authDatabase(t, connectionString);
  const app = buildApp(undefined, {
    AUTH_ENABLED: 'false',
    INGEST_TOKEN: testIngestToken,
  });
  t.after(() => app.close());

  // Import a private draft
  const fixturePath = join(
    process.cwd(),
    'tests/fixtures/review_candidate_fixture.json',
  );
  const fixtureRaw = await readFile(fixturePath, 'utf8');
  const { importReviewDraft } = await import('../src/lib/review-drafts.js');
  const imported = await importReviewDraft(fixtureRaw, database);

  // Query public jobs list: must be empty
  const publicList = await app.inject({
    method: 'GET',
    url: '/api/jobs',
  });
  assert.equal(publicList.statusCode, 200);
  const listJson = publicList.json();
  assert.ok(Array.isArray(listJson.data));
  assert.equal(listJson.data.length, 0);

  // Query public job detail by candidate ID: must be 404
  const publicDetail = await app.inject({
    method: 'GET',
    url: `/api/jobs/${imported.itemId}`,
  });
  assert.equal(publicDetail.statusCode, 404);
});
