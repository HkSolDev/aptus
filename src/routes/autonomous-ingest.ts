import {
  EducationLevel,
  PostGroup,
  Prisma,
} from '../../generated/prisma/index.js';
import {
  storeExtractionCandidate,
  validateStorageEnvelope,
} from '../../scripts/store-extraction-candidate.js';
import { validatePost } from '../../scripts/validate-post.js';
import { prisma } from '../db.js';

export class AutonomousIngestError extends Error {}

const OFFICIAL_AUTHORITIES = new Set([
  'official',
  'official_notification',
  'official_host_candidate',
  'official_portal',
  'official_pdf',
]);

const numberOrNull = (value: Prisma.InputJsonValue | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const stringOrNull = (value: Prisma.InputJsonValue | null | undefined) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const dateOrNull = (value: Prisma.InputJsonValue | null | undefined) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOfficialAuthority(authority: unknown): boolean {
  return (
    typeof authority === 'string' &&
    OFFICIAL_AUTHORITIES.has(authority.trim().toLowerCase())
  );
}

function hasPostQualification(post: Record<string, unknown>): boolean {
  if (
    typeof post.education_required === 'string' &&
    post.education_required.trim()
  ) {
    return true;
  }
  if (
    typeof post.min_education_level === 'string' &&
    post.min_education_level.trim()
  ) {
    return true;
  }
  const rules = isRecord(post.eligibility_rules)
    ? post.eligibility_rules
    : null;
  const options = Array.isArray(rules?.education_options)
    ? rules.education_options
    : [];
  return options.some(
    (opt) =>
      isRecord(opt) &&
      ((typeof opt.qualification === 'string' && opt.qualification.trim()) ||
        (typeof opt.minimum_level === 'string' && opt.minimum_level.trim())),
  );
}

function hasSecondaryCoreMetric(post: Record<string, unknown>): boolean {
  if (typeof post.vacancies === 'number' && post.vacancies >= 0) return true;
  if (typeof post.min_age === 'number' || typeof post.max_age === 'number') {
    return true;
  }
  const rules = isRecord(post.eligibility_rules)
    ? post.eligibility_rules
    : null;
  const ageRules = Array.isArray(rules?.age_rules) ? rules.age_rules : [];
  if (
    ageRules.some(
      (r) =>
        isRecord(r) &&
        (typeof r.min_age === 'number' || typeof r.max_age === 'number'),
    )
  ) {
    return true;
  }
  const expRules = Array.isArray(post.experience_rules)
    ? post.experience_rules
    : [];
  return expRules.some(
    (r) =>
      isRecord(r) &&
      typeof r.minimum_years === 'number' &&
      r.minimum_years >= 0,
  );
}

function verifyAcceptedEnvelopeDeterministically(
  envelope: Awaited<ReturnType<typeof validateStorageEnvelope>>,
  noticeIdentity: Record<string, unknown>,
  historicalCutoffs: unknown,
): void {
  const issuer =
    typeof noticeIdentity.issuer === 'string'
      ? noticeIdentity.issuer.trim()
      : '';
  const adv =
    typeof noticeIdentity.advertisement_number === 'string'
      ? noticeIdentity.advertisement_number.trim()
      : typeof noticeIdentity.campaign === 'string'
        ? noticeIdentity.campaign.trim()
        : '';
  if (!issuer || !adv) {
    throw new AutonomousIngestError(
      'Accepted notice requires verified identity',
    );
  }
  if (
    'authority' in noticeIdentity &&
    noticeIdentity.authority != null &&
    !isOfficialAuthority(noticeIdentity.authority)
  ) {
    throw new AutonomousIngestError(
      'Accepted notice requires official authority',
    );
  }

  if (Array.isArray(historicalCutoffs)) {
    for (const item of historicalCutoffs) {
      if (!isRecord(item) || item.reference_only !== true) {
        throw new AutonomousIngestError(
          'Historical cutoffs must be marked reference_only=true',
        );
      }
    }
  }

  const unitsById = new Map<string, Record<string, unknown>>();
  for (const unit of envelope.evidence_units) {
    if (!isRecord(unit) || typeof unit.evidence_id !== 'string') {
      throw new AutonomousIngestError(
        'Invalid evidence unit on accepted notice',
      );
    }
    if (!isOfficialAuthority(unit.authority)) {
      throw new AutonomousIngestError(
        'Accepted notice cannot rely on non-official evidence unit',
      );
    }
    if (!Array.isArray(unit.locations) || unit.locations.length === 0) {
      throw new AutonomousIngestError(
        'Accepted evidence unit missing page/locator provenance',
      );
    }
    unitsById.set(unit.evidence_id, unit);
  }

  const citations = Array.isArray(envelope.facts.evidence)
    ? envelope.facts.evidence
    : [];
  for (const cit of citations) {
    if (
      !isRecord(cit) ||
      typeof cit.evidence_id !== 'string' ||
      typeof cit.quote !== 'string' ||
      !cit.quote.trim() ||
      !unitsById.has(cit.evidence_id)
    ) {
      throw new AutonomousIngestError(
        'Accepted notice has ungrounded or unquoted citation',
      );
    }
  }

  const posts = Array.isArray(envelope.facts.posts) ? envelope.facts.posts : [];
  if (posts.length === 0) {
    throw new AutonomousIngestError(
      'Accepted notice requires at least one post',
    );
  }

  for (const rawPost of posts) {
    if (!isRecord(rawPost)) {
      throw new AutonomousIngestError('Invalid post in accepted notice');
    }
    const postName =
      typeof rawPost.post_name === 'string' ? rawPost.post_name.trim() : '';
    const recruitingBody =
      typeof rawPost.recruiting_body === 'string'
        ? rawPost.recruiting_body.trim()
        : '';
    const lastDate = dateOrNull(
      rawPost.application_last_date as Prisma.InputJsonValue,
    );
    if (
      !postName ||
      !recruitingBody ||
      !lastDate ||
      !hasPostQualification(rawPost) ||
      !hasSecondaryCoreMetric(rawPost)
    ) {
      throw new AutonomousIngestError(
        `Core publication fields incomplete for post ${postName || '<unnamed>'}`,
      );
    }

    const minAge = numberOrNull(rawPost.min_age as Prisma.InputJsonValue);
    const maxAge = numberOrNull(rawPost.max_age as Prisma.InputJsonValue);
    const minMarks = numberOrNull(
      rawPost.min_marks_percent as Prisma.InputJsonValue,
    );
    const allQuotes = citations
      .map((c) => (isRecord(c) && typeof c.quote === 'string' ? c.quote : ''))
      .join('\n');
    const validatedBounds = validatePost(
      {
        minAge,
        maxAge,
        minMarksPercent: minMarks,
        categoryRelaxationRules: {},
      },
      allQuotes,
    );
    if (
      (minAge !== null && validatedBounds.minAge === null) ||
      (maxAge !== null && validatedBounds.maxAge === null) ||
      (minMarks !== null && validatedBounds.minMarksPercent === null)
    ) {
      throw new AutonomousIngestError(
        `Deterministic numeric bounds check failed for post ${postName}`,
      );
    }
  }
}

function buildPostDataFromDetails(
  sourceId: string,
  candidateId: string,
  index: number,
  details: Prisma.InputJsonObject,
  reviewNote: string,
) {
  return {
    sourceId,
    postName:
      typeof details.post_name === 'string' ? details.post_name.trim() : '',
    organization: stringOrNull(details.recruiting_body),
    postGroup:
      Object.values(PostGroup).find((v) => v === details.post_group) ?? null,
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
    categoryRelaxationRules: details.category_relaxation_rules ?? Prisma.DbNull,
    eligibilityRules: details.eligibility_rules ?? Prisma.DbNull,
    extractionCandidateId: candidateId,
    candidatePostIndex: index,
    reviewedDetails: details,
    reviewedAt: new Date(),
    reviewNote,
  };
}

export async function ingestAutonomousNotice(
  input: unknown,
  database = prisma,
) {
  if (!isRecord(input) || input.kind !== 'autonomous_notice') {
    throw new AutonomousIngestError('Invalid autonomous notice payload');
  }

  const bundleId =
    typeof input.bundleId === 'string' ? input.bundleId.trim() : '';
  const sourceName =
    typeof input.sourceName === 'string' ? input.sourceName.trim() : '';
  const sourceUrl =
    typeof input.sourceUrl === 'string' ? input.sourceUrl.trim() : '';
  const evidenceFingerprint =
    typeof input.evidenceFingerprint === 'string'
      ? input.evidenceFingerprint.trim()
      : '';
  const extractionVersion =
    typeof input.extractionVersion === 'string'
      ? input.extractionVersion.trim()
      : '';
  const decision = input.decision;
  const publicationStatus = input.publicationStatus;
  const persistenceAllowed = input.persistenceAllowed;

  if (
    !bundleId ||
    !sourceName ||
    !sourceUrl ||
    !evidenceFingerprint ||
    !extractionVersion ||
    (decision !== 'accepted' &&
      decision !== 'blocked' &&
      decision !== 'retryable') ||
    (publicationStatus !== 'published' &&
      publicationStatus !== 'blocked' &&
      publicationStatus !== 'retryable') ||
    typeof persistenceAllowed !== 'boolean'
  ) {
    throw new AutonomousIngestError(
      'Missing required autonomous notice fields',
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new AutonomousIngestError('Invalid sourceUrl');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new AutonomousIngestError('Unsupported sourceUrl protocol');
  }

  const reasonCodes = Array.isArray(input.reasonCodes)
    ? input.reasonCodes.filter((r): r is string => typeof r === 'string')
    : [];
  const retryCount =
    typeof input.retryCount === 'number' &&
    Number.isInteger(input.retryCount) &&
    input.retryCount >= 0
      ? input.retryCount
      : 0;
  const backoffSeconds =
    typeof input.backoffSeconds === 'number' &&
    Number.isInteger(input.backoffSeconds) &&
    input.backoffSeconds >= 0
      ? input.backoffSeconds
      : 0;
  const nextRetryAt =
    typeof input.nextRetryAt === 'string' && input.nextRetryAt.trim()
      ? new Date(input.nextRetryAt)
      : null;
  if (nextRetryAt && Number.isNaN(nextRetryAt.getTime())) {
    throw new AutonomousIngestError('Invalid nextRetryAt timestamp');
  }

  const toOptionalJson = (
    val: unknown,
  ): Prisma.InputJsonValue | typeof Prisma.DbNull => {
    if (val === undefined || val === null) return Prisma.DbNull;
    if (
      typeof val === 'string' ||
      typeof val === 'number' ||
      typeof val === 'boolean'
    ) {
      return val;
    }
    if (Array.isArray(val)) return val as Prisma.InputJsonArray;
    if (isRecord(val)) return val as Prisma.InputJsonObject;
    return Prisma.DbNull;
  };
  const noticeIdentity: Prisma.InputJsonObject = isRecord(input.noticeIdentity)
    ? (input.noticeIdentity as Prisma.InputJsonObject)
    : {};
  const auditLineage: Prisma.InputJsonArray = Array.isArray(input.auditLineage)
    ? (input.auditLineage as Prisma.InputJsonArray)
    : [];

  if (decision !== 'accepted') {
    if (persistenceAllowed || publicationStatus === 'published') {
      throw new AutonomousIngestError(
        'Non-accepted notice cannot allow persistence or publish',
      );
    }

    const record = await database.automatedNoticeRecord.upsert({
      where: {
        bundleId_evidenceFingerprint: {
          bundleId,
          evidenceFingerprint,
        },
      },
      update: {
        extractionVersion,
        decision,
        publicationStatus,
        persistenceAllowed: false,
        reasonCodes,
        retryCount,
        backoffSeconds,
        nextRetryAt,
        noticeIdentity,
        readerSummary: toOptionalJson(input.readerSummary),
        officialSyllabus: toOptionalJson(input.officialSyllabus),
        historicalCutoffs: toOptionalJson(input.historicalCutoffs),
        visionRecovery: toOptionalJson(input.visionRecovery),
        enrichmentCandidates: toOptionalJson(input.enrichmentCandidates),
        auditLineage,
      },
      create: {
        bundleId,
        evidenceFingerprint,
        extractionVersion,
        decision,
        publicationStatus,
        persistenceAllowed: false,
        reasonCodes,
        retryCount,
        backoffSeconds,
        nextRetryAt,
        noticeIdentity,
        readerSummary: toOptionalJson(input.readerSummary),
        officialSyllabus: toOptionalJson(input.officialSyllabus),
        historicalCutoffs: toOptionalJson(input.historicalCutoffs),
        visionRecovery: toOptionalJson(input.visionRecovery),
        enrichmentCandidates: toOptionalJson(input.enrichmentCandidates),
        auditLineage,
      },
    });

    return {
      record_id: record.id,
      decision: record.decision,
      publication_status: record.publicationStatus,
      reused_existing: false,
      post_ids: [] as string[],
    };
  }

  // Accepted path: verify all deterministic boundary gates before touching Post
  if (
    !persistenceAllowed ||
    publicationStatus !== 'published' ||
    reasonCodes.length > 0
  ) {
    throw new AutonomousIngestError(
      'Accepted notice must have persistenceAllowed=true, publicationStatus=published, and zero reasonCodes',
    );
  }
  if (!isRecord(input.draftEnvelope)) {
    throw new AutonomousIngestError('Accepted notice requires draftEnvelope');
  }

  const envelope = await validateStorageEnvelope(input.draftEnvelope).catch(
    (err: unknown) => {
      throw new AutonomousIngestError(
        err instanceof Error ? err.message : 'Invalid draftEnvelope',
      );
    },
  );
  if (envelope.bundle_id !== bundleId) {
    throw new AutonomousIngestError('bundleId mismatch with draftEnvelope');
  }

  verifyAcceptedEnvelopeDeterministically(
    envelope,
    noticeIdentity,
    input.historicalCutoffs,
  );

  // Check idempotency if the exact (bundleId, evidenceFingerprint) was already accepted
  const existingRecord = await database.automatedNoticeRecord.findUnique({
    where: {
      bundleId_evidenceFingerprint: {
        bundleId,
        evidenceFingerprint,
      },
    },
  });
  if (
    existingRecord &&
    existingRecord.decision === 'accepted' &&
    existingRecord.sourceId
  ) {
    const existingPosts = await database.post.findMany({
      where: { sourceId: existingRecord.sourceId },
      orderBy: { candidatePostIndex: 'asc' },
      select: { id: true },
    });
    return {
      record_id: existingRecord.id,
      decision: 'accepted',
      publication_status: 'published',
      reused_existing: true,
      post_ids: existingPosts.map((p) => p.id),
    };
  }

  const savedCandidate = await storeExtractionCandidate(envelope, database);

  return database.$transaction(async (db) => {
    const source = await db.source.upsert({
      where: { url: envelope.source_url },
      update: { name: envelope.source_name },
      create: { url: envelope.source_url, name: envelope.source_name },
    });

    const existingPosts = await db.post.findMany({
      where: { sourceId: source.id },
      orderBy: { candidatePostIndex: 'asc' },
    });

    const existingByTitle = new Map(
      existingPosts.map((p) => [p.postName.trim().toLowerCase(), p]),
    );

    const computedLineage: Prisma.InputJsonObject[] = (
      Array.isArray(input.auditLineage) ? input.auditLineage : []
    ).filter((item): item is Prisma.InputJsonObject => isRecord(item));

    const savedPostIds: string[] = [];
    const rawPosts: unknown[] = Array.isArray(envelope.facts.posts)
      ? envelope.facts.posts
      : [];
    const autoNote = `autonomous_acceptance:${extractionVersion}:${evidenceFingerprint.slice(0, 16)}`;

    for (const [index, raw] of rawPosts.entries()) {
      const details = raw as Prisma.InputJsonObject;
      const createData = buildPostDataFromDetails(
        source.id,
        savedCandidate.id,
        index,
        details,
        autoNote,
      );
      const priorPost = existingByTitle.get(createData.postName.toLowerCase());

      if (!priorPost) {
        const created = await db.post.create({
          data: createData,
          select: { id: true },
        });
        savedPostIds.push(created.id);
        continue;
      }

      // Stronger later official evidence updates only supported non-null fields and records auditLineage
      const updateData: Prisma.PostUncheckedUpdateInput = {
        reviewedDetails: details,
        reviewedAt: new Date(),
        reviewNote: autoNote,
      };

      const recordFieldChange = (
        fieldPath: string,
        previousValue: Prisma.InputJsonValue | null,
        newValue: Prisma.InputJsonValue | null,
      ) => {
        if (JSON.stringify(previousValue) === JSON.stringify(newValue)) return;
        const alreadyRecorded = computedLineage.some(
          (entry) =>
            entry.post_name === createData.postName &&
            entry.field_path === fieldPath &&
            entry.evidence_fingerprint === evidenceFingerprint,
        );
        if (!alreadyRecorded) {
          computedLineage.push({
            post_name: createData.postName,
            field_path: fieldPath,
            previous_value: previousValue,
            new_value: newValue,
            evidence_fingerprint: evidenceFingerprint,
            updated_at: new Date().toISOString(),
          });
        }
      };

      if (
        createData.vacancies !== null &&
        createData.vacancies !== priorPost.vacancies
      ) {
        recordFieldChange(
          'vacancies',
          priorPost.vacancies,
          createData.vacancies,
        );
        updateData.vacancies = createData.vacancies;
      }
      if (
        createData.applicationLastDate !== null &&
        priorPost.applicationLastDate?.toISOString() !==
          createData.applicationLastDate.toISOString()
      ) {
        recordFieldChange(
          'application_last_date',
          priorPost.applicationLastDate?.toISOString().slice(0, 10) ?? null,
          createData.applicationLastDate.toISOString().slice(0, 10),
        );
        updateData.applicationLastDate = createData.applicationLastDate;
      }
      if (
        createData.minAge !== null &&
        createData.minAge !== priorPost.minAge
      ) {
        recordFieldChange('min_age', priorPost.minAge, createData.minAge);
        updateData.minAge = createData.minAge;
      }
      if (
        createData.maxAge !== null &&
        createData.maxAge !== priorPost.maxAge
      ) {
        recordFieldChange('max_age', priorPost.maxAge, createData.maxAge);
        updateData.maxAge = createData.maxAge;
      }
      if (
        createData.educationRequired !== null &&
        createData.educationRequired !== priorPost.educationRequired
      ) {
        recordFieldChange(
          'education_required',
          priorPost.educationRequired,
          createData.educationRequired,
        );
        updateData.educationRequired = createData.educationRequired;
      }
      if (
        createData.minEducationLevel !== null &&
        createData.minEducationLevel !== priorPost.minEducationLevel
      ) {
        recordFieldChange(
          'min_education_level',
          priorPost.minEducationLevel,
          createData.minEducationLevel,
        );
        updateData.minEducationLevel = createData.minEducationLevel;
      }
      if (
        createData.minMarksPercent !== null &&
        createData.minMarksPercent !== priorPost.minMarksPercent
      ) {
        recordFieldChange(
          'min_marks_percent',
          priorPost.minMarksPercent,
          createData.minMarksPercent,
        );
        updateData.minMarksPercent = createData.minMarksPercent;
      }
      if (
        createData.payLevel !== null &&
        createData.payLevel !== priorPost.payLevel
      ) {
        recordFieldChange('pay_level', priorPost.payLevel, createData.payLevel);
        updateData.payLevel = createData.payLevel;
      }

      const updated = await db.post.update({
        where: { id: priorPost.id },
        data: updateData,
        select: { id: true },
      });
      savedPostIds.push(updated.id);
    }

    const record = await db.automatedNoticeRecord.upsert({
      where: {
        bundleId_evidenceFingerprint: {
          bundleId,
          evidenceFingerprint,
        },
      },
      update: {
        extractionVersion,
        decision: 'accepted',
        publicationStatus: 'published',
        persistenceAllowed: true,
        reasonCodes: [],
        retryCount: 0,
        backoffSeconds: 0,
        nextRetryAt: null,
        noticeIdentity,
        readerSummary: toOptionalJson(input.readerSummary),
        officialSyllabus: toOptionalJson(input.officialSyllabus),
        historicalCutoffs: toOptionalJson(input.historicalCutoffs),
        visionRecovery: toOptionalJson(input.visionRecovery),
        enrichmentCandidates: toOptionalJson(input.enrichmentCandidates),
        auditLineage: computedLineage,
        sourceId: source.id,
        extractionCandidateId: savedCandidate.id,
      },
      create: {
        bundleId,
        evidenceFingerprint,
        extractionVersion,
        decision: 'accepted',
        publicationStatus: 'published',
        persistenceAllowed: true,
        reasonCodes: [],
        retryCount: 0,
        backoffSeconds: 0,
        nextRetryAt: null,
        noticeIdentity,
        readerSummary: toOptionalJson(input.readerSummary),
        officialSyllabus: toOptionalJson(input.officialSyllabus),
        historicalCutoffs: toOptionalJson(input.historicalCutoffs),
        visionRecovery: toOptionalJson(input.visionRecovery),
        enrichmentCandidates: toOptionalJson(input.enrichmentCandidates),
        auditLineage: computedLineage,
        sourceId: source.id,
        extractionCandidateId: savedCandidate.id,
      },
    });

    return {
      record_id: record.id,
      candidate_id: savedCandidate.id,
      decision: record.decision,
      publication_status: record.publicationStatus,
      reused_existing: false,
      post_ids: savedPostIds,
      audit_lineage: computedLineage,
    };
  });
}
