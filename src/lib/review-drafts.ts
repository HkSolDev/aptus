import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import type { Prisma } from '../../generated/prisma/index.js';
import {
  candidateContentHash,
  validateStorageEnvelope,
} from '../../scripts/store-extraction-candidate.js';

export class StaleRevisionError extends Error {
  constructor(message = 'Revision is stale. Reload candidate to see newer changes.') {
    super(message);
    this.name = 'StaleRevisionError';
  }
}

export class ReviewDraftValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewDraftValidationError';
  }
}

export interface ReviewDraftImportInput {
  bundle_id: string;
  source_url: string;
  source_name: string;
  disposition?: string;
  facts: Record<string, unknown>;
  review: Record<string, unknown>;
  evidence_units: Array<Record<string, unknown>>;
  source_evidence?: Array<Record<string, unknown>>;
  hold_reason?: string | null;
}

export async function importReviewDraft(
  input: unknown,
  database = prisma,
) {
  let rawString: string | null = null;
  let parsed: unknown = input;

  if (typeof input === 'string') {
    if (Buffer.byteLength(input) > 1_048_576) {
      throw new ReviewDraftValidationError('Draft payload exceeds 1MB limit');
    }
    rawString = input;
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new ReviewDraftValidationError('Malformed JSON payload');
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new ReviewDraftValidationError('Draft payload must be an object');
  }

  const rawObj = parsed as Record<string, unknown>;
  if (
    'disposition' in rawObj &&
    rawObj.disposition !== 'valid_recruitment_review_draft'
  ) {
    throw new ReviewDraftValidationError(
      'Only valid recruitment review drafts can be imported',
    );
  }

  // Preserve hold_reason in metadata if passed at root
  if (typeof rawObj.hold_reason === 'string' && rawObj.hold_reason.trim()) {
    const existingMeta =
      rawObj.metadata && typeof rawObj.metadata === 'object'
        ? (rawObj.metadata as Record<string, unknown>)
        : {};
    rawObj.metadata = { ...existingMeta, hold_reason: rawObj.hold_reason.trim() };
    delete rawObj.hold_reason;
  }

  const rawDigest = rawString
    ? createHash('sha256').update(rawString).digest('hex')
    : null;

  const envelope = await validateStorageEnvelope(rawObj).catch((error: Error) => {
    throw new ReviewDraftValidationError(error.message);
  });

  const canonicalHash = candidateContentHash(envelope.facts);
  const sourceEvidence = Array.isArray(rawObj.source_evidence)
    ? (rawObj.source_evidence as unknown as Prisma.InputJsonValue)
    : ([] as unknown as Prisma.InputJsonValue);

  const metadataObj =
    rawObj.metadata && typeof rawObj.metadata === 'object'
      ? (rawObj.metadata as Record<string, unknown>)
      : {};
  const holdReason =
    typeof metadataObj.hold_reason === 'string' && metadataObj.hold_reason.trim()
      ? metadataObj.hold_reason.trim()
      : 'Held for operator review';

  return database.$transaction(async (tx) => {
    // Touch the row inside this transaction to hold its row lock until commit.
    await tx.reviewItem
      .update({ where: { bundleId: envelope.bundle_id }, data: { updatedAt: new Date() } })
      .catch(() => undefined);
    const existingItem = await tx.reviewItem.findUnique({
      where: { bundleId: envelope.bundle_id },
      include: {
        revisions: {
          orderBy: { revisionNumber: 'desc' },
        },
      },
    });

    if (existingItem) {
      // Check if any revision matches this canonical hash exactly
      const matchingRev = existingItem.revisions.find(
        (r) => r.canonicalHash === canonicalHash,
      );
      if (matchingRev) {
        return {
          itemId: existingItem.id,
          bundleId: existingItem.bundleId,
          revisionId: matchingRev.id,
          revisionNumber: matchingRev.revisionNumber,
          canonicalHash,
          duplicate: true,
        };
      }

      // Human corrections are identified by provenance: worker imports are
      // createdBy 'worker_import', human saves by the operator email.
      // New worker output must not overwrite a human correction.
      const hasHumanCorrections = existingItem.revisions.some(
        (r) => r.createdBy !== 'worker_import',
      );
      const nextRevNumber =
        Math.max(...existingItem.revisions.map((r) => r.revisionNumber)) + 1;

      const newRev = await tx.reviewRevision.create({
        data: {
          reviewItemId: existingItem.id,
          revisionNumber: nextRevNumber,
          facts: envelope.facts,
          sourceEvidence,
          evidenceUnits: envelope.evidence_units,
          rawDigest,
          canonicalHash,
          createdBy: 'worker_import',
          validationState: 'none',
        },
      });

      if (!hasHumanCorrections) {
        await tx.reviewItem.update({
          where: { id: existingItem.id },
          data: {
            currentRevisionId: newRev.id,
            updatedAt: new Date(),
          },
        });
      }

      return {
        itemId: existingItem.id,
        bundleId: existingItem.bundleId,
        revisionId: newRev.id,
        revisionNumber: newRev.revisionNumber,
        canonicalHash,
        duplicate: false,
      };
    }

    // New review item
    const newItem = await tx.reviewItem.create({
      data: {
        bundleId: envelope.bundle_id,
        sourceUrl: envelope.source_url,
        sourceName: envelope.source_name,
        status: 'held',
        holdReason,
      },
    });

    const newRev = await tx.reviewRevision.create({
      data: {
        reviewItemId: newItem.id,
        revisionNumber: 1,
        facts: envelope.facts,
        sourceEvidence,
        evidenceUnits: envelope.evidence_units,
        rawDigest,
        canonicalHash,
        createdBy: 'worker_import',
        validationState: 'none',
      },
    });

    await tx.reviewItem.update({
      where: { id: newItem.id },
      data: { currentRevisionId: newRev.id },
    });

    return {
      itemId: newItem.id,
      bundleId: newItem.bundleId,
      revisionId: newRev.id,
      revisionNumber: 1,
      canonicalHash,
      duplicate: false,
    };
  });
}

export async function listReviewQueue(
  options: {
    status?: string;
    limit?: number;
    cursor?: string;
  } = {},
  database = prisma,
) {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const where: Prisma.ReviewItemWhereInput = {};

  if (options.status && options.status !== 'all') {
    where.status = options.status;
  }

  const [totalCount, items] = await Promise.all([
    database.reviewItem.count({ where }),
    database.reviewItem.findMany({
      where,
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        currentRevision: {
          select: {
            id: true,
            revisionNumber: true,
            canonicalHash: true,
            validationState: true,
            createdBy: true,
            createdAt: true,
            facts: true,
          },
        },
      },
    }),
  ]);

  let nextCursor: string | null = null;
  if (items.length > limit) {
    items.pop();
    // Cursor is the last returned item; the next request skips past it.
    nextCursor = items[items.length - 1]?.id ?? null;
  }

  const queueItems = items.map((item) => {
    const facts = item.currentRevision?.facts as Record<string, unknown> | null;
    const posts = Array.isArray(facts?.posts) ? facts.posts : [];
    const firstPost = posts[0] as Record<string, unknown> | undefined;
    const title =
      typeof firstPost?.post_name === 'string'
        ? `${firstPost.post_name} — ${item.sourceName}`
        : item.sourceName;

    return {
      id: item.id,
      bundle_id: item.bundleId,
      title,
      source_name: item.sourceName,
      source_url: item.sourceUrl,
      role_count: posts.length,
      status: item.status,
      hold_reason: item.holdReason,
      current_revision: item.currentRevision
        ? {
            id: item.currentRevision.id,
            revision_number: item.currentRevision.revisionNumber,
            canonical_hash: item.currentRevision.canonicalHash,
            validation_state: item.currentRevision.validationState,
            created_by: item.currentRevision.createdBy,
            created_at: item.currentRevision.createdAt.toISOString(),
          }
        : null,
      updated_at: item.updatedAt.toISOString(),
    };
  });

  return {
    items: queueItems,
    next_cursor: nextCursor,
    counts_as_of: new Date().toISOString(),
    total_items: totalCount,
  };
}

export async function getReviewItemDetail(
  itemId: string,
  database = prisma,
) {
  const item = await database.reviewItem.findUnique({
    where: { id: itemId },
    include: {
      currentRevision: {
        include: {
          validationTasks: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  });

  if (!item || !item.currentRevision) return null;

  const rev = item.currentRevision;
  const latestTask = rev.validationTasks[0] ?? null;

  return {
    item: {
      id: item.id,
      bundle_id: item.bundleId,
      source_name: item.sourceName,
      source_url: item.sourceUrl,
      status: item.status,
      hold_reason: item.holdReason,
      updated_at: item.updatedAt.toISOString(),
    },
    revision: {
      id: rev.id,
      revision_number: rev.revisionNumber,
      canonical_hash: rev.canonicalHash,
      change_reason: rev.changeReason,
      created_by: rev.createdBy,
      created_at: rev.createdAt.toISOString(),
      validation_state: rev.validationState,
      facts: rev.facts,
      evidence_units: rev.evidenceUnits,
      source_evidence: rev.sourceEvidence,
    },
    latest_validation: latestTask
      ? {
          task_id: latestTask.id,
          status: latestTask.status,
          validator_version: latestTask.validatorVersion,
          result: latestTask.result,
          error_details: latestTask.errorDetails,
          created_at: latestTask.createdAt.toISOString(),
          updated_at: latestTask.updatedAt.toISOString(),
        }
      : null,
  };
}

export async function saveReviewCorrection(
  itemId: string,
  input: {
    baseRevisionId: string;
    facts: Record<string, unknown>;
    changeReason: string;
    operatorEmail: string;
  },
  database = prisma,
) {
  const { baseRevisionId, facts, changeReason, operatorEmail } = input;

  if (!changeReason || !changeReason.trim()) {
    throw new ReviewDraftValidationError('A reason for the correction is required');
  }

  return database.$transaction(async (tx) => {
    // Serialize saves for this item so the base check and revision
    // allocation cannot race a simultaneous save or worker import.
    await tx.reviewItem
      .update({ where: { id: itemId }, data: { updatedAt: new Date() } })
      .catch(() => undefined);
    const item = await tx.reviewItem.findUnique({
      where: { id: itemId },
      include: {
        currentRevision: true,
      },
    });

    if (!item) {
      throw new ReviewDraftValidationError('Candidate item not found');
    }

    if (!item.currentRevision || item.currentRevision.id !== baseRevisionId) {
      throw new StaleRevisionError();
    }

    const baseRev = item.currentRevision;

    // Validate the updated facts by wrapping in a candidate envelope
    const envelopeCandidate = {
      bundle_id: item.bundleId,
      source_url: item.sourceUrl,
      source_name: item.sourceName,
      facts,
      review: {
        status: 'needs_review',
        warnings: [],
        semantic_support_verified: false,
        publication_allowed: false,
        bundle_identity: {},
        field_checks: [],
      },
      evidence_units: baseRev.evidenceUnits,
    };

    const envelope = await validateStorageEnvelope(envelopeCandidate).catch(
      (err: Error) => {
        throw new ReviewDraftValidationError(`Invalid facts: ${err.message}`);
      },
    );

    const canonicalHash = candidateContentHash(envelope.facts);
    // Allocate above every existing revision, including non-current worker
    // observations, so they cannot collide with the next human correction.
    const highest = await tx.reviewRevision.findFirst({
      where: { reviewItemId: item.id },
      orderBy: { revisionNumber: 'desc' },
      select: { revisionNumber: true },
    });
    const nextRevisionNumber = (highest?.revisionNumber ?? baseRev.revisionNumber) + 1;

    const newRev = await tx.reviewRevision.create({
      data: {
        reviewItemId: item.id,
        revisionNumber: nextRevisionNumber,
        parentRevisionId: baseRev.id,
        facts: envelope.facts,
        sourceEvidence: baseRev.sourceEvidence as Prisma.InputJsonValue,
        evidenceUnits: baseRev.evidenceUnits as Prisma.InputJsonValue,
        canonicalHash,
        changeReason: changeReason.trim(),
        createdBy: operatorEmail,
        validationState: 'none',
      },
    });

    await tx.reviewItem.update({
      where: { id: item.id },
      data: {
        currentRevisionId: newRev.id,
        updatedAt: new Date(),
      },
    });

    return {
      revisionId: newRev.id,
      revisionNumber: nextRevisionNumber,
      canonicalHash,
      validationState: 'none',
    };
  });
}

export async function requestValidation(
  itemId: string,
  revisionId: string,
  validatorVersion = 'aptus-val-v1',
  database = prisma,
) {
  return database.$transaction(async (tx) => {
    const item = await tx.reviewItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      throw new ReviewDraftValidationError('Review item not found');
    }

    const revision = await tx.reviewRevision.findUnique({
      where: { id: revisionId },
    });

    if (!revision || revision.reviewItemId !== item.id) {
      throw new ReviewDraftValidationError('Revision does not belong to this item');
    }

    // Check for existing task for this exact revision and validator version
    const existingTask = await tx.validationTask.findFirst({
      where: {
        reviewRevisionId: revision.id,
        validatorVersion,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingTask) {
      if (existingTask.status === 'completed') {
        return {
          taskId: existingTask.id,
          revisionId: revision.id,
          status: 'completed',
          result: existingTask.result,
          reused: true,
        };
      }
      if (
        existingTask.status === 'running' &&
        existingTask.claimExpiresAt &&
        existingTask.claimExpiresAt.getTime() > Date.now()
      ) {
        return {
          taskId: existingTask.id,
          revisionId: revision.id,
          status: 'running',
          reused: true,
        };
      }
      if (existingTask.status === 'pending') {
        return {
          taskId: existingTask.id,
          revisionId: revision.id,
          status: 'pending',
          reused: true,
        };
      }
    }

    // Create durable pending task
    const task = await tx.validationTask.create({
      data: {
        reviewRevisionId: revision.id,
        validatorVersion,
        status: 'pending',
      },
    });

    await tx.reviewRevision.update({
      where: { id: revision.id },
      data: { validationState: 'waiting_for_worker' },
    });

    return {
      taskId: task.id,
      revisionId: revision.id,
      status: 'pending',
      reused: false,
    };
  });
}

export async function getValidationStatus(
  taskId: string,
  database = prisma,
) {
  const task = await database.validationTask.findUnique({
    where: { id: taskId },
    include: {
      reviewRevision: {
        select: {
          id: true,
          revisionNumber: true,
          canonicalHash: true,
          validationState: true,
        },
      },
    },
  });

  if (!task) return null;

  return {
    taskId: task.id,
    revisionId: task.reviewRevisionId,
    status: task.status,
    validatorVersion: task.validatorVersion,
    result: task.result,
    errorDetails: task.errorDetails,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export async function claimValidationTask(
  options: {
    workerId?: string;
    leaseSeconds?: number;
  } = {},
  database = prisma,
) {
  const leaseSeconds = options.leaseSeconds ?? 60;
  const now = new Date();

  return database.$transaction(async (tx) => {
    // Atomic conditional claim: the update only succeeds while the task is
    // still pending or its lease has expired, so overlapping workers cannot
    // both own it. Retry a few times if another task was claimed first.
    let candidateTask = null;
    let claimToken = '';
    for (let attempt = 0; attempt < 5 && !candidateTask; attempt++) {
      const found = await tx.validationTask.findFirst({
        where: {
          OR: [
            { status: 'pending' },
            {
              status: 'running',
              claimExpiresAt: { lt: now },
            },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          reviewRevision: {
            include: {
              reviewItem: true,
            },
          },
        },
      });
      if (!found) return null;
      claimToken = randomUUID();
      const claimExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);
      const claimed = await tx.validationTask.updateMany({
        where: {
          id: found.id,
          OR: [
            { status: 'pending' },
            { status: 'running', claimExpiresAt: { lt: now } },
          ],
        },
        data: {
          status: 'running',
          claimToken,
          claimExpiresAt,
          updatedAt: now,
        },
      });
      if (claimed.count === 1) candidateTask = found;
    }
    if (!candidateTask) return null;
    const updatedTask = { id: candidateTask.id };

    await tx.reviewRevision.update({
      where: { id: candidateTask.reviewRevisionId },
      data: { validationState: 'checking' },
    });

    return {
      taskId: updatedTask.id,
      task_id: updatedTask.id,
      revisionId: candidateTask.reviewRevisionId,
      revision_id: candidateTask.reviewRevisionId,
      revisionHash: candidateTask.reviewRevision.canonicalHash,
      revision_hash: candidateTask.reviewRevision.canonicalHash,
      bundleId: candidateTask.reviewRevision.reviewItem.bundleId,
      bundle_id: candidateTask.reviewRevision.reviewItem.bundleId,
      facts: candidateTask.reviewRevision.facts,
      sourceEvidence: candidateTask.reviewRevision.sourceEvidence,
      source_evidence: candidateTask.reviewRevision.sourceEvidence,
      claimToken,
      claim_token: claimToken,
    };
  });
}

export async function submitValidationResult(
  taskId: string,
  input: {
    claimToken: string;
    revisionHash: string;
    validatorVersion?: string;
    result: Record<string, unknown>;
  },
  database = prisma,
) {
  const { claimToken, revisionHash, validatorVersion = 'aptus-val-v1', result } = input;

  return database.$transaction(async (tx) => {
    const task = await tx.validationTask.findUnique({
      where: { id: taskId },
      include: {
        reviewRevision: true,
      },
    });

    if (!task) {
      throw new ReviewDraftValidationError('Validation task not found');
    }

    if (task.claimToken !== claimToken) {
      throw new ReviewDraftValidationError('Invalid or expired claim token');
    }

    if (task.reviewRevision.canonicalHash !== revisionHash) {
      throw new ReviewDraftValidationError(
        'Revision hash mismatch: task result does not match revision content',
      );
    }

    const errors = Array.isArray(result.errors) ? result.errors : [];
    const validationState = errors.length > 0 ? 'completed_with_issues' : 'checks_passed';

    await tx.validationTask.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        validatorVersion,
        result: result as unknown as Prisma.InputJsonValue,
        claimToken: null,
        claimExpiresAt: null,
        updatedAt: new Date(),
      },
    });

    // Update ONLY this specific revision's validationState
    await tx.reviewRevision.update({
      where: { id: task.reviewRevisionId },
      data: { validationState },
    });

    return {
      taskId: task.id,
      status: 'completed',
      validationState,
    };
  });
}

export async function reportValidationFailure(
  taskId: string,
  input: {
    claimToken: string;
    errorDetails: string;
  },
  database = prisma,
) {
  const { claimToken, errorDetails } = input;

  return database.$transaction(async (tx) => {
    const task = await tx.validationTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new ReviewDraftValidationError('Validation task not found');
    }

    if (task.claimToken !== claimToken) {
      throw new ReviewDraftValidationError('Invalid or expired claim token');
    }

    await tx.validationTask.update({
      where: { id: task.id },
      data: {
        status: 'failed',
        errorDetails,
        claimToken: null,
        claimExpiresAt: null,
        updatedAt: new Date(),
      },
    });

    await tx.reviewRevision.update({
      where: { id: task.reviewRevisionId },
      data: { validationState: 'failed' },
    });

    return {
      taskId: task.id,
      status: 'failed',
    };
  });
}

export async function keepReviewItemHeld(
  itemId: string,
  input: {
    holdReason?: string;
  },
  database = prisma,
) {
  const item = await database.reviewItem.findUnique({
    where: { id: itemId },
  });

  if (!item) {
    throw new ReviewDraftValidationError('Review item not found');
  }

  const updated = await database.reviewItem.update({
    where: { id: itemId },
    data: {
      status: 'held',
      ...(input.holdReason ? { holdReason: input.holdReason.trim() } : {}),
      updatedAt: new Date(),
    },
  });

  return {
    itemId: updated.id,
    status: updated.status,
    holdReason: updated.holdReason,
  };
}
