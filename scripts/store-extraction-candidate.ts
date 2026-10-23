import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import { Prisma } from '../generated/prisma/index.js';
import { prisma } from '../src/db.js';

interface CandidateEnvelope {
  bundle_id: string;
  source_url: string;
  source_name: string;
  facts: Prisma.InputJsonObject;
  review: Prisma.InputJsonObject;
  evidence_units: Prisma.InputJsonObject[];
}

function canonical(value: unknown): unknown {
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Invalid numeric value');
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export async function validateStorageEnvelope(
  input: unknown,
): Promise<CandidateEnvelope> {
  const schema: unknown = JSON.parse(
    await readFile(
      new URL('../services/ai/candidate-storage.schema.json', import.meta.url),
      'utf8',
    ),
  );
  // Reuse the installed validator offline: no listening socket or public route.
  const checker = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
        useDefaults: false,
      },
    },
  });
  checker.post<{ Body: CandidateEnvelope }>(
    '/',
    { schema: { body: schema } },
    (request, reply) => reply.send(request.body),
  );
  try {
    const response = await checker.inject({
      method: 'POST',
      url: '/',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(canonical(input)),
    });
    if (response.statusCode !== 200)
      throw new Error('Invalid candidate storage envelope');
    const envelope = response.json<CandidateEnvelope>();
    const url = new URL(envelope.source_url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error('Invalid candidate source URL');
    return envelope;
  } finally {
    await checker.close();
  }
}

export function candidateContentHash(input: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(input)))
    .digest('hex');
}

export async function storeExtractionCandidate(
  input: unknown,
  database: Pick<Prisma.TransactionClient, 'extractionCandidate'> = prisma,
) {
  const envelope = await validateStorageEnvelope(input);
  // Hash precisely the immutable fields stored in PostgreSQL. Worker metadata
  // is not persisted here and must not make reconstruction fail at publication.
  const contentHash = candidateContentHash({
    bundle_id: envelope.bundle_id,
    source_url: envelope.source_url,
    source_name: envelope.source_name,
    facts: envelope.facts,
    review: envelope.review,
    evidence_units: envelope.evidence_units,
  });
  // Immutable, content-addressed drafts: repeat/concurrent runs share one row.
  return database.extractionCandidate.upsert({
    where: { contentHash },
    // An identical update enables PostgreSQL's atomic conflict-handling path.
    update: { contentHash },
    create: {
      bundleId: envelope.bundle_id,
      sourceUrl: envelope.source_url,
      sourceName: envelope.source_name,
      contentHash,
      status: 'needs_review',
      facts: envelope.facts,
      review: envelope.review,
      evidenceUnits: envelope.evidence_units,
    },
    select: { id: true, status: true, contentHash: true },
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const filename = process.argv[2];
    if (!filename || (await stat(filename)).size > 1_048_576)
      throw new Error('Candidate file missing or too large');
    const input: unknown = JSON.parse(await readFile(filename, 'utf8'));
    const saved = await storeExtractionCandidate(input);
    console.log(
      JSON.stringify({
        status: 'draft_saved',
        candidate_id: saved.id,
        review_status: saved.status,
        publication_allowed: false,
      }),
    );
  } catch {
    console.error(
      JSON.stringify({ status: 'blocked', reason: 'candidate_storage_failed' }),
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
