CREATE TABLE "AutomatedNoticeRecord" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "evidenceFingerprint" TEXT NOT NULL,
    "extractionVersion" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "publicationStatus" TEXT NOT NULL,
    "persistenceAllowed" BOOLEAN NOT NULL DEFAULT false,
    "reasonCodes" JSONB NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "backoffSeconds" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "noticeIdentity" JSONB NOT NULL,
    "readerSummary" JSONB,
    "officialSyllabus" JSONB,
    "historicalCutoffs" JSONB,
    "visionRecovery" JSONB,
    "enrichmentCandidates" JSONB,
    "auditLineage" JSONB NOT NULL,
    "sourceId" TEXT,
    "extractionCandidateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomatedNoticeRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AutomatedNoticeRecord_decision_check" CHECK ("decision" IN ('accepted', 'blocked', 'retryable')),
    CONSTRAINT "AutomatedNoticeRecord_publicationStatus_check" CHECK ("publicationStatus" IN ('published', 'blocked', 'retryable')),
    CONSTRAINT "AutomatedNoticeRecord_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AutomatedNoticeRecord_extractionCandidateId_fkey" FOREIGN KEY ("extractionCandidateId") REFERENCES "ExtractionCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AutomatedNoticeRecord_bundleId_evidenceFingerprint_key" ON "AutomatedNoticeRecord"("bundleId", "evidenceFingerprint");
CREATE INDEX "AutomatedNoticeRecord_bundleId_updatedAt_idx" ON "AutomatedNoticeRecord"("bundleId", "updatedAt");
CREATE INDEX "AutomatedNoticeRecord_decision_nextRetryAt_idx" ON "AutomatedNoticeRecord"("decision", "nextRetryAt");
