import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Prisma } from '../generated/prisma/index.js';
import { JobDetailContent } from '../components/jobs/job-detail-content.js';
import { WorkspaceProvider } from '../components/providers/workspace-provider.js';
import { prisma } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { activeApplicationWhere } from '../src/lib/application-deadline.js';
import {
  candidateContentHash,
  validateStorageEnvelope,
} from '../scripts/store-extraction-candidate.js';
import { publishExtractionCandidate } from '../scripts/publish-extraction-candidate.js';
import { contractChecker, stub, worker } from '../scripts/contracts/support.js';

test('Python facts survive the actual publication mapper, HTTP serialization and frontend rendering', async (t) => {
  const { draft } = worker('produce');
  const envelope = await validateStorageEnvelope(draft);
  const candidate = {
    id: 'contract-candidate',
    status: 'needs_review',
    bundleId: envelope.bundle_id,
    sourceUrl: envelope.source_url,
    sourceName: envelope.source_name,
    facts: envelope.facts,
    review: envelope.review,
    evidenceUnits: envelope.evidence_units,
    contentHash: candidateContentHash({
      bundle_id: envelope.bundle_id,
      source_url: envelope.source_url,
      source_name: envelope.source_name,
      facts: envelope.facts,
      review: envelope.review,
      evidence_units: envelope.evidence_units,
    }),
  };
  let stored: Record<string, unknown> = {};
  stub(
    t,
    prisma,
    '$transaction',
    async (run: (db: typeof prisma) => Promise<unknown>) => run(prisma),
  );
  stub(
    t,
    prisma.extractionCandidate,
    'findUniqueOrThrow',
    async () => candidate,
  );
  stub(t, prisma.source, 'upsert', async () => ({ id: 'contract-source' }));
  stub(t, prisma.post, 'count', async () => 0);
  stub(
    t,
    prisma.post,
    'upsert',
    async ({ create }: { create: Record<string, unknown> }) => {
      stored = Object.fromEntries(
        Object.entries(create).map(([key, value]) => [
          key,
          value === Prisma.DbNull ? null : value,
        ]),
      );
      return { id: 'contract-post', postName: create.postName };
    },
  );
  const posts = await publishExtractionCandidate(
    candidate.id,
    candidate.contentHash,
    'Illustrative reviewed contract',
    prisma,
  );
  assert.equal(posts[0].id, 'contract-post');
  assert.equal(stored.minAge, null);
  assert.equal(stored.maxAge, 30);
  assert.equal(stored.organization, 'Example');
  assert.deepEqual(stored.reviewedDetails, draft.facts.posts[0]);
  assert.deepEqual(
    stored.eligibilityRules,
    draft.facts.posts[0].eligibility_rules,
  );

  // Only DB operations are replaced. The production mapper, select, route,
  // serializer and React view execute. This does not prove PostgreSQL behavior.
  const source = {
    name: candidate.sourceName,
    url: candidate.sourceUrl,
    notificationPdfUrl: null,
    officialSiteUrl: null,
    applyUrl: null,
    fetchedAt: new Date('2026-10-27T00:00:00Z'),
  };
  stub(
    t,
    prisma.post,
    'findUnique',
    async ({ select }: { select: Record<string, unknown> }) =>
      Object.fromEntries(
        Object.keys(select).map((key) => [
          key,
          key === 'source'
            ? source
            : key === 'id'
              ? 'contract-post'
              : stored[key],
        ]),
      ),
  );
  const app = buildApp(undefined, { AUTH_ENABLED: 'false' });
  const check = await contractChecker();
  t.after(() => app.close());
  t.after(() => check.close());
  const response = await app.inject('/api/jobs/contract-post');
  assert.equal(response.statusCode, 200);
  const job = response.json();
  await check.assert('JobDetail', job);
  assert.equal(job.educationRequired, null);
  assert.equal(job.minAge, null);
  assert.equal(job.maxAge, 30);
  assert.equal(job.source.fetchedAt, '2026-10-27T00:00:00.000Z');
  assert.equal('reviewNote' in job, false);
  const html = renderToStaticMarkup(
    createElement(
      WorkspaceProvider,
      null,
      createElement(JobDetailContent, { job }),
    ),
  );
  assert.match(html, /Engineer/);
  assert.match(html, /Example/);
  assert.match(html, /30/);
  assert.doesNotMatch(html, /Eligible for this job|Minimum 0 years/);
});

test('calendar deadlines remain open through India midnight and unknown dates stay visible', () => {
  assert.deepEqual(activeApplicationWhere(new Date('2026-10-27T18:29:59Z')), {
    OR: [
      { applicationLastDate: null },
      { applicationLastDate: { gte: new Date('2026-10-27T00:00:00Z') } },
    ],
  });
  assert.deepEqual(activeApplicationWhere(new Date('2026-10-27T18:30:00Z')), {
    OR: [
      { applicationLastDate: null },
      { applicationLastDate: { gte: new Date('2026-10-28T00:00:00Z') } },
    ],
  });
});
