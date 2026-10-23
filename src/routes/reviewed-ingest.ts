import { createHash } from 'node:crypto';
import {
  storeExtractionCandidate,
  validateStorageEnvelope,
} from '../../scripts/store-extraction-candidate.js';
import { publishExtractionCandidate } from '../../scripts/publish-extraction-candidate.js';
import { prisma } from '../db.js';

export class ReviewSubmissionError extends Error {}

async function validateReviewedSubmission(input: unknown) {
  if (
    !input ||
    typeof input !== 'object' ||
    !('reviewed_candidate_json' in input) ||
    typeof input.reviewed_candidate_json !== 'string' ||
    Buffer.byteLength(input.reviewed_candidate_json) > 1_000_000 ||
    !('approval' in input) ||
    !input.approval ||
    typeof input.approval !== 'object'
  )
    throw new Error('Invalid reviewed submission');
  const approval = input.approval;
  if (
    !('draft_sha256' in approval) ||
    typeof approval.draft_sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(approval.draft_sha256) ||
    !('reviewed_by' in approval) ||
    typeof approval.reviewed_by !== 'string' ||
    !approval.reviewed_by.trim() ||
    approval.reviewed_by.length > 100 ||
    !('note' in approval) ||
    typeof approval.note !== 'string' ||
    !approval.note.trim() ||
    approval.note.length > 1500 ||
    /[\u0000-\u001f\u007f]/u.test(approval.reviewed_by + approval.note)
  )
    throw new Error('Explicit review required');
  const digest = createHash('sha256')
    .update(input.reviewed_candidate_json)
    .digest('hex');
  if (digest !== approval.draft_sha256)
    throw new Error('Reviewed draft changed');
  const raw: unknown = JSON.parse(input.reviewed_candidate_json);
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('disposition' in raw) ||
    raw.disposition !== 'valid_recruitment_review_draft' ||
    !('facts' in raw) ||
    !raw.facts ||
    typeof raw.facts !== 'object' ||
    !('purpose' in raw.facts) ||
    raw.facts.purpose !== 'recruitment'
  )
    throw new Error('Recruitment draft required');
  const envelope = await validateStorageEnvelope(raw);
  if (!('bundle_id' in approval) || approval.bundle_id !== envelope.bundle_id)
    throw new Error('Reviewed identity changed');
  return {
    envelope,
    digest,
    reviewNote: `${approval.reviewed_by.trim()}: ${approval.note.trim()}`,
  };
}

export async function ingestReviewedCandidate(
  input: unknown,
  database = prisma,
) {
  const { envelope, digest, reviewNote } = await validateReviewedSubmission(
    input,
  ).catch(() => {
    throw new ReviewSubmissionError('Invalid reviewed submission');
  });
  const saved = await storeExtractionCandidate(envelope, database);
  const posts = await publishExtractionCandidate(
    saved.id,
    saved.contentHash,
    reviewNote,
    database,
  );
  return {
    candidate_id: saved.id,
    content_hash: saved.contentHash,
    draft_sha256: digest,
    post_ids: posts.map((post) => post.id),
  };
}
