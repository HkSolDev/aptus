import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const execute = promisify(execFile);
const token = 'fictional-ingest-credential-for-tests-only';

await test('reviewed endpoint rejects missing approval and stale hashes before database access', async (t) => {
  const app = buildApp(undefined, {
    AUTH_ENABLED: 'false',
    INGEST_TOKEN: token,
  });
  t.after(() => app.close());
  const request = { method: 'POST' as const, url: '/api/internal/ingest' };
  assert.equal(
    (
      await app.inject({
        ...request,
        payload: { reviewed_candidate_json: '{}' },
      })
    ).statusCode,
    401,
  );
  for (const payload of [
    { reviewed_candidate_json: '{}' },
    {
      reviewed_candidate_json: '{}',
      approval: {
        draft_sha256: 'a'.repeat(64),
        reviewed_by: 'Fixture reviewer',
        note: 'Checked',
      },
    },
  ])
    assert.equal(
      (
        await app.inject({
          ...request,
          headers: { authorization: `Bearer ${token}` },
          payload,
        })
      ).statusCode,
      400,
    );
});

await test(
  'Python approval and publication cross HTTP into PostgreSQL exactly once',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const database = new URL(process.env.TEST_DATABASE_URL!);
    assert.equal(database.hostname, '127.0.0.1');
    assert.equal(process.env.DATABASE_URL, process.env.TEST_DATABASE_URL);
    const root = await mkdtemp(join(tmpdir(), 'aptus-stage7-'));
    const app = buildApp(undefined, {
      AUTH_ENABLED: 'false',
      INGEST_TOKEN: token,
    });
    const sourceUrl = `https://example.invalid/stage7-${randomUUID()}`;
    t.after(async () => {
      await app.close();
      const source = await prisma.source.findUnique({
        where: { url: sourceUrl },
      });
      if (source) {
        await prisma.post.deleteMany({ where: { sourceId: source.id } });
        await prisma.source.delete({ where: { id: source.id } });
      }
      await prisma.extractionCandidate.deleteMany({ where: { sourceUrl } });
      await prisma.$disconnect();
      await rm(root, { recursive: true, force: true });
    });
    await execute(
      'services/ai/.venv/bin/python',
      [
        '-c',
        `
import json,sys
from pathlib import Path
from store_candidate import prepare_storage
from services.ai.tests.test_validate_candidate import CandidateValidationTests
r,s=CandidateValidationTests().candidate()
r['bundle_id']=s['bundle_id']
for d in s['documents']: d['source_url']=sys.argv[2]
draft=prepare_storage(r,s,source_name='Illustrative Stage 7 fixture')
draft['source_evidence']=s['documents']
Path(sys.argv[1]).write_text(json.dumps(draft))
`,
        join(root, 'draft.json'),
        sourceUrl,
      ],
      { env: { ...process.env, PYTHONPATH: 'services/ai' } },
    );
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const env = {
      ...process.env,
      PYTHONPATH: 'services/ai',
      BASE_URL: address,
      INGEST_TOKEN: token,
    };
    const args = ['services/ai/review_publication.py'];
    await execute(
      'services/ai/.venv/bin/python',
      [
        ...args,
        'approve',
        root,
        join(root, 'draft.json'),
        '--reviewer',
        'Fixture reviewer',
        '--note',
        'Verified illustrative source and facts',
      ],
      { env },
    );
    const publish = () =>
      execute(
        'services/ai/.venv/bin/python',
        [...args, 'publish', root, join(root, 'draft.json')],
        { env },
      );
    const first: unknown = JSON.parse((await publish()).stdout);
    // Remove only the delivery receipt: simulate losing it after a database commit.
    await rm(join(root, 'publication', 'receipts'), { recursive: true });
    const second: unknown = JSON.parse((await publish()).stdout);
    assert.deepEqual(second, first);
    const source = await prisma.source.findUniqueOrThrow({
      where: { url: sourceUrl },
    });
    assert.equal(
      await prisma.post.count({ where: { sourceId: source.id } }),
      1,
    );
    assert.equal(
      await prisma.extractionCandidate.count({ where: { sourceUrl } }),
      1,
    );
    const post = await prisma.post.findFirstOrThrow({
      where: { sourceId: source.id },
    });
    assert.ok(post.reviewedAt);
    assert.match(post.reviewNote ?? '', /Fixture reviewer/);
    assert.equal(post.minAge, null);
  },
);
