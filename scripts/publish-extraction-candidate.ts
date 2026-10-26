import { pathToFileURL } from 'node:url';
import { prisma } from '../src/db.js';
import {
  EducationLevel,
  PostGroup,
  Prisma,
} from '../generated/prisma/index.js';
import {
  candidateContentHash,
  validateStorageEnvelope,
} from './store-extraction-candidate.js';

const numberOrNull = (value: Prisma.InputJsonValue | null | undefined) =>
  typeof value === 'number' ? value : null;
const stringOrNull = (value: Prisma.InputJsonValue | null | undefined) =>
  typeof value === 'string' ? value : null;
const dateOrNull = (value: Prisma.InputJsonValue | null | undefined) =>
  typeof value === 'string' ? new Date(value) : null;

export async function publishExtractionCandidate(
  candidateId: string,
  expectedHash: string,
  reviewNote: string,
  database = prisma,
) {
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(candidateId) ||
    !/^[a-f0-9]{64}$/.test(expectedHash) ||
    !reviewNote.trim() ||
    reviewNote.length > 2000
  )
    throw new Error('Publication requires an identified reviewed draft');
  return database.$transaction(
    async (db) => {
      const candidate = await db.extractionCandidate.findUniqueOrThrow({
        where: { id: candidateId },
      });
      if (
        candidate.contentHash !== expectedHash ||
        candidate.status !== 'needs_review'
      )
        throw new Error('Reviewed candidate changed');
      const envelope = await validateStorageEnvelope({
        bundle_id: candidate.bundleId,
        source_url: candidate.sourceUrl,
        source_name: candidate.sourceName,
        facts: candidate.facts,
        review: candidate.review,
        evidence_units: candidate.evidenceUnits,
      });
      if (candidateContentHash(envelope) !== expectedHash)
        throw new Error('Reviewed candidate contents changed');
      const posts = envelope.facts.posts;
      if (!Array.isArray(posts) || !posts.length)
        throw new Error('No reviewed posts');
      const source = await db.source.upsert({
        where: { url: candidate.sourceUrl },
        update: {},
        create: { url: candidate.sourceUrl, name: candidate.sourceName },
      });
      // A changed draft must never silently replace a previously published source.
      const unrelated = await db.post.count({
        where: {
          sourceId: source.id,
          OR: [
            { extractionCandidateId: null },
            { extractionCandidateId: { not: candidate.id } },
          ],
        },
      });
      if (unrelated)
        throw new Error(
          'Source already published; review replacement separately',
        );
      const saved = [];
      const rows: unknown[] = posts;
      for (const [index, raw] of rows.entries()) {
        if (
          !raw ||
          typeof raw !== 'object' ||
          Array.isArray(raw) ||
          !('post_name' in raw) ||
          typeof raw.post_name !== 'string'
        )
          throw new Error('Invalid reviewed post');
        const details = raw as Prisma.InputJsonObject;
        const data: Prisma.PostUncheckedCreateInput = {
          sourceId: source.id,
          postName: raw.post_name,
          organization: stringOrNull(details.recruiting_body),
          postGroup:
            Object.values(PostGroup).find((v) => v === details.post_group) ??
            null,
          payLevel: stringOrNull(details.pay_level),
          minAge: numberOrNull(details.min_age),
          maxAge: numberOrNull(details.max_age),
          vacancies: numberOrNull(details.vacancies),
          applicationLastDate: dateOrNull(details.application_last_date),
          ageAsOnDate: dateOrNull(details.age_as_on_date),
          educationRequired: stringOrNull(details.education_required),
          minEducationLevel:
            Object.values(EducationLevel).find(
              (v) => v === details.min_education_level,
            ) ?? null,
          minMarksPercent: numberOrNull(details.min_marks_percent),
          categoryRelaxationApplies:
            typeof details.category_relaxation_applies === 'boolean'
              ? details.category_relaxation_applies
              : null,
          categoryRelaxationRules:
            details.category_relaxation_rules ?? Prisma.DbNull,
          eligibilityRules: details.eligibility_rules ?? Prisma.DbNull,
          extractionCandidateId: candidate.id,
          candidatePostIndex: index,
          reviewedDetails: details,
          reviewedAt: new Date(),
          reviewNote: reviewNote.trim(),
        };
        saved.push(
          await db.post.upsert({
            where: {
              extractionCandidateId_candidatePostIndex: {
                extractionCandidateId: candidate.id,
                candidatePostIndex: index,
              },
            },
            update: {},
            create: data,
            select: { id: true, postName: true },
          }),
        );
      }
      return saved;
    },
    // Multi-post publication includes several remote database round trips.
    { isolationLevel: 'Serializable', timeout: 60000 },
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [id, hash, note] = process.argv.slice(2);
    if (!id || !hash || !note) throw new Error('Missing review');
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      throw new Error('Local trials only');
    console.log(
      JSON.stringify({
        status: 'published_locally',
        posts: await publishExtractionCandidate(id, hash, note),
      }),
    );
  } catch {
    console.error(
      JSON.stringify({
        status: 'blocked',
        reason: 'candidate_publication_failed',
      }),
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
